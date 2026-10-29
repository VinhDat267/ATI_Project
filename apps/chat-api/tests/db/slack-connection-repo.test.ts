import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { SlackConnectionRepo } from '../../src/db/repositories/slack-connection-repo.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
describe('Slack workspace connections on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>, repo: SlackConnectionRepo;
  beforeAll(async () => { db = await createMigratedSchema('slack_connections'); repo = new SlackConnectionRepo(db.pool); });
  afterAll(async () => { await db?.close(); });
  async function flow(person: { id: string; sid: string }) {
    const state = randomBytes(32).toString('base64url'), browser = randomBytes(32).toString('base64url');
    await repo.start({ userId: person.id, sessionId: person.sid, stateHash: hash(state), browserHash: hash(browser) });
    return { state, browser };
  }
  const input = (workspaceId: string) => ({ appId: 'A_APP', workspaceId, workspaceName: 'Same name', actorId: 'U_ONE', config: 'ENCRYPTED', scopes: ['chat:write'] });
  it('consumes state once, bound to owner/session/browser; stores only hashes', async () => {
    const a = await db.person(), b = await db.person(), f = await flow(a);
    expect(await repo.consume({ ...f, userId: b.id, sessionId: b.sid })).toBeNull();
    const results = await Promise.all([repo.consume({ ...f, userId: a.id, sessionId: a.sid }), repo.consume({ ...f, userId: a.id, sessionId: a.sid })]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(JSON.stringify((await db.pool.query('SELECT * FROM slack_oauth_states')).rows)).not.toContain(f.state);
  });
  it('preserves two workspaces, isolates owners, reconnect changes identity version', async () => {
    const a = await db.person(), b = await db.person();
    const save = async (who: typeof a, workspace: string) => { const f = await flow(who), s = await repo.consume({ ...f, userId: who.id, sessionId: who.sid }); return repo.save(who.id, s!.id, input(workspace)); };
    const first = await save(a, 'T_A'); await save(a, 'T_B');
    expect(await repo.list(a.id)).toHaveLength(2); expect(await repo.list(b.id)).toHaveLength(0);
    await expect(save(b, 'T_A')).rejects.toThrow('SLACK_IDENTITY_CONFLICT');
    const next = await save(a, 'T_A'); expect(next!.id).toBe(first!.id); expect(next!.identity_version).toBe(first!.identity_version + 1);
  });
  it('disconnect invalidates an exchange in flight; cannot resurrect connection', async () => {
    const a = await db.person(), f = await flow(a), state = await repo.consume({ ...f, userId: a.id, sessionId: a.sid });
    await repo.disconnect(a.id, '00000000-0000-4000-8000-000000000000');
    expect(await repo.save(a.id, state!.id, input('T_RACE'))).toBeNull();
    expect(await repo.list(a.id)).toHaveLength(0);
  });
  it('logout after code exchange prevents a save', async () => {
    const a = await db.person(), f = await flow(a), state = await repo.consume({ ...f, userId: a.id, sessionId: a.sid });
    await db.users.sessions.revoke(a.sid, a.id);
    expect(await repo.save(a.id, state!.id, input('T_LOGOUT'))).toBeNull();
  });
});
