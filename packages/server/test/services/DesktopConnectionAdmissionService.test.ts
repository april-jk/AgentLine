import { describe, expect, it, vi } from "vitest";
import { DesktopConnectionAdmissionService } from "../../src/services/DesktopConnectionAdmissionService.js";

describe("DesktopConnectionAdmissionService", () => {
  it("allows relay connection only when desktop account and host access are both active", () => {
    const service = new DesktopConnectionAdmissionService({
      remoteAccessService: {
        getAuthEpoch: () => 4,
        isHostAccessEnabled: () => true,
        isEnabled: () => true,
      } as never,
      controlPlaneBridgeService: {
        getState: vi.fn().mockReturnValue({
          enabled: true,
          running: true,
          consecutiveFailures: 0,
          deviceId: "device-1",
          relayUsername: "desk-a",
        }),
      } as never,
    });

    expect(service.canAcceptRelayConnection()).toEqual({
      allowed: true,
      authEpoch: 4,
    });
  });

  it("rejects relay connection when desktop account is logged out", () => {
    const service = new DesktopConnectionAdmissionService({
      remoteAccessService: {
        getAuthEpoch: () => 2,
        isHostAccessEnabled: () => true,
        isEnabled: () => true,
      } as never,
      controlPlaneBridgeService: {
        getState: vi.fn().mockReturnValue({
          enabled: false,
          running: false,
          pausedReason: "control_plane_not_configured",
          consecutiveFailures: 0,
        }),
      } as never,
    });

    expect(service.canAcceptRelayConnection()).toEqual({
      allowed: false,
      reason: "desktop_account_logged_out",
      authEpoch: 2,
    });
  });

  it("rejects relay connection when the control-plane token is unauthorized", () => {
    const service = new DesktopConnectionAdmissionService({
      remoteAccessService: {
        getAuthEpoch: () => 5,
        isHostAccessEnabled: () => true,
        isEnabled: () => true,
      } as never,
      controlPlaneBridgeService: {
        getState: vi.fn().mockReturnValue({
          enabled: true,
          running: false,
          pausedReason: "unauthorized",
          consecutiveFailures: 1,
        }),
      } as never,
    });

    expect(service.canAcceptRelayConnection()).toEqual({
      allowed: false,
      reason: "desktop_account_logged_out",
      authEpoch: 5,
    });
  });
});
