import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { NotionConnectionRepo } from '../../src/db/repositories/notion-connection-repo.js';
import {
  applyMigrations,
  assertAssignedNotionTestDatabaseUrl,
  fingerprintSecret,
  listV3MigrationFiles,
} from '../helpers/notion-oauth-test-env.js';

const V3_DIR = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));
const MIGRATION_FILE = '0036_notion_oauth_durability.sql';
// Full migration replays issue dozens of sequential PostgreSQL queries.
const MIGRATION_REPLAY_TIMEOUT_MS = 30_000;
const ALLOWLISTED_CODES = [
  'access_rejected',
  'refresh_retryable',
  'rotation_unknown',
  'grant_rejected',
  'client_misconfigured',
  'identity_mismatch',
] as const;

describe('migration 0036_notion_oauth_durability.sql on disposable PostgreSQL', () => {
  const schemaPreExisting = `notion_mig0036_pre_${randomUUID().replaceAll('-', '')}`;
  const schemaFreshTwice = `notion_mig0036_fresh_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool;
  let prePool: pg.Pool;
  let freshPool: pg.Pool;

  beforeAll(async () => {
    const { connectionString } = assertAssignedNotionTestDatabaseUrl();
    admin = new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000 });
    await admin.query(`CREATE SCHEMA "${schemaPreExisting}"`);
    await admin.query(`CREATE SCHEMA "${schemaFreshTwice}"`);

    const preUrl = new URL(connectionString);
    preUrl.searchParams.set(
      'options',
      `-c search_path=${schemaPreExisting} -c lock_timeout=4000ms -c statement_timeout=10000ms`,
    );
    prePool = new pg.Pool({ connectionString: preUrl.href, max: 4 });

    const freshUrl = new URL(connectionString);
    freshUrl.searchParams.set(
      'options',
      `-c search_path=${schemaFreshTwice} -c lock_timeout=4000ms -c statement_timeout=10000ms`,
    );
    freshPool = new pg.Pool({ connectionString: freshUrl.href, max: 4 });
  });

  afterAll(async () => {
    await prePool?.end();
    await freshPool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schemaPreExisting}" CASCADE`);
    await admin?.query(`DROP SCHEMA IF EXISTS "${schemaFreshTwice}" CASCADE`);
    await admin?.end();
  });

  it('contains 0036_notion_oauth_durability.sql scoped strictly to notion_connections.auth_failure_code without unapproved digest_authorization', async () => {
    const files = await listV3MigrationFiles();
    expect(files).toContain(MIGRATION_FILE);

    const sql = await readFile(`${V3_DIR}/${MIGRATION_FILE}`, 'utf8');
    expect(sql).toMatch(/auth_failure_code/i);
    // Unapproved D08 schedule binding must NOT appear as executable DDL
    const nonCommentLines = sql
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(nonCommentLines).not.toMatch(/digest_authorization/i);
    expect(nonCommentLines).not.toMatch(/ALTER\s+TABLE\s+schedules/i);
    expect(nonCommentLines).not.toMatch(/CREATE\s+TABLE/i);
  });

  it('preserves pre-existing notion_connections rows/constraints across two 0036 applications and keeps NotionConnectionRepo read-compatible', async () => {
    // 1. Apply all migrations strictly prior to 0036
    await applyMigrations(prePool, (f) => f < MIGRATION_FILE);

    const userId = (
      await prePool.query(
        "INSERT INTO users(email,password,name,status,email_verified) VALUES('pre0036@notion-n2b.test','hash','Pre 0036','active',true) RETURNING id",
      )
    ).rows[0].id as string;

    const syntheticCipherA = 'v1:synthetic_cipher_active_row_pre0036';
    const syntheticCipherB = 'v1:synthetic_cipher_reconnect_row_pre0036';
    const dbUuid = '11111111-2222-3333-4444-555555555555';

    const rowActiveId = (
      await prePool.query(
        `INSERT INTO notion_connections(
           user_id, app_id, workspace_id, workspace_name, actor_id, bot_id,
           identity_version, status, config, allowed_databases, selected_databases, is_default, refresh_in_flight
         ) VALUES($1,'app-1','ws-active','Active WS','actor-1','bot-1',3,'active',$2,$3,$4::jsonb,true,false)
         RETURNING id`,
        [
          userId,
          syntheticCipherA,
          [dbUuid],
          JSON.stringify([{ id: dbUuid, title: 'Roadmap' }]),
        ],
      )
    ).rows[0].id as string;

    const rowReconnectId = (
      await prePool.query(
        `INSERT INTO notion_connections(
           user_id, app_id, workspace_id, workspace_name, actor_id, bot_id,
           identity_version, status, config, is_default, refresh_in_flight
         ) VALUES($1,'app-1','ws-reconn','Reconnect WS','actor-2','bot-2',2,'reconnect_required',$2,false,false)
         RETURNING id`,
        [userId, syntheticCipherB],
      )
    ).rows[0].id as string;

    const rowDisconnectedId = (
      await prePool.query(
        `INSERT INTO notion_connections(
           user_id, app_id, workspace_id, workspace_name, actor_id, bot_id,
           identity_version, status, config, is_default, refresh_in_flight
         ) VALUES($1,'app-1','ws-disc','Disconnected WS','actor-3','bot-3',4,'disconnected',NULL,false,false)
         RETURNING id`,
        [userId],
      )
    ).rows[0].id as string;

    // 2. Apply 0036 twice on the schema containing existing rows
    const files = await listV3MigrationFiles();
    expect(files).toContain(MIGRATION_FILE);
    const migSql = await readFile(`${V3_DIR}/${MIGRATION_FILE}`, 'utf8');
    await prePool.query(migSql);
    await prePool.query(migSql);

    // 3. Verify existing rows are preserved with auth_failure_code IS NULL
    const rowsRes = await prePool.query(
      'SELECT id, status, identity_version, config, allowed_databases, is_default, refresh_in_flight, auth_failure_code FROM notion_connections ORDER BY workspace_id',
    );
    expect(rowsRes.rows).toHaveLength(3);

    const byId = new Map(rowsRes.rows.map((r: any) => [r.id, r]));
    const activeAfter = byId.get(rowActiveId)!;
    expect(activeAfter.status).toBe('active');
    expect(activeAfter.identity_version).toBe(3);
    expect(fingerprintSecret(activeAfter.config)).toBe(fingerprintSecret(syntheticCipherA));
    expect(activeAfter.allowed_databases).toEqual([dbUuid]);
    expect(activeAfter.is_default).toBe(true);
    expect(activeAfter.auth_failure_code).toBeNull();

    const reconnAfter = byId.get(rowReconnectId)!;
    expect(reconnAfter.status).toBe('reconnect_required');
    expect(reconnAfter.identity_version).toBe(2);
    expect(fingerprintSecret(reconnAfter.config)).toBe(fingerprintSecret(syntheticCipherB));
    expect(reconnAfter.auth_failure_code).toBeNull();

    const discAfter = byId.get(rowDisconnectedId)!;
    expect(discAfter.status).toBe('disconnected');
    expect(discAfter.config).toBeNull();
    expect(discAfter.auth_failure_code).toBeNull();

    // 4. Verify NotionConnectionRepo reads existing rows cleanly
    const repo = new NotionConnectionRepo(prePool);
    const listed = await repo.list(userId);
    expect(listed.map((r) => r.id)).toEqual([rowActiveId, rowReconnectId]);
    const defaultActive = await repo.getActive(userId);
    expect(defaultActive?.id).toBe(rowActiveId);
    expect((defaultActive as any)?.auth_failure_code).toBeNull();
  }, MIGRATION_REPLAY_TIMEOUT_MS);

  it('applies full v3 migration chain twice on a fresh schema, accepts NULL and all 6 allowlisted codes, and rejects invalid codes with 23514', async () => {
    const firstRun = await applyMigrations(freshPool);
    expect(firstRun).toContain(MIGRATION_FILE);
    const secondRun = await applyMigrations(freshPool);
    expect(secondRun).toEqual(firstRun);

    const userId = (
      await freshPool.query(
        "INSERT INTO users(email,password,name,status,email_verified) VALUES('fresh0036@notion-n2b.test','hash','Fresh 0036','active',true) RETURNING id",
      )
    ).rows[0].id as string;

    const rowId = (
      await freshPool.query(
        `INSERT INTO notion_connections(user_id,app_id,workspace_id,workspace_name,actor_id,bot_id,config)
         VALUES($1,'app-1','ws-1','Fresh WS','actor-1','bot-1','v1:synthetic_fresh')
         RETURNING id, auth_failure_code`,
        [userId],
      )
    ).rows[0];
    expect(rowId.auth_failure_code).toBeNull();

    for (const code of ALLOWLISTED_CODES) {
      const updated = await freshPool.query(
        'UPDATE notion_connections SET auth_failure_code = $2 WHERE id = $1 RETURNING auth_failure_code',
        [rowId.id, code],
      );
      expect(updated.rows[0].auth_failure_code).toBe(code);
    }

    await expect(
      freshPool.query('UPDATE notion_connections SET auth_failure_code = NULL WHERE id = $1', [rowId.id]),
    ).resolves.toBeTruthy();

    for (const badCode of ['', 'resource_denied', 'unknown_failure', 'INVALID_GRANT', 'sql_injected']) {
      await expect(
        freshPool.query('UPDATE notion_connections SET auth_failure_code = $2 WHERE id = $1', [
          rowId.id,
          badCode,
        ]),
        `expected check_violation for ${badCode}`,
      ).rejects.toMatchObject({ code: '23514' });
    }

    // Existing disconnected config=NULL constraint still enforced
    await expect(
      freshPool.query(
        `INSERT INTO notion_connections(user_id,app_id,workspace_id,workspace_name,actor_id,bot_id,status,config)
         VALUES($1,'app-1','ws-bad-disc','Bad Disc','actor-9','bot-9','disconnected','v1:non_null')`,
        [userId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  }, MIGRATION_REPLAY_TIMEOUT_MS);
});
