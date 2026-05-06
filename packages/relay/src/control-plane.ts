import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { isValidRelayUsername } from "@agentline/shared";
import type Database from "better-sqlite3";
import type { ActiveRelayServer } from "./connections.js";

const ACCESS_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AccountUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  token: string;
  createdAt: string;
  expiresAt: string;
}

export type DeviceRelayState = "offline" | "waiting" | "paired";

export interface AccountDevice {
  id: string;
  userId: string;
  installId: string;
  deviceName: string;
  deviceType: string;
  relayUsername: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
}

export interface AccountDeviceView extends AccountDevice {
  relayState: DeviceRelayState;
}

interface UserRow {
  id: string;
  email: string;
  password_salt: string;
  password_hash: string;
  created_at: string;
}

interface DeviceRow {
  id: string;
  user_id: string;
  install_id: string;
  device_name: string;
  device_type: string;
  relay_username: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

interface AuthLookupRow {
  session_id: string;
  session_user_id: string;
  session_expires_at: string;
  user_id: string;
  user_email: string;
  user_created_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function ensurePassword(password: string): void {
  if (password.length < 8) {
    throw new Error("password_too_short");
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

function toUser(row: UserRow): AccountUser {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
  };
}

function toDevice(row: DeviceRow): AccountDevice {
  return {
    id: row.id,
    userId: row.user_id,
    installId: row.install_id,
    deviceName: row.device_name,
    deviceType: row.device_type,
    relayUsername: row.relay_username,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
  };
}

export class RelayControlPlaneService {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  registerUser(emailInput: string, password: string): AccountUser {
    const email = normalizeEmail(emailInput);
    if (!isValidEmail(email)) {
      throw new Error("invalid_email");
    }
    ensurePassword(password);

    const existing = this.db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get(email) as { id: string } | undefined;
    if (existing) {
      throw new Error("email_taken");
    }

    const now = nowIso();
    const id = randomUUID();
    const salt = randomBytes(16).toString("hex");
    const passwordHash = hashPassword(password, salt);

    this.db
      .prepare(
        "INSERT INTO users (id, email, password_salt, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, email, salt, passwordHash, now, now);

    return { id, email, createdAt: now };
  }

  login(emailInput: string, password: string): {
    user: AccountUser;
    session: AuthSession;
  } {
    const email = normalizeEmail(emailInput);
    const row = this.db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email) as UserRow | undefined;

    if (!row) {
      throw new Error("invalid_credentials");
    }

    const computed = hashPassword(password, row.password_salt);
    const storedBuf = Buffer.from(row.password_hash, "hex");
    const computedBuf = Buffer.from(computed, "hex");
    if (
      storedBuf.length !== computedBuf.length ||
      !timingSafeEqual(storedBuf, computedBuf)
    ) {
      throw new Error("invalid_credentials");
    }

    const now = nowIso();
    const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString();
    const token = randomBytes(32).toString("base64url");
    const sessionId = randomUUID();

    this.db
      .prepare(
        "INSERT INTO user_sessions (id, user_id, token_hash, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)",
      )
      .run(sessionId, row.id, hashToken(token), now, expiresAt);

    return {
      user: toUser(row),
      session: {
        id: sessionId,
        userId: row.id,
        token,
        createdAt: now,
        expiresAt,
      },
    };
  }

  authenticate(accessToken: string): { user: AccountUser; sessionId: string } {
    const tokenHash = hashToken(accessToken);
    const now = nowIso();
    const row = this.db
      .prepare(
        `
        SELECT
          s.id as session_id,
          s.user_id as session_user_id,
          s.expires_at as session_expires_at,
          u.id as user_id,
          u.email as user_email,
          u.created_at as user_created_at
        FROM user_sessions s
        INNER JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
          AND s.revoked_at IS NULL
          AND s.expires_at > ?
      `,
      )
      .get(tokenHash, now) as AuthLookupRow | undefined;

    if (!row) {
      throw new Error("unauthorized");
    }

    return {
      sessionId: row.session_id,
      user: {
        id: row.user_id,
        email: row.user_email,
        createdAt: row.user_created_at,
      },
    };
  }

  revokeSession(sessionId: string): void {
    this.db
      .prepare("UPDATE user_sessions SET revoked_at = ? WHERE id = ?")
      .run(nowIso(), sessionId);
  }

  registerOrUpdateDevice(params: {
    userId: string;
    installId: string;
    deviceName: string;
    deviceType: string;
  }): AccountDevice {
    const installId = params.installId.trim();
    const deviceName = params.deviceName.trim();
    const deviceType = params.deviceType.trim().toLowerCase();

    if (!installId) {
      throw new Error("invalid_install_id");
    }
    if (!deviceName) {
      throw new Error("invalid_device_name");
    }
    if (!deviceType) {
      throw new Error("invalid_device_type");
    }

    const now = nowIso();
    const existing = this.db
      .prepare(
        "SELECT * FROM devices WHERE user_id = ? AND install_id = ? LIMIT 1",
      )
      .get(params.userId, installId) as DeviceRow | undefined;

    if (existing) {
      this.db
        .prepare(
          `
          UPDATE devices
          SET device_name = ?, device_type = ?, updated_at = ?, last_seen_at = ?
          WHERE id = ?
        `,
        )
        .run(deviceName, deviceType, now, now, existing.id);

      return {
        ...toDevice(existing),
        deviceName,
        deviceType,
        updatedAt: now,
        lastSeenAt: now,
      };
    }

    const id = randomUUID();
    const relayUsername = this.createRelayUsername();

    this.db
      .prepare(
        `
        INSERT INTO devices (
          id, user_id, install_id, device_name, device_type, relay_username,
          created_at, updated_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        id,
        params.userId,
        installId,
        deviceName,
        deviceType,
        relayUsername,
        now,
        now,
        now,
      );

    return {
      id,
      userId: params.userId,
      installId,
      deviceName,
      deviceType,
      relayUsername,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
  }

  touchDevice(params: { userId: string; deviceId: string }): AccountDevice {
    const now = nowIso();
    const result = this.db
      .prepare(
        "UPDATE devices SET last_seen_at = ?, updated_at = ? WHERE id = ? AND user_id = ?",
      )
      .run(now, now, params.deviceId, params.userId);

    if (result.changes === 0) {
      throw new Error("device_not_found");
    }

    const row = this.db
      .prepare("SELECT * FROM devices WHERE id = ?")
      .get(params.deviceId) as DeviceRow | undefined;
    if (!row) {
      throw new Error("device_not_found");
    }

    return toDevice(row);
  }

  listDevices(
    userId: string,
    activeServers: ActiveRelayServer[],
  ): AccountDeviceView[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM devices WHERE user_id = ? ORDER BY last_seen_at DESC",
      )
      .all(userId) as DeviceRow[];

    const activeByUsername = new Map(
      activeServers.map((server) => [server.username, server.state] as const),
    );

    return rows.map((row) => {
      const device = toDevice(row);
      const state = activeByUsername.get(device.relayUsername);
      const relayState: DeviceRelayState =
        state === "waiting" || state === "paired" ? state : "offline";
      return { ...device, relayState };
    });
  }

  private createRelayUsername(): string {
    for (let i = 0; i < 8; i++) {
      const candidate = `dev-${randomBytes(6).toString("hex")}`;
      if (!isValidRelayUsername(candidate)) {
        continue;
      }
      const exists = this.db
        .prepare("SELECT 1 FROM devices WHERE relay_username = ?")
        .get(candidate);
      if (!exists) {
        return candidate;
      }
    }
    throw new Error("relay_username_generation_failed");
  }
}
