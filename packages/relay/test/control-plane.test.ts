import { describe, expect, it } from "vitest";
import type { ActiveRelayServer } from "../src/connections.js";
import { RelayControlPlaneService } from "../src/control-plane.js";
import { createTestDb } from "../src/db.js";

describe("RelayControlPlaneService", () => {
  it("registers, logs in, and authenticates a user", () => {
    const db = createTestDb();
    const service = new RelayControlPlaneService(db);

    const user = service.registerUser("user@example.com", "password123");
    expect(user.email).toBe("user@example.com");

    const login = service.login("user@example.com", "password123");
    expect(login.user.id).toBe(user.id);
    expect(login.session.token.length).toBeGreaterThan(10);

    const auth = service.authenticate(login.session.token);
    expect(auth.user.id).toBe(user.id);

    db.close();
  });

  it("rejects duplicate emails and invalid credentials", () => {
    const db = createTestDb();
    const service = new RelayControlPlaneService(db);

    service.registerUser("user@example.com", "password123");
    expect(() =>
      service.registerUser("user@example.com", "password123"),
    ).toThrow("email_taken");
    expect(() => service.login("user@example.com", "wrong")).toThrow(
      "invalid_credentials",
    );

    db.close();
  });

  it("creates and updates devices per install id", () => {
    const db = createTestDb();
    const service = new RelayControlPlaneService(db);
    const user = service.registerUser("user@example.com", "password123");

    const deviceA = service.registerOrUpdateDevice({
      userId: user.id,
      installId: "install-1",
      deviceName: "MacBook Pro",
      deviceType: "desktop",
    });
    expect(deviceA.relayUsername.startsWith("dev-")).toBe(true);

    const deviceB = service.registerOrUpdateDevice({
      userId: user.id,
      installId: "install-1",
      deviceName: "Mac mini",
      deviceType: "desktop",
    });
    expect(deviceB.id).toBe(deviceA.id);
    expect(deviceB.deviceName).toBe("Mac mini");

    db.close();
  });

  it("maps device relay state from active relay servers", () => {
    const db = createTestDb();
    const service = new RelayControlPlaneService(db);
    const user = service.registerUser("user@example.com", "password123");

    const waitingDevice = service.registerOrUpdateDevice({
      userId: user.id,
      installId: "install-a",
      deviceName: "Desktop A",
      deviceType: "desktop",
    });
    const pairedDevice = service.registerOrUpdateDevice({
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

    const devices = service.listDevices(user.id, activeServers);
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
});
