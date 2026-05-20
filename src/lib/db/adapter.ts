import "server-only";
import { Pool } from "pg";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// ── Adapter interface ──

export type AdvisoryLockResult<T> = { acquired: true; result: T } | { acquired: false };

export interface DbAdapter {
  queryAll<T>(sql: string, params?: SQLInputValue[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: SQLInputValue[]): Promise<T | null>;
  execute(sql: string, params?: SQLInputValue[]): Promise<number>;
  transaction<T>(callback: (tx: DbAdapter) => Promise<T>): Promise<T>;
  tryWithAdvisoryLock<T>(lockKey: number, callback: () => Promise<T>): Promise<AdvisoryLockResult<T>>;
  close(): Promise<void>;
  readonly dialect: "sqlite" | "postgres";
}

export const PERSISTENT_DATABASE_REQUIRED_MESSAGE = "Persistent database URL is required in production. Set DATABASE_URL or POSTGRES_URL.";

function hasPersistentDatabaseUrl(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.DATABASE_URL?.trim() || env.POSTGRES_URL?.trim());
}

function isHostedDeployment(env: NodeJS.ProcessEnv): boolean {
  return env.VERCEL === "1" || Boolean(env.VERCEL_ENV);
}

function allowsEphemeralSqlite(env: NodeJS.ProcessEnv): boolean {
  return env.ALLOW_EPHEMERAL_SQLITE === "true";
}

export function resolveDatabaseDialect(env: NodeJS.ProcessEnv = process.env): DbAdapter["dialect"] {
  if (hasPersistentDatabaseUrl(env)) return "postgres";
  if (isHostedDeployment(env) && !allowsEphemeralSqlite(env)) {
    throw new Error(PERSISTENT_DATABASE_REQUIRED_MESSAGE);
  }
  return "sqlite";
}

function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.LLMLAB_DATA_DIR) return env.LLMLAB_DATA_DIR;
  if (isHostedDeployment(env) || env.NODE_ENV === "production") return "/tmp/llmlab_data";
  return join(process.cwd(), "data");
}

// ── SQLite adapter ──

class SqliteAdapter implements DbAdapter {
  readonly dialect = "sqlite" as const;
  private db: DatabaseSync;

  constructor() {
    const dataDir = resolveDataDir();
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, "catalog.db"));
    this.db.exec("PRAGMA busy_timeout = 30000;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
  }

  queryAll<T>(sql: string, params: SQLInputValue[] = []): Promise<T[]> {
    return Promise.resolve(this.db.prepare(sql).all(...params) as T[]);
  }

  queryOne<T>(sql: string, params: SQLInputValue[] = []): Promise<T | null> {
    return Promise.resolve((this.db.prepare(sql).get(...params) as T | undefined) ?? null);
  }

  execute(sql: string, params: SQLInputValue[] = []): Promise<number> {
    const result = this.db.prepare(sql).run(...params);
    return Promise.resolve(Number(result.changes));
  }

  async transaction<T>(callback: (tx: DbAdapter) => Promise<T>): Promise<T> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = await callback(this);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async tryWithAdvisoryLock<T>(lockKey: number, callback: () => Promise<T>): Promise<AdvisoryLockResult<T>> {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const expiresAtIso = new Date(now + 10 * 60_000).toISOString();
    const key = String(lockKey);

    await this.execute(`
      CREATE TABLE IF NOT EXISTS runtime_locks (
        lock_key TEXT PRIMARY KEY,
        locked_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )
    `);
    await this.execute("CREATE INDEX IF NOT EXISTS idx_runtime_locks_expires_at ON runtime_locks(expires_at)");
    await this.execute("DELETE FROM runtime_locks WHERE expires_at <= ?", [nowIso]).catch(() => 0);
    try {
      await this.execute(
        "INSERT INTO runtime_locks (lock_key, locked_at, expires_at) VALUES (?, ?, ?)",
        [key, nowIso, expiresAtIso],
      );
    } catch {
      return { acquired: false };
    }

    try {
      return { acquired: true, result: await callback() };
    } finally {
      await this.execute("DELETE FROM runtime_locks WHERE lock_key = ?", [key]).catch(() => 0);
    }
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  close(): Promise<void> {
    this.db.close();
    return Promise.resolve();
  }
}

