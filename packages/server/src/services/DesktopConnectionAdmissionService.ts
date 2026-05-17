import type { RemoteAccessService } from "../remote-access/RemoteAccessService.js";
import type { ControlPlaneBridgeService } from "./ControlPlaneBridgeService.js";

export type DesktopConnectionRejectReason =
  | "desktop_account_unavailable"
  | "desktop_account_logged_out"
  | "remote_access_disabled"
  | "host_access_not_configured"
  | "device_not_registered";

export interface DesktopConnectionAdmissionResult {
  allowed: boolean;
  reason?: DesktopConnectionRejectReason;
  authEpoch: number;
}

export interface DesktopConnectionAdmissionServiceOptions {
  remoteAccessService: RemoteAccessService;
  controlPlaneBridgeService?: ControlPlaneBridgeService;
}

/**
 * Central desktop-side gate for relay-delivered remote connections.
 * Relay may route traffic to the desktop, but final admission still happens here.
 */
export class DesktopConnectionAdmissionService {
  constructor(
    private readonly options: DesktopConnectionAdmissionServiceOptions,
  ) {}

  getCurrentAuthEpoch(): number {
    return this.options.remoteAccessService.getAuthEpoch();
  }

  canAcceptRelayConnection(): DesktopConnectionAdmissionResult {
    const authEpoch = this.getCurrentAuthEpoch();
    const bridge = this.options.controlPlaneBridgeService;
    if (!bridge) {
      return {
        allowed: false,
        reason: "desktop_account_unavailable",
        authEpoch,
      };
    }

    const state = bridge.getState();
    if (!state.enabled) {
      return {
        allowed: false,
        reason: "desktop_account_logged_out",
        authEpoch,
      };
    }

    if (state.pausedReason === "unauthorized") {
      return {
        allowed: false,
        reason: "desktop_account_logged_out",
        authEpoch,
      };
    }

    if (!this.options.remoteAccessService.isHostAccessEnabled()) {
      return {
        allowed: false,
        reason: "host_access_not_configured",
        authEpoch,
      };
    }

    if (!this.options.remoteAccessService.isEnabled()) {
      return {
        allowed: false,
        reason: "remote_access_disabled",
        authEpoch,
      };
    }

    if (!state.deviceId || !state.relayUsername) {
      return {
        allowed: false,
        reason: "device_not_registered",
        authEpoch,
      };
    }

    return { allowed: true, authEpoch };
  }
}
