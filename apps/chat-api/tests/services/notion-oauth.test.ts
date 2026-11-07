import { describe, expect, it, vi } from 'vitest';
import {
  extractNotionDatabaseId,
  NotionOAuthClient,
  NotionOAuthError,
} from '../../src/services/notion/oauth-client.js';

const cfg = {
  clientId: 'notion-client-id',
  clientSecret: 'notion-client-secret',
  redirectUri: 'https://app.example.com/connections/notion/callback',
  authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
  apiBaseUrl: 'https://api.notion.com/v1',
};

describe('NotionOAuthClient & extractNotionDatabaseId', () => {
  it('extracts canonical Notion database UUID from raw hex, dashed UUID, or Notion URLs', () => {
    const expected = 'a8aec433-84f4-47ed-8439-0e8e42c2e089';
    expect(extractNotionDatabaseId('a8aec43384f447ed84390e8e42c2e089')).toBe(expected);
    expect(extractNotionDatabaseId('A8AEC433-84F4-47ED-8439-0E8E42C2E089')).toBe(expected);
    expect(
      extractNotionDatabaseId(
        'https://www.notion.so/myworkspace/Sprint-Tasks-a8aec43384f447ed84390e8e42c2e089?v=11111111222233334444555566667777',
      ),
    ).toBe(expected);
    expect(
      extractNotionDatabaseId('https://app.notion.com/p/a8aec433-84f4-47ed-8439-0e8e42c2e089'),
    ).toBe(expected);
    expect(extractNotionDatabaseId('not-a-valid-uuid')).toBeNull();
  });

  it('exchanges code with Basic Auth, verifies bot via users/me, and discovers databases', async () => {
    const wsId = '11111111-2222-3333-4444-555555555555';
    const botId = '22222222-3333-4444-5555-666666666666';
    const actorId = '33333333-4444-5555-6666-777777777777';
    const db1 = '44444444-5555-6666-7777-888888888888';
    const db2 = '55555555-6666-7777-8888-999999999999';

    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      expect(headers.get('Notion-Version')).toBe('2026-03-11');

      if (url.endsWith('/oauth/token')) {
        expect(headers.get('Authorization')).toBe(
          'Basic ' + Buffer.from('notion-client-id:notion-client-secret').toString('base64'),
        );
        return new Response(
          JSON.stringify({
            access_token: 'ntn_access_1',
            refresh_token: 'ntn_refresh_1',
            token_type: 'bearer',
            workspace_id: wsId,
            workspace_name: 'ATI Product Team',
            bot_id: botId,
            owner: { type: 'user', user: { id: actorId } },
          }),
        );
      }
      if (url.endsWith('/users/me')) {
        expect(headers.get('Authorization')).toBe('Bearer ntn_access_1');
        return new Response(JSON.stringify({ object: 'user', type: 'bot', id: botId }));
      }
      if (url.endsWith('/search')) {
        return new Response(
          JSON.stringify({
            object: 'list',
            results: [
              {
                object: 'data_source',
                id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                parent: { type: 'database_id', database_id: db1 },
                title: [{ plain_text: 'Việc cần làm' }],
                url: 'https://www.notion.so/viec-can-lam',
              },
              {
                object: 'database',
                id: db2,
                title: [{ plain_text: 'Ghi chú họp' }],
                url: 'https://www.notion.so/ghi-chu-hop',
              },
            ],
            has_more: false,
          }),
        );
      }
      if (url.endsWith(`/databases/${db1}`)) {
        return new Response(
          JSON.stringify({
            object: 'database',
            id: db1,
            title: [{ plain_text: 'Việc cần làm' }],
            url: 'https://www.notion.so/viec-can-lam',
          }),
        );
      }
      return new Response(JSON.stringify({ object: 'error', code: 'unauthorized' }), { status: 401 });
    }) as unknown as typeof fetch;

    const client = new NotionOAuthClient(cfg, fetchFn);
    const authUrl = new URL(client.authorizationUrl('state-xyz'));
    expect(authUrl.searchParams.get('owner')).toBe('user');
    expect(authUrl.searchParams.get('state')).toBe('state-xyz');

    const grant = await client.exchange('code-123', AbortSignal.timeout(5000));
    expect(grant).toMatchObject({
      appId: 'notion-client-id',
      workspaceId: wsId,
      workspaceName: 'ATI Product Team',
      botId,
      actorId,
      accessToken: 'ntn_access_1',
      refreshToken: 'ntn_refresh_1',
    });

    const searched = await client.databases('ntn_access_1', '', AbortSignal.timeout(5000));
    expect(searched.databases).toEqual([
      { id: db1, title: 'Việc cần làm', url: 'https://www.notion.so/viec-can-lam' },
      { id: db2, title: 'Ghi chú họp', url: 'https://www.notion.so/ghi-chu-hop' },
    ]);

    const validated = await client.validateDatabases(
      'ntn_access_1',
      [`https://www.notion.so/team/Tasks-${db1.replaceAll('-', '')}`],
      AbortSignal.timeout(5000),
    );
    expect(validated).toEqual([
      { id: db1, title: 'Việc cần làm', url: 'https://www.notion.so/viec-can-lam' },
    ]);

    await expect(
      client.validateDatabases('ntn_access_1', [db2], AbortSignal.timeout(5000)),
    ).rejects.toBeInstanceOf(NotionOAuthError);
  });

  it('allows null/missing refresh_token on initial exchange() while requiring refresh_token on refresh()', async () => {
    const wsId = '11111111-2222-3333-4444-555555555555';
    const botId = '22222222-3333-4444-5555-666666666666';
    const actorId = '33333333-4444-5555-6666-777777777777';

    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/oauth/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'ntn_access_no_refresh',
            refresh_token: null,
            token_type: 'bearer',
            workspace_id: wsId,
            workspace_name: 'ATI Product Team',
            bot_id: botId,
            owner: { type: 'user', user: { id: actorId } },
          }),
        );
      }
      if (url.endsWith('/users/me')) {
        return new Response(JSON.stringify({ object: 'user', type: 'bot', id: botId }));
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    const client = new NotionOAuthClient(cfg, fetchFn);
    const grant = await client.exchange('code-initial', AbortSignal.timeout(5000));
    expect(grant.accessToken).toBe('ntn_access_no_refresh');
    expect(grant.refreshToken).toBe('');

    await expect(
      client.refresh('old-refresh-token', AbortSignal.timeout(5000)),
    ).rejects.toBeInstanceOf(NotionOAuthError);
  });
});
