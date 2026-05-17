import { describe, expect, it } from "vitest";
import type { ActiveRelayServer } from "../src/connections.js";
import { RelayControlPlaneService } from "../src/control-plane.js";
import { createTestDb } from "../src/db.js";

describe("RelayControlPlaneService", () => {
  it("registers, logs in, and authenticates a user", async () => {
    const db = createTestDb();
    const service = new RelayControlPlaneService(db);

    const user = await service.registerUser("user@example.com", "password123");
    expect(user.email).toBe("user@example.com");

    const login = await service.login("user@example.com", "password123");
    expect(login.user.id).toBe(user.id);
    expect(login.session.token.length).toBeGreaterThan(10);

    const auth = await service.authenticate(login.session.token);
    expect(auth.user.id).toBe(user.id);

    db.close();
  });

  it("rejects duplicate emails and invalid credentials", async () => {
    const db = createTestDb();
    const service = new RelayControlPlaneService(db);

    await service.registerUser("user@example.com", "password123");
    await expect(
      service.registerUser("user@example.com", "password123"),
    ).rejects.toThrow("email_taken");
    await expect(service.login("user@example.com", "wrong")).rejects.toThrow(
      "invalid_credentials",
    );

    db.close();
  });

  it("creates and updates devices per install id", async () => {
    const db = createTestDb();
    const service = new RelayControlPlaneService(db);
    const user = await service.registerUser("user@example.com", "password123");

    const deviceA = await service.registerOrUpdateDevice({
      userId: user.id,
      installId: "install-1",
      deviceName: "MacBook Pro",
      deviceType: "desktop",
    });
    expect(deviceA.relayUsername.startsWith("dev-")).toBe(true);

    const deviceB = await service.registerOrUpdateDevice({
      userId: user.id,
      installId: "install-1",
      deviceName: "Mac mini",
      deviceType: "desktop",
    });
    expect(deviceB.id).toBe(deviceA.id);
    expect(deviceB.deviceName).toBe("Mac mini");

    db.close();
  });

  it("maps device relay state from active relay servers", async () => {
    const db = createTestDb();
    const service = new RelayControlPlaneService(db);
    const user = await service.registerUser("user@example.com", "password123");

    const waitingDevice = await service.registerOrUpdateDevice({
      userId: user.id,
      installId: "install-a",
      deviceName: "Desktop A",
      deviceType: "desktop",
    });
    const pairedDevice = await service.registerOrUpdateDevice({
      userId: user.id,
      installId: "install-b",
      deviceName: "Desktop B",
      deviceType: "desktop",
    });

    const activeServers: ActiveRelayServer[] = [
      {
        username: waitingDevice.relayUsername,
        installId: "install-a",
        connectedAt: new Date().toISOString(),
        state: "waiting",
      },
      {
        username: pairedDevice.relayUsername,
        installId: "install-b",
        connectedAt: new Date().toISOString(),
        state: "paired",
      },
    ];

    const devices = await service.listDevices(user.id, activeServers);
    const waiting = devices.find((device) => device.id === waitingDevice.id);
    const paired = devices.find((device) => device.id === pairedDevice.id);

    expect(waiting?.relayState).toBe("waiting");
    expect(paired?.relayState).toBe("paired");
    expect(waiting?.machineId).toBe(waitingDevice.id);
    expect(waiting?.owner.userId).toBe(user.id);
    expect(waiting?.machine.routeId).toBe(waitingDevice.relayUsername);
    expect(waiting?.machine.endpoints.relay.relayUsername).toBe(
      waitingDevice.relayUsername,
    );

    db.close();
  });

  it("issues and consumes relay grants once", async () => {
    const db = createTestDb();
    const service = new RelayControlPlaneService(db);
    const user = await service.registerUser("user@example.com", "password123");
    const login = await service.login("user@example.com", "password123");

    const device = await service.registerOrUpdateDevice({
      userId: user.id,
      installId: "install-1",
      deviceName: "Desktop A",
      deviceType: "desktop",
    });

    const serverGrant = await service.issueServerRegisterGrant({
      userId: user.id,
      sessionId: login.session.id,
      installId: "install-1",
      relayUsername: device.relayUsername,
    });

    const consumedServerGrant = await service.consumeRelayGrant({
      token: serverGrant.grant,
      expectedType: "server_register",
    });
    expect(consumedServerGrant.userId).toBe(user.id);
    expect(consumedServerGrant.relayUsername).toBe(device.relayUsername);

    await expect(
      service.consumeRelayGrant({
        token: serverGrant.grant,
        expectedType: "server_register",
      }),
    ).rejects.toThrow("grant_consumed");

    const clientGrant = await service.issueClientConnectGrant({
      userId: user.id,
      sessionId: login.session.id,
      deviceId: device.id,
    });
    const consumedClientGrant = await service.consumeRelayGrant({
      token: clientGrant.grant,
      expectedType: "client_connect",
    });
    expect(consumedClientGrant.deviceId).toBe(device.id);
    expect(consumedClientGrant.relayUsername).toBe(device.relayUsername);

    db.close();
  });

  it("marks stale heartbeat devices offline in account device views", async () => {
    const db = createTestDb();
    const service = new RelayControlPlaneService(db, {
      deviceHeartbeatOfflineTimeoutMs: 60_000,
    });
    const user = await service.registerUser("user@example.com", "password123");

    const device = await service.registerOrUpdateDevice({
      userId: user.id,
      installId: "install-stale",
      deviceName: "Desktop Stale",
      deviceType: "desktop",
    });
    const staleIso = new Date(Date.now() - 120_000).toISOString();
    db.prepare(
      "UPDATE devices SET last_seen_at = ?, updated_at = ? WHERE id = ?",
    ).run(staleIso, staleIso, device.id);

    const devices = await service.listDevices(user.id, [
      {
        username: device.relayUsername,
        installId: "install-stale",
        connectedAt: new Date().toISOString(),
        state: "waiting",
      },
    ]);
    const view = devices.find((item) => item.id === device.id);

    expect(view?.relayState).toBe("offline");
    expect(view?.machine.heartbeat.offline).toBe(true);
    expect(view?.machine.heartbeat.offlineTimeoutMs).toBe(60_000);
    expect(view?.machine.heartbeat.ageMs).toBeGreaterThan(60_000);

    db.close();
  });

  it("blocks client grants while heartbeat is stale and recovers after heartbeat", async () => {
    const db = createTestDb();
    const service = new RelayControlPlaneService(db, {
      deviceHeartbeatOfflineTimeoutMs: 60_000,
    });
    const user = await service.registerUser("user@example.com", "password123");
    const login = await service.login("user@example.com", "password123");

    const device = await service.registerOrUpdateDevice({
      userId: user.id,
      installId: "install-grant-stale",
      deviceName: "Desktop Grant",
      deviceType: "desktop",
    });
    const staleIso = new Date(Date.now() - 121_000).toISOString();
    db.prepare(
      "UPDATE devices SET last_seen_at = ?, updated_at = ? WHERE id = ?",
    ).run(staleIso, staleIso, device.id);

    await expect(
      service.issueClientConnectGrant({
        userId: user.id,
        sessionId: login.session.id,
        deviceId: device.id,
      }),
    ).rejects.toThrow("device_offline");

    await service.touchDevice({ userId: user.id, deviceId: device.id });

    const grant = await service.issueClientConnectGrant({
      userId: user.id,
      sessionId: login.session.id,
      deviceId: device.id,
    });
    expect(grant.relayUsername).toBe(device.relayUsername);

    db.close();
  });

  it("returns heartbeat metadata by relay username", async () => {
    const db = createTestDb();
    const service = new RelayControlPlaneService(db, {
      deviceHeartbeatOfflineTimeoutMs: 60_000,
    });
    const user = await service.registerUser("user@example.com", "password123");
    const device = await service.registerOrUpdateDevice({
      userId: user.id,
      installId: "install-hb-meta",
      deviceName: "Desktop HB",
      deviceType: "desktop",
    });

    const heartbeat = await service.getDeviceHeartbeatByRelayUsername(
      device.relayUsername,
    );
    expect(heartbeat).not.toBeNull();
    expect(heartbeat?.lastSeenAt).toBeTruthy();
    expect(heartbeat?.offlineTimeoutMs).toBe(60_000);
    expect(heartbeat?.offline).toBe(false);

    const unknown =
      await service.getDeviceHeartbeatByRelayUsername("unknown-user");
    expect(unknown).toBeNull();

    db.close();
  });
});
