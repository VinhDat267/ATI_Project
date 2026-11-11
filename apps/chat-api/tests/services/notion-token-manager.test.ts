import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptCredentials } from '@wap/tool-adapters';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { NotionConnectionRepo } from '../../src/db/repositories/notion-connection-repo.js';
import { NotionOAuthError, type NotionOAuthClient } from '../../src/services/notion/oauth-client.js';
import { NotionTokenManager } from '../../src/services/notion/token-manager.js';

const key = '0123456789abcdef0123456789abcdef';

describe('NotionTokenManager on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let repo: NotionConnectionRepo;
  let alice: Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;

  beforeAll(async () => {
    db = await createMigratedSchema('notion_tm');
    repo = new NotionConnectionRepo(db.pool);
    alice = await db.person('alice');
  });

  afterAll(async () => {
    await db?.close();
  });

  it('rotates token once on 401 and marks reconnect_required when refresh fails or crashes mid-flight', async () => {
    const wsId = '11111111-1111-1111-1111-111111111111';
    const actorId = '22222222-2222-2222-2222-222222222222';
    const botId = '33333333-3333-3333-3333-333333333333';

    await repo.start({
      userId: alice.id,
      sessionId: alice.sid,
      stateHash: NotionConnectionRepo.hash('s1'),
      browserHash: NotionConnectionRepo.hash('b1'),
    });
    const consumed = (await repo.consume({
      userId: alice.id,
      sessionId: alice.sid,
      state: 's1',
      browser: 'b1',
    }))!;
    const row = (await repo.save(alice.id, consumed.id, {
      appId: 'app-1',
      workspaceId: wsId,
      workspaceName: 'WS',
      actorId,
      botId,
      config: encryptCredentials(
        { accessToken: 'expired-token', refreshToken: 'valid-refresh', botId },
        key,
      ),
      scopes: [],
    }))!;

    let refreshed = 0;
    const oauth = {
      appId: 'app-1',
      refresh: async (rt: string) => {
        expect(rt).toBe('valid-refresh');
        refreshed++;
        return {
          appId: 'app-1',
          workspaceId: wsId,
          workspaceName: 'WS',
          actorId,
          botId,
          accessToken: 'fresh-token',
          refreshToken: 'next-refresh',
          scopes: [],
        };
      },
    } as unknown as NotionOAuthClient;

    const tm = new NotionTokenManager(repo, oauth, key);
    const result = await tm.execute(alice.id, row.id, row.identity_version, async (token) => {
      if (token === 'expired-token') throw new NotionOAuthError(true);
      return `ok:${token}`;
    });
    expect(result).toBe('ok:fresh-token');
    expect(refreshed).toBe(1);

    const afterRotate = (await repo.getActive(alice.id, row.id))!;
    expect(afterRotate.config).toBeTruthy();

    // Simulate interrupted refresh_in_flight checkpoint -> next call must quarantine to reconnect_required + rotation_unknown while preserving last ciphertext
    await db.pool.query('UPDATE notion_connections SET refresh_in_flight=true WHERE id=$1', [row.id]);
    await expect(
      tm.execute(alice.id, row.id, row.identity_version, async () => 'never'),
    ).rejects.toBeInstanceOf(NotionOAuthError);

    const afterFail = (await repo.getActive(alice.id, row.id))!;
    expect(afterFail.status).toBe('reconnect_required');
    expect(afterFail.refresh_in_flight).toBe(false);
    expect((afterFail as any).auth_failure_code).toBe('rotation_unknown');
    expect(afterFail.config).toBe(afterRotate.config);
  });
});
