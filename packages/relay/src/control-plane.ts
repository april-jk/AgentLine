import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { isValidRelayUsername } from "@agentline/shared";
import type Database from "better-sqlite3";
import type { Pool } from "pg";
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

export interface MachineOwnerView {
  userId: string;
  role: "owner";
  status: "active";
}

export interface MachineEndpointView {
  kind: "relay";
  routeId: string;
  relayUsername: string;
  relayState: DeviceRelayState;
  lastSeenAt: string;
}

export interface MachineLanEndpointView {
  kind: "lan";
  address: string;
  port: number;
  boundToAllInterfaces?: boolean;
  localhostOnly?: boolean;
  lastSeenAt: string;
  expiresAt?: string;
}

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
  machineId: string;
  owner: MachineOwnerView;
  machine: {
    id: string;
    routeId: string;
    owner: MachineOwnerView;
    hostService?: {
      listening?: boolean;
      boundToAllInterfaces?: boolean;
      localhostOnly?: boolean;
    };
    endpoints: {
      relay: MachineEndpointView;
      lan?: MachineLanEndpointView | null;
    };
    heartbeat: {
      lastSeenAt: string;
    };
  };
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
  user_id: string;
  user_email: string;
  user_created_at: string;
}

type ControlPlaneStore = Database.Database | Pool;

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

function toOwner(userId: string): MachineOwnerView {
  return {
    userId,
    role: "owner",
    status: "active",
  };
}

function isPgPool(store: ControlPlaneStore): store is Pool {
  return typeof (store as Pool).query === "function";
}

function isPgUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

export function toMachineCompatibleDeviceView(
  device: AccountDevice,
  relayState: DeviceRelayState,
): AccountDeviceView {
  const owner = toOwner(device.userId);
  const relayEndpoint: MachineEndpointView = {
    kind: "relay",
    routeId: device.relayUsername,
    relayUsername: device.relayUsername,
    relayState,
    lastSeenAt: device.lastSeenAt,
  };

  return {
    ...device,
    relayState,
    machineId: device.id,
    owner,
    machine: {
      id: device.id,
      routeId: device.relayUsername,
      owner,
      endpoints: {
        relay: relayEndpoint,
        lan: null,
      },
      heartbeat: {
        lastSeenAt: device.lastSeenAt,
      },
    },
  };
}

export class RelayControlPlaneService {
  private readonly store: ControlPlaneStore;

  constructor(store: ControlPlaneStore) {
    this.store = store;
  }

