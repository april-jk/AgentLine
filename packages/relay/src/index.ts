import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebSocketServer } from "ws";
import { loadConfig } from "./config.js";
import { ConnectionManager } from "./connections.js";
import {
  RelayControlPlaneService,
  toMachineCompatibleDeviceView,
} from "./control-plane.js";
import { createDb } from "./db.js";
import { createLogger } from "./logger.js";
import { UsernameRegistry } from "./registry.js";
import { generateRelayStatsHtml } from "./stats.js";
import { createRelayTelemetryRecorder } from "./telemetry.js";
import { createWsHandler } from "./ws-handler.js";

const config = loadConfig();

// Initialize logger with file logging enabled by default
const logger = createLogger(config.logging);

logger.info(
  {
    dataDir: config.dataDir,
    port: config.port,
    logFile: config.logging.logToFile
      ? `${config.logging.logDir}/${config.logging.logFile}`
      : "disabled",
  },
  "Starting relay server",
);

// Initialize database and registry
const db = createDb(config.dataDir);
const registry = new UsernameRegistry(db);
const controlPlane = new RelayControlPlaneService(db);

// Run reclamation on startup
const reclaimed = registry.reclaimInactive(config.reclaimDays);
if (reclaimed > 0) {
  logger.info({ count: reclaimed }, "Reclaimed inactive usernames");
}

// Create connection manager
const connectionManager = new ConnectionManager(registry);
const telemetry = createRelayTelemetryRecorder(config.telemetry, logger);
telemetry.startSampling(() => ({
  waiting: connectionManager.getWaitingCount(),
  pairs: connectionManager.getPairCount(),
  registered: registry.count(),
  activeServers: connectionManager.getActiveServers().length,
}));

// Create Hono app for HTTP endpoints
const app = new Hono();

// Add CORS for browser clients
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

function getBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token.trim();
}

function deriveRelayState(
  connectionManager: ConnectionManager,
  relayUsername: string,
): "offline" | "waiting" | "paired" {
  const active = connectionManager
    .getActiveServers()
    .find((server) => server.username === relayUsername);
  if (!active) return "offline";
  return active.state === "paired" ? "paired" : "waiting";
}

interface ParsedHeartbeatPayload {
  lanEndpoint: {
    kind: "lan";
    address: string;
    port: number;
    boundToAllInterfaces?: boolean;
    localhostOnly?: boolean;
    lastSeenAt: string;
    expiresAt?: string;
  } | null;
  hostService: {
    listening?: boolean;
    boundToAllInterfaces?: boolean;
    localhostOnly?: boolean;
  } | null;
}

function parseHeartbeatPayload(raw: unknown): ParsedHeartbeatPayload {
  const payload =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const machine =
    typeof payload.machine === "object" && payload.machine !== null
      ? (payload.machine as Record<string, unknown>)
      : {};
  const endpoints =
    typeof machine.endpoints === "object" && machine.endpoints !== null
      ? (machine.endpoints as Record<string, unknown>)
      : {};
  const lanRaw =
    typeof endpoints.lan === "object" && endpoints.lan !== null
      ? (endpoints.lan as Record<string, unknown>)
      : null;
  const hostServiceRaw =
    typeof machine.hostService === "object" && machine.hostService !== null
      ? (machine.hostService as Record<string, unknown>)
      : null;

  const lanEndpoint =
    lanRaw &&
    typeof lanRaw.address === "string" &&
    typeof lanRaw.port === "number" &&
    Number.isFinite(lanRaw.port)
      ? {
          kind: "lan" as const,
          address: lanRaw.address,
          port: lanRaw.port,
          boundToAllInterfaces:
            typeof lanRaw.boundToAllInterfaces === "boolean"
              ? lanRaw.boundToAllInterfaces
              : undefined,
          localhostOnly:
            typeof lanRaw.localhostOnly === "boolean"
              ? lanRaw.localhostOnly
              : undefined,
          lastSeenAt:
            typeof lanRaw.lastSeenAt === "string"
              ? lanRaw.lastSeenAt
              : new Date().toISOString(),
          expiresAt:
            typeof lanRaw.expiresAt === "string" ? lanRaw.expiresAt : undefined,
        }
      : null;

  const hostService =
    hostServiceRaw &&
    (typeof hostServiceRaw.listening === "boolean" ||
      typeof hostServiceRaw.boundToAllInterfaces === "boolean" ||
      typeof hostServiceRaw.localhostOnly === "boolean")
      ? {
          listening:
            typeof hostServiceRaw.listening === "boolean"
              ? hostServiceRaw.listening
              : undefined,
          boundToAllInterfaces:
            typeof hostServiceRaw.boundToAllInterfaces === "boolean"
              ? hostServiceRaw.boundToAllInterfaces
              : undefined,
          localhostOnly:
            typeof hostServiceRaw.localhostOnly === "boolean"
              ? hostServiceRaw.localhostOnly
              : undefined,
        }
      : null;

  return { lanEndpoint, hostService };
}

