/**
 * Remote access API routes.
 */

import { Hono } from "hono";
import type { ControlPlaneBridgeService } from "../services/ControlPlaneBridgeService.js";
import type { RelayClientService } from "../services/RelayClientService.js";
import type { ServerSettingsService } from "../services/ServerSettingsService.js";
import type { RemoteAccessService } from "./RemoteAccessService.js";
import type { RemoteSessionService } from "./RemoteSessionService.js";

export interface RemoteAccessRoutesOptions {
  remoteAccessService: RemoteAccessService;
  /** Optional session service for invalidating sessions on password change */
  remoteSessionService?: RemoteSessionService;
  /** Optional relay client service for status reporting */
  relayClientService?: RelayClientService;
  /** Optional control-plane bridge service for account/device automation */
  controlPlaneBridgeService?: ControlPlaneBridgeService;
  /** Optional settings service for persisting control-plane credentials */
  serverSettingsService?: ServerSettingsService;
  /** Callback to update relay connection when config changes */
  onRelayConfigChanged?: () => Promise<void>;
}

export function createRemoteAccessRoutes(
  options: RemoteAccessRoutesOptions,
): Hono {
  const {
    remoteAccessService,
    remoteSessionService,
    relayClientService,
    controlPlaneBridgeService,
    serverSettingsService,
    onRelayConfigChanged,
  } = options;
  const app = new Hono();

  const normalizeControlPlaneBaseUrl = (rawValue: string): string => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      throw new Error("control_plane_base_url_required");
    }
    const withScheme =
      trimmed.startsWith("http://") || trimmed.startsWith("https://")
        ? trimmed
        : `https://${trimmed}`;
    return withScheme.replace(/\/+$/, "");
  };

  const deriveRelayWsUrl = (baseUrl: string): string => {
    const url = new URL(baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws";
    url.search = "";
    url.hash = "";
    return url.toString();
  };

  /**
   * GET /api/remote-access/config
   * Get current remote access configuration.
   */
  app.get("/config", async (c) => {
    const config = remoteAccessService.getConfig();
    return c.json(config);
  });

  /**
   * POST /api/remote-access/configure
   * Configure host-access password (SRP verifier).
   * If relay exists, relay username is used as SRP identity.
   * Otherwise a local SRP identity is used for direct/offline auth.
   * Body: { password: string }
   */
  app.post("/configure", async (c) => {
    try {
      const body = await c.req.json<{ password: string }>();

      if (!body.password) {
        return c.json({ error: "Password is required" }, 400);
      }

      // Get existing username before changing (to invalidate their sessions)
      const existingUsername = remoteAccessService.getUsername();

      await remoteAccessService.configure(body.password);

      // Get the username (relay username) that was used
      const newUsername = remoteAccessService.getUsername();

      // Invalidate all sessions for the username (password changed)
      if (remoteSessionService && existingUsername) {
        const count =
          await remoteSessionService.invalidateUserSessions(existingUsername);
        if (count > 0) {
          console.log(
            `[RemoteAccess] Invalidated ${count} sessions for ${existingUsername}`,
          );
        }
      }

      return c.json({ success: true, username: newUsername });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to configure";
      return c.json({ error: message }, 400);
    }
  });

  /**
   * POST /api/remote-access/enable
   * Enable remote access (must be configured first).
   */
  app.post("/enable", async (c) => {
    try {
      await remoteAccessService.enable();
      return c.json({ success: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to enable";
      return c.json({ error: message }, 400);
    }
  });

  /**
   * POST /api/remote-access/disable
   * Disable remote access (keeps credentials).
   */
  app.post("/disable", async (c) => {
    try {
      await remoteAccessService.disable();
      return c.json({ success: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to disable";
      return c.json({ error: message }, 400);
    }
  });

  /**
   * POST /api/remote-access/clear
   * Clear all credentials and disable remote access.
   */
  app.post("/clear", async (c) => {
    try {
      // Get username before clearing to invalidate their sessions
      const existingUsername = remoteAccessService.getUsername();

      await remoteAccessService.clearCredentials();

      // Invalidate all sessions for the user
      if (remoteSessionService && existingUsername) {
        const count =
          await remoteSessionService.invalidateUserSessions(existingUsername);
        if (count > 0) {
          console.log(
            `[RemoteAccess] Invalidated ${count} sessions for ${existingUsername}`,
          );
        }
      }

      return c.json({ success: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to clear";
      return c.json({ error: message }, 400);
    }
  });

  /**
   * GET /api/remote-access/relay
   * Get relay configuration.
   */
  app.get("/relay", async (c) => {
    const relay = remoteAccessService.getRelayConfig();
    return c.json({ relay });
  });

  /**
   * PUT /api/remote-access/relay
   * Set relay URL and username.
   * Body: { url: string, username: string }
   */
  app.put("/relay", async (c) => {
    try {
      const body = await c.req.json<{ url: string; username: string }>();

      if (!body.url || !body.username) {
        return c.json({ error: "URL and username are required" }, 400);
      }

      // Get existing username before changing (to invalidate sessions on username change)
      const existingUsername = remoteAccessService.getUsername();

      await remoteAccessService.setRelayConfig({
        url: body.url,
        username: body.username,
      });

      // Invalidate sessions if username changed (sessions are tied to username identity)
      if (
        remoteSessionService &&
        existingUsername &&
        existingUsername !== body.username
      ) {
        const count =
          await remoteSessionService.invalidateUserSessions(existingUsername);
        if (count > 0) {
          console.log(
            `[RemoteAccess] Relay username changed, invalidated ${count} sessions for ${existingUsername}`,
          );
        }
      }

      // Notify server to reconnect with new config
      await onRelayConfigChanged?.();

      return c.json({ success: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to set relay config";
      return c.json({ error: message }, 400);
    }
  });

  /**
   * DELETE /api/remote-access/relay
   * Clear relay configuration.
   */
  app.delete("/relay", async (c) => {
    try {
      // Get username before clearing to invalidate their sessions
      const existingUsername = remoteAccessService.getUsername();

      await remoteAccessService.clearRelayConfig();

      // Invalidate all sessions for the user (relay identity is being removed)
      if (remoteSessionService && existingUsername) {
        const count =
          await remoteSessionService.invalidateUserSessions(existingUsername);
        if (count > 0) {
          console.log(
            `[RemoteAccess] Relay config cleared, invalidated ${count} sessions for ${existingUsername}`,
          );
        }
      }

      // Notify server to disconnect
      await onRelayConfigChanged?.();

      return c.json({ success: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to clear relay config";
      return c.json({ error: message }, 400);
    }
  });

  /**
   * GET /api/remote-access/relay/status
   * Get relay client connection status.
   */
  app.get("/relay/status", (c) => {
    if (!relayClientService) {
      return c.json({
        status: "disconnected" as const,
        error: null,
        reconnectAttempts: 0,
      });
    }
    const state = relayClientService.getState();
    return c.json({
      status: state.status,
      error: state.error ?? null,
      reconnectAttempts: state.reconnectAttempts,
    });
  });

  /**
   * GET /api/remote-access/control-plane/status
   * Get control-plane bridge status (desktop auto register/heartbeat).
   */
  app.get("/control-plane/status", (c) => {
    if (!controlPlaneBridgeService) {
      return c.json({
        enabled: false,
        running: false,
        pausedReason: "unavailable",
        consecutiveFailures: 0,
      });
    }
    return c.json(controlPlaneBridgeService.getState());
  });

  /**
   * PUT /api/remote-access/control-plane/config
   * Configure control-plane bridge credentials at runtime and sync immediately.
   */
  app.put("/control-plane/config", async (c) => {
    if (!controlPlaneBridgeService) {
      return c.json({ error: "control_plane_bridge_unavailable" }, 503);
    }

    try {
      const body = await c.req.json<{
        baseUrl?: string;
        accessToken?: string;
        relayWsUrl?: string;
        deviceName?: string;
        deviceType?: string;
        lastEmail?: string;
      }>();
      const rawBaseUrl = body.baseUrl ?? "";
      const rawAccessToken = body.accessToken ?? "";
      if (!rawBaseUrl.trim() || !rawAccessToken.trim()) {
        return c.json(
          { error: "control_plane_base_url_and_access_token_required" },
          400,
        );
      }

      const normalizedBaseUrl = normalizeControlPlaneBaseUrl(rawBaseUrl);
      const relayWsUrl =
        body.relayWsUrl?.trim() || deriveRelayWsUrl(normalizedBaseUrl);
      const state = await controlPlaneBridgeService.reconfigure({
        baseUrl: normalizedBaseUrl,
        accessToken: rawAccessToken.trim(),
        relayUrl: relayWsUrl,
        deviceName: body.deviceName?.trim() || undefined,
        deviceType: body.deviceType?.trim() || undefined,
      });

      if (state.pausedReason === "unauthorized") {
        return c.json({ error: "control_plane_unauthorized", state }, 401);
      }

      await serverSettingsService?.updateSettings({
        controlPlaneBaseUrl: normalizedBaseUrl,
        controlPlaneAccessToken: rawAccessToken.trim(),
        controlPlaneRelayWsUrl: relayWsUrl,
        controlPlaneLastEmail: body.lastEmail?.trim() || undefined,
      });

      if (!state.deviceId || !state.relayUsername) {
        return c.json(
          { error: state.lastError ?? "control_plane_sync_failed", state },
          502,
        );
      }

      return c.json({
        success: true,
        state,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "control_plane_config_failed";
      return c.json({ error: message }, 400);
    }
  });

  /**
   * DELETE /api/remote-access/control-plane/config
   * Clear runtime control-plane credentials and stop bridge sync.
   */
  app.delete("/control-plane/config", async (c) => {
    if (!controlPlaneBridgeService) {
      return c.json({ error: "control_plane_bridge_unavailable" }, 503);
    }

    const existingUsername = remoteAccessService.getUsername();

    await controlPlaneBridgeService.reconfigure({
      baseUrl: undefined,
      accessToken: undefined,
      relayUrl: undefined,
    });
    if (remoteSessionService && existingUsername) {
      const revokedCount =
        await remoteSessionService.invalidateUserSessions(existingUsername);
      if (revokedCount > 0) {
        console.log(
          `[RemoteAccess] Control-plane logout revoked ${revokedCount} remote session(s) for ${existingUsername}`,
        );
      }
    }
    await remoteAccessService.clearRelayConfig();
    await onRelayConfigChanged?.();
    await serverSettingsService?.updateSettings({
      controlPlaneBaseUrl: undefined,
      controlPlaneAccessToken: undefined,
      controlPlaneRelayWsUrl: undefined,
      controlPlaneLastEmail: undefined,
    });

    return c.json({ success: true });
  });

  /**
   * POST /api/remote-access/control-plane/sync
   * Trigger an immediate control-plane sync cycle.
   */
  app.post("/control-plane/sync", async (c) => {
    if (!controlPlaneBridgeService) {
      return c.json({ error: "control_plane_bridge_unavailable" }, 503);
    }
    const state = await controlPlaneBridgeService.syncNow();
    return c.json(state);
  });

  /**
   * POST /api/remote-access/control-plane/grants/client-connect
   * Issue a short-lived one-time relay client grant using desktop control-plane auth.
   */
  app.post("/control-plane/grants/client-connect", async (c) => {
    if (!controlPlaneBridgeService) {
      return c.json({ error: "control_plane_bridge_unavailable" }, 503);
    }

    try {
      const body = await c.req
        .json<{
          relayUsername?: string;
          deviceId?: string;
        }>()
        .catch(() => null);

      const grant = await controlPlaneBridgeService.getClientConnectGrant({
        relayUsername: body?.relayUsername,
        deviceId: body?.deviceId,
      });
      return c.json(grant, 200);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "control_plane_grant_failed";
      if (message === "control_plane_not_configured") {
        return c.json({ error: message }, 400);
      }
      if (message === "unauthorized" || message === "control_plane_401") {
        return c.json({ error: "control_plane_unauthorized" }, 401);
      }
      if (message === "device_not_found") {
        return c.json({ error: message }, 404);
      }
      if (message.startsWith("control_plane_")) {
        return c.json({ error: message }, 502);
      }
      return c.json({ error: message }, 400);
    }
  });

  /**
   * GET /api/remote-access/sessions
   * List all active remote sessions.
   */
  app.get("/sessions", (c) => {
    if (!remoteSessionService) {
      return c.json({ sessions: [] });
    }
    const sessions = remoteSessionService.listSessions();
    return c.json({ sessions });
  });

  /**
   * DELETE /api/remote-access/sessions/:sessionId
   * Revoke a specific session.
   */
  app.delete("/sessions/:sessionId", async (c) => {
    if (!remoteSessionService) {
      return c.json({ error: "Session service not available" }, 500);
    }
    const sessionId = c.req.param("sessionId");
    await remoteSessionService.deleteSession(sessionId);
    return c.json({ success: true });
  });

  /**
   * DELETE /api/remote-access/sessions
   * Revoke all sessions.
   */
  app.delete("/sessions", async (c) => {
    if (!remoteSessionService) {
      return c.json({ error: "Session service not available" }, 500);
    }
    const username = remoteAccessService.getUsername();
    if (username) {
      const count = await remoteSessionService.invalidateUserSessions(username);
      return c.json({ success: true, revokedCount: count });
    }
    return c.json({ success: true, revokedCount: 0 });
  });

  return app;
}
