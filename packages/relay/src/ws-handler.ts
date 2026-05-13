import {
  type RelayClientConnected,
  type RelayClientError,
  type RelayClientErrorReason,
  type RelayServerRegistered,
  type RelayServerRejected,
  type RelayServerRejectedReason,
  isRelayClientConnect,
  isRelayServerRegister,
} from "@agentline/shared";
import type { Logger } from "pino";
import type { RawData, WebSocket } from "ws";
import type { RelayConfig } from "./config.js";
import type {
  ConnectionManager,
  RelayServerAuthContext,
} from "./connections.js";
import type { ConsumedRelayGrant, RelayGrantType } from "./control-plane.js";
import type { RelayTelemetryRecorder } from "./telemetry.js";

/** State for each WebSocket connection */
interface ConnectionState {
  /** Username this connection is associated with (after registration) */
  username?: string;
  /** Whether this is a server connection (vs client) */
  isServer?: boolean;
  /** Whether this connection has been paired */
  paired: boolean;
  /** Ping interval timer */
  pingInterval?: ReturnType<typeof setInterval>;
  /** Pong timeout timer */
  pongTimeout?: ReturnType<typeof setTimeout>;
  /** Last pong received */
  lastPong?: number;
}

interface RelayGrantAuthorizer {
  consumeRelayGrant(params: {
    token: string;
    expectedType: RelayGrantType;
  }): Promise<ConsumedRelayGrant>;
  isSessionActive(sessionId: string): Promise<boolean>;
}

interface WsHandlerOptions {
  grantAuthorizer?: RelayGrantAuthorizer;
  requireGrants?: boolean;
}

/** Track connection state by WebSocket */
const connectionStates = new WeakMap<WebSocket, ConnectionState>();

function getState(ws: WebSocket): ConnectionState {
  let state = connectionStates.get(ws);
  if (!state) {
    state = { paired: false };
    connectionStates.set(ws, state);
  }
  return state;
}

/**
 * Creates the WebSocket message handler for the relay.
 */