  async registerUser(emailInput: string, password: string): Promise<AccountUser> {
    const email = normalizeEmail(emailInput);
    if (!isValidEmail(email)) {
      throw new Error("invalid_email");
    }
    ensurePassword(password);

    const existing = await this.getUserIdByEmail(email);
    if (existing) {
      throw new Error("email_taken");
    }

    const now = nowIso();
    const id = randomUUID();
    const salt = randomBytes(16).toString("hex");
    const passwordHash = hashPassword(password, salt);

    try {
      if (isPgPool(this.store)) {
        await this.store.query(
          `
            INSERT INTO users (id, email, password_salt, password_hash, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [id, email, salt, passwordHash, now, now],
        );
      } else {
        this.store
          .prepare(
            "INSERT INTO users (id, email, password_salt, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(id, email, salt, passwordHash, now, now);
      }
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        throw new Error("email_taken");
      }
      throw error;
    }

    return { id, email, createdAt: now };
  }

  async login(
    emailInput: string,
    password: string,
  ): Promise<{
    user: AccountUser;
    session: AuthSession;
  }> {
    const email = normalizeEmail(emailInput);
    const row = await this.getUserByEmail(email);
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

    if (isPgPool(this.store)) {
      await this.store.query(
        `
          INSERT INTO user_sessions (id, user_id, token_hash, created_at, expires_at, revoked_at)
          VALUES ($1, $2, $3, $4, $5, NULL)
        `,
        [sessionId, row.id, hashToken(token), now, expiresAt],
      );
    } else {
      this.store
        .prepare(
          "INSERT INTO user_sessions (id, user_id, token_hash, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)",
        )
        .run(sessionId, row.id, hashToken(token), now, expiresAt);
    }

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

  async authenticate(
    accessToken: string,
  ): Promise<{ user: AccountUser; sessionId: string }> {
    const tokenHash = hashToken(accessToken);
    const now = nowIso();
    const row = await this.getAuthRowByToken(tokenHash, now);
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

  async updateUser(params: {
    userId: string;
    currentPassword: string;
    nextEmail?: string;
    nextPassword?: string;
  }): Promise<AccountUser> {
    const row = await this.getUserById(params.userId);
    if (!row) {
      throw new Error("unauthorized");
    }

    const computed = hashPassword(params.currentPassword, row.password_salt);
    const storedBuf = Buffer.from(row.password_hash, "hex");
    const computedBuf = Buffer.from(computed, "hex");
    if (
      storedBuf.length !== computedBuf.length ||
      !timingSafeEqual(storedBuf, computedBuf)
    ) {
      throw new Error("invalid_credentials");
    }

    const nextEmailInput = params.nextEmail?.trim();
    const nextPasswordInput = params.nextPassword?.trim();
    if (!nextEmailInput && !nextPasswordInput) {
      throw new Error("no_changes_requested");
    }

    let email = row.email;
    if (nextEmailInput) {
      const normalized = normalizeEmail(nextEmailInput);
      if (!isValidEmail(normalized)) {
        throw new Error("invalid_email");
      }
      if (normalized !== row.email) {
        const existing = await this.getUserIdByEmail(normalized);
        if (existing && existing !== row.id) {
          throw new Error("email_taken");
        }
        email = normalized;
      }
    }

    let passwordSalt = row.password_salt;
    let passwordHash = row.password_hash;
    if (nextPasswordInput) {
      ensurePassword(nextPasswordInput);
      passwordSalt = randomBytes(16).toString("hex");
      passwordHash = hashPassword(nextPasswordInput, passwordSalt);
    }

    const now = nowIso();
    if (isPgPool(this.store)) {
      await this.store.query(
        `
          UPDATE users
          SET email = $1, password_salt = $2, password_hash = $3, updated_at = $4
          WHERE id = $5
        `,
        [email, passwordSalt, passwordHash, now, row.id],
      );
    } else {
      this.store
        .prepare(
          `
            UPDATE users
            SET email = ?, password_salt = ?, password_hash = ?, updated_at = ?
            WHERE id = ?
          `,
        )
        .run(email, passwordSalt, passwordHash, now, row.id);
    }

    return {
      id: row.id,
      email,
      createdAt: row.created_at,
    };
  }

  async revokeSession(sessionId: string): Promise<void> {
    const now = nowIso();
    if (isPgPool(this.store)) {
      await this.store.query(
        "UPDATE user_sessions SET revoked_at = $1 WHERE id = $2",
        [now, sessionId],
      );
      return;
    }
    this.store
      .prepare("UPDATE user_sessions SET revoked_at = ? WHERE id = ?")
      .run(now, sessionId);
  }

  async registerOrUpdateDevice(params: {
    userId: string;
    installId: string;
    deviceName: string;
    deviceType: string;
  }): Promise<AccountDevice> {
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
    const existing = await this.getDeviceByUserInstall(params.userId, installId);

    if (existing) {
      if (isPgPool(this.store)) {
        const result = await this.store.query<DeviceRow>(
          `
            UPDATE devices
            SET device_name = $1, device_type = $2, updated_at = $3, last_seen_at = $4
            WHERE id = $5
            RETURNING *
          `,
          [deviceName, deviceType, now, now, existing.id],
        );
        if (!result.rows[0]) {
          throw new Error("device_not_found");
        }
        return toDevice(result.rows[0]);
      }

      this.store
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
    const relayUsername = await this.createRelayUsername();

    if (isPgPool(this.store)) {
      const result = await this.store.query<DeviceRow>(
        `
          INSERT INTO devices (
            id, user_id, install_id, device_name, device_type, relay_username,
            created_at, updated_at, last_seen_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *
        `,
        [
          id,
          params.userId,
          installId,
          deviceName,
          deviceType,
          relayUsername,
          now,
          now,
          now,
        ],
      );
      if (!result.rows[0]) {
        throw new Error("device_insert_failed");
      }
      return toDevice(result.rows[0]);
    }

    this.store
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

  async touchDevice(params: {
    userId: string;
    deviceId: string;
  }): Promise<AccountDevice> {
    const now = nowIso();
    if (isPgPool(this.store)) {
      const result = await this.store.query<DeviceRow>(
        `
          UPDATE devices
          SET last_seen_at = $1, updated_at = $2
          WHERE id = $3 AND user_id = $4
          RETURNING *
        `,
        [now, now, params.deviceId, params.userId],
      );
      if (result.rowCount === 0) {
        throw new Error("device_not_found");
      }
      if (!result.rows[0]) {
        throw new Error("device_not_found");
      }
      return toDevice(result.rows[0]);
    }

    const update = this.store
      .prepare(
        "UPDATE devices SET last_seen_at = ?, updated_at = ? WHERE id = ? AND user_id = ?",
      )
      .run(now, now, params.deviceId, params.userId);

    if (update.changes === 0) {
      throw new Error("device_not_found");
    }

    const row = this.store
      .prepare("SELECT * FROM devices WHERE id = ?")
      .get(params.deviceId) as DeviceRow | undefined;
    if (!row) {
      throw new Error("device_not_found");
    }
    return toDevice(row);
  }

  async listDevices(
    userId: string,
    activeServers: ActiveRelayServer[],
  ): Promise<AccountDeviceView[]> {
    const rows = isPgPool(this.store)
      ? (
          await this.store.query<DeviceRow>(
            "SELECT * FROM devices WHERE user_id = $1 ORDER BY last_seen_at DESC",
            [userId],
          )
        ).rows
      : (this.store
          .prepare(
            "SELECT * FROM devices WHERE user_id = ? ORDER BY last_seen_at DESC",
          )
          .all(userId) as DeviceRow[]);

    const activeByUsername = new Map(
      activeServers.map((server) => [server.username, server.state] as const),
    );

    return rows.map((row) => {
      const device = toDevice(row);
      const state = activeByUsername.get(device.relayUsername);
      const relayState: DeviceRelayState =
        state === "waiting" || state === "paired" ? state : "offline";
      return toMachineCompatibleDeviceView(device, relayState);
    });
  }

  private async createRelayUsername(): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const candidate = `dev-${randomBytes(6).toString("hex")}`;
      if (!isValidRelayUsername(candidate)) {
        continue;
      }
      const exists = await this.hasDeviceRelayUsername(candidate);
      if (!exists) {
        return candidate;
      }
    }
    throw new Error("relay_username_generation_failed");
  }

  private async getUserByEmail(email: string): Promise<UserRow | undefined> {
    if (isPgPool(this.store)) {
      const result = await this.store.query<UserRow>(
        "SELECT * FROM users WHERE email = $1 LIMIT 1",
        [email],
      );
      return result.rows[0];
    }
    return this.store
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email) as UserRow | undefined;
  }

  private async getUserById(userId: string): Promise<UserRow | undefined> {
    if (isPgPool(this.store)) {
      const result = await this.store.query<UserRow>(
        "SELECT * FROM users WHERE id = $1 LIMIT 1",
        [userId],
      );
      return result.rows[0];
    }
    return this.store
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(userId) as UserRow | undefined;
  }

  private async getUserIdByEmail(email: string): Promise<string | null> {
    if (isPgPool(this.store)) {
      const result = await this.store.query<{ id: string }>(
        "SELECT id FROM users WHERE email = $1 LIMIT 1",
        [email],
      );
      return result.rows[0]?.id ?? null;
    }
    const row = this.store
      .prepare("SELECT id FROM users WHERE email = ?")
      .get(email) as { id: string } | undefined;
    return row?.id ?? null;
  }

  private async getAuthRowByToken(
    tokenHash: string,
    now: string,
  ): Promise<AuthLookupRow | undefined> {
    if (isPgPool(this.store)) {
      const result = await this.store.query<AuthLookupRow>(
        `
          SELECT
            s.id as session_id,
            u.id as user_id,
            u.email as user_email,
            u.created_at as user_created_at
          FROM user_sessions s
          INNER JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1
            AND s.revoked_at IS NULL
            AND s.expires_at > $2
          LIMIT 1
        `,
        [tokenHash, now],
      );
      return result.rows[0];
    }
    return this.store
      .prepare(
        `
          SELECT
            s.id as session_id,
            u.id as user_id,
            u.email as user_email,
            u.created_at as user_created_at
          FROM user_sessions s
          INNER JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ?
            AND s.revoked_at IS NULL
            AND s.expires_at > ?
          LIMIT 1
        `,
      )
      .get(tokenHash, now) as AuthLookupRow | undefined;
  }

  private async getDeviceByUserInstall(
    userId: string,
    installId: string,
  ): Promise<DeviceRow | undefined> {
    if (isPgPool(this.store)) {
      const result = await this.store.query<DeviceRow>(
        `
          SELECT *
          FROM devices
          WHERE user_id = $1 AND install_id = $2
          LIMIT 1
        `,
        [userId, installId],
      );
      return result.rows[0];
    }
    return this.store
      .prepare(
        "SELECT * FROM devices WHERE user_id = ? AND install_id = ? LIMIT 1",
      )
      .get(userId, installId) as DeviceRow | undefined;
  }

  private async hasDeviceRelayUsername(relayUsername: string): Promise<boolean> {
    if (isPgPool(this.store)) {
      const result = await this.store.query(
        "SELECT 1 FROM devices WHERE relay_username = $1 LIMIT 1",
        [relayUsername],
      );
      return result.rows.length > 0;
    }
    const row = this.store
      .prepare("SELECT 1 FROM devices WHERE relay_username = ?")
      .get(relayUsername);
    return Boolean(row);
  }
}
