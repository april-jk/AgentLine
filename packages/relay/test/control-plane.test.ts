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
});