export function createWsHandler(
  connectionManager: ConnectionManager,
  config: RelayConfig,
  logger: Logger,
  telemetry: RelayTelemetryRecorder,
  options: WsHandlerOptions = {},
) {
  const requireGrants = options.requireGrants === true;
  const grantAuthorizer = options.grantAuthorizer;

  function sendJson(ws: WebSocket, data: object): void {
    try {
      // Send as text frame (binary: false)
      ws.send(JSON.stringify(data), { binary: false });
    } catch (err) {
      logger.debug({ err }, "Failed to send message");
    }
  }

  function startPingInterval(ws: WebSocket, state: ConnectionState): void {
    // Only ping waiting connections (not paired)
    state.pingInterval = setInterval(() => {
      if (state.paired) {
        // Stop pinging paired connections
        if (state.pingInterval) {
          clearInterval(state.pingInterval);
          state.pingInterval = undefined;
        }
        return;
      }

      // Send WebSocket ping frame
      try {
        ws.ping();
      } catch {
        // Ignore ping errors
      }

      // Set pong timeout
      state.pongTimeout = setTimeout(() => {
        logger.debug(
          { username: state.username },
          "Pong timeout, closing connection",
        );
        try {
          ws.close(1000, "Pong timeout");
        } catch {
          // Ignore close errors
        }
      }, config.pongTimeoutMs);
    }, config.pingIntervalMs);
  }

  function stopPingInterval(state: ConnectionState): void {
    if (state.pingInterval) {
      clearInterval(state.pingInterval);
      state.pingInterval = undefined;
    }
    if (state.pongTimeout) {
      clearTimeout(state.pongTimeout);
      state.pongTimeout = undefined;
    }
  }

  function handlePong(state: ConnectionState): void {
    state.lastPong = Date.now();
    if (state.pongTimeout) {
      clearTimeout(state.pongTimeout);
      state.pongTimeout = undefined;
    }
  }

  function mapGrantErrorToServerRejectReason(
    error: unknown,
  ): RelayServerRejectedReason {
    const message = error instanceof Error ? error.message : "grant_invalid";
    if (message === "grant_expired") return "grant_expired";
    if (message === "grant_consumed") return "grant_consumed";
    if (message === "auth_required") return "auth_required";
    return "grant_invalid";
  }

  function mapGrantErrorToClientErrorReason(
    error: unknown,
  ): RelayClientErrorReason {
    const message = error instanceof Error ? error.message : "grant_invalid";
    if (
      message === "grant_expired" ||
      message === "grant_consumed" ||
      message === "auth_required" ||
      message === "account_mismatch" ||
      message === "server_session_revoked"
    ) {
      return message;
    }
    return "grant_invalid";
  }

  return {
    onOpen(ws: WebSocket): void {
      logger.debug("WebSocket connection opened");
      // State is initialized lazily on first message
    },

    async onMessage(
      ws: WebSocket,
      data: RawData,
      isBinary: boolean,
    ): Promise<void> {
      try {
        const state = getState(ws);

        // Debug logging
        const dataType = isBinary ? "binary" : "text";
        const size =
          data instanceof Buffer
            ? data.length
            : Array.isArray(data)
              ? data.reduce((sum, buf) => sum + buf.length, 0)
              : (data as ArrayBuffer).byteLength;
        logger.debug(
          { paired: state.paired, dataType, size, isServer: state.isServer },
          "onMessage received",
        );

        // Convert RawData to Buffer for consistent handling
        let buffer: Buffer;
        if (data instanceof Buffer) {
          buffer = data;
        } else if (Array.isArray(data)) {
          // Array of Buffers - concatenate
          buffer = Buffer.concat(data);
        } else {
          // ArrayBuffer - need to wrap in Uint8Array first
          buffer = Buffer.from(new Uint8Array(data));
        }

        // If already paired, forward everything preserving frame type
        if (state.paired) {
          connectionManager.forward(ws, buffer, isBinary);
          return;
        }

        // Before pairing, we only accept text frames with JSON protocol messages
        if (isBinary) {
          logger.debug("Received binary message before pairing, ignoring");
          return;
        }

        // Parse JSON message for protocol handling
        let msg: unknown;
        try {
          msg = JSON.parse(buffer.toString("utf8"));
        } catch {
          logger.debug("Failed to parse message as JSON");
          return;
        }

        // Handle server registration
        if (isRelayServerRegister(msg)) {
          let serverAuth: RelayServerAuthContext | undefined;
          if (requireGrants) {
            if (!grantAuthorizer || !msg.serverGrant) {
              const reason: RelayServerRejectedReason = "auth_required";
              const response: RelayServerRejected = {
                type: "server_rejected",
                reason,
              };
              sendJson(ws, response);
              ws.close(1000, "Registration rejected: auth_required");
              return;
            }

            try {
              const grant = await grantAuthorizer.consumeRelayGrant({
                token: msg.serverGrant,
                expectedType: "server_register",
              });
              if (
                grant.relayUsername !== msg.username ||
                (grant.installId && grant.installId !== msg.installId)
              ) {
                throw new Error("grant_invalid");
              }
              serverAuth = {
                userId: grant.userId,
                sessionId: grant.sessionId,
                deviceId: grant.deviceId,
              };
            } catch (error) {
              const reason = mapGrantErrorToServerRejectReason(error);
              const response: RelayServerRejected = {
                type: "server_rejected",
                reason,
              };
              sendJson(ws, response);
              ws.close(1000, `Registration rejected: ${reason}`);
              return;
            }
          }

          const result = connectionManager.registerServer(
            ws,
            msg.username,
            msg.installId,
            {
              appVersion: msg.appVersion,
              resumeProtocolVersion: msg.resumeProtocolVersion,
              renderProtocolVersion: msg.renderProtocolVersion,
              capabilities: msg.capabilities,
            },
            serverAuth,
          );

          if (result === "registered") {
            state.username = msg.username;
            state.isServer = true;
            const response: RelayServerRegistered = {
              type: "server_registered",
            };
            sendJson(ws, response);

            // Start ping interval for waiting connections
            startPingInterval(ws, state);

            telemetry.record({
              event: "server_register",
              username: msg.username,
              installId: msg.installId,
              appVersion: msg.appVersion,
              resumeProtocolVersion: msg.resumeProtocolVersion,
              renderProtocolVersion: msg.renderProtocolVersion,
              capabilities: msg.capabilities
                ? [...msg.capabilities]
                : undefined,
            });

            logger.info(
              {
                username: msg.username,
                appVersion: msg.appVersion,
                resumeProtocolVersion: msg.resumeProtocolVersion,
                renderProtocolVersion: msg.renderProtocolVersion,
                capabilities: msg.capabilities,
              },
              "Server registered",
            );
          } else {
            const response: RelayServerRejected = {
              type: "server_rejected",
              reason: result,
            };
            sendJson(ws, response);
            logger.info(
              { username: msg.username, reason: result },
              "Server registration rejected",
            );
            // Close connection after rejection
            ws.close(1000, `Registration rejected: ${result}`);
          }
          return;
        }

        // Handle client connection
        if (isRelayClientConnect(msg)) {
          if (requireGrants) {
            if (!grantAuthorizer || !msg.clientGrant) {
              const reason: RelayClientErrorReason = "auth_required";
              const response: RelayClientError = {
                type: "client_error",
                reason,
              };
              sendJson(ws, response);
              ws.close(1000, "Connection failed: auth_required");
              return;
            }

            const availability = connectionManager.getClientAvailability(
              msg.username,
            );
            if (availability !== "ready") {
              const response: RelayClientError = {
                type: "client_error",
                reason: availability,
              };
              sendJson(ws, response);
              ws.close(1000, `Connection failed: ${availability}`);
              return;
            }

            const waiting = connectionManager.getWaitingServerInfo(
              msg.username,
            );
            if (!waiting) {
              const response: RelayClientError = {
                type: "client_error",
                reason: "server_offline",
              };
              sendJson(ws, response);
              ws.close(1000, "Connection failed: server_offline");
              return;
            }

            try {
              const grant = await grantAuthorizer.consumeRelayGrant({
                token: msg.clientGrant,
                expectedType: "client_connect",
              });

              if (grant.relayUsername !== msg.username) {
                throw new Error("grant_invalid");
              }

              if (!waiting.auth) {
                throw new Error("auth_required");
              }

              if (
                waiting.auth.userId !== grant.userId ||
                waiting.auth.deviceId !== grant.deviceId
              ) {
                throw new Error("account_mismatch");
              }

              const serverSessionActive = await grantAuthorizer.isSessionActive(
                waiting.auth.sessionId,
              );
              if (!serverSessionActive) {
                try {
                  waiting.ws.close(4001, "session_revoked");
                } catch {
                  // ignore close errors
                }
                throw new Error("server_session_revoked");
              }
            } catch (error) {
              const reason = mapGrantErrorToClientErrorReason(error);
              const response: RelayClientError = {
                type: "client_error",
                reason,
              };
              sendJson(ws, response);
              ws.close(1000, `Connection failed: ${reason}`);
              return;
            }
          }

          const result = connectionManager.connectClient(ws, msg.username);

          if (result.status === "connected") {
            state.username = msg.username;
            state.isServer = false;
            state.paired = true;

            // Also mark the server as paired
            const serverState = getState(result.serverWs);
            serverState.paired = true;

            // Stop ping interval on server (paired connections don't need keepalive from relay)
            stopPingInterval(serverState);

            const response: RelayClientConnected = { type: "client_connected" };
            sendJson(ws, response);

            telemetry.record({
              event: "client_connect_success",
              username: msg.username,
              installId: result.server?.installId,
              appVersion: result.server?.appVersion,
              resumeProtocolVersion: result.server?.resumeProtocolVersion,
              renderProtocolVersion: result.server?.renderProtocolVersion,
              capabilities: result.server?.capabilities
                ? [...result.server.capabilities]
                : undefined,
            });

            logger.info({ username: msg.username }, "Pair connected");
          } else {
            const response: RelayClientError = {
              type: "client_error",
              reason: result.status,
            };
            sendJson(ws, response);
            telemetry.record({
              event: "client_connect_error",
              username: msg.username,
              reason: result.status,
            });
            logger.info(
              { username: msg.username, reason: result.status },
              "Client connection failed",
            );
            ws.close(1000, `Connection failed: ${result.status}`);
          }
          return;
        }

        // If server is waiting and receives a non-protocol message,
        // this means a client was paired and this is the first forwarded message
        if (state.isServer && state.username && !state.paired) {
          // This shouldn't happen - clients send client_connect first
          // But if we receive data before client_connect, treat it as claim detection
          logger.warn(
            { username: state.username },
            "Received non-protocol message on waiting connection",
          );
        }
      } catch (error) {
        logger.error({ err: error }, "Unhandled relay ws message error");
        try {
          ws.close(1011, "Internal server error");
        } catch {
          // ignore
        }
      }
    },

    onClose(ws: WebSocket, code: number, reason: Buffer): void {
      const state = getState(ws);

      stopPingInterval(state);
      const closeResult = connectionManager.handleClose(ws, state.username);

      if (closeResult.kind === "pair_disconnected" && state.username) {
        telemetry.record({
          event: "pair_disconnected",
          username: state.username,
          initiator: closeResult.initiator,
          closeCode: code,
          closeReason: reason.toString("utf8"),
        });
        logger.info({ username: state.username }, "Pair disconnected");
      }

      if (
        closeResult.kind === "waiting_server_closed" &&
        closeResult.server &&
        state.username
      ) {
        telemetry.record({
          event: "server_disconnect",
          username: state.username,
          installId: closeResult.server.installId,
          connectionState: "waiting",
          closeCode: code,
          closeReason: reason.toString("utf8"),
        });
      }

      if (
        closeResult.kind === "pair_disconnected" &&
        closeResult.initiator === "server" &&
        closeResult.server &&
        state.username
      ) {
        telemetry.record({
          event: "server_disconnect",
          username: state.username,
          installId: closeResult.server.installId,
          connectionState: "paired",
          closeCode: code,
          closeReason: reason.toString("utf8"),
        });
      }

      if (state.username) {
        logger.debug(
          {
            username: state.username,
            isServer: state.isServer,
            code,
            reason: reason.toString("utf8"),
          },
          "Connection closed",
        );
      } else {
        logger.debug(
          { code, reason: reason.toString("utf8") },
          "Connection closed (no username)",
        );
      }

      connectionStates.delete(ws);
    },

    onError(ws: WebSocket, error: Error): void {
      const state = getState(ws);
      logger.error({ username: state.username, error }, "WebSocket error");
    },

    onPong(ws: WebSocket): void {
      const state = getState(ws);
      handlePong(state);
    },
  };
}
