import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { NotionConnectionRepo } from '../../src/db/repositories/notion-connection-repo.js';

describe('NotionConnectionRepo on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let repo: NotionConnectionRepo;
  let alice: Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;
  let bob: Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;

  beforeAll(async () => {
    db = await createMigratedSchema('notion_repo');
    repo = new NotionConnectionRepo(db.pool);
    alice = await db.person('alice');
    bob = await db.person('bob');
  });

  afterAll(async () => {
    await db?.close();
  });

  it('stores multiple workspaces per user, tracks default workspace, and prevents cross-user identity theft', async () => {
    const convId = (
      await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [alice.id])
    ).rows[0].id;
    const returnTo = `/c/${convId}`;

    await repo.start({
      userId: alice.id,
      sessionId: alice.sid,
      stateHash: NotionConnectionRepo.hash('state-1'),
      browserHash: NotionConnectionRepo.hash('browser-1'),
      returnTo,
    });

    // Wrong browser or user cannot consume state
    expect(
      await repo.consume({
        userId: alice.id,
        sessionId: alice.sid,
        state: 'state-1',
        browser: 'wrong-browser',
      }),
    ).toBeNull();
    expect(
      await repo.consume({
        userId: bob.id,
        sessionId: bob.sid,
        state: 'state-1',
        browser: 'browser-1',
      }),
    ).toBeNull();

    const consumed1 = await repo.consume({
      userId: alice.id,
      sessionId: alice.sid,
      state: 'state-1',
      browser: 'browser-1',
    });
    expect(consumed1).toMatchObject({ returnTo });
    // One-time state cannot be replayed
    expect(
      await repo.consume({
        userId: alice.id,
        sessionId: alice.sid,
        state: 'state-1',
        browser: 'browser-1',
      }),
    ).toBeNull();

    const ws1 = await repo.save(alice.id, consumed1!.id, {
      appId: 'notion-app',
      workspaceId: '11111111-1111-1111-1111-111111111111',
      workspaceName: 'Workspace A',
      actorId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      botId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      config: 'v1:enc-1',
      scopes: ['read_content', 'insert_content'],
    });
    expect(ws1).toMatchObject({
      workspace_name: 'Workspace A',
      identity_version: 1,
      status: 'active',
      is_default: true,
      allowed_databases: [],
    });

    // Add second workspace for Alice
    await repo.start({
      userId: alice.id,
      sessionId: alice.sid,
      stateHash: NotionConnectionRepo.hash('state-2'),
      browserHash: NotionConnectionRepo.hash('browser-1'),
    });
    const consumed2 = await repo.consume({
      userId: alice.id,
      sessionId: alice.sid,
      state: 'state-2',
      browser: 'browser-1',
    });
    const ws2 = await repo.save(alice.id, consumed2!.id, {
      appId: 'notion-app',
      workspaceId: '22222222-2222-2222-2222-222222222222',
      workspaceName: 'Workspace B',
      actorId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      botId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      config: 'v1:enc-2',
      scopes: ['read_content'],
    });
    expect(ws2?.is_default).toBe(true);

    const list = await repo.list(alice.id);
    expect(list).toHaveLength(2);
    expect(list.find((r) => r.id === ws1!.id)?.is_default).toBe(false);
    expect(list.find((r) => r.id === ws2!.id)?.is_default).toBe(true);

    // Switch default back to Workspace A
    expect(await repo.setActiveWorkspace(alice.id, ws1!.id)).toBe(true);
    expect((await repo.getActive(alice.id))?.id).toBe(ws1!.id);

    // Bob cannot claim Alice's Notion actor in the same workspace
    await repo.start({
      userId: bob.id,
      sessionId: bob.sid,
      stateHash: NotionConnectionRepo.hash('state-bob'),
      browserHash: NotionConnectionRepo.hash('browser-bob'),
    });
    const consumedBob = await repo.consume({
      userId: bob.id,
      sessionId: bob.sid,
      state: 'state-bob',
      browser: 'browser-bob',
    });
    await expect(
      repo.save(bob.id, consumedBob!.id, {
        appId: 'notion-app',
        workspaceId: '11111111-1111-1111-1111-111111111111',
        workspaceName: 'Workspace A',
        actorId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        botId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        config: 'v1:enc-bob',
        scopes: [],
      }),
    ).rejects.toThrow('NOTION_IDENTITY_CONFLICT');
  });

  it('enforces CAS on selectDatabases across concurrent updates and increments identity_version', async () => {
    const active = (await repo.getActive(alice.id))!;
    const db1 = 'dddddddd-1111-2222-3333-444444444444';
    const db2 = 'dddddddd-5555-6666-7777-888888888888';

    // Concurrent CAS race on same identity_version: exactly one succeeds
    const [r1, r2] = await Promise.all([
      repo.selectDatabases(alice.id, active.id, active.identity_version, [
        { id: db1, title: 'Tasks DB', url: 'https://www.notion.so/db1' },
      ]),
      repo.selectDatabases(alice.id, active.id, active.identity_version, [
        { id: db2, title: 'Notes DB', url: 'https://www.notion.so/db2' },
      ]),
    ]);
    expect([r1, r2].sort()).toEqual([false, true]);

    const updated = (await repo.getActive(alice.id))!;
    expect(updated.identity_version).toBe(active.identity_version + 1);
    expect(updated.allowed_databases).toHaveLength(1);
    expect(updated.selected_databases).toHaveLength(1);
  });

  it('invalidates in-flight callbacks when disconnect wins the race', async () => {
    const active = (await repo.getActive(alice.id))!;
    await repo.start({
      userId: alice.id,
      sessionId: alice.sid,
      stateHash: NotionConnectionRepo.hash('state-race'),
      browserHash: NotionConnectionRepo.hash('browser-race'),
    });
    const consumed = await repo.consume({
      userId: alice.id,
      sessionId: alice.sid,
      state: 'state-race',
      browser: 'browser-race',
    });
    expect(consumed).toBeTruthy();

    await repo.disconnect(alice.id, active.id);
    const savedAfterDisconnect = await repo.save(alice.id, consumed!.id, {
      appId: 'notion-app',
      workspaceId: active.workspace_id,
      workspaceName: active.workspace_name,
      actorId: active.actor_id,
      botId: active.bot_id,
      config: 'v1:resurrected',
      scopes: [],
    });
    expect(savedAfterDisconnect).toBeNull();
  });
});
