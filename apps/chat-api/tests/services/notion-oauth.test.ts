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

  it('paginates /search using next_cursor up to 5 pages so child pages do not hide databases or leave hasMore true when <= 10 databases exist', async () => {
    const db1 = '44444444-5555-6666-7777-888888888888';
    const db2 = '55555555-6666-7777-8888-999999999999';
    const seenCursors: Array<string | undefined> = [];
    const seenFilters: unknown[] = [];

    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      seenCursors.push(body.start_cursor);
      seenFilters.push(body.filter);
      if (!body.start_cursor) {
        return new Response(
          JSON.stringify({
            object: 'list',
            results: [
              // Child pages returned by /search on page 1
              { object: 'page', id: '11111111-1111-4111-8111-111111111111' },
              {
                object: 'database',
                id: db1,
                title: [{ plain_text: 'Database 1' }],
                url: 'https://www.notion.so/db-1',
              },
            ],
            has_more: true,
            next_cursor: 'cursor-page-2',
          }),
        );
      }
      return new Response(
        JSON.stringify({
          object: 'list',
          results: [
            {
              object: 'database',
              id: db2,
              title: [{ plain_text: 'Database 2' }],
              url: 'https://www.notion.so/db-2',
            },
          ],
          has_more: false,
          next_cursor: null,
        }),
      );
    }) as unknown as typeof fetch;

    const client = new NotionOAuthClient(cfg, fetchFn);
    const discovered = await client.databases('ntn_access_1', '', AbortSignal.timeout(5000));
    expect(seenCursors).toEqual([undefined, 'cursor-page-2']);
    expect(seenFilters).toEqual([
      { property: 'object', value: 'data_source' },
      { property: 'object', value: 'data_source' },
    ]);
    expect(discovered.hasMore).toBe(false);
    expect(discovered.databases).toEqual([
      { id: db1, title: 'Database 1', url: 'https://www.notion.so/db-1' },
      { id: db2, title: 'Database 2', url: 'https://www.notion.so/db-2' },
    ]);
  });

  it('sets hasMore accurately when 100 databases are exceeded mid-page or next_cursor is missing', async () => {
    const mkUuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const overflowResults = Array.from({ length: 101 }, (_, i) => ({
      object: 'data_source',
      id: mkUuid(i + 1),
      parent: { type: 'database_id', database_id: mkUuid(1000 + i) },
      title: [{ plain_text: `DB ${i}` }],
      url: `https://www.notion.so/db-${i}`,
    }));
    const fetchOverflow = vi.fn(async () =>
      new Response(JSON.stringify({ object: 'list', results: overflowResults, has_more: false, next_cursor: null })),
    ) as unknown as typeof fetch;
    const overflowClient = new NotionOAuthClient(cfg, fetchOverflow);
    const overflowRes = await overflowClient.databases('ntn_access_1', '', AbortSignal.timeout(5000));
    expect(overflowRes.databases).toHaveLength(100);
    expect(overflowRes.hasMore).toBe(true);

    const fetchMissingCursor = vi.fn(async () =>
      new Response(JSON.stringify({
        object: 'list',
        results: [{ object: 'data_source', id: mkUuid(1), parent: { type: 'database_id', database_id: mkUuid(2) }, title: [{ plain_text: 'Single DB' }], url: 'https://www.notion.so/db' }],
        has_more: true,
        next_cursor: null,
      })),
    ) as unknown as typeof fetch;
    const missingCursorClient = new NotionOAuthClient(cfg, fetchMissingCursor);
    const missingCursorRes = await missingCursorClient.databases('ntn_access_1', '', AbortSignal.timeout(5000));
    expect(missingCursorRes.databases).toHaveLength(1);
    expect(missingCursorRes.hasMore).toBe(false);
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

  it('exposes public appId and classifies resource 403/404/400/429/5xx vs 401, token invalid_grant/invalid_client/403, pre-dispatch abort, and mid-flight transport loss without leaking provider bodies', async () => {
    const dbForbidden = '66666666-7777-8888-9999-aaaaaaaaaaaa';
    const dbMissing = '77777777-8888-9999-aaaa-bbbbbbbbbbbb';

    const client = new NotionOAuthClient(cfg, async (input, init) => {
      if (init?.signal?.aborted) {
        const abortErr = new Error('The operation was aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      const url = String(input);
      if (url.endsWith(`/databases/${dbForbidden}`)) {
        return new Response(
          JSON.stringify({
            object: 'error',
            status: 403,
            code: 'restricted_resource',
            message: 'secret-upstream-detail-403',
          }),
          { status: 403 },
        );
      }
      if (url.endsWith(`/databases/${dbMissing}`)) {
        return new Response(
          JSON.stringify({
            object: 'error',
            status: 404,
            code: 'object_not_found',
            message: 'Could not find database with ID secret-existence-detail',
          }),
          { status: 404 },
        );
      }
      if (url.endsWith('/search')) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        if (body.query === 'trigger-400') {
          return new Response(JSON.stringify({ code: 'validation_error', message: 'raw-400' }), { status: 400 });
        }
        if (body.query === 'trigger-429') {
          return new Response(JSON.stringify({ code: 'rate_limited', message: 'raw-429' }), { status: 429 });
        }
        if (body.query === 'trigger-503') {
          return new Response(JSON.stringify({ code: 'service_unavailable', message: 'raw-503' }), { status: 503 });
        }
        return new Response(JSON.stringify({ code: 'unauthorized', message: 'raw-401' }), { status: 401 });
      }
      if (url.endsWith('/oauth/token')) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        if (body.refresh_token === 'rt-invalid-grant') {
          return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'secret-rt' }), {
            status: 400,
          });
        }
        if (body.refresh_token === 'rt-invalid-client') {
          return new Response(JSON.stringify({ error: 'invalid_client', error_description: 'secret-client' }), {
            status: 401,
          });
        }
        if (body.refresh_token === 'rt-403') {
          return new Response(JSON.stringify({ message: 'waf-403' }), { status: 403 });
        }
        if (body.refresh_token === 'rt-socket-loss') {
          throw new TypeError('fetch failed: socket hang up');
        }
      }
      return new Response('{}', { status: 500 });
    });

    expect((client as any).appId).toBe('notion-client-id');

    // Resource 403 -> authenticationLost: false, reason: 'resource_denied'
    await expect(
      client.validateDatabases('ntn_tok', [dbForbidden], AbortSignal.timeout(2000)),
    ).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(NotionOAuthError);
      expect(err.authenticationLost).toBe(false);
      expect(err.endpointKind).toBe('resource');
      expect(err.statusCode).toBe(403);
      expect(err.providerCode).toBe('restricted_resource');
      expect(err.reason).toBe('resource_denied');
      expect(err.requestState).toBe('response_received');
      expect(err.message).not.toContain('secret-upstream-detail-403');
      return true;
    });

    // Resource 404 -> bounded unavailable, no existence oracle, authenticationLost: false
    await expect(
      client.validateDatabases('ntn_tok', [dbMissing], AbortSignal.timeout(2000)),
    ).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(NotionOAuthError);
      expect(err.authenticationLost).toBe(false);
      expect(err.endpointKind).toBe('resource');
      expect(err.statusCode).toBe(404);
      expect(err.providerCode).toBe('object_not_found');
      expect(err.reason).toBe('resource_unavailable');
      expect(err.message).not.toContain('secret-existence-detail');
      return true;
    });

    // Resource 400, 429, 503 -> authenticationLost: false
    await expect(client.databases('ntn_tok', 'trigger-400', AbortSignal.timeout(2000))).rejects.toMatchObject({
      authenticationLost: false,
      statusCode: 400,
      reason: 'invalid_request',
    });
    await expect(client.databases('ntn_tok', 'trigger-429', AbortSignal.timeout(2000))).rejects.toMatchObject({
      authenticationLost: false,
      statusCode: 429,
      reason: 'rate_limited',
    });
    await expect(client.databases('ntn_tok', 'trigger-503', AbortSignal.timeout(2000))).rejects.toMatchObject({
      authenticationLost: false,
      statusCode: 503,
      reason: 'transient',
    });

    // Resource 401 -> authenticationLost: true, reason: 'access_rejected'
    await expect(client.databases('ntn_tok', 'trigger-401', AbortSignal.timeout(2000))).rejects.toMatchObject({
      authenticationLost: true,
      endpointKind: 'resource',
      statusCode: 401,
      providerCode: 'unauthorized',
      reason: 'access_rejected',
    });

    // Token endpoint classifications
    await expect(client.refresh('rt-invalid-grant', AbortSignal.timeout(2000))).rejects.toMatchObject({
      endpointKind: 'token',
      statusCode: 400,
      providerCode: 'invalid_grant',
      reason: 'grant_rejected',
      requestState: 'response_received',
    });
    await expect(client.refresh('rt-invalid-client', AbortSignal.timeout(2000))).rejects.toMatchObject({
      endpointKind: 'token',
      statusCode: 401,
      providerCode: 'invalid_client',
      reason: 'client_misconfigured',
      requestState: 'response_received',
    });
    await expect(client.refresh('rt-403', AbortSignal.timeout(2000))).rejects.toMatchObject({
      endpointKind: 'token',
      statusCode: 403,
      reason: 'rotation_unknown',
      requestState: 'response_received',
    });

    // Pre-aborted signal -> requestState: 'not_sent'
    let dispatchedCalls = 0;
    const preAbortClient = new NotionOAuthClient(cfg, async () => {
      dispatchedCalls++;
      return new Response('{}');
    });
    await expect(preAbortClient.refresh('rt-any', AbortSignal.abort())).rejects.toMatchObject({
      endpointKind: 'token',
      requestState: 'not_sent',
    });
    expect(dispatchedCalls).toBe(0);

    // Mid-flight socket hang up -> requestState: 'possibly_sent', reason: 'rotation_unknown'
    await expect(client.refresh('rt-socket-loss', AbortSignal.timeout(2000))).rejects.toMatchObject({
      endpointKind: 'token',
      requestState: 'possibly_sent',
      reason: 'rotation_unknown',
    });
  });

  it('enforces endpoint + HTTP status authority over contradictory or unknown payload codes across resource, identity, and token endpoints', async () => {
    const dbTarget = '88888888-9999-aaaa-bbbb-cccccccccccc';
    const botId = '22222222-3333-4444-5555-666666666666';
    let nextStatus = 500;
    let nextBody: unknown = {};

    const client = new NotionOAuthClient(cfg, async () => {
      return new Response(JSON.stringify(nextBody), { status: nextStatus });
    });

    const nonAuthResourceCases: Array<{
      status: number;
      body: Record<string, unknown>;
      expectedReason: string;
      expectedProviderCode?: string;
    }> = [
      {
        status: 400,
        body: { object: 'error', status: 400, code: 'unauthorized', message: 'secret-contradictory-400' },
        expectedReason: 'invalid_request',
        expectedProviderCode: 'unauthorized',
      },
      {
        status: 403,
        body: { object: 'error', status: 403, code: 'unauthorized', message: 'secret-contradictory-403' },
        expectedReason: 'resource_denied',
        expectedProviderCode: 'unauthorized',
      },
      {
        status: 404,
        body: { object: 'error', status: 404, code: 'unauthorized', message: 'secret-contradictory-404' },
        expectedReason: 'resource_unavailable',
        expectedProviderCode: 'unauthorized',
      },
      {
        status: 429,
        body: { object: 'error', status: 429, code: 'unauthorized', message: 'secret-contradictory-429' },
        expectedReason: 'rate_limited',
        expectedProviderCode: 'unauthorized',
      },
      {
        status: 500,
        body: { object: 'error', status: 500, code: 'unauthorized', message: 'secret-contradictory-500' },
        expectedReason: 'transient',
        expectedProviderCode: 'unauthorized',
      },
      {
        status: 503,
        body: {
          object: 'error',
          status: 503,
          code: 'unauthorized',
          error: 'invalid_grant',
          message: 'secret-contradictory-503',
        },
        expectedReason: 'transient',
        expectedProviderCode: 'unauthorized',
      },
      {
        status: 403,
        body: { object: 'error', status: 403, code: 'future_unlisted_code', message: 'secret-unknown-403' },
        expectedReason: 'resource_denied',
        expectedProviderCode: undefined,
      },
      {
        status: 503,
        body: { object: 'error', status: 503, code: 'restricted_resource', message: 'secret-503-restricted' },
        expectedReason: 'transient',
        expectedProviderCode: 'restricted_resource',
      },
    ];

    for (const tc of nonAuthResourceCases) {
      nextStatus = tc.status;
      nextBody = tc.body;

      await expect(
        client.validateDatabases('ntn_tok', [dbTarget], AbortSignal.timeout(2000)),
        `validateDatabases ${tc.status}`,
      ).rejects.toSatisfy((err: any) => {
        expect(err).toBeInstanceOf(NotionOAuthError);
        expect(err.authenticationLost).toBe(false);
        expect(err.endpointKind).toBe('resource');
        expect(err.statusCode).toBe(tc.status);
        expect(err.providerCode).toBe(tc.expectedProviderCode);
        expect(err.reason).toBe(tc.expectedReason);
        expect(err.message).not.toContain('secret-');
        return true;
      });

      await expect(
        client.databases('ntn_tok', 'probe', AbortSignal.timeout(2000)),
        `databases ${tc.status}`,
      ).rejects.toMatchObject({
        authenticationLost: false,
        endpointKind: 'resource',
        statusCode: tc.status,
        reason: tc.expectedReason,
      });

      await expect(
        client.verify('ntn_tok', botId, AbortSignal.timeout(2000)),
        `verify ${tc.status}`,
      ).rejects.toMatchObject({
        authenticationLost: false,
        endpointKind: 'identity',
        statusCode: tc.status,
        reason: tc.expectedReason,
      });
    }

    // Conversely, HTTP 401 on resource/identity is authoritative access_rejected even with contradictory body code
    nextStatus = 401;
    nextBody = { object: 'error', status: 401, code: 'restricted_resource', message: 'secret-401-body' };
    await expect(
      client.validateDatabases('ntn_tok', [dbTarget], AbortSignal.timeout(2000)),
    ).rejects.toMatchObject({
      authenticationLost: true,
      endpointKind: 'resource',
      statusCode: 401,
      providerCode: 'restricted_resource',
      reason: 'access_rejected',
    });

    // Token endpoint: contradictory 5xx/429/403/401 with invalid_grant or unknown 400 MUST NOT classify as grant_rejected
    const nonTerminalTokenCases: Array<{
      label: string;
      status: number;
      body: Record<string, unknown>;
      expectedReason: string;
    }> = [
      {
        label: '503+invalid_grant',
        status: 503,
        body: { error: 'invalid_grant', error_description: 'secret-upstream-503' },
        expectedReason: 'rotation_unknown',
      },
      {
        label: '500+invalid_grant',
        status: 500,
        body: { error: 'invalid_grant' },
        expectedReason: 'rotation_unknown',
      },
      {
        label: '429+invalid_grant',
        status: 429,
        body: { error: 'invalid_grant' },
        expectedReason: 'rotation_unknown',
      },
      {
        label: '403+invalid_grant',
        status: 403,
        body: { error: 'invalid_grant' },
        expectedReason: 'rotation_unknown',
      },
      {
        label: '401+invalid_grant',
        status: 401,
        body: { error: 'invalid_grant' },
        expectedReason: 'rotation_unknown',
      },
      {
        label: '503+invalid_client',
        status: 503,
        body: { error: 'invalid_client' },
        expectedReason: 'rotation_unknown',
      },
      {
        label: '400+unknown_code',
        status: 400,
        body: { error: 'mystery_token_failure' },
        expectedReason: 'rotation_unknown',
      },
      {
        label: '400+invalid_request',
        status: 400,
        body: { error: 'invalid_request' },
        expectedReason: 'rotation_unknown',
      },
      {
        label: '400+invalid_client',
        status: 400,
        body: { error: 'invalid_client' },
        expectedReason: 'client_misconfigured',
      },
      {
        label: '400+unauthorized_client',
        status: 400,
        body: { error: 'unauthorized_client' },
        expectedReason: 'client_misconfigured',
      },
    ];

    for (const tc of nonTerminalTokenCases) {
      nextStatus = tc.status;
      nextBody = tc.body;
      await expect(
        client.refresh('rt-probe', AbortSignal.timeout(2000)),
        tc.label,
      ).rejects.toSatisfy((err: any) => {
        expect(err).toBeInstanceOf(NotionOAuthError);
        expect(err.authenticationLost).toBe(false);
        expect(err.endpointKind).toBe('token');
        expect(err.statusCode).toBe(tc.status);
        expect(err.reason).toBe(tc.expectedReason);
        expect(err.requestState).toBe('response_received');
        expect(err.message).not.toContain('secret-');
        return true;
      });
    }
  });
});
