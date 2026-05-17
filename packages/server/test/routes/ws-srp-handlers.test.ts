import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  SrpError,
  SrpServerChallenge,
  SrpSessionInvalid,
} from "@agentline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteSessionService } from "../../src/remote-access/RemoteSessionService.js";
import { createConnectionState } from "../../src/routes/ws-relay-handlers.js";
import {
  handleSrpHello,
  handleSrpResumeInit,
} from "../../src/routes/ws-srp-handlers.js";
import { DesktopConnectionAdmissionService } from "../../src/services/DesktopConnectionAdmissionService.js";

function createMockWs() {
  const sent: Array<SrpError | SrpServerChallenge | SrpSessionInvalid> = [];
  const result = {
    sent,
    closed: null as { code?: number; reason?: string } | null,
    adapter: {
      send(data: string | ArrayBuffer | Uint8Array<ArrayBuffer>) {
        if (typeof data === "string") {
          sent.push(
            JSON.parse(data) as
              | SrpError
              | SrpServerChallenge
              | SrpSessionInvalid,
          );
        }
      },
      close(code?: number, reason?: string) {
        result.closed = { code, reason };
      },
    },
  };
  return result;
}

let mock: ReturnType<typeof createMockWs>;
let tempDir: string;

describe("ws-srp-handlers relay admission", () => {
  beforeEach(async () => {
    mock = createMockWs();
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "agentline-ws-srp-handlers-test-"),
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("blocks relay SRP hello when desktop account is logged out", async () => {
    const connState = createConnectionState();
    connState.isRelayConnection = true;
    const admission = new DesktopConnectionAdmissionService({
      remoteAccessService: {
        getAuthEpoch: () => 1,
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

    await handleSrpHello(
      mock.adapter,
      connState,
      {
        type: "srp_hello",
        identity: "desk-a",
        A: "client-a",
      },
      {
        getCredentials: () => ({ salt: "salt", verifier: "verifier" }),
        getUsername: () => "desk-a",
      } as never,
      admission,
    );

    expect(mock.sent[0]).toMatchObject({
      type: "srp_error",
      message: "desktop_account_logged_out",
    });
    expect(mock.closed).toEqual({
      code: 4001,
      reason: "desktop_account_logged_out",
    });
  });

  it("rejects relay session resume when auth epoch changed after logout", async () => {
    const remoteSessionService = new RemoteSessionService({
      dataDir: tempDir,
    });
    await remoteSessionService.initialize();
    const sessionId = await remoteSessionService.createSession(
      "desk-a",
      new Uint8Array(32).fill(0x42),
      { authEpoch: 2 },
    );

    const connState = createConnectionState();
    connState.isRelayConnection = true;
    const admission = new DesktopConnectionAdmissionService({
      remoteAccessService: {
        getAuthEpoch: () => 3,
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

    await handleSrpResumeInit(
      mock.adapter,
      connState,
      {
        type: "srp_resume_init",
        identity: "desk-a",
        sessionId,
      },
      remoteSessionService,
      admission,
    );

    expect(mock.sent[0]).toEqual({
      type: "srp_invalid",
      reason: "invalid_proof",
    });
    remoteSessionService.shutdown();
  });
});
