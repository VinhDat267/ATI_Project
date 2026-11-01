import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));
const databaseUrl = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3';

describe('0015_workspaces.sql migration and schema invariants', () => {
  const schema = `migration_ws_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool;
  let pool: pg.Pool;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: url.href, max: 8 });

    // Apply migrations up to 0015
    for (const f of (await readdir(directory)).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()) {
      await pool.query(await readFile(`${directory}/${f}`, 'utf8'));
    }
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it('runs 0015_workspaces.sql idempotently a second time without error', async () => {
    const sql = await readFile(`${directory}/0015_workspaces.sql`, 'utf8');
    await expect(pool.query(sql)).resolves.not.toThrow();
  });

  it('creates workspaces table with name check and default require_approval = true', async () => {
    const creatorId = randomUUID();
    await pool.query("INSERT INTO users(id, email, password, name, status, email_verified) VALUES($1, $2, 'hash', 'Owner', 'active', true)", [creatorId, `${creatorId}@example.test`]);

    const res = await pool.query(
      `INSERT INTO workspaces (name, invite_code, created_by)
       VALUES ('Tổ chức Alpha', 'ATI-TEST-1234', $1)
       RETURNING *`,
      [creatorId]
    );

    expect(res.rows[0]).toMatchObject({
      name: 'Tổ chức Alpha',
      invite_code: 'ATI-TEST-1234',
      require_approval: true,
      created_by: creatorId,
    });

    // Check name constraint: length between 1 and 100
    await expect(
      pool.query("INSERT INTO workspaces (name, invite_code, created_by) VALUES ('', 'ATI-FAIL-0001', $1)", [creatorId])
    ).rejects.toThrow();
  });

  it('creates workspace_members table with role and status constraints', async () => {
    const u1 = randomUUID();
    const u2 = randomUUID();
    await pool.query("INSERT INTO users(id, email, password, name, status, email_verified) VALUES($1, $2, 'hash', 'U1', 'active', true), ($3, $4, 'hash', 'U2', 'active', true)",
      [u1, `${u1}@example.test`, u2, `${u2}@example.test`]);

    const wsRes = await pool.query("INSERT INTO workspaces (name, invite_code, created_by) VALUES ('WS Members Test', 'ATI-MEMB-0001', $1) RETURNING id", [u1]);
    const wsId = wsRes.rows[0].id;

    // Insert admin
    const m1 = await pool.query("INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'admin', 'active') RETURNING *", [wsId, u1]);
    expect(m1.rows[0].role).toBe('admin');
    expect(m1.rows[0].status).toBe('active');

    // Insert default member (role='member', status='pending')
    const m2 = await pool.query("INSERT INTO workspace_members (workspace_id, user_id) VALUES ($1, $2) RETURNING *", [wsId, u2]);
    expect(m2.rows[0].role).toBe('member');
    expect(m2.rows[0].status).toBe('pending');

    // Reject invalid role
    await expect(pool.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'superuser')", [wsId, u2])).rejects.toThrow();
  });

  it('enforces consistency constraint on conversations.workspace_mode and workspace_id', async () => {
    const uId = randomUUID();
    await pool.query("INSERT INTO users(id, email, password, name, status, email_verified) VALUES($1, $2, 'hash', 'Conv User', 'active', true)", [uId, `${uId}@example.test`]);
    const wsRes = await pool.query("INSERT INTO workspaces (name, invite_code, created_by) VALUES ('Conv WS', 'ATI-CONV-0001', $1) RETURNING id", [uId]);
    const wsId = wsRes.rows[0].id;

    // 1. legacy mode with workspace_id IS NULL: OK
    const legacyConv = await pool.query("INSERT INTO conversations (user_id, workspace_mode, workspace_id) VALUES ($1, 'legacy', NULL) RETURNING *", [uId]);
    expect(legacyConv.rows[0].workspace_mode).toBe('legacy');

    // 2. personal mode with workspace_id IS NULL: OK
    const personalConv = await pool.query("INSERT INTO conversations (user_id, workspace_mode, workspace_id) VALUES ($1, 'personal', NULL) RETURNING *", [uId]);
    expect(personalConv.rows[0].workspace_mode).toBe('personal');

    // 3. organization mode with workspace_id NOT NULL: OK
    const orgConv = await pool.query("INSERT INTO conversations (user_id, workspace_mode, workspace_id) VALUES ($1, 'organization', $2) RETURNING *", [uId, wsId]);
    expect(orgConv.rows[0].workspace_mode).toBe('organization');
    expect(orgConv.rows[0].workspace_id).toBe(wsId);

    // 4. organization mode with workspace_id NULL: MUST FAIL
    await expect(
      pool.query("INSERT INTO conversations (user_id, workspace_mode, workspace_id) VALUES ($1, 'organization', NULL)", [uId])
    ).rejects.toThrow();

    // 5. personal mode with workspace_id NOT NULL: MUST FAIL
    await expect(
      pool.query("INSERT INTO conversations (user_id, workspace_mode, workspace_id) VALUES ($1, 'personal', $2)", [uId, wsId])
    ).rejects.toThrow();
  });

  it('enforces consistency constraint on schedules.workspace_mode and workspace_id', async () => {
    const uId = randomUUID();
    await pool.query("INSERT INTO users(id, email, password, name, status, email_verified) VALUES($1, $2, 'hash', 'Sched User', 'active', true)", [uId, `${uId}@example.test`]);
    const wsRes = await pool.query("INSERT INTO workspaces (name, invite_code, created_by) VALUES ('Sched WS', 'ATI-SCHD-0001', $1) RETURNING id", [uId]);
    const wsId = wsRes.rows[0].id;
    const convRes = await pool.query("INSERT INTO conversations (user_id, workspace_mode, workspace_id) VALUES ($1, 'legacy', NULL) RETURNING id", [uId]);
    const convId = convRes.rows[0].id;

    // Organization mode requires workspace_id
    await expect(
      pool.query("INSERT INTO schedules (user_id, conv_id, name, request, recurrence, services, status, workspace_mode, workspace_id) VALUES ($1, $2, 'test', 'req', '{}', '{}', 'paused', 'organization', NULL)", [uId, convId])
    ).rejects.toThrow();

    const okSched = await pool.query("INSERT INTO schedules (user_id, conv_id, name, request, recurrence, services, status, workspace_mode, workspace_id) VALUES ($1, $2, 'test', 'req', '{}', '{}', 'paused', 'organization', $3) RETURNING *", [uId, convId, wsId]);
    expect(okSched.rows[0].workspace_mode).toBe('organization');
  });

  it('allows trello_team_scope and trello_team_boards with default, workspace UUID, and personal:UUID', async () => {
    const uId = randomUUID();
    await pool.query("INSERT INTO users(id, email, password, name, status, email_verified) VALUES($1, $2, 'hash', 'Trello User', 'active', true)", [uId, `${uId}@example.test`]);
    const wsId = randomUUID();

    // 1. 'default'
    await pool.query("INSERT INTO trello_team_scope (id, workspace_id, workspace_name, chosen_by) VALUES ('default', 'trello-ws-default', 'Default WS', $1) ON CONFLICT (id) DO NOTHING", [uId]);
    await pool.query("INSERT INTO trello_team_boards (scope_id, workspace_id, board_id, board_name) VALUES ('default', 'trello-ws-default', 'b-def-1', 'Board Def 1')");

    // 2. workspace UUID
    await pool.query("INSERT INTO trello_team_scope (id, workspace_id, workspace_name, chosen_by) VALUES ($1, 'trello-ws-org', 'Org WS', $2)", [wsId, uId]);
    await pool.query("INSERT INTO trello_team_boards (scope_id, workspace_id, board_id, board_name) VALUES ($1, 'trello-ws-org', 'b-org-1', 'Board Org 1')", [wsId]);

    // 3. 'personal:' || uId
    const personalScopeId = `personal:${uId}`;
    await pool.query("INSERT INTO trello_team_scope (id, workspace_id, workspace_name, chosen_by) VALUES ($1, 'trello-ws-pers', 'Personal WS', $2)", [personalScopeId, uId]);
    await pool.query("INSERT INTO trello_team_boards (scope_id, workspace_id, board_id, board_name) VALUES ($1, 'trello-ws-pers', 'b-pers-1', 'Board Personal 1')", [personalScopeId]);

    // 4. Invalid scope ID should fail check constraint
    await expect(
      pool.query("INSERT INTO trello_team_scope (id, workspace_id, workspace_name, chosen_by) VALUES ('invalid-scope-id', 'trello-ws', 'Invalid', $1)", [uId])
    ).rejects.toThrow();
  });

  it('[AUDIT-C] automatically migrates pre-existing shared credentials, default Trello boards, and active users into "Không gian Chung" when 0015 runs', async () => {
    const upgradeSchema = `migration_upg_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE SCHEMA "${upgradeSchema}"`);
    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-c search_path=${upgradeSchema}`);
    const upgPool = new pg.Pool({ connectionString: url.href, max: 4 });

    try {
      const files = (await readdir(directory)).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
      for (const f of files.filter(f => parseInt(f.slice(0, 4), 10) < 15)) {
        await upgPool.query(await readFile(`${directory}/${f}`, 'utf8'));
      }

      // Seed existing pre-0015 data: 1 active admin, 1 active member, 1 pending stranger, 1 shared slack credential, 1 default trello scope, 1 conversation
      const adminId = randomUUID();
      const memberId = randomUUID();
      const pendingId = randomUUID();
      await upgPool.query(
        `INSERT INTO users (id, email, password, name, role, status, email_verified) VALUES
         ($1, 'admin@legacy.test', 'h', 'Legacy Admin', 'admin', 'active', true),
         ($2, 'member@legacy.test', 'h', 'Legacy Member', 'member', 'active', true),
         ($3, 'pending@legacy.test', 'h', 'Pending Stranger', 'member', 'pending', false)`,
        [adminId, memberId, pendingId]
      );
      await upgPool.query(
        "INSERT INTO service_credentials (service, user_id, config, status) VALUES ('slack', NULL, 'v1:legacy-shared-slack', 'active')"
      );
      await upgPool.query(
        "INSERT INTO trello_team_scope (id, workspace_id, workspace_name, chosen_by) VALUES ('default', 'tr-ws-1', 'Trello Legacy WS', $1)",
        [adminId]
      );
      await upgPool.query(
        "INSERT INTO trello_team_boards (scope_id, workspace_id, board_id, board_name, position) VALUES ('default', 'tr-ws-1', 'b-leg-1', 'Board Legacy 1', 1)"
      );
      const convRes = await upgPool.query(
        "INSERT INTO conversations (user_id, status, title) VALUES ($1, 'chatting', 'Hội thoại cũ') RETURNING id",
        [memberId]
      );

      // Now run 0015_workspaces.sql
      await upgPool.query(await readFile(`${directory}/0015_workspaces.sql`, 'utf8'));

      // Run subsequent migrations (e.g. 0018_jira_workspaces.sql)
      for (const f of files.filter(f => parseInt(f.slice(0, 4), 10) > 15)) {
        await upgPool.query(await readFile(`${directory}/${f}`, 'utf8'));
      }

      // Verify "Không gian Chung" was created
      const wsRes = await upgPool.query("SELECT * FROM workspaces WHERE name = 'Không gian Chung'");
      expect(wsRes.rows).toHaveLength(1);
      const defaultWsId = wsRes.rows[0].id as string;
      expect(wsRes.rows[0].created_by).toBe(adminId);

      // Verify active admin and active member are enrolled, but pending stranger is not
      const membersRes = await upgPool.query(
        'SELECT user_id, role, status FROM workspace_members WHERE workspace_id = $1 ORDER BY role ASC',
        [defaultWsId]
      );
      expect(membersRes.rows).toEqual([
        { user_id: adminId, role: 'admin', status: 'active' },
        { user_id: memberId, role: 'member', status: 'active' },
      ]);

      // Verify shared slack credential now belongs to defaultWsId
      const credRes = await upgPool.query("SELECT workspace_id FROM service_credentials WHERE service = 'slack'");
      expect(credRes.rows[0].workspace_id).toBe(defaultWsId);

      // Verify Trello scope and board were copied to defaultWsId
      const trelloScopeRes = await upgPool.query('SELECT * FROM trello_team_scope WHERE id = $1', [defaultWsId]);
      expect(trelloScopeRes.rows).toHaveLength(1);
      const trelloBoardRes = await upgPool.query('SELECT * FROM trello_team_boards WHERE scope_id = $1', [defaultWsId]);
      expect(trelloBoardRes.rows).toHaveLength(1);
      expect(trelloBoardRes.rows[0].board_id).toBe('b-leg-1');

      // Verify existing conversation was migrated to defaultWsId
      const migratedConv = await upgPool.query('SELECT workspace_mode, workspace_id FROM conversations WHERE id = $1', [
        convRes.rows[0].id,
      ]);
      expect(migratedConv.rows[0]).toEqual({
        workspace_mode: 'organization',
        workspace_id: defaultWsId,
      });
    } finally {
      await upgPool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${upgradeSchema}" CASCADE`);
    }
  });
});