// ── PostgreSQL adapter ──

class PgAdapter implements DbAdapter {
  readonly dialect = "postgres" as const;
  private pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not configured for PostgreSQL adapter.");
    }
    this.pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
      max: 4,
    });
  }

  /**
   * Translates SQLite-style `?` placeholders to PostgreSQL `$1`, `$2`, etc.
   * Does NOT modify quoted strings.
   */
  private translatePlaceholders(sql: string): string {
    let paramIndex = 0;
    let inString = false;
    let stringChar = "";
    const out: string[] = [];

    for (let i = 0; i < sql.length; i++) {
      const ch = sql[i];
      if (inString) {
        out.push(ch);
        if (ch === stringChar && sql[i - 1] !== "\\") {
          inString = false;
        }
        continue;
      }
      if (ch === "'" || ch === '"') {
        inString = true;
        stringChar = ch;
        out.push(ch);
        continue;
      }
      if (ch === "?") {
        paramIndex++;
        out.push(`$${paramIndex}`);
      } else {
        out.push(ch);
      }
    }
    return out.join("");
  }

  async queryAll<T>(sql: string, params: SQLInputValue[] = []): Promise<T[]> {
    const result = await this.pool.query(this.translatePlaceholders(sql), params as unknown[]);
    return result.rows as T[];
  }

  async queryOne<T>(sql: string, params: SQLInputValue[] = []): Promise<T | null> {
    const result = await this.pool.query(this.translatePlaceholders(sql), params as unknown[]);
    return (result.rows[0] as T | undefined) ?? null;
  }

  async execute(sql: string, params: SQLInputValue[] = []): Promise<number> {
    const result = await this.pool.query(this.translatePlaceholders(sql), params as unknown[]);
    return result.rowCount ?? 0;
  }

  async transaction<T>(callback: (tx: DbAdapter) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const translate = (sql: string) => this.translatePlaceholders(sql);
    const txAdapter: DbAdapter = {
      dialect: this.dialect,
      queryAll: async <R>(sql: string, params: SQLInputValue[] = []) => {
        const result = await client.query(translate(sql), params as unknown[]);
        return result.rows as R[];
      },
      queryOne: async <R>(sql: string, params: SQLInputValue[] = []) => {
        const result = await client.query(translate(sql), params as unknown[]);
        return (result.rows[0] as R | undefined) ?? null;
      },
      execute: async (sql: string, params: SQLInputValue[] = []) => {
        const result = await client.query(translate(sql), params as unknown[]);
        return result.rowCount ?? 0;
      },
      transaction: async <R>(nestedCallback: (nestedTx: DbAdapter) => Promise<R>) => nestedCallback(txAdapter),
      tryWithAdvisoryLock: async <R>(lockKey: number, lockCallback: () => Promise<R>) => this.tryWithAdvisoryLock(lockKey, lockCallback),
      close: async () => undefined,
    };

    try {
      await client.query("BEGIN");
      const result = await callback(txAdapter);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async tryWithAdvisoryLock<T>(lockKey: number, callback: () => Promise<T>): Promise<AdvisoryLockResult<T>> {
    const client = await this.pool.connect();
    try {
      const lockResult = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1) AS acquired", [lockKey]);
      if (!lockResult.rows[0]?.acquired) {
        return { acquired: false };
      }
      try {
        return { acquired: true, result: await callback() };
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [lockKey]).catch(() => undefined);
      }
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ── Singleton ──

const globalForDb = globalThis as unknown as {
  adapter: DbAdapter | undefined;
};

function createAdapter(): DbAdapter {
  return resolveDatabaseDialect() === "postgres" ? new PgAdapter() : new SqliteAdapter();
}

export function getAdapter(): DbAdapter {
  if (!globalForDb.adapter) {
    globalForDb.adapter = createAdapter();
  }
  return globalForDb.adapter;
}