// Health check endpoint
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    uptime: process.uptime(),
    waiting: connectionManager.getWaitingCount(),
    pairs: connectionManager.getPairCount(),
  });
});

// Status endpoint with more details
app.get("/status", (c) => {
  return c.json({
    status: "ok",
    uptime: process.uptime(),
    waiting: connectionManager.getWaitingCount(),
    pairs: connectionManager.getPairCount(),
    registered: registry.count(),
    activeServers: connectionManager.getActiveServers(),
    compatibility: connectionManager.getActiveServerSummary(),
    telemetry: telemetry.getStatus(),
    memory: process.memoryUsage(),
  });
});

app.get("/stats", (c) => {
  const telemetryStatus = telemetry.getStatus();
  if (!telemetryStatus.enabled || !telemetryStatus.eventsDir) {
    return c.html(
      "<html><body><p>Relay telemetry is disabled.</p></body></html>",
    );
  }

  return c.html(generateRelayStatsHtml(telemetryStatus.eventsDir), 200, {
    "Cache-Control": "no-cache, no-store, must-revalidate",
  });
});

app.post("/api/v1/auth/register", async (c) => {
  try {
    const body = await c.req.json();
    const email = typeof body?.email === "string" ? body.email : ("" as string);
    const password =
      typeof body?.password === "string" ? body.password : ("" as string);
    const user = controlPlane.registerUser(email, password);
    return c.json({ user }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "bad_request";
    const status =
      message === "email_taken"
        ? 409
        : message === "invalid_email" || message === "password_too_short"
          ? 400
          : 400;
    return c.json({ error: message }, status);
  }
});

app.post("/api/v1/auth/login", async (c) => {
  try {
    const body = await c.req.json();
    const email = typeof body?.email === "string" ? body.email : ("" as string);
    const password =
      typeof body?.password === "string" ? body.password : ("" as string);

    const { user, session } = controlPlane.login(email, password);
    return c.json(
      {
        user,
        accessToken: session.token,
        expiresAt: session.expiresAt,
      },
      200,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "invalid_credentials";
    if (message === "invalid_credentials") {
      return c.json({ error: message }, 401);
    }
    return c.json({ error: "bad_request" }, 400);
  }
});

app.post("/api/v1/auth/logout", (c) => {
  const token = getBearerToken(c.req.header("authorization"));
  if (!token) {
    return c.json({ error: "unauthorized" }, 401);
  }

  try {
    const auth = controlPlane.authenticate(token);
    controlPlane.revokeSession(auth.sessionId);
    return c.body(null, 204);
  } catch {
    return c.json({ error: "unauthorized" }, 401);
  }
});

app.get("/api/v1/me", (c) => {
  const token = getBearerToken(c.req.header("authorization"));
  if (!token) {
    return c.json({ error: "unauthorized" }, 401);
  }

  try {
    const auth = controlPlane.authenticate(token);
    return c.json({ user: auth.user });
  } catch {
    return c.json({ error: "unauthorized" }, 401);
  }
});

app.post("/api/v1/devices/register", async (c) => {
  const token = getBearerToken(c.req.header("authorization"));
  if (!token) {
    return c.json({ error: "unauthorized" }, 401);
  }

  try {
    const auth = controlPlane.authenticate(token);
    const body = await c.req.json();
    const installId =
      typeof body?.installId === "string" ? body.installId : ("" as string);
    const deviceName =
      typeof body?.deviceName === "string"
        ? body.deviceName
        : ("AgentLine Device" as string);
    const deviceType =
      typeof body?.deviceType === "string"
        ? body.deviceType
        : ("desktop" as string);

    const device = controlPlane.registerOrUpdateDevice({
      userId: auth.user.id,
      installId,
      deviceName,
      deviceType,
    });
    const relayState = deriveRelayState(
      connectionManager,
      device.relayUsername,
    );
    return c.json(
      { device: toMachineCompatibleDeviceView(device, relayState) },
      200,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "bad_request";
    if (message === "unauthorized") {
      return c.json({ error: "unauthorized" }, 401);
    }
    return c.json({ error: message }, 400);
  }
});

app.post("/api/v1/devices/:deviceId/heartbeat", async (c) => {
  const token = getBearerToken(c.req.header("authorization"));
  if (!token) {
    return c.json({ error: "unauthorized" }, 401);
  }

  try {
    const auth = controlPlane.authenticate(token);
    const deviceId = c.req.param("deviceId");
    const rawPayload = await c.req.json().catch(() => null);
    const heartbeatPayload = parseHeartbeatPayload(rawPayload);
    const device = controlPlane.touchDevice({ userId: auth.user.id, deviceId });
    const relayState = deriveRelayState(
      connectionManager,
      device.relayUsername,
    );
    const view = toMachineCompatibleDeviceView(device, relayState);
    const enriched =
      heartbeatPayload.lanEndpoint || heartbeatPayload.hostService
        ? {
            ...view,
            machine: {
              ...view.machine,
              hostService: heartbeatPayload.hostService ?? undefined,
              endpoints: {
                ...view.machine.endpoints,
                lan: heartbeatPayload.lanEndpoint ?? null,
              },
            },
          }
        : view;
    return c.json({ device: enriched }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "bad_request";
    if (message === "device_not_found") {
      return c.json({ error: message }, 404);
    }
    return c.json({ error: "unauthorized" }, 401);
  }
});

app.get("/api/v1/devices", (c) => {
  const token = getBearerToken(c.req.header("authorization"));
  if (!token) {
    return c.json({ error: "unauthorized" }, 401);
  }

  try {
    const auth = controlPlane.authenticate(token);
    const devices = controlPlane.listDevices(
      auth.user.id,
      connectionManager.getActiveServers(),
    );
    return c.json({ devices });
  } catch {
    return c.json({ error: "unauthorized" }, 401);
  }
});

// Check if a specific username has a server online (waiting for client)
app.get("/online/:username", (c) => {
  const username = c.req.param("username");
  const online = connectionManager.isWaiting(username);
  return c.json({ online });
});

// Create WebSocket handler
const wsHandler = createWsHandler(connectionManager, config, logger, telemetry);

// Create HTTP server with Hono
const requestListener = getRequestListener(app.fetch);
const server = createServer(requestListener);

// Create WebSocket server attached to the HTTP server, but with noServer
// so we can manually handle upgrades for /ws path only
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket connections
wss.on("connection", (ws) => {
  wsHandler.onOpen(ws);

  ws.on("message", (data, isBinary) => {
    wsHandler.onMessage(ws, data, isBinary);
  });

  ws.on("close", (code, reason) => {
    wsHandler.onClose(ws, code, reason);
  });

  ws.on("error", (error) => {
    wsHandler.onError(ws, error);
  });

  ws.on("pong", () => {
    wsHandler.onPong(ws);
  });
});

// Handle HTTP upgrade requests for WebSocket
server.on("upgrade", (request, socket, head) => {
  const urlPath = request.url || "/";
  logger.debug(
    { urlPath, headers: request.headers },
    "Received upgrade request",
  );

  // Only handle /ws path
  if (!urlPath.startsWith("/ws")) {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  // Upgrade to WebSocket
  wss.handleUpgrade(request, socket, head, (ws) => {
    logger.info({ urlPath }, "WebSocket upgrade complete");
    wss.emit("connection", ws, request);
  });
});

// Start the server
server.listen(config.port, () => {
  // Get the actual port (important when binding to port 0)
  const address = server.address();
  const actualPort =
    typeof address === "object" && address ? address.port : config.port;

  // Write port to file if requested (for test harnesses)
  if (config.portFile) {
    writeFileSync(config.portFile, String(actualPort));
    logger.debug({ portFile: config.portFile }, "Wrote port to file");
  }

  logger.info(
    { port: actualPort },
    `Relay server listening on http://localhost:${actualPort}`,
  );
  logger.info(`WebSocket endpoint: ws://localhost:${actualPort}/ws`);
});

// Graceful shutdown
function shutdown() {
  logger.info("Shutting down relay server...");

  // Close all WebSocket connections first
  for (const client of wss.clients) {
    try {
      client.close(1001, "Server shutting down");
    } catch {
      // Ignore errors
    }
  }
  // Give connections a moment to close gracefully, then force exit
  const forceExitTimeout = setTimeout(() => {
    logger.warn("Force exiting after timeout");
    process.exit(0);
  }, 2000);

  server.close(async () => {
    clearTimeout(forceExitTimeout);
    await telemetry.close();
    db.close();
    logger.info("Relay server stopped");
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
