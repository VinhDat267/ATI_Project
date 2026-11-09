import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const migrationsDir = path.join(repoRoot, 'db', 'v3');
const migration0034Path = path.join(migrationsDir, '0034_github_workspace_scoped_team_scope.sql');

export const WS_ALPHA_UUID = '11111111-1111-4111-8111-111111111111';
export const WS_BETA_UUID = '22222222-2222-4222-8222-222222222222';
export const USER_ALPHA_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const USER_BETA_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const MIGRATION_0033_SQL = `
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS workspace_mode TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS workspace_mode TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS workspace_mode TEXT NOT NULL DEFAULT 'legacy';
`;

export function assertDedicatedTestDatabaseUrl(connectionString) {
  const parsed = new URL(connectionString);
  const host = parsed.hostname;
  const port = parsed.port || '5432';
  const dbName = parsed.pathname.replace(/^\//, '');

  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`Unsafe migration test host "${host}": must be 127.0.0.1 or localhost.`);
  }
  if (port === '55533') {
    throw new Error('Refusing to run migration rehearsal on runtime port 55533.');
  }
  if (dbName === 'ati_v3' || !dbName.includes('test')) {
    throw new Error(
      `Refusing to run migration rehearsal on database "${dbName}": dedicated *_test database required.`,
    );
  }
}

