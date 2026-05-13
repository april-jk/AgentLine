import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Pool } from "pg";

/**
 * Creates and initializes the SQLite database for username registry.
 *
 * Schema:
 * - usernames: Maps usernames to installation IDs with timestamps
 */
export function createDb(dataDir: string): Database.Database {
  // Ensure data directory exists
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = join(dataDir, "relay.db");
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");

  // Create usernames table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS usernames (
      username TEXT PRIMARY KEY,
      install_id TEXT NOT NULL,
      registered_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )
  `);

  // Create index on last_seen_at for efficient reclamation queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_usernames_last_seen
    ON usernames(last_seen_at)
  `);

  // Account users (control plane)
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Login sessions (bearer tokens hashed at rest)
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
    ON user_sessions(user_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at
    ON user_sessions(expires_at)
  `);

  // Desktop/mobile resources visible per account
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      install_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      device_type TEXT NOT NULL,
      relay_username TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_user_install
    ON devices(user_id, install_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_devices_user_id
    ON devices(user_id)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS relay_grants (
      id TEXT PRIMARY KEY,
      grant_type TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      relay_username TEXT NOT NULL,
      install_id TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      revoked_at TEXT,
      metadata_json TEXT
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_relay_grants_type_expiry
    ON relay_grants(grant_type, expires_at)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_relay_grants_session
    ON relay_grants(session_id, grant_type)
  `);

  return db;
}

/**
 * Creates an in-memory database for testing.
 */
export function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE IF NOT EXISTS usernames (
      username TEXT PRIMARY KEY,
      install_id TEXT NOT NULL,
      registered_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_usernames_last_seen
    ON usernames(last_seen_at)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      install_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      device_type TEXT NOT NULL,
      relay_username TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS relay_grants (
      id TEXT PRIMARY KEY,
      grant_type TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      relay_username TEXT NOT NULL,
      install_id TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      revoked_at TEXT,
      metadata_json TEXT
    )
  `);

  return db;
}

export async function createControlPlanePostgresPool(
  connectionString: string,
): Promise<Pool> {
  const pool = new Pool({
    connectionString,
    max: 10,
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
    ON user_sessions(user_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at
    ON user_sessions(expires_at)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      install_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      device_type TEXT NOT NULL,
      relay_username TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_user_install
    ON devices(user_id, install_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_devices_user_id
    ON devices(user_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_grants (
      id TEXT PRIMARY KEY,
      grant_type TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id),
      session_id TEXT NOT NULL REFERENCES user_sessions(id),
      device_id TEXT NOT NULL REFERENCES devices(id),
      relay_username TEXT NOT NULL,
      install_id TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      revoked_at TEXT,
      metadata_json TEXT
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_relay_grants_type_expiry
    ON relay_grants(grant_type, expires_at)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_relay_grants_session
    ON relay_grants(session_id, grant_type)
  `);

  return pool;
}
