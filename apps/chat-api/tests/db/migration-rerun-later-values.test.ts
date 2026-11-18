import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Live audit 18/11/2026: `npm run db:migrate:v3` failed with 23514 on a database that already had a
// `myjira_digest` schedule, because 0016–0020/0032 re-create `schedules_kind_check` with an older list.
const MIGRATE_SCRIPT = fileURLToPath(new URL('../../../../db/v3/migrate.mjs', import.meta.url));
const DIGEST_KINDS = [
  'sheets_digest', 'calendar_digest', 'github_digest', 'telegram_digest',
  'slack_digest', 'trello_digest', 'notion_digest', 'myjira_digest',
];
const CONNECT_MODES = [
  'connect_gmail', 'connect_mycalendar', 'connect_mysheets', 'connect_trello', 'connect_github',
  'connect_telegram', 'connect_notion', 'connect_jira_identity', 'connect_jira_sites',
];

const runMigrate = (databaseUrl: string) =>
  spawnSync(process.execPath, [MIGRATE_SCRIPT], { env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8' });

describe.skipIf(!process.env.DATABASE_URL)('db/v3/migrate.mjs re-run with rows that only newer migrations allow', () => {
  it('re-applies every migration without rejecting existing digest schedules or OAuth states', async () => {
    const rawUrl = process.env.DATABASE_URL!;
    const dbName = `mig_rerun_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const adminUrl = new URL(rawUrl);
    adminUrl.pathname = '/postgres';
    const targetUrl = new URL(rawUrl);
    targetUrl.pathname = `/${dbName}`;
    const admin = new pg.Pool({ connectionString: adminUrl.href, max: 1 });
    try {
      await admin.query(`CREATE DATABASE "${dbName}"`);
      const first = runMigrate(targetUrl.href);
      expect(first.status, first.stderr).toBe(0);

      const db = new pg.Pool({ connectionString: targetUrl.href, max: 2 });
      // DROP DATABASE ... WITH (FORCE) below may terminate a closing client (57P01).
      db.on('error', () => {});
      try {
        const userId = (await db.query(
          `INSERT INTO users (email, name) VALUES ('rerun@example.test', 'Rerun') RETURNING id`,
        )).rows[0]!.id as string;
        const sessionId = (await db.query(
          `INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at)
           VALUES ($1, $2, now() + interval '1 day') RETURNING id`,
          [userId, 'b'.repeat(64)],
        )).rows[0]!.id as string;

        for (const kind of DIGEST_KINDS) {
          const convId = (await db.query(
            `INSERT INTO conversations (user_id) VALUES ($1) RETURNING id`, [userId],
          )).rows[0]!.id as string;
          await db.query(
            `INSERT INTO schedules (user_id, conv_id, name, request, recurrence, services, status, kind,
                                    digest_config, digest_config_hash, digest_approved_at)
             VALUES ($1, $2, $3, 'r', '{"type":"daily","time":"08:00"}'::jsonb, '{slack}', 'paused', $3,
                     '{}'::jsonb, $4, now())`,
            [userId, convId, kind, 'a'.repeat(64)],
          );
        }
        for (const mode of CONNECT_MODES) {
          await db.query(
            `INSERT INTO oauth_states (state_hash, mode, user_id, session_id, code_verifier, nonce,
                                       browser_binding_hash, expires_at, return_to)
             VALUES ($1, $2, $3, $4, 'v', 'n', $5, now() + interval '10 minutes', $6)`,
            [createHash('sha256').update(mode).digest('hex'), mode, userId, sessionId, 'c'.repeat(64), `/c/${randomUUID()}`],
          );
        }

        const second = runMigrate(targetUrl.href);
        expect(second.status, second.stderr).toBe(0);

        const counts = (await db.query(
          `SELECT (SELECT count(*)::int FROM schedules) AS schedules,
                  (SELECT count(*)::int FROM oauth_states) AS oauth_states`,
        )).rows[0];
        expect(counts).toEqual({ schedules: DIGEST_KINDS.length, oauth_states: CONNECT_MODES.length });
      } finally {
        await db.end();
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
      await admin.end();
    }
  }, 60_000);
});