export async function run0034MigrationVerification({
  adminUrl = 'postgres://ati_v3:ati_v3_local_only@127.0.0.1:56534/postgres',
  testDbUrl = 'postgres://ati_v3:ati_v3_local_only@127.0.0.1:56534/ati_v3_migration_test',
} = {}) {
  assertDedicatedTestDatabaseUrl(testDbUrl);

  const sql0034 = fs.readFileSync(migration0034Path, 'utf8');
  const baselineFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && f !== '0034_github_workspace_scoped_team_scope.sql')
    .sort();

  const adminClient = new pg.Client({ connectionString: adminUrl });
  await adminClient.connect();
  try {
    await adminClient.query(`
      SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
       WHERE datname = 'ati_v3_migration_test'
         AND pid <> pg_backend_pid()
    `);
    await adminClient.query('DROP DATABASE IF EXISTS ati_v3_migration_test');
    await adminClient.query('CREATE DATABASE ati_v3_migration_test');
  } finally {
    await adminClient.end();
  }

  const testPool = new pg.Pool({ connectionString: testDbUrl, max: 4 });
  try {
    // Scenario 1: pre_0033 baseline (without 0015_workspaces.sql) -> seed legacy 'default' -> run 0034 -> verify constraints, repeated runs, immutable archives, tenant isolation
    await testPool.query('DROP SCHEMA IF EXISTS s1_pre0033 CASCADE; CREATE SCHEMA s1_pre0033;');
    const c1 = await testPool.connect();
    let scenario1;
    try {
      await c1.query('SET search_path TO s1_pre0033, public');
      for (const file of baselineFiles) {
        await c1.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
      }
      await c1.query(
        `INSERT INTO users (id, email, password, name, role, status)
         VALUES ($1, 'alpha@example.com', 'hash', 'Alpha Admin', 'admin', 'active'),
                ($2, 'beta@example.com', 'hash', 'Beta Admin', 'admin', 'active')`,
        [USER_ALPHA_UUID, USER_BETA_UUID],
      );

      // Seed legacy 'default' row before 0034
      await c1.query(`INSERT INTO github_team_scope (id, chosen_by) VALUES ('default', $1)`, [USER_ALPHA_UUID]);
      await c1.query(
        `INSERT INTO github_team_repos (id, scope_id, repo_id, full_name, name, position)
         VALUES ('33333333-3333-4333-8333-333333333331', 'default', '101', 'VinhDat267/legacy-repo-1', 'legacy-repo-1', 1),
                ('33333333-3333-4333-8333-333333333332', 'default', '102', 'VinhDat267/legacy-repo-2', 'legacy-repo-2', 2)`,
      );

      // Run 0034 (Pass 1)
      await c1.query(sql0034);
      // Run 0034 (Pass 2 - Idempotency)
      await c1.query(sql0034);

      // Conflicting archive snapshot test: temporarily drop constraint, insert second 'default', re-run 0034
      await c1.query('ALTER TABLE github_team_scope DROP CONSTRAINT github_team_scope_id_check');
      await c1.query('ALTER TABLE github_team_repos DROP CONSTRAINT github_team_repos_scope_id_check');
      await c1.query(`INSERT INTO github_team_scope (id, chosen_by) VALUES ('default', $1)`, [USER_BETA_UUID]);
      await c1.query(
        `INSERT INTO github_team_repos (id, scope_id, repo_id, full_name, name, position)
         VALUES ('33333333-3333-4333-8333-333333333333', 'default', '103', 'VinhDat267/legacy-repo-conflict', 'legacy-repo-conflict', 1)`,
      );
      await c1.query(sql0034);

      // Verify immutable archive ON DELETE RESTRICT
      let archiveDeleteBlocked = false;
      try {
        await c1.query('DELETE FROM github_team_scope_legacy_archive WHERE snapshot_id = 1');
      } catch {
        archiveDeleteBlocked = true;
      }

      // Verify CHECK constraints
      let rejectedDefaultScope = false;
      try {
        await c1.query(`INSERT INTO github_team_scope (id, chosen_by) VALUES ('default', $1)`, [USER_ALPHA_UUID]);
      } catch {
        rejectedDefaultScope = true;
      }

      // Insert valid UUID workspace scopes for WS_ALPHA_UUID and WS_BETA_UUID
      await c1.query(`INSERT INTO github_team_scope (id, chosen_by) VALUES ($1, $2), ($3, $4)`, [
        WS_ALPHA_UUID,
        USER_ALPHA_UUID,
        WS_BETA_UUID,
        USER_BETA_UUID,
      ]);
      await c1.query(
        `INSERT INTO github_team_repos (id, scope_id, repo_id, full_name, name, position)
         VALUES ('44444444-4444-4444-8444-444444444441', $1, '201', 'alpha-org/alpha-repo', 'alpha-repo', 1),
                ('44444444-4444-4444-8444-444444444442', $2, '202', 'beta-org/beta-repo', 'beta-repo', 1)`,
        [WS_ALPHA_UUID, WS_BETA_UUID],
      );

      let rejectedBadFullName = false;
      try {
        await c1.query(
          `INSERT INTO github_team_repos (id, scope_id, repo_id, full_name, name, position)
           VALUES ('44444444-4444-4444-8444-444444444443', $1, '203', 'invalid_repo_name', 'bad', 2)`,
          [WS_ALPHA_UUID],
        );
      } catch {
        rejectedBadFullName = true;
      }

      let rejectedBadPosition = false;
      try {
        await c1.query(
          `INSERT INTO github_team_repos (id, scope_id, repo_id, full_name, name, position)
           VALUES ('44444444-4444-4444-8444-444444444444', $1, '204', 'alpha-org/pos-bad', 'pos-bad', 11)`,
          [WS_ALPHA_UUID],
        );
      } catch {
        rejectedBadPosition = true;
      }

      let rejectedDefaultRepoScope = false;
      try {
        await c1.query(
          `INSERT INTO github_team_repos (id, scope_id, repo_id, full_name, name, position)
           VALUES ('44444444-4444-4444-8444-444444444445', 'default', '205', 'alpha-org/def', 'def', 2)`,
        );
      } catch {
        rejectedDefaultRepoScope = true;
      }

      // Verify FK ON DELETE CASCADE isolates WS_ALPHA_UUID deletion from WS_BETA_UUID
      await c1.query(`DELETE FROM github_team_scope WHERE id = $1`, [WS_ALPHA_UUID]);
      const remainingRepos = await c1.query(
        `SELECT scope_id, full_name FROM github_team_repos ORDER BY scope_id`,
      );

      const constraintsRes = await c1.query(`
        SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS def
          FROM pg_constraint
         WHERE connamespace = 's1_pre0033'::regnamespace
           AND conrelid::regclass::text LIKE '%github_team%'
         ORDER BY table_name, conname
      `);

      const archiveSnapshots = await c1.query(
        `SELECT snapshot_id::text, legacy_id FROM github_team_scope_legacy_archive ORDER BY snapshot_id`,
      );
      const archiveRepos = await c1.query(
        `SELECT snapshot_id::text, full_name FROM github_team_repos_legacy_archive ORDER BY snapshot_id, position`,
      );

      scenario1 = {
        archiveSnapshotCount: archiveSnapshots.rowCount,
        archiveRepoCount: archiveRepos.rowCount,
        archiveDeleteBlocked,
        rejectedDefaultScope,
        rejectedBadFullName,
        rejectedBadPosition,
        rejectedDefaultRepoScope,
        remainingReposAfterAlphaCascade: remainingRepos.rows,
        constraints: constraintsRes.rows,
      };
    } finally {
      c1.release();
    }

    // Scenario 2: post_0033 baseline (all 44 baseline migrations including 0015_workspaces.sql) -> pre-existing multi-tenant WS_ALPHA_UUID + WS_BETA_UUID + legacy 'default' -> run 0034
    await testPool.query('DROP SCHEMA IF EXISTS s2_post0033 CASCADE; CREATE SCHEMA s2_post0033;');
    const c2 = await testPool.connect();
    let scenario2;
    try {
      await c2.query('SET search_path TO s2_post0033, public');
      for (const file of baselineFiles) {
        await c2.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
      }
      await c2.query(
        `INSERT INTO users (id, email, password, name, role, status)
         VALUES ($1, 'alpha@example.com', 'hash', 'Alpha Admin', 'admin', 'active'),
                ($2, 'beta@example.com', 'hash', 'Beta Admin', 'admin', 'active')`,
        [USER_ALPHA_UUID, USER_BETA_UUID],
      );
      await c2.query(
        `INSERT INTO workspaces (id, name, invite_code, created_by)
         VALUES ($1, 'Alpha Org', 'INV-ALPHA-2', $3),
                ($2, 'Beta Org', 'INV-BETA-2', $4)`,
        [WS_ALPHA_UUID, WS_BETA_UUID, USER_ALPHA_UUID, USER_BETA_UUID],
      );

      // Seed legacy 'default' row
      await c2.query(`INSERT INTO github_team_scope (id, chosen_by) VALUES ('default', $1)`, [USER_ALPHA_UUID]);
      await c2.query(
        `INSERT INTO github_team_repos (id, scope_id, repo_id, full_name, name, position)
         VALUES ('55555555-5555-4555-8555-555555555551', 'default', '301', 'VinhDat267/legacy-post0033', 'legacy-post0033', 1)`,
      );

      // Run 0034 and insert valid UUID workspace scopes
      await c2.query(sql0034);
      await c2.query(`INSERT INTO github_team_scope (id, chosen_by) VALUES ($1, $2), ($3, $4)`, [
        WS_ALPHA_UUID,
        USER_ALPHA_UUID,
        WS_BETA_UUID,
        USER_BETA_UUID,
      ]);
      await c2.query(
        `INSERT INTO github_team_repos (id, scope_id, repo_id, full_name, name, position)
         VALUES ('55555555-5555-4555-8555-555555555552', $1, '302', 'alpha-org/repo-a', 'repo-a', 1),
                ('55555555-5555-4555-8555-555555555553', $2, '303', 'beta-org/repo-b', 'repo-b', 1)`,
        [WS_ALPHA_UUID, WS_BETA_UUID],
      );
      // Re-run 0034 to confirm idempotency preserves valid UUID workspace scopes untouched
      await c2.query(sql0034);

      const activeScopes = await c2.query(`SELECT id FROM github_team_scope ORDER BY id`);
      const activeRepos = await c2.query(
        `SELECT scope_id, full_name FROM github_team_repos ORDER BY scope_id`,
      );
      const archivedScopes = await c2.query(
        `SELECT legacy_id FROM github_team_scope_legacy_archive`,
      );

      scenario2 = {
        activeScopes: activeScopes.rows,
        activeRepos: activeRepos.rows,
        archivedScopes: archivedScopes.rows,
      };
    } finally {
      c2.release();
    }

    return {
      migrationFile: 'db/v3/0034_github_workspace_scoped_team_scope.sql',
      scenario1,
      scenario2,
    };
  } finally {
    await testPool.end();
    const cleanupClient = new pg.Client({ connectionString: adminUrl });
    await cleanupClient.connect();
    try {
      await cleanupClient.query(`
        SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
         WHERE datname = 'ati_v3_migration_test'
           AND pid <> pg_backend_pid()
      `);
      await cleanupClient.query('DROP DATABASE IF EXISTS ati_v3_migration_test');
    } finally {
      await cleanupClient.end();
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await run0034MigrationVerification();
  console.log(JSON.stringify(result, null, 2));
}
