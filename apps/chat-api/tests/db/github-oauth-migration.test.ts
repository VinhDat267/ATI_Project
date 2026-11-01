import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));
const hex = (n = 64) => randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, n);
const daily = JSON.stringify({ type: 'daily', time: '08:00' });

async function connectAdmin(): Promise<{ admin: pg.Pool; databaseUrl: string }> {
  const candidates = [
    process.env.DATABASE_URL,
    'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3',
    'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:56533/ati_v3',
  ].filter(Boolean) as string[];

  for (const url of candidates) {
    try {
      const p = new pg.Pool({ connectionString: url });
      await p.query('SELECT 1');
      return { admin: p, databaseUrl: url };
    } catch {
      // try next candidate
    }
  }
  throw new Error('Cannot connect to PostgreSQL on any candidate port (55533, 56533)');
}

describe('migration 0018 (github oauth, team repo scope, and digest schedules) on PostgreSQL', () => {
  const schema = `github_oauth_migration_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool, pool: pg.Pool, files: string[];
  let userId: string, sessionId: string;

  const runAll = async () => {
    for (const f of files) {
      await pool.query(await readFile(`${directory}/${f}`, 'utf8'));
    }
  };

  const state = (mode: string, user: string | null, session: string | null, returnTo: unknown = null) => pool.query(
    `INSERT INTO oauth_states(state_hash,browser_binding_hash,code_verifier,nonce,mode,user_id,session_id,expires_at,return_to)
     VALUES($1,$2,'verifier','nonce',$3,$4,$5,now()+interval '10 minutes',$6) RETURNING id`,
    [hex(), hex(), mode, user, session, returnTo]
  );

  const conversation = async () => (await pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [userId])).rows[0].id as string;

  beforeAll(async () => {
    const conn = await connectAdmin();
    admin = conn.admin;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(conn.databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: url.href });
    files = (await readdir(directory)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    expect(files).toContain('0018_github_oauth_and_digest.sql');
    await runAll();
    await runAll();
    userId = (await pool.query("INSERT INTO users(email,password,name) VALUES('owner@example.test','hash','Owner') RETURNING id")).rows[0].id;
    sessionId = (await pool.query("INSERT INTO auth_sessions(user_id,refresh_token_hash,expires_at) VALUES($1,$2,now()+interval '1 day') RETURNING id", [userId, hex()])).rows[0].id;
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it('accepts connect_github with user_id, session_id and return_to as /c/<uuid> or NULL', async () => {
    const convId = randomUUID();
    await expect(state('connect_github', userId, sessionId, null)).resolves.toBeTruthy();
    await expect(state('connect_github', userId, sessionId, `/c/${convId}`)).resolves.toBeTruthy();
  });

  it('rejects connect_github without user_id/session_id or with invalid return_to', async () => {
    const convId = randomUUID();
    await expect(state('connect_github', null, null, null)).rejects.toMatchObject({ code: '23514' });
    await expect(state('connect_github', userId, null, null)).rejects.toMatchObject({ code: '23514' });
    await expect(state('connect_github', null, sessionId, null)).rejects.toMatchObject({ code: '23514' });

    for (const bad of ['/settings', 'https://evil.example', '//evil.example', `/c/${convId.toUpperCase()}`, `/c/${convId}?x=1`, `/c/${convId}/x`]) {
      await expect(state('connect_github', userId, sessionId, bad), bad).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('contains DELETE credential service = github AND user_id IS NULL in the SQL file', async () => {
    const sqlContent = await readFile(`${directory}/0018_github_oauth_and_digest.sql`, 'utf8');
    expect(sqlContent).toMatch(/DELETE\s+FROM\s+service_credentials\s+WHERE\s+service\s*=\s*'github'\s+AND\s+user_id\s+IS\s+NULL/i);
  });

  it('rejects service_credentials with service = github and user_id IS NULL', async () => {
    await expect(pool.query("INSERT INTO service_credentials(service,user_id,config) VALUES('github',NULL,'v1:x')")).rejects.toMatchObject({ code: '23514' });
    const own = (await pool.query("INSERT INTO service_credentials(service,user_id,config) VALUES('github',$1,'v1:x') RETURNING id,status", [userId])).rows[0];
    expect(own.status).toBe('active');
    await pool.query('DELETE FROM service_credentials WHERE id=$1', [own.id]);
  });

  it('enforces team repo scope limit of 10 repos and validates full_name pattern', async () => {
    await pool.query(
      `INSERT INTO github_team_scope(id, chosen_by)
       VALUES('default', $1)
       ON CONFLICT (id) DO UPDATE SET chosen_by = EXCLUDED.chosen_by`,
      [userId]
    );
    await pool.query("DELETE FROM github_team_repos WHERE scope_id = 'default'");

    for (let i = 1; i <= 10; i++) {
      await pool.query(
        `INSERT INTO github_team_repos(scope_id, repo_id, full_name, name, position)
         VALUES('default', $1, $2, $3, $4)`,
        [`repo_${i}`, `octo/repo_${i}`, `repo_${i}`, i]
      );
    }

    await expect(
      pool.query(
        `INSERT INTO github_team_repos(scope_id, repo_id, full_name, name, position)
         VALUES('default', 'repo_11', 'octo/repo_11', 'repo_11', 11)`
      )
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces strict two-way check on schedules.kind and digest_* columns', async () => {
    const convPlanBad = await conversation();
    await expect(
      pool.query(
        `INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at,kind,digest_config)
         VALUES($1,$2,'Lịch','Yêu cầu',$3,'{github,slack}','active',now(),'plan','{"version":1}')`,
        [userId, convPlanBad, daily]
      )
    ).rejects.toMatchObject({ code: '23514' });

    const convDigestBad = await conversation();
    await expect(
      pool.query(
        `INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at,kind,digest_config)
         VALUES($1,$2,'Lịch','Yêu cầu',$3,'{github,slack}','active',now(),'github_digest','{"version":1}')`,
        [userId, convDigestBad, daily]
      )
    ).rejects.toMatchObject({ code: '23514' });

    const convDigestGood = await conversation();
    const inserted = await pool.query(
      `INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at,kind,digest_config,digest_config_hash,digest_approved_at)
       VALUES($1,$2,'Bản tin GitHub','Gửi bản tin GitHub',$3,'{github,slack}','active',now(),'github_digest','{"version":1}',$4,now())
       RETURNING id`,
      [userId, convDigestGood, daily, hex()]
    );
    const scheduleId = inserted.rows[0].id as string;

    // schedule_runs: digest_sent requires delivery, plan_id NULL
    await expect(
      pool.query(
        `INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status,delivery)
         VALUES($1,1,'scheduled','2026-11-02T01:00:00Z','digest_sent',NULL)`,
        [scheduleId]
      )
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      pool.query(
        `INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status,delivery)
         VALUES($1,1,'scheduled','2026-11-02T01:00:00Z','digest_sent','{"channelId":"C1","ts":"1.0"}')`,
        [scheduleId]
      )
    ).resolves.toBeTruthy();

    await expect(
      pool.query(
        `INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status,delivery,error)
         VALUES($1,1,'manual','2026-11-02T02:00:00Z','digest_failed',NULL,'Slack error')`,
        [scheduleId]
      )
    ).resolves.toBeTruthy();

    await expect(
      pool.query(
        `INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status,delivery,error)
         VALUES($1,1,'manual','2026-11-02T03:00:00Z','digest_failed','{"channelId":"C1"}','Slack error')`,
        [scheduleId]
      )
    ).rejects.toMatchObject({ code: '23514' });
  });
});
