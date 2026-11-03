import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface IsolatedTestContext {
  schema: string;
  pool: pg.Pool;
  adminPool: pg.Pool;
  migrationDirectory: string;
  createWorkerPool: (options?: { max?: number; applicationName?: string }) => pg.Pool;
  runAllMigrations: () => Promise<string[]>;
  cleanup: () => Promise<void>;
}

/**
 * Validates that DATABASE_URL points strictly to the dedicated test database.
 * - Runtime port 55533 is strictly forbidden.
 * - Local tests MUST point to port 56534 on loopback.
 * - In CI (CI=true), loopback:5432 with database ati_v3 is allowed.
 * - No default production connection fallback.
 * - Error messages never leak user credentials or connection strings.
 */
export function validateDatabaseUrl(rawUrl?: string): string {
  const urlString = rawUrl ?? process.env.DATABASE_URL;
  if (!urlString || urlString.trim() === '') {
    throw new Error('DATABASE_URL is required; dedicated test connection must be explicitly configured.');
  }

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error('Invalid DATABASE_URL format: unable to parse connection URL.');
  }

  if (parsed.port === '55533') {
    throw new Error('DATABASE_URL on port 55533 is strictly forbidden for tests (runtime database port).');
  }

  const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (!isLoopback) {
    throw new Error(`DATABASE_URL host must be localhost or loopback (127.0.0.1), got "${parsed.hostname}".`);
  }

  const isCI = process.env.CI === 'true' || process.env.CI === '1';
  const isCIAllowed =
    isCI &&
    (parsed.port === '5432' || parsed.port === '') &&
    (parsed.pathname === '/ati_v3' || parsed.pathname === '/ati_v3/');
  const isLocalDedicatedAllowed = parsed.port === '56534';

  if (!isCIAllowed && !isLocalDedicatedAllowed) {
    throw new Error(
      `Dedicated test database required: localhost:56534 for local tests (or loopback:5432/ati_v3 when CI=true). Received port "${parsed.port}" and pathname "${parsed.pathname}".`
    );
  }

  return urlString;
}

/**
 * Resolves the directory containing v3 database migrations.
 */
