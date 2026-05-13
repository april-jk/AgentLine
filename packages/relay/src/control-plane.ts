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
const SERVER_REGISTER_GRANT_TTL_MS = 60_000;
const CLIENT_CONNECT_GRANT_TTL_MS = 60_000;

export type RelayGrantType = "server_register" | "client_connect";

export interface IssuedRelayGrant {
  id: string;
  grant: string;
  expiresAt: string;
  relayUsername: string;
  deviceId: string;
}

export interface ConsumedRelayGrant {
  id: string;
  grantType: RelayGrantType;
  userId: string;
  sessionId: string;
  deviceId: string;
  relayUsername: string;
  installId: string | null;
  expiresAt: string;
}

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

interface SessionActiveRow {
  id: string;
}

interface RelayGrantRow {
  id: string;
  grant_type: RelayGrantType;
  token_hash: string;
  user_id: string;
  session_id: string;
  device_id: string;
  relay_username: string;
  install_id: string | null;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
  metadata_json: string | null;
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

  async registerUser(
    emailInput: string,
    password: string,
  ): Promise<AccountUser> {
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

  async isSessionActive(sessionId: string): Promise<boolean> {
    const now = nowIso();
    if (isPgPool(this.store)) {
      const result = await this.store.query<SessionActiveRow>(
        `
          SELECT id
          FROM user_sessions
          WHERE id = $1
            AND revoked_at IS NULL
            AND expires_at > $2
          LIMIT 1
        `,
        [sessionId, now],
      );
      return Boolean(result.rows[0]);
    }

    const row = this.store
      .prepare(
        `
          SELECT id
          FROM user_sessions
          WHERE id = ?
            AND revoked_at IS NULL
            AND expires_at > ?
          LIMIT 1
        `,
      )
      .get(sessionId, now) as SessionActiveRow | undefined;
    return Boolean(row);
  }

  async issueServerRegisterGrant(params: {
    userId: string;
    sessionId: string;
    installId: string;
    relayUsername: string;
    deviceId?: string;
  }): Promise<IssuedRelayGrant> {
    const installId = params.installId.trim();
    const relayUsername = params.relayUsername.trim().toLowerCase();
    if (!installId || !relayUsername) {
      throw new Error("invalid_grant_request");
    }

    const device = params.deviceId
      ? await this.getDeviceByIdOwnedByUser(params.deviceId, params.userId)
      : await this.getDeviceByUserInstall(params.userId, installId);
    if (!device) {
      throw new Error("device_not_found");
    }
    if (device.relay_username !== relayUsername) {
      throw new Error("device_route_mismatch");
    }
    if (device.install_id !== installId) {
      throw new Error("device_install_mismatch");
    }

    return this.createRelayGrant({
      grantType: "server_register",
      userId: params.userId,
      sessionId: params.sessionId,
      deviceId: device.id,
      relayUsername: relayUsername,
      installId,
      ttlMs: SERVER_REGISTER_GRANT_TTL_MS,
    });
  }

  async issueClientConnectGrant(params: {
    userId: string;
    sessionId: string;
    deviceId?: string;
    relayUsername?: string;
  }): Promise<IssuedRelayGrant> {
    const relayUsername = params.relayUsername?.trim().toLowerCase();
    const deviceId = params.deviceId?.trim();

    let device: DeviceRow | undefined;
    if (deviceId) {
      device = await this.getDeviceByIdOwnedByUser(deviceId, params.userId);
    } else if (relayUsername) {
      device = await this.getDeviceByUserRelayUsername(
        params.userId,
        relayUsername,
      );
    }

    if (!device) {
      throw new Error("device_not_found");
    }

    return this.createRelayGrant({
      grantType: "client_connect",
      userId: params.userId,
      sessionId: params.sessionId,
      deviceId: device.id,
      relayUsername: device.relay_username,
      installId: null,
      ttlMs: CLIENT_CONNECT_GRANT_TTL_MS,
    });
  }

  async consumeRelayGrant(params: {
    token: string;
    expectedType: RelayGrantType;
  }): Promise<ConsumedRelayGrant> {
    const rawToken = params.token.trim();
    if (!rawToken) {
      throw new Error("grant_invalid");
    }

    const tokenHash = hashToken(rawToken);
    const now = nowIso();
    const grant = await this.getRelayGrantByTokenHash(tokenHash);
    if (!grant) {
      throw new Error("grant_invalid");
    }
    if (grant.grant_type !== params.expectedType) {
      throw new Error("grant_invalid");
    }
    if (grant.revoked_at) {
      throw new Error("grant_invalid");
    }
    if (grant.consumed_at) {
      throw new Error("grant_consumed");
    }
    if (grant.expires_at <= now) {
      throw new Error("grant_expired");
    }
    const sessionActive = await this.isSessionActive(grant.session_id);
    if (!sessionActive) {
      throw new Error("server_session_revoked");
    }

    const consumed = await this.markRelayGrantConsumed(grant.id, now);
    if (!consumed) {
      throw new Error("grant_consumed");
    }
    return {
      id: grant.id,
      grantType: grant.grant_type,
      userId: grant.user_id,
      sessionId: grant.session_id,
      deviceId: grant.device_id,
      relayUsername: grant.relay_username,
      installId: grant.install_id,
      expiresAt: grant.expires_at,
    };
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
    const existing = await this.getDeviceByUserInstall(
      params.userId,
      installId,
    );

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
    return this.store.prepare("SELECT * FROM users WHERE id = ?").get(userId) as
      | UserRow
      | undefined;
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

  private async getDeviceByIdOwnedByUser(
    deviceId: string,
    userId: string,
  ): Promise<DeviceRow | undefined> {
    if (isPgPool(this.store)) {
      const result = await this.store.query<DeviceRow>(
        `
          SELECT *
          FROM devices
          WHERE id = $1 AND user_id = $2
          LIMIT 1
        `,
        [deviceId, userId],
      );
      return result.rows[0];
    }
    return this.store
      .prepare("SELECT * FROM devices WHERE id = ? AND user_id = ? LIMIT 1")
      .get(deviceId, userId) as DeviceRow | undefined;
  }

  private async getDeviceByUserRelayUsername(
    userId: string,
    relayUsername: string,
  ): Promise<DeviceRow | undefined> {
    if (isPgPool(this.store)) {
      const result = await this.store.query<DeviceRow>(
        `
          SELECT *
          FROM devices
          WHERE user_id = $1 AND relay_username = $2
          LIMIT 1
        `,
        [userId, relayUsername],
      );
      return result.rows[0];
    }
    return this.store
      .prepare(
        "SELECT * FROM devices WHERE user_id = ? AND relay_username = ? LIMIT 1",
      )
      .get(userId, relayUsername) as DeviceRow | undefined;
  }

  private async createRelayGrant(params: {
    grantType: RelayGrantType;
    userId: string;
    sessionId: string;
    deviceId: string;
    relayUsername: string;
    installId: string | null;
    ttlMs: number;
  }): Promise<IssuedRelayGrant> {
    const now = nowIso();
    const expiresAt = new Date(Date.now() + params.ttlMs).toISOString();
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const id = randomUUID();

    if (isPgPool(this.store)) {
      await this.store.query(
        `
          INSERT INTO relay_grants (
            id, grant_type, token_hash, user_id, session_id, device_id,
            relay_username, install_id, created_at, expires_at, consumed_at, revoked_at, metadata_json
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, NULL, NULL)
        `,
        [
          id,
          params.grantType,
          tokenHash,
          params.userId,
          params.sessionId,
          params.deviceId,
          params.relayUsername,
          params.installId,
          now,
          expiresAt,
        ],
      );
    } else {
      this.store
        .prepare(
          `
            INSERT INTO relay_grants (
              id, grant_type, token_hash, user_id, session_id, device_id,
              relay_username, install_id, created_at, expires_at, consumed_at, revoked_at, metadata_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
          `,
        )
        .run(
          id,
          params.grantType,
          tokenHash,
          params.userId,
          params.sessionId,
          params.deviceId,
          params.relayUsername,
          params.installId,
          now,
          expiresAt,
        );
    }

    return {
      id,
      grant: token,
      expiresAt,
      relayUsername: params.relayUsername,
      deviceId: params.deviceId,
    };
  }

  private async getRelayGrantByTokenHash(
    tokenHash: string,
  ): Promise<RelayGrantRow | undefined> {
    if (isPgPool(this.store)) {
      const result = await this.store.query<RelayGrantRow>(
        `
          SELECT *
          FROM relay_grants
          WHERE token_hash = $1
          LIMIT 1
        `,
        [tokenHash],
      );
      return result.rows[0];
    }
    return this.store
      .prepare("SELECT * FROM relay_grants WHERE token_hash = ? LIMIT 1")
      .get(tokenHash) as RelayGrantRow | undefined;
  }

  private async markRelayGrantConsumed(
    id: string,
    consumedAt: string,
  ): Promise<boolean> {
    if (isPgPool(this.store)) {
      const result = await this.store.query(
        `
          UPDATE relay_grants
          SET consumed_at = $1
          WHERE id = $2 AND consumed_at IS NULL
        `,
        [consumedAt, id],
      );
      return (result.rowCount ?? 0) > 0;
    }

    const result = this.store
      .prepare(
        `
          UPDATE relay_grants
          SET consumed_at = ?
          WHERE id = ? AND consumed_at IS NULL
        `,
      )
      .run(consumedAt, id);
    return result.changes > 0;
  }

  private async hasDeviceRelayUsername(
    relayUsername: string,
  ): Promise<boolean> {
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