export function resolveMigrationDirectory(): string {
  const candidates = [
    resolve(process.cwd(), 'db/v3'),
    fileURLToPath(new URL('../../../../db/v3', import.meta.url)),
    fileURLToPath(new URL('../../../../../db/v3', import.meta.url)),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Migration directory db/v3 not found among candidates: ${candidates.join(', ')}`);
}

/**
 * Creates an isolated schema for tests with a connection pool bound strictly to that schema.
 * Max 12 connections total per test file (adminPool: 2, pool: 4, worker pools: 2+2 <= 12).
 * Search path is strictly isolated to the private schema ONLY (no public fallback).
 */
export async function createIsolatedTestSchema(options?: {
  rawUrl?: string;
  maxConnections?: number;
}): Promise<IsolatedTestContext> {
  const databaseUrl = validateDatabaseUrl(options?.rawUrl);

  const uniqueSuffix = randomUUID().replaceAll('-', '');
  const schema = `jira_ws_migration_${uniqueSuffix}`;

  // Strict check on schema identifier to prevent SQL injection
  if (!/^jira_ws_migration_[0-9a-f]{32}$/.test(schema)) {
    throw new Error(`Generated schema identifier is invalid: ${schema}`);
  }

  const adminPool = new pg.Pool({
    connectionString: databaseUrl,
    max: 2,
    connectionTimeoutMillis: 5000,
  });

  await adminPool.query(`CREATE SCHEMA "${schema}"`);

  // Strictly bind search_path to the private isolated schema ONLY
  const isolatedUrl = new URL(databaseUrl);
  isolatedUrl.searchParams.set('options', `-c search_path=${schema}`);

  const maxPoolConnections = Math.min(options?.maxConnections ?? 4, 10);
  const pool = new pg.Pool({
    connectionString: isolatedUrl.href,
    max: maxPoolConnections,
    connectionTimeoutMillis: 5000,
  });

  const workerPools: pg.Pool[] = [];

  const createWorkerPool = (opts?: { max?: number; applicationName?: string }): pg.Pool => {
    const workerUrl = new URL(databaseUrl);
    workerUrl.searchParams.set('options', `-c search_path=${schema}`);
    const worker = new pg.Pool({
      connectionString: workerUrl.href,
      max: opts?.max ?? 2,
      application_name: opts?.applicationName,
      connectionTimeoutMillis: 5000,
    });
    workerPools.push(worker);
    return worker;
  };

  const migrationDirectory = resolveMigrationDirectory();

  const runAllMigrations = async (): Promise<string[]> => {
    const dirFiles = await readdir(migrationDirectory);
    const sqlFiles = dirFiles.filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

    for (const file of sqlFiles) {
      const filePath = resolve(migrationDirectory, file);
      const content = await readFile(filePath, 'utf8');
      await pool.query(content);
    }

    return sqlFiles;
  };

  const cleanup = async (): Promise<void> => {
    for (const wp of workerPools) {
      try {
        await wp.end();
      } catch {
        // Ignore worker pool termination errors during teardown
      }
    }

    try {
      await pool.end();
    } catch {
      // Ignore pool close errors during teardown
    }

    try {
      // Cleanup only own created schema
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await adminPool.end();
    }
  };

  return {
    schema,
    pool,
    adminPool,
    migrationDirectory,
    createWorkerPool,
    runAllMigrations,
    cleanup,
  };
}

export const hex = (length = 64): string => {
  return randomUUID().replaceAll('-', '').repeat(Math.ceil(length / 32)).slice(0, length);
};

export async function createSyntheticUser(
  pool: pg.Pool,
  name = 'Test User',
  emailPrefix = 'user',
  options?: { role?: 'member' | 'admin'; status?: 'pending' | 'active' | 'disabled' }
): Promise<string> {
  const email = `${emailPrefix}_${randomUUID().slice(0, 8)}@example.test`;
  const role = options?.role ?? 'member';
  const status = options?.status ?? 'active';

  const res = await pool.query(
    `INSERT INTO users (email, password, name, role, status)
     VALUES ($1, 'pbkdf2:synthetic_hash', $2, $3, $4)
     RETURNING id`,
    [email, name, role, status]
  );
  return res.rows[0].id;
}

export async function connectSyntheticJiraAccount(
  pool: pg.Pool,
  userId: string,
  atlassianAccountId = `atlas-${randomUUID().slice(0, 8)}`
): Promise<string> {
  const res = await pool.query(
    `INSERT INTO jira_accounts (user_id, atlassian_account_id, status)
     VALUES ($1, $2, 'connected')
     RETURNING id`,
    [userId, atlassianAccountId]
  );
  return res.rows[0].id;
}

/**
 * Deterministically polls pg_locks for active sessions waiting on a lock
 * filtered to the exact application_names of competing race actors.
 * Requires COUNT(DISTINCT a.pid) >= applicationNames.length before returning.
 */
export async function waitForBlockedQueries(
  pool: pg.Pool,
  applicationNames: string[],
  timeoutMs = 5000
): Promise<number> {
  const start = Date.now();
  const requiredCount = applicationNames.length;
  while (Date.now() - start < timeoutMs) {
    const res = await pool.query<{ count: string }>(
      `SELECT count(DISTINCT a.pid)::text AS count
       FROM pg_locks l
       JOIN pg_stat_activity a ON a.pid = l.pid
       WHERE l.granted = false
         AND a.datname = current_database()
         AND a.application_name = ANY($1)`,
      [applicationNames]
    );
    const count = parseInt(res.rows[0]?.count ?? '0', 10);
    if (count >= requiredCount) {
      return count;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(
    `Timeout waiting for ${requiredCount} distinct blocked sessions with application_name in [${applicationNames.join(
      ', '
    )}] after ${timeoutMs}ms`
  );
}
