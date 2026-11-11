import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { encryptCredentials } from '@wap/tool-adapters';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { NotionConnectionRepo } from '../../src/db/repositories/notion-connection-repo.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { createNotionConnectionLookup } from '../../src/services/notion/connection-reference.js';
import { NotionOAuthClient, NotionOAuthError } from '../../src/services/notion/oauth-client.js';
import { NotionTokenManager } from '../../src/services/notion/token-manager.js';
import {
  createDeferred,
  createNotionDurabilitySchema,
  fingerprintSecret,
  inspectOwnerAdvisoryLocks,
  type InspectedNotionRow,
  startNotionLoopbackServer,
  waitForOwnerLockWaiter,
} from '../helpers/notion-oauth-test-env.js';

const ENC_KEY = '0123456789abcdef0123456789abcdef';
const JWT_SECRET = 'notion_n2b_durability_jwt_secret_at_least_32b';
const PERMITTED_DB = '44444444-5555-6666-7777-888888888888';
const FORBIDDEN_DB = '99999999-8888-7777-6666-555555555555';

describe('Notion OAuth N2-B durability, classification, checkpointing & PostgreSQL concurrency', () => {
  let db: Awaited<ReturnType<typeof createNotionDurabilitySchema>>;
  let loopback: Awaited<ReturnType<typeof startNotionLoopbackServer>>;

  beforeAll(async () => {
    db = await createNotionDurabilitySchema('notion_n2b_dur');
    loopback = await startNotionLoopbackServer();
  });

  afterAll(async () => {
    await loopback?.close();
    await db?.close();
  });

  describe('1. Non-auth resource errors preserve active connection (0 refresh, 0 credential UPDATE)', () => {
    it('preserves exact ciphertext hash, tuple xmin, status, version, and scope across resource 403 -> permitted DB 200, plus 404, 400, 429, and 5xx', async () => {
      const alice = await db.person('alice-resource');
      const seeded = await db.seedConnection({
        userId: alice.id,
        sessionId: alice.sid,
        encryptionKey: ENC_KEY,
        appId: 'notion-app-1',
        accessToken: 'syn_tok_resource_healthy',
        refreshToken: 'syn_ref_resource_healthy',
        databases: [{ id: PERMITTED_DB, title: 'Permitted Roadmap' }],
      });

      const before = (await db.inspectRow(seeded.id))!;
      expect(before.status).toBe('active');
      expect(before.configPresent).toBe(true);

      let reconnectCallbacks = 0;
      const client = new NotionOAuthClient(loopback.oauthConfig('notion-app-1'));
      const manager = new NotionTokenManager(db.repo, client, ENC_KEY, () => {
        reconnectCallbacks++;
      });

      loopback.clearRoutes();
      // 1) 403 restricted_resource on unshared/restricted database
      loopback.enqueue('GET', `/databases/${FORBIDDEN_DB}`, {
        kind: 'json',
        status: 403,
        body: {
          object: 'error',
          status: 403,
          code: 'restricted_resource',
          message: 'API token does not have access to this resource; raw secret detail must not leak',
        },
      });
      // 2) Immediately followed by 200 on permitted database
      loopback.enqueue('GET', `/databases/${PERMITTED_DB}`, {
        kind: 'json',
        status: 200,
        body: {
          object: 'database',
          id: PERMITTED_DB,
          title: [{ plain_text: 'Permitted Roadmap' }],
          url: 'https://www.notion.so/permitted-roadmap',
        },
      });

      let err403: unknown;
      try {
        await manager.execute(alice.id, seeded.id, seeded.identity_version, (accessToken) =>
          client.validateDatabases(accessToken, [FORBIDDEN_DB], AbortSignal.timeout(3000)),
        );
      } catch (e) {
        err403 = e;
      }
      expect(err403).toBeInstanceOf(NotionOAuthError);
      expect((err403 as NotionOAuthError).authenticationLost).toBe(false);
      expect((err403 as any).endpointKind).toBe('resource');
      expect((err403 as any).statusCode).toBe(403);
      expect((err403 as any).providerCode).toBe('restricted_resource');
      expect((err403 as any).reason).toBe('resource_denied');
      expect((err403 as any).requestState).toBe('response_received');
      // Message must reflect permission/sharing OR workspace/provider limits, and never leak raw provider body
      expect((err403 as Error).message).not.toContain('raw secret detail');
      expect((err403 as Error).message).toMatch(/quyền|chia sẻ|giới hạn/i);

      const after403 = (await db.inspectRow(seeded.id))!;
      expect(after403.status).toBe('active');
      expect(after403.authFailureCode).toBeNull();
      expect(after403.identityVersion).toBe(before.identityVersion);
      expect(after403.allowedDatabases).toEqual([PERMITTED_DB]);
      expect(after403.configFingerprint).toBe(before.configFingerprint);
      expect(after403.xmin).toBe(before.xmin); // 0 SQL UPDATEs on notion_connections
      expect(loopback.countPath('/oauth/token')).toBe(0);
      expect(reconnectCallbacks).toBe(0);

      // Next permitted DB succeeds with the exact same access token
      const okItems = await manager.execute(alice.id, seeded.id, seeded.identity_version, (accessToken) =>
        client.validateDatabases(accessToken, [PERMITTED_DB], AbortSignal.timeout(3000)),
      );
      expect(okItems).toEqual([
        { id: PERMITTED_DB, title: 'Permitted Roadmap', url: 'https://www.notion.so/permitted-roadmap' },
      ]);

      // 3) Resource 404, 400, 429, 500, 503 all preserve active credentials with 0 refresh & 0 tuple updates
      const nonAuthStatuses: Array<{ status: number; code: string; expectedReason: string }> = [
        { status: 404, code: 'object_not_found', expectedReason: 'resource_unavailable' },
        { status: 400, code: 'validation_error', expectedReason: 'invalid_request' },
        { status: 429, code: 'rate_limited', expectedReason: 'rate_limited' },
        { status: 500, code: 'internal_server_error', expectedReason: 'transient' },
        { status: 503, code: 'service_unavailable', expectedReason: 'transient' },
      ];

      for (const item of nonAuthStatuses) {
        loopback.enqueue('POST', '/search', {
          kind: 'json',
          status: item.status,
          body: {
            object: 'error',
            status: item.status,
            code: item.code,
            message: `provider-internal-${item.status}`,
          },
        });
        let caught: any;
        try {
          await manager.execute(alice.id, seeded.id, seeded.identity_version, (accessToken) =>
            client.databases(accessToken, 'roadmap', AbortSignal.timeout(3000)),
          );
        } catch (e) {
          caught = e;
        }
        expect(caught, `status ${item.status}`).toBeInstanceOf(NotionOAuthError);
        expect(caught.authenticationLost, `status ${item.status}`).toBe(false);
        expect(caught.reason, `status ${item.status}`).toBe(item.expectedReason);
        expect(String(caught.message)).not.toContain(`provider-internal-${item.status}`);
      }

      const afterAllNonAuth = (await db.inspectRow(seeded.id))!;
      expect(afterAllNonAuth.status).toBe('active');
      expect(afterAllNonAuth.authFailureCode).toBeNull();
      expect(afterAllNonAuth.identityVersion).toBe(before.identityVersion);
      expect(afterAllNonAuth.allowedDatabases).toEqual([PERMITTED_DB]);
      expect(afterAllNonAuth.configFingerprint).toBe(before.configFingerprint);
      expect(afterAllNonAuth.xmin).toBe(before.xmin);
      expect(loopback.countPath('/oauth/token')).toBe(0);
      expect(reconnectCallbacks).toBe(0);
    });

    it('preserves freshly rotated token pair when post-refresh resource operation returns 403 restricted_resource', async () => {
      const alice = await db.person('alice-post-refresh-403');
      const wsId = randomUUID();
      const actorId = randomUUID();
      const botId = randomUUID();
      const seeded = await db.seedConnection({
        userId: alice.id,
        sessionId: alice.sid,
        encryptionKey: ENC_KEY,
        appId: 'notion-app-1',
        workspaceId: wsId,
        actorId,
        botId,
        accessToken: 'syn_expired_before_403',
        refreshToken: 'syn_refresh_before_403',
        databases: [{ id: PERMITTED_DB, title: 'Permitted DB' }],
      });
      const before = (await db.inspectRow(seeded.id))!;

      loopback.clearRoutes();
      // First attempt with old token -> 401 unauthorized
      loopback.enqueue('GET', `/databases/${FORBIDDEN_DB}`, {
        kind: 'json',
        status: 401,
        body: { object: 'error', status: 401, code: 'unauthorized' },
      });
      // Refresh succeeds with replacement pair
      loopback.enqueue('POST', '/oauth/token', {
        kind: 'json',
        status: 200,
        body: {
          access_token: 'syn_fresh_after_401',
          refresh_token: 'syn_next_refresh_after_401',
          workspace_id: wsId,
          workspace_name: 'Synthetic Workspace',
          bot_id: botId,
          owner: { type: 'user', user: { id: actorId } },
        },
      });
      loopback.enqueue('GET', '/users/me', {
        kind: 'json',
        status: 200,
        body: { object: 'user', type: 'bot', id: botId },
      });
      // Retry of resource call with fresh token -> 403 restricted_resource!
      loopback.enqueue('GET', `/databases/${FORBIDDEN_DB}`, {
        kind: 'json',
        status: 403,
        body: { object: 'error', status: 403, code: 'restricted_resource' },
      });

      const client = new NotionOAuthClient(loopback.oauthConfig('notion-app-1'));
      const manager = new NotionTokenManager(db.repo, client, ENC_KEY);

      await expect(
        manager.execute(alice.id, seeded.id, seeded.identity_version, (accessToken) =>
          client.validateDatabases(accessToken, [FORBIDDEN_DB], AbortSignal.timeout(3000)),
        ),
      ).rejects.toMatchObject({
        authenticationLost: false,
        statusCode: 403,
        reason: 'resource_denied',
      });

      const after = (await db.inspectRow(seeded.id))!;
      expect(after.status).toBe('active');
      expect(after.authFailureCode).toBeNull();
      expect(after.refreshInFlight).toBe(false);
      expect(after.configPresent).toBe(true);
      expect(after.configFingerprint).not.toBe(before.configFingerprint);
      expect(after.identityVersion).toBe(before.identityVersion);
      expect(loopback.countPath('/oauth/token')).toBe(1);
    });

    it('R1-A: rejects resource and identity 400/403/404/429/500/503 with contradictory unauthorized/invalid_grant or unknown payload codes with 0 manager/provider refresh calls, unchanged PG xmin/fingerprint/version/scope, then succeeds on permitted DB', async () => {
      const alice = await db.person('alice-r1-contradictory');
      const seeded = await db.seedConnection({
        userId: alice.id,
        sessionId: alice.sid,
        encryptionKey: ENC_KEY,
        appId: 'notion-app-1',
        accessToken: 'syn_tok_r1_contradictory',
        refreshToken: 'syn_ref_r1_contradictory',
        databases: [{ id: PERMITTED_DB, title: 'Permitted Roadmap' }],
      });
      const before = (await db.inspectRow(seeded.id))!;

      let reconnectCallbacks = 0;
      let refreshMethodCalls = 0;
      const client = new NotionOAuthClient(loopback.oauthConfig('notion-app-1'));
      const origRefresh = client.refresh.bind(client);
      client.refresh = (async (...args) => {
        refreshMethodCalls++;
        return origRefresh(...args);
      }) as typeof client.refresh;

      const manager = new NotionTokenManager(db.repo, client, ENC_KEY, () => {
        reconnectCallbacks++;
      });

      loopback.clearRoutes();
      loopback.resetLedger();

      const contradictoryCases: Array<{
        label: string;
        kind: 'validate' | 'search' | 'verify';
        status: number;
        body: Record<string, unknown>;
        expectedReason: string;
      }> = [
        {
          label: 'resource-403-unauthorized',
          kind: 'validate',
          status: 403,
          body: {
            object: 'error',
            status: 403,
            code: 'unauthorized',
            error: 'invalid_grant',
            message: 'contradictory-403-body',
          },
          expectedReason: 'resource_denied',
        },
        {
          label: 'resource-404-unauthorized',
          kind: 'validate',
          status: 404,
          body: { object: 'error', status: 404, code: 'unauthorized', message: 'contradictory-404-body' },
          expectedReason: 'resource_unavailable',
        },
        {
          label: 'resource-400-unauthorized',
          kind: 'search',
          status: 400,
          body: { object: 'error', status: 400, code: 'unauthorized', message: 'contradictory-400-body' },
          expectedReason: 'invalid_request',
        },
        {
          label: 'resource-429-unauthorized',
          kind: 'search',
          status: 429,
          body: { object: 'error', status: 429, code: 'unauthorized', message: 'contradictory-429-body' },
          expectedReason: 'rate_limited',
        },
        {
          label: 'resource-500-unauthorized',
          kind: 'search',
          status: 500,
          body: { object: 'error', status: 500, code: 'unauthorized', message: 'contradictory-500-body' },
          expectedReason: 'transient',
        },
        {
          label: 'resource-503-unauthorized',
          kind: 'search',
          status: 503,
          body: {
            object: 'error',
            status: 503,
            code: 'unauthorized',
            error: 'invalid_grant',
            message: 'contradictory-503-body',
          },
          expectedReason: 'transient',
        },
        {
          label: 'resource-403-unknown-code',
          kind: 'validate',
          status: 403,
          body: { object: 'error', status: 403, code: 'future_unknown_code', message: 'unknown-403-body' },
          expectedReason: 'resource_denied',
        },
        {
          label: 'identity-400-unauthorized',
          kind: 'verify',
          status: 400,
          body: { object: 'error', status: 400, code: 'unauthorized' },
          expectedReason: 'invalid_request',
        },
        {
          label: 'identity-403-unauthorized',
          kind: 'verify',
          status: 403,
          body: { object: 'error', status: 403, code: 'unauthorized' },
          expectedReason: 'resource_denied',
        },
        {
          label: 'identity-404-unauthorized',
          kind: 'verify',
          status: 404,
          body: { object: 'error', status: 404, code: 'unauthorized' },
          expectedReason: 'resource_unavailable',
        },
        {
          label: 'identity-429-unauthorized',
          kind: 'verify',
          status: 429,
          body: { object: 'error', status: 429, code: 'unauthorized' },
          expectedReason: 'rate_limited',
        },
        {
          label: 'identity-503-unauthorized',
          kind: 'verify',
          status: 503,
          body: { object: 'error', status: 503, code: 'unauthorized' },
          expectedReason: 'transient',
        },
      ];

      for (const tc of contradictoryCases) {
        if (tc.kind === 'validate') {
          loopback.enqueue('GET', `/databases/${FORBIDDEN_DB}`, {
            kind: 'json',
            status: tc.status,
            body: tc.body,
          });
        } else if (tc.kind === 'search') {
          loopback.enqueue('POST', '/search', {
            kind: 'json',
            status: tc.status,
            body: tc.body,
          });
        } else {
          loopback.enqueue('GET', '/users/me', {
            kind: 'json',
            status: tc.status,
            body: tc.body,
          });
        }

        let caught: unknown;
        try {
          await manager.execute<unknown>(alice.id, seeded.id, seeded.identity_version, async (tok, bId) => {
            if (tc.kind === 'validate') {
              return client.validateDatabases(tok, [FORBIDDEN_DB], AbortSignal.timeout(3000));
            }
            if (tc.kind === 'search') {
              return client.databases(tok, 'probe', AbortSignal.timeout(3000));
            }
            return client.verify(tok, bId, AbortSignal.timeout(3000));
          });
        } catch (err) {
          caught = err;
        }

        expect(caught, tc.label).toBeInstanceOf(NotionOAuthError);
        const rowSnap = (await db.inspectRow(seeded.id))!;
        expect(
          {
            authenticationLost: (caught as NotionOAuthError).authenticationLost,
            reason: (caught as NotionOAuthError).reason,
            statusCode: (caught as NotionOAuthError).statusCode,
            refreshMethodCalls,
            tokenHttpCalls: loopback.countPath('/oauth/token'),
            reconnectCallbacks,
            status: rowSnap.status,
            authFailureCode: rowSnap.authFailureCode,
            refreshInFlight: rowSnap.refreshInFlight,
            xminUnchanged: rowSnap.xmin === before.xmin,
            configFingerprintUnchanged: rowSnap.configFingerprint === before.configFingerprint,
            identityVersionUnchanged: rowSnap.identityVersion === before.identityVersion,
            allowedDatabases: rowSnap.allowedDatabases,
          },
          tc.label,
        ).toEqual({
          authenticationLost: false,
          reason: tc.expectedReason,
          statusCode: tc.status,
          refreshMethodCalls: 0,
          tokenHttpCalls: 0,
          reconnectCallbacks: 0,
          status: 'active',
          authFailureCode: null,
          refreshInFlight: false,
          xminUnchanged: true,
          configFingerprintUnchanged: true,
          identityVersionUnchanged: true,
          allowedDatabases: [PERMITTED_DB],
        });
      }

      // Permitted database immediately succeeds with the preserved active token and 0 refreshes
      loopback.enqueue('GET', `/databases/${PERMITTED_DB}`, {
        kind: 'json',
        status: 200,
        body: {
          object: 'database',
          id: PERMITTED_DB,
          title: [{ plain_text: 'Permitted Roadmap' }],
          url: 'https://www.notion.so/permitted-roadmap',
        },
      });
      const permitted = await manager.execute(alice.id, seeded.id, seeded.identity_version, (tok) =>
        client.validateDatabases(tok, [PERMITTED_DB], AbortSignal.timeout(3000)),
      );
      expect(permitted).toEqual([
        { id: PERMITTED_DB, title: 'Permitted Roadmap', url: 'https://www.notion.so/permitted-roadmap' },
      ]);
      expect(refreshMethodCalls).toBe(0);
      expect(loopback.countPath('/oauth/token')).toBe(0);
    });

    it('R1-B: NotionTokenManager gate rejects typed non-401 access_rejected errors without refresh or quarantine (pre-refresh, post-refresh, and checkConnection), while preserving legacy boolean NotionOAuthError(true)', async () => {
      const alice = await db.person('alice-r1-manager-gate');
      const wsId = randomUUID();
      const actorId = randomUUID();
      const botId = randomUUID();
      const seeded = await db.seedConnection({
        userId: alice.id,
        sessionId: alice.sid,
        encryptionKey: ENC_KEY,
        appId: 'notion-app-1',
        workspaceId: wsId,
        actorId,
        botId,
        accessToken: 'syn_tok_gate_v1',
        refreshToken: 'syn_ref_gate_v1',
        databases: [{ id: PERMITTED_DB, title: 'Permitted DB' }],
      });
      const before = (await db.inspectRow(seeded.id))!;

      let refreshCalls = 0;
      let reconnectCalls = 0;
      const client = new NotionOAuthClient(loopback.oauthConfig('notion-app-1'));
      const origRefresh = client.refresh.bind(client);
      client.refresh = (async (...args) => {
        refreshCalls++;
        return origRefresh(...args);
      }) as typeof client.refresh;

      const manager = new NotionTokenManager(db.repo, client, ENC_KEY, () => {
        reconnectCalls++;
      });

      loopback.clearRoutes();
      loopback.resetLedger();

      // 1) Pre-refresh typed non-401 or non-access endpoint errors claiming authenticationLost=true + access_rejected
      const syntheticNon401Errors = [
        new NotionOAuthError('Typed 403 access_rejected', true, {
          endpointKind: 'resource',
          statusCode: 403,
          reason: 'access_rejected',
        }),
        new NotionOAuthError('Typed 503 identity access_rejected', true, {
          endpointKind: 'identity',
          statusCode: 503,
          reason: 'access_rejected',
        }),
        new NotionOAuthError('Typed token 401 access_rejected', true, {
          endpointKind: 'token',
          statusCode: 401,
          reason: 'access_rejected',
        }),
        new NotionOAuthError('Typed statusless details access_rejected', true, {
          endpointKind: 'resource',
          reason: 'access_rejected',
        }),
      ];

      for (const synthErr of syntheticNon401Errors) {
        await expect(
          manager.execute(alice.id, seeded.id, seeded.identity_version, async () => {
            throw synthErr;
          }),
          synthErr.message,
        ).rejects.toBe(synthErr);
        expect(refreshCalls, synthErr.message).toBe(0);
        expect(loopback.countPath('/oauth/token'), synthErr.message).toBe(0);
        expect(reconnectCalls, synthErr.message).toBe(0);
        const snap = (await db.inspectRow(seeded.id))!;
        expect(snap.xmin, synthErr.message).toBe(before.xmin);
        expect(snap.status, synthErr.message).toBe('active');
        expect(snap.configFingerprint, synthErr.message).toBe(before.configFingerprint);
      }

      // 2) Legacy boolean NotionOAuthError(true) triggers single rotation, and a post-refresh typed 403 access_rejected MUST NOT quarantine the fresh token
      loopback.enqueue('POST', '/oauth/token', {
        kind: 'json',
        status: 200,
        body: {
          access_token: 'syn_tok_gate_v2',
          refresh_token: 'syn_ref_gate_v2',
          workspace_id: wsId,
          workspace_name: 'Synthetic Workspace',
          bot_id: botId,
          owner: { type: 'user', user: { id: actorId } },
        },
      });
      loopback.enqueue('GET', '/users/me', {
        kind: 'json',
        status: 200,
        body: { object: 'user', type: 'bot', id: botId },
      });

      const postRefresh403 = new NotionOAuthError('Post-refresh typed 403 access_rejected', true, {
        endpointKind: 'resource',
        statusCode: 403,
        reason: 'access_rejected',
      });
      await expect(
        manager.execute(alice.id, seeded.id, seeded.identity_version, async (tok) => {
          if (tok === 'syn_tok_gate_v1') {
            throw new NotionOAuthError(true); // legacy boolean constructor -> statusCode: 401
          }
          throw postRefresh403;
        }),
      ).rejects.toBe(postRefresh403);

      expect(refreshCalls).toBe(1);
      expect(loopback.countPath('/oauth/token')).toBe(1);
      expect(reconnectCalls).toBe(0);
      const afterPostRefresh = (await db.inspectRow(seeded.id))!;
      expect(afterPostRefresh.status).toBe('active');
      expect(afterPostRefresh.authFailureCode).toBeNull();
      expect(afterPostRefresh.refreshInFlight).toBe(false);
      expect(afterPostRefresh.configPresent).toBe(true);
      expect(afterPostRefresh.configFingerprint).not.toBe(before.configFingerprint);
    });
  });

  describe('2. 401 rotation, missing refreshToken, token endpoint rejections & identity/app mismatches', () => {
    it('rotates once on 401, persists replacement pair durably BEFORE dispatching new token, and preserves identity_version', async () => {
      const alice = await db.person('alice-401-ok');
      const wsId = randomUUID();
      const actorId = randomUUID();
      const botId = randomUUID();
      const seeded = await db.seedConnection({
        userId: alice.id,
        sessionId: alice.sid,
        encryptionKey: ENC_KEY,
        appId: 'notion-app-1',
        workspaceId: wsId,
        actorId,
        botId,
        accessToken: 'syn_old_access_1',
        refreshToken: 'syn_old_refresh_1',
        databases: [{ id: PERMITTED_DB, title: 'Roadmap' }],
      });
      const before = (await db.inspectRow(seeded.id))!;

      loopback.clearRoutes();
      loopback.enqueue('POST', '/oauth/token', {
        kind: 'json',
        status: 200,
        body: {
          access_token: 'syn_rotated_access_2',
          refresh_token: 'syn_rotated_refresh_2',
          workspace_id: wsId,
          workspace_name: 'Updated WS Name',
          bot_id: botId,
          owner: { type: 'user', user: { id: actorId } },
        },
      });
      loopback.enqueue('GET', '/users/me', {
        kind: 'json',
        status: 200,
        body: { object: 'user', type: 'bot', id: botId },
      });

      const client = new NotionOAuthClient(loopback.oauthConfig('notion-app-1'));
      const manager = new NotionTokenManager(db.repo, client, ENC_KEY);

      let snapshotDuringRetry: Awaited<ReturnType<typeof db.inspectRow>> = null;
      const out = await manager.execute(alice.id, seeded.id, seeded.identity_version, async (token) => {
        if (token === 'syn_old_access_1') {
          throw new NotionOAuthError('HTTP 401 unauthorized', true);
        }
        // Observe from independent PG connection BEFORE operation returns: new ciphertext must already be committed!
        snapshotDuringRetry = await db.inspectRow(seeded.id);
        return fingerprintSecret(token);
      });

      expect(out).toBe(fingerprintSecret('syn_rotated_access_2'));
      expect(loopback.countPath('/oauth/token')).toBe(1);
      expect(snapshotDuringRetry).not.toBeNull();
      expect(snapshotDuringRetry!.refreshInFlight).toBe(false);
      expect(snapshotDuringRetry!.authFailureCode).toBeNull();
      expect(snapshotDuringRetry!.configFingerprint).not.toBe(before.configFingerprint);
      expect(snapshotDuringRetry!.identityVersion).toBe(before.identityVersion);
    });

    it('never dispatches empty refresh_token on 401 and transitions terminally to grant_rejected without reusing rejected access token', async () => {
      const alice = await db.person('alice-no-rt');
      const seeded = await db.seedConnection({
        userId: alice.id,
        sessionId: alice.sid,
        encryptionKey: ENC_KEY,
        appId: 'notion-app-1',
        accessToken: 'syn_access_without_refresh',
        refreshToken: '',
      });

      loopback.clearRoutes();
      let notified = 0;
      const client = new NotionOAuthClient(loopback.oauthConfig('notion-app-1'));
      const manager = new NotionTokenManager(db.repo, client, ENC_KEY, () => {
        notified++;
      });

      let opCalls = 0;
      await expect(
        manager.execute(alice.id, seeded.id, seeded.identity_version, async () => {
          opCalls++;
          throw new NotionOAuthError('HTTP 401', true);
        }),
      ).rejects.toBeInstanceOf(NotionOAuthError);

      expect(opCalls).toBe(1);
      expect(loopback.countPath('/oauth/token')).toBe(0);
      expect(notified).toBe(1);

      const after = (await db.inspectRow(seeded.id))!;
      expect(after.status).toBe('reconnect_required');
      expect(after.authFailureCode).toBe('grant_rejected');
      expect(after.configPresent).toBe(false);
      expect(after.refreshInFlight).toBe(false);

      // Subsequent call does not reuse rejected access token
      await expect(
        manager.execute(alice.id, seeded.id, seeded.identity_version, async () => {
          opCalls++;
          return 'unexpected';
        }),
      ).rejects.toBeInstanceOf(NotionOAuthError);
      expect(opCalls).toBe(1);
    });

    it('classifies invalid_grant (terminal NULL config), invalid_client (preserved config), token 403 (conservative preserved config), and workspace/actor/bot mismatches', async () => {
      const otherUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

      const caseNames = [
        'invalid_grant',
        'invalid_client',
        'token_403_unknown',
        'workspace_mismatch',
        'actor_mismatch',
        'bot_mismatch',
      ] as const;

      for (const caseName of caseNames) {
        const wsId = randomUUID();
        const actorId = randomUUID();
        const botId = randomUUID();
        let tokenAction: Parameters<typeof loopback.enqueue>[2];
        let meBody: unknown = undefined;
        let expectedFailureCode = '';
        let expectConfigPreserved = true;

        switch (caseName) {
          case 'invalid_grant':
            tokenAction = {
              kind: 'json',
              status: 400,
              body: { error: 'invalid_grant', error_description: 'Refresh token expired or revoked' },
            };
            expectedFailureCode = 'grant_rejected';
            expectConfigPreserved = false;
            break;
          case 'invalid_client':
            tokenAction = {
              kind: 'json',
              status: 401,
              body: { error: 'invalid_client', error_description: 'Client secret mismatch' },
            };
            expectedFailureCode = 'client_misconfigured';
            expectConfigPreserved = true;
            break;
          case 'token_403_unknown':
            tokenAction = {
              kind: 'json',
              status: 403,
              body: { object: 'error', status: 403, message: 'Temporary upstream WAF gate' },
            };
            expectedFailureCode = 'rotation_unknown';
            expectConfigPreserved = true;
            break;
          case 'workspace_mismatch':
            tokenAction = {
              kind: 'json',
              status: 200,
              body: {
                access_token: 'syn_mismatch_ws',
                refresh_token: 'syn_mismatch_ws_ref',
                workspace_id: otherUuid,
                workspace_name: 'Wrong WS',
                bot_id: botId,
                owner: { type: 'user', user: { id: actorId } },
              },
            };
            meBody = { object: 'user', type: 'bot', id: botId };
            expectedFailureCode = 'identity_mismatch';
            expectConfigPreserved = true;
            break;
          case 'actor_mismatch':
            tokenAction = {
              kind: 'json',
              status: 200,
              body: {
                access_token: 'syn_mismatch_actor',
                refresh_token: 'syn_mismatch_actor_ref',
                workspace_id: wsId,
                workspace_name: 'Same WS',
                bot_id: botId,
                owner: { type: 'user', user: { id: otherUuid } },
              },
            };
            meBody = { object: 'user', type: 'bot', id: botId };
            expectedFailureCode = 'identity_mismatch';
            expectConfigPreserved = true;
            break;
          case 'bot_mismatch':
            tokenAction = {
              kind: 'json',
              status: 200,
              body: {
                access_token: 'syn_mismatch_bot',
                refresh_token: 'syn_mismatch_bot_ref',
                workspace_id: wsId,
                workspace_name: 'Same WS',
                bot_id: otherUuid,
                owner: { type: 'user', user: { id: actorId } },
              },
            };
            meBody = { object: 'user', type: 'bot', id: otherUuid };
            expectedFailureCode = 'identity_mismatch';
            expectConfigPreserved = true;
            break;
        }

        const tc = { name: caseName, tokenAction, meBody, expectedFailureCode, expectConfigPreserved };
        const user = await db.person(`user-${tc.name}`);
        const seeded = await db.seedConnection({
          userId: user.id,
          sessionId: user.sid,
          encryptionKey: ENC_KEY,
          appId: 'notion-app-1',
          workspaceId: wsId,
          actorId,
          botId,
          accessToken: `syn_tok_${tc.name}`,
          refreshToken: `syn_ref_${tc.name}`,
        });
        const before = (await db.inspectRow(seeded.id))!;

        loopback.clearRoutes();
        loopback.enqueue('POST', '/oauth/token', tc.tokenAction);
        if (tc.meBody) {
          loopback.enqueue('GET', '/users/me', { kind: 'json', status: 200, body: tc.meBody });
        }

        const client = new NotionOAuthClient(loopback.oauthConfig('notion-app-1'));
        const manager = new NotionTokenManager(db.repo, client, ENC_KEY);

        await expect(
          manager.execute(user.id, seeded.id, seeded.identity_version, async () => {
            throw new NotionOAuthError('HTTP 401', true);
          }),
          tc.name,
        ).rejects.toBeInstanceOf(NotionOAuthError);

        expect(loopback.countPath('/oauth/token'), tc.name).toBe(1);
        const after = (await db.inspectRow(seeded.id))!;
        expect(after.status, tc.name).toBe('reconnect_required');
        expect(after.authFailureCode, tc.name).toBe(tc.expectedFailureCode);
        expect(after.refreshInFlight, tc.name).toBe(false);
        expect(after.configPresent, tc.name).toBe(tc.expectConfigPreserved);
        if (tc.expectConfigPreserved) {
          expect(after.configFingerprint, tc.name).toBe(before.configFingerprint);
        } else {
          expect(after.configFingerprint, tc.name).toBeNull();
        }
      }
    });

    it('rejects configured OAuth app mismatch before any provider HTTP call, including via cached AdapterFactory execution', async () => {
      const alice = await db.person('alice-app-mismatch');
      const seeded = await db.seedConnection({
        userId: alice.id,
        sessionId: alice.sid,
        encryptionKey: ENC_KEY,
        appId: 'stored-app-alpha',
        accessToken: 'syn_tok_alpha',
        refreshToken: 'syn_ref_alpha',
        databases: [{ id: PERMITTED_DB, title: 'Alpha DB' }],
      });
      const before = (await db.inspectRow(seeded.id))!;

      loopback.clearRoutes();
      // Operator rotated OAuth clientId to 'configured-app-beta'
      const betaClient = new NotionOAuthClient(loopback.oauthConfig('configured-app-beta'));
      expect((betaClient as any).appId).toBe('configured-app-beta');

      let reconnectNotified = 0;
      const manager = new NotionTokenManager(db.repo, betaClient, ENC_KEY, () => {
        reconnectNotified++;
      });
      const credRepo = new CredentialRepo(db.pool, ENC_KEY);
      const factory = new AdapterFactory({
        credentialRepo: credRepo,
        encryptionKey: ENC_KEY,
        notionRepo: db.repo,
        notionTokens: manager,
      });

      // Obtain personal cached adapter from READ-ONLY AdapterFactory
      const cachedAdapter = await factory.getAdapterForService('notion', {
        userId: alice.id,
        phase: 'execution',
        connections: {
          notion: {
            credentialId: seeded.id,
            workspaceId: seeded.workspace_id,
            workspaceName: seeded.workspace_name,
            botId: seeded.bot_id,
            identityVersion: seeded.identity_version,
            databaseIds: [PERMITTED_DB],
          },
        },
      });

      await expect(cachedAdapter.execute('notion.search_databases', {})).rejects.toThrow();

      // Zero outbound HTTP calls to Notion resource or token endpoints!
      expect(loopback.ledger).toHaveLength(0);
      expect(reconnectNotified).toBe(1);

      const after = (await db.inspectRow(seeded.id))!;
      expect(after.status).toBe('reconnect_required');
      expect(after.authFailureCode).toBe('client_misconfigured');
      expect(after.refreshInFlight).toBe(false);
      expect(after.configPresent).toBe(true);
      expect(after.configFingerprint).toBe(before.configFingerprint);
    });

    it('R1-C: preserves encrypted config as rotation_unknown (never clearing config) when /oauth/token returns contradictory 503/500/429/403/401 invalid_grant or unknown 400', async () => {
      const nonTerminalCases: Array<{
        label: string;
        status: number;
        body: Record<string, unknown>;
      }> = [
        {
          label: 'token-503-invalid_grant',
          status: 503,
          body: { error: 'invalid_grant', error_description: 'upstream 503 proxy body' },
        },
        {
          label: 'token-500-invalid_grant',
          status: 500,
          body: { error: 'invalid_grant' },
        },
        {
          label: 'token-429-invalid_grant',
          status: 429,
          body: { error: 'invalid_grant' },
        },
        {
          label: 'token-403-invalid_grant',
          status: 403,
          body: { error: 'invalid_grant' },
        },
        {
          label: 'token-401-invalid_grant',
          status: 401,
          body: { error: 'invalid_grant' },
        },
        {
          label: 'token-400-unknown-error',
          status: 400,
          body: { error: 'unrecognized_provider_error' },
        },
      ];

      for (const tc of nonTerminalCases) {
        const user = await db.person(`user-${tc.label}`);
        const seeded = await db.seedConnection({
          userId: user.id,
          sessionId: user.sid,
          encryptionKey: ENC_KEY,
          appId: 'notion-app-1',
          accessToken: `syn_tok_${tc.label}`,
          refreshToken: `syn_ref_${tc.label}`,
        });
        const before = (await db.inspectRow(seeded.id))!;

        loopback.clearRoutes();
        loopback.resetLedger();
        loopback.enqueue('POST', '/oauth/token', {
          kind: 'json',
          status: tc.status,
          body: tc.body,
        });

        const client = new NotionOAuthClient(loopback.oauthConfig('notion-app-1'));
        const manager = new NotionTokenManager(db.repo, client, ENC_KEY);

        await expect(
          manager.execute(user.id, seeded.id, seeded.identity_version, async () => {
            throw new NotionOAuthError('HTTP 401', true);
          }),
          tc.label,
        ).rejects.toBeInstanceOf(NotionOAuthError);

        expect(loopback.countPath('/oauth/token'), tc.label).toBe(1);
        const after = (await db.inspectRow(seeded.id))!;
        expect(
          {
            status: after.status,
            authFailureCode: after.authFailureCode,
            refreshInFlight: after.refreshInFlight,
            configPresent: after.configPresent,
            configFingerprintUnchanged: after.configFingerprint === before.configFingerprint,
            identityVersionUnchanged: after.identityVersion === before.identityVersion,
          },
          tc.label,
        ).toEqual({
          status: 'reconnect_required',
          authFailureCode: 'rotation_unknown',
          refreshInFlight: false,
          configPresent: true,
          configFingerprintUnchanged: true,
          identityVersionUnchanged: true,
        });
      }

      // Also verify manager.classifyRefreshFailure defense-in-depth if a custom refresh throws statusCode=503 with reason='grant_rejected'
      const synthUser = await db.person('user-r1c-manager-defense');
      const synthSeeded = await db.seedConnection({
        userId: synthUser.id,
        sessionId: synthUser.sid,
        encryptionKey: ENC_KEY,
        appId: 'notion-app-1',
        accessToken: 'syn_tok_defense',
        refreshToken: 'syn_ref_defense',
      });
      const beforeDefense = (await db.inspectRow(synthSeeded.id))!;
      const synthOAuth = {
        appId: 'notion-app-1',
        refresh: async () => {
          throw new NotionOAuthError('Contradictory 503 grant_rejected', true, {
            endpointKind: 'token',
            statusCode: 503,
            providerCode: 'invalid_grant',
            reason: 'grant_rejected',
            requestState: 'response_received',
          });
        },
      } as unknown as NotionOAuthClient;
      const defenseManager = new NotionTokenManager(db.repo, synthOAuth, ENC_KEY);
      await expect(
        defenseManager.execute(synthUser.id, synthSeeded.id, synthSeeded.identity_version, async () => {
          throw new NotionOAuthError(true);
        }),
      ).rejects.toBeInstanceOf(NotionOAuthError);

      const afterDefense = (await db.inspectRow(synthSeeded.id))!;
      expect(afterDefense.status).toBe('reconnect_required');
      expect(afterDefense.authFailureCode).toBe('rotation_unknown');
      expect(afterDefense.configPresent).toBe(true);
      expect(afterDefense.configFingerprint).toBe(beforeDefense.configFingerprint);
    });
  });

  describe('3. Refresh checkpoints, pre-dispatch vs ambiguous transport faults, and DB boundary faults', () => {
    it('quarantines proven pre-dispatch refresh failure as refresh_retryable (0 HTTP) and recovers once via explicit POST /:id/check', async () => {
      const alice = await db.person('alice-predispatch');
      const wsId = randomUUID();
      const actorId = randomUUID();
      const botId = randomUUID();
      const seeded = await db.seedConnection({
        userId: alice.id,
        sessionId: alice.sid,
        encryptionKey: ENC_KEY,
        appId: 'notion-app-1',
        workspaceId: wsId,
        actorId,
        botId,
        accessToken: 'syn_expired_predispatch',
        refreshToken: 'syn_valid_refresh_predispatch',
        databases: [{ id: PERMITTED_DB, title: 'Roadmap' }],
      });
      const before = (await db.inspectRow(seeded.id))!;

      loopback.clearRoutes();
      // Configure an invalid local apiBaseUrl so request fails provably BEFORE fetchFn is ever invoked
      let preDispatchFetchCalls = 0;
      const neverCalledFetch: typeof fetch = async () => {
        preDispatchFetchCalls++;
        throw new Error('should never dispatch');
      };
      const preDispatchClient = new NotionOAuthClient(
        { ...loopback.oauthConfig('notion-app-1'), apiBaseUrl: '::invalid-local-url::' },
        neverCalledFetch,
      );
      const manager = new NotionTokenManager(db.repo, preDispatchClient, ENC_KEY);

      await expect(
        manager.execute(alice.id, seeded.id, seeded.identity_version, async () => {
          throw new NotionOAuthError('HTTP 401', true);
        }),
      ).rejects.toBeInstanceOf(NotionOAuthError);

      // Zero fetchFn invocations and zero /oauth/token requests arrived at loopback server
      expect(preDispatchFetchCalls).toBe(0);
      expect(loopback.countPath('/oauth/token')).toBe(0);

      const quarantined = (await db.inspectRow(seeded.id))!;
      expect(quarantined.status).toBe('reconnect_required');
      expect(quarantined.authFailureCode).toBe('refresh_retryable');
      expect(quarantined.refreshInFlight).toBe(false);
      expect(quarantined.configPresent).toBe(true);
      expect(quarantined.configFingerprint).toBe(before.configFingerprint);

      // Ordinary execute() (even with healthy client) must NOT automatically retry while in reconnect_required
      const healthyManager = new NotionTokenManager(
        db.repo,
        new NotionOAuthClient(loopback.oauthConfig('notion-app-1')),
        ENC_KEY,
      );
      await expect(
        healthyManager.execute(alice.id, seeded.id, seeded.identity_version, async () => 'no-auto-retry'),
      ).rejects.toBeInstanceOf(NotionOAuthError);
      expect(loopback.countPath('/oauth/token')).toBe(0);

      // Explicit POST /api/connections/notion/:id/check recovers once cleanly!
      loopback.enqueue('POST', '/oauth/token', {
        kind: 'json',
        status: 200,
        body: {
          access_token: 'syn_recovered_access',
          refresh_token: 'syn_recovered_refresh',
          workspace_id: wsId,
          workspace_name: 'Synthetic Workspace',
          bot_id: botId,
          owner: { type: 'user', user: { id: actorId } },
        },
      });
      loopback.enqueue('GET', '/users/me', {
        kind: 'json',
        status: 200,
        body: { object: 'user', type: 'bot', id: botId },
      });
      // verify() inside check after recovery
      loopback.enqueue('GET', '/users/me', {
        kind: 'json',
        status: 200,
        body: { object: 'user', type: 'bot', id: botId },
      });

      let changedCount = 0;
      const aliceToken = generateAccessToken(alice, JWT_SECRET, alice.sid).accessToken;
      const app = createApp({
        jwtSecret: JWT_SECRET,
        encryptionKey: ENC_KEY,
        userRepo: db.users,
        notion: {
          oauth: loopback.oauthConfig('notion-app-1'),
          repo: db.repo,
          onConnectionChanged: () => {
            changedCount++;
          },
        },
      });

      const checkRes = await request(app)
        .post(`/api/connections/notion/${seeded.id}/check`)
        .set('Authorization', `Bearer ${aliceToken}`);
      expect(checkRes.status).toBe(200);
      expect(checkRes.body.status).toBe('connected');
      expect(checkRes.body.authFailureCode).toBeNull();
      expect(loopback.countPath('/oauth/token')).toBe(1);
      expect(changedCount).toBeGreaterThanOrEqual(1);

      const recovered = (await db.inspectRow(seeded.id))!;
      expect(recovered.status).toBe('active');
      expect(recovered.authFailureCode).toBeNull();
      expect(recovered.refreshInFlight).toBe(false);
      expect(recovered.configPresent).toBe(true);
      expect(recovered.configFingerprint).not.toBe(before.configFingerprint);
    });

    it('quarantines accepted-socket-loss, real AbortSignal timeout, HTTP 503, and malformed 200 grant as rotation_unknown with preserved ciphertext and zero replay', async () => {
      const faults: Array<{
        name: string;
        action: Parameters<typeof loopback.enqueue>[2];
        customFetch?: typeof fetch;
      }> = [
        {
          name: 'accepted_socket_destroy',
          action: { kind: 'destroy_socket' },
        },
        {
          name: 'real_abort_signal_timeout',
          action: { kind: 'hang', holdMs: 400 },
          customFetch: (input, init) =>
            fetch(input, {
              ...init,
              signal: init?.signal
                ? AbortSignal.any([init.signal, AbortSignal.timeout(80)])
                : AbortSignal.timeout(80),
            }),
        },
        {
          name: 'http_503_unavailable',
          action: {
            kind: 'json',
            status: 503,
            body: { object: 'error', status: 503, code: 'service_unavailable' },
          },
        },
        {
          name: 'malformed_200_grant',
          action: {
            kind: 'json',
            status: 200,
            body: { access_token: 'syn_incomplete_grant_missing_refresh_and_ids' },
          },
        },
      ];

      for (const fault of faults) {
        const user = await db.person(`user-${fault.name}`);
        const seeded = await db.seedConnection({
          userId: user.id,
          sessionId: user.sid,
          encryptionKey: ENC_KEY,
          appId: 'notion-app-1',
          accessToken: `syn_tok_${fault.name}`,
          refreshToken: `syn_ref_${fault.name}`,
          databases: [{ id: PERMITTED_DB, title: 'Ops' }],
        });
        const before = (await db.inspectRow(seeded.id))!;

        loopback.clearRoutes();
        let checkpointDuringRequest: InspectedNotionRow | null = null;
        const wrappedAction = {
          ...fault.action,
          onRequest: async () => {
            checkpointDuringRequest = await db.inspectRow(seeded.id);
          },
        };
        loopback.enqueue('POST', '/oauth/token', wrappedAction);

        const client = new NotionOAuthClient(loopback.oauthConfig('notion-app-1'), fault.customFetch);
        const manager = new NotionTokenManager(db.repo, client, ENC_KEY);

        await expect(
          manager.execute(user.id, seeded.id, seeded.identity_version, async () => {
            throw new NotionOAuthError('HTTP 401', true);
          }),
          fault.name,
        ).rejects.toBeInstanceOf(NotionOAuthError);

        // Durable checkpoint was visible BEFORE provider completed
        const observedCheckpoint = checkpointDuringRequest as InspectedNotionRow | null;
        expect(observedCheckpoint?.refreshInFlight, fault.name).toBe(true);
        expect(observedCheckpoint?.authFailureCode, fault.name).toBe('access_rejected');
        expect(loopback.countPath('/oauth/token'), fault.name).toBe(1);

        const after = (await db.inspectRow(seeded.id))!;
        expect(after.status, fault.name).toBe('reconnect_required');
        expect(after.authFailureCode, fault.name).toBe('rotation_unknown');
        expect(after.refreshInFlight, fault.name).toBe(false);
        expect(after.configPresent, fault.name).toBe(true);
        expect(after.configFingerprint, fault.name).toBe(before.configFingerprint);

        // Neither execute() nor POST /:id/check may replay the ambiguous refresh token
        await expect(
          manager.execute(user.id, seeded.id, seeded.identity_version, async () => 'no-replay'),
          fault.name,
        ).rejects.toBeInstanceOf(NotionOAuthError);

        const userJwt = generateAccessToken(user, JWT_SECRET, user.sid).accessToken;
        const app = createApp({
          jwtSecret: JWT_SECRET,
          encryptionKey: ENC_KEY,
          userRepo: db.users,
          notion: {
            oauth: loopback.oauthConfig('notion-app-1'),
            repo: db.repo,
            tokens: manager,
          },
        });
        const checkRes = await request(app)
          .post(`/api/connections/notion/${seeded.id}/check`)
          .set('Authorization', `Bearer ${userJwt}`);
        expect(checkRes.status, fault.name).toBe(409);
        expect(loopback.countPath('/oauth/token'), fault.name).toBe(1);
      }
    });

    it('never dispatches new access token when DB save returns rowCount=0 or throws lost-ack at pg.PoolClient.query boundary', async () => {
      const wsId = randomUUID();
      const actorId = randomUUID();
      const botId = randomUUID();

      // Subcase A: Real PoolClient boundary returns rowCount=0 on the active token-save UPDATE
      {
        const user = await db.person('user-rowcount0');
        const seeded = await db.seedConnection({
          userId: user.id,
          sessionId: user.sid,
          encryptionKey: ENC_KEY,
          appId: 'notion-app-1',
          workspaceId: wsId,
          actorId,
          botId,
          accessToken: 'syn_old_rc0',
          refreshToken: 'syn_ref_rc0',
        });
        const before = (await db.inspectRow(seeded.id))!;

        loopback.clearRoutes();
        loopback.enqueue('POST', '/oauth/token', {
          kind: 'json',
          status: 200,
          body: {
            access_token: 'syn_new_unpersisted_rc0',
            refresh_token: 'syn_new_ref_rc0',
            workspace_id: wsId,
            workspace_name: 'WS',
            bot_id: botId,
            owner: { type: 'user', user: { id: actorId } },
          },
        });
        loopback.enqueue('GET', '/users/me', {
          kind: 'json',
          status: 200,
          body: { object: 'user', type: 'bot', id: botId },
        });

        const proxyRepo = new Proxy(db.repo, {
          get(target, prop, receiver) {
            if (prop === 'withOwner') {
              return async (uId: string, action: (client: pg.PoolClient) => Promise<unknown>) =>
                target.withOwner(uId, async (realClient) => {
                  const origQuery = realClient.query.bind(realClient);
                  const wrappedClient = new Proxy(realClient, {
                    get(cTarget, cProp) {
                      if (cProp === 'query') {
                        return async (sql: any, params?: any) => {
                          const text = typeof sql === 'string' ? sql : String(sql?.text ?? '');
                          // Intercept ONLY the replacement credential save UPDATE (leaves real PG untouched -> rowCount 0)
                          if (
                            /UPDATE\s+notion_connections/i.test(text) &&
                            /workspace_name\s*=/i.test(text) &&
                            /refresh_in_flight\s*=\s*false/i.test(text)
                          ) {
                            return { rows: [], rowCount: 0, command: 'UPDATE', oid: 0, fields: [] };
                          }
                          return origQuery(sql, params);
                        };
                      }
                      return Reflect.get(cTarget, cProp);
                    },
                  });
                  return action(wrappedClient);
                });
            }
            return Reflect.get(target, prop, receiver);
          },
        });

        const client = new NotionOAuthClient(loopback.oauthConfig('notion-app-1'));
        const manager = new NotionTokenManager(proxyRepo, client, ENC_KEY);

        const seenTokens: string[] = [];
        await expect(
          manager.execute(user.id, seeded.id, seeded.identity_version, async (tok) => {
            seenTokens.push(tok);
            if (tok === 'syn_old_rc0') throw new NotionOAuthError('HTTP 401', true);
            return 'MUST_NEVER_HAPPEN';
          }),
        ).rejects.toBeInstanceOf(NotionOAuthError);

        // Unpersisted token MUST NEVER be handed to operation!
        expect(seenTokens).toEqual(['syn_old_rc0']);

        const after = (await db.inspectRow(seeded.id))!;
        expect(after.status).toBe('reconnect_required');
        expect(after.authFailureCode).toBe('rotation_unknown');
        expect(after.refreshInFlight).toBe(false);
        expect(after.configFingerprint).toBe(before.configFingerprint);
      }

      // Subcase B: Lost acknowledgement / broken DB session thrown during replacement save UPDATE
      {
        const wsIdB = randomUUID();
        const actorIdB = randomUUID();
        const botIdB = randomUUID();
        const user = await db.person('user-lost-ack');
        const seeded = await db.seedConnection({
          userId: user.id,
          sessionId: user.sid,
          encryptionKey: ENC_KEY,
          appId: 'notion-app-1',
          workspaceId: wsIdB,
          actorId: actorIdB,
          botId: botIdB,
          accessToken: 'syn_old_ackloss',
          refreshToken: 'syn_ref_ackloss',
        });
        const before = (await db.inspectRow(seeded.id))!;

        loopback.clearRoutes();
        loopback.enqueue('POST', '/oauth/token', {
          kind: 'json',
          status: 200,
          body: {
            access_token: 'syn_new_ackloss',
            refresh_token: 'syn_new_ref_ackloss',
            workspace_id: wsIdB,
            workspace_name: 'WS',
            bot_id: botIdB,
            owner: { type: 'user', user: { id: actorIdB } },
          },
        });
        loopback.enqueue('GET', '/users/me', {
          kind: 'json',
          status: 200,
          body: { object: 'user', type: 'bot', id: botIdB },
        });

        let sessionBroken = false;
        let poolConnectCount = 0;
        const proxyRepo = new Proxy(db.repo, {
          get(target, prop, receiver) {
            if (prop === 'withOwner') {
              return async (uId: string, action: (client: pg.PoolClient) => Promise<unknown>) => {
                poolConnectCount++;
                return target.withOwner(uId, async (realClient) => {
                  const origQuery = realClient.query.bind(realClient);
                  const wrappedClient = new Proxy(realClient, {
                    get(cTarget, cProp) {
                      if (cProp === 'query') {
                        return async (sql: any, params?: any) => {
                          const text = typeof sql === 'string' ? sql : String(sql?.text ?? '');
                          if (/pg_advisory_unlock/i.test(text)) {
                            return origQuery(sql, params);
                          }
                          if (sessionBroken) {
                            throw new Error('ECONNRESET: simulated lost PostgreSQL session');
                          }
                          if (
                            /UPDATE\s+notion_connections/i.test(text) &&
                            /workspace_name\s*=/i.test(text) &&
                            /refresh_in_flight\s*=\s*false/i.test(text)
                          ) {
                            sessionBroken = true;
                            throw new Error('ECONNRESET: lost commit acknowledgement during token save');
                          }
                          return origQuery(sql, params);
                        };
                      }
                      return Reflect.get(cTarget, cProp);
                    },
                  });
                  return action(wrappedClient);
                });
              };
            }
            return Reflect.get(target, prop, receiver);
          },
        });

        const client = new NotionOAuthClient(loopback.oauthConfig('notion-app-1'));
        const manager = new NotionTokenManager(proxyRepo, client, ENC_KEY);

        const seenTokens: string[] = [];
        await expect(
          manager.execute(user.id, seeded.id, seeded.identity_version, async (tok) => {
            seenTokens.push(tok);
            if (tok === 'syn_old_ackloss') throw new NotionOAuthError('HTTP 401', true);
            return 'MUST_NEVER_HAPPEN';
          }),
        ).rejects.toBeInstanceOf(NotionOAuthError);

        // Must NOT dispatch unacknowledged token AND must NOT reacquire a new pool client to overwrite state!
        expect(seenTokens).toEqual(['syn_old_ackloss']);
        expect(poolConnectCount).toBe(1);

        // Durable refresh_in_flight checkpoint remains in PG with original ciphertext intact -> next call quarantines cleanly
        const midState = (await db.inspectRow(seeded.id))!;
        expect(midState.refreshInFlight).toBe(true);
        expect(midState.configFingerprint).toBe(before.configFingerprint);

        const cleanManager = new NotionTokenManager(db.repo, client, ENC_KEY);
        await expect(
          cleanManager.execute(user.id, seeded.id, seeded.identity_version, async () => 'quarantine'),
        ).rejects.toBeInstanceOf(NotionOAuthError);

        const finalState = (await db.inspectRow(seeded.id))!;
        expect(finalState.status).toBe('reconnect_required');
        expect(finalState.authFailureCode).toBe('rotation_unknown');
        expect(finalState.refreshInFlight).toBe(false);
        expect(finalState.configPresent).toBe(true);
        expect(finalState.configFingerprint).toBe(before.configFingerprint);
      }
    });

    it('R2: transitions interrupted explicit recovery checkpoint (reconnect_required + refresh_retryable + refresh_in_flight=true) durably under owner lock to rotation_unknown across checkConnection, execute, GET view, and connection lookup without touching other generations or disconnected rows', async () => {
      const wsId = randomUUID();
      const actorId = randomUUID();
      const botId = randomUUID();

      // 1) Explicit recovery save failure leaves reconnect_required + refresh_retryable + refresh_in_flight=true;
      //    subsequent GET view/lookup and POST /:id/check must report & persist rotation_unknown with 0 replay
      {
        const user = await db.person('user-r2-check-save-fail');
        const seeded = await db.seedConnection({
          userId: user.id,
          sessionId: user.sid,
          encryptionKey: ENC_KEY,
          appId: 'notion-app-1',
          workspaceId: wsId,
          actorId,
          botId,
          accessToken: 'syn_r2_old_tok',
          refreshToken: 'syn_r2_old_ref',
          databases: [{ id: PERMITTED_DB, title: 'Roadmap' }],
        });
        await db.pool.query(
          `UPDATE notion_connections
              SET status = 'reconnect_required',
                  auth_failure_code = 'refresh_retryable',
                  refresh_in_flight = false
            WHERE id = $1`,
          [seeded.id],
        );
        const before = (await db.inspectRow(seeded.id))!;

        loopback.clearRoutes();
        loopback.resetLedger();
        loopback.enqueue('POST', '/oauth/token', {
          kind: 'json',
          status: 200,
          body: {
            access_token: 'syn_r2_unpersisted_tok',
            refresh_token: 'syn_r2_unpersisted_ref',
            workspace_id: wsId,
            workspace_name: 'WS',
            bot_id: botId,
            owner: { type: 'user', user: { id: actorId } },
          },
        });
        loopback.enqueue('GET', '/users/me', {
          kind: 'json',
          status: 200,
          body: { object: 'user', type: 'bot', id: botId },
        });

        const failSaveRepo = new Proxy(db.repo, {
          get(target, prop, receiver) {
            if (prop === 'withOwner') {
              return async (uId: string, action: (client: pg.PoolClient) => Promise<unknown>) =>
                target.withOwner(uId, async (realClient) => {
                  const origQuery = realClient.query.bind(realClient);
                  const wrappedClient = new Proxy(realClient, {
                    get(cTarget, cProp) {
                      if (cProp === 'query') {
                        return async (sql: any, params?: any) => {
                          const text = typeof sql === 'string' ? sql : String(sql?.text ?? '');
                          if (
                            /UPDATE\s+notion_connections/i.test(text) &&
                            /SET\s+status\s*=\s*'active'/i.test(text)
                          ) {
                            throw new Error('simulated DB failure before explicit recovery save');
                          }
                          return origQuery(sql, params);
                        };
                      }
                      return Reflect.get(cTarget, cProp);
                    },
                  });
                  return action(wrappedClient);
                });
            }
            return Reflect.get(target, prop, receiver);
          },
        });

        const client = new NotionOAuthClient(loopback.oauthConfig('notion-app-1'));
        const failingCheckManager = new NotionTokenManager(failSaveRepo, client, ENC_KEY);

        let verifyCalled = false;
        let saveFailErr: any;
        try {
          await failingCheckManager.checkConnection(
            user.id,
            seeded.id,
            seeded.identity_version,
            async () => {
              verifyCalled = true;
            },
          );
        } catch (err) {
          saveFailErr = err;
        }
        expect(saveFailErr).toBeInstanceOf(NotionOAuthError);
        expect(verifyCalled).toBe(false);
        expect(loopback.countPath('/oauth/token')).toBe(1);

        // Row now holds reconnect_required + refresh_retryable + refresh_in_flight=true
        const mid = (await db.inspectRow(seeded.id))!;
        expect(mid.status).toBe('reconnect_required');
        expect(mid.refreshInFlight).toBe(true);
        expect(mid.configFingerprint).toBe(before.configFingerprint);

        // Lookup & GET route must immediately treat dangling refresh_in_flight as rotation_unknown (not retryable!)
        const lookup = createNotionConnectionLookup({ repo: db.repo });
        const lookupRes = await lookup(user.id);

        const userJwt = generateAccessToken(user, JWT_SECRET, user.sid).accessToken;
        let notifyCount = 0;
        const app = createApp({
          jwtSecret: JWT_SECRET,
          encryptionKey: ENC_KEY,
          userRepo: db.users,
          notion: {
            oauth: loopback.oauthConfig('notion-app-1'),
            repo: db.repo,
            onConnectionChanged: () => {
              notifyCount++;
            },
          },
        });

        const getBeforeCheck = await request(app)
          .get('/api/connections/notion')
          .set('Authorization', `Bearer ${userJwt}`);

        // Subsequent POST /:id/check transitions row durably under owner lock to rotation_unknown + refresh_in_flight=false with 0 replay
        const checkRes = await request(app)
          .post(`/api/connections/notion/${seeded.id}/check`)
          .set('Authorization', `Bearer ${userJwt}`);
        const afterCheck = (await db.inspectRow(seeded.id))!;

        expect({
          saveFailReason: saveFailErr?.reason,
          lookupAuthFailureCode: lookupRes.authFailureCode,
          getBeforeCheckAuthFailureCode: getBeforeCheck.body.authFailureCode,
          checkStatus: checkRes.status,
          checkBodyAuthFailureCode: checkRes.body.authFailureCode,
          tokenHttpCalls: loopback.countPath('/oauth/token'),
          notifiedOnQuarantine: notifyCount >= 1,
          afterCheckStatus: afterCheck.status,
          afterCheckAuthFailureCode: afterCheck.authFailureCode,
          afterCheckRefreshInFlight: afterCheck.refreshInFlight,
          afterCheckConfigPresent: afterCheck.configPresent,
          afterCheckFingerprintUnchanged: afterCheck.configFingerprint === before.configFingerprint,
          afterCheckVersionUnchanged: afterCheck.identityVersion === before.identityVersion,
        }).toEqual({
          saveFailReason: 'rotation_unknown',
          lookupAuthFailureCode: 'rotation_unknown',
          getBeforeCheckAuthFailureCode: 'rotation_unknown',
          checkStatus: 409,
          checkBodyAuthFailureCode: 'rotation_unknown',
          tokenHttpCalls: 1,
          notifiedOnQuarantine: true,
          afterCheckStatus: 'reconnect_required',
          afterCheckAuthFailureCode: 'rotation_unknown',
          afterCheckRefreshInFlight: false,
          afterCheckConfigPresent: true,
          afterCheckFingerprintUnchanged: true,
          afterCheckVersionUnchanged: true,
        });
      }

      // 2) Persisted reconnect_required + refresh_retryable + refresh_in_flight=true encountered by ordinary execute()
      {
        const user = await db.person('user-r2-exec-quarantine');
        const seeded = await db.seedConnection({
          userId: user.id,
          sessionId: user.sid,
          encryptionKey: ENC_KEY,
          appId: 'notion-app-1',
          accessToken: 'syn_r2_exec_tok',
          refreshToken: 'syn_r2_exec_ref',
        });
        await db.pool.query(
          `UPDATE notion_connections
              SET status = 'reconnect_required',
                  auth_failure_code = 'refresh_retryable',
                  refresh_in_flight = true
            WHERE id = $1`,
          [seeded.id],
        );
        const before = (await db.inspectRow(seeded.id))!;

        loopback.clearRoutes();
        loopback.resetLedger();
        let notified = 0;
        const client = new NotionOAuthClient(loopback.oauthConfig('notion-app-1'));
        const manager = new NotionTokenManager(db.repo, client, ENC_KEY, () => {
          notified++;
        });

        await expect(
          manager.execute(user.id, seeded.id, seeded.identity_version, async () => 'must-not-run'),
        ).rejects.toMatchObject({
          reason: 'rotation_unknown',
        });
        expect(loopback.countPath('/oauth/token')).toBe(0);
        expect(notified).toBe(1);

        const after = (await db.inspectRow(seeded.id))!;
        expect(after.status).toBe('reconnect_required');
        expect(after.authFailureCode).toBe('rotation_unknown');
        expect(after.refreshInFlight).toBe(false);
        expect(after.configPresent).toBe(true);
        expect(after.configFingerprint).toBe(before.configFingerprint);
        expect(after.identityVersion).toBe(before.identityVersion);
      }

      // 3) Generation fence & disconnected protection: stale caller version or disconnected row MUST NOT be mutated
      {
        const userFence = await db.person('user-r2-fence');
        const seededGen = await db.seedConnection({
          userId: userFence.id,
          sessionId: userFence.sid,
          encryptionKey: ENC_KEY,
          appId: 'notion-app-1',
          accessToken: 'syn_r2_fence_tok',
          refreshToken: 'syn_r2_fence_ref',
        });
        await db.pool.query(
          `UPDATE notion_connections
              SET status = 'reconnect_required',
                  auth_failure_code = 'refresh_retryable',
                  refresh_in_flight = true,
                  identity_version = identity_version + 1
            WHERE id = $1`,
          [seededGen.id],
        );
        const genBefore = (await db.inspectRow(seededGen.id))!;
        const client = new NotionOAuthClient(loopback.oauthConfig('notion-app-1'));
        const manager = new NotionTokenManager(db.repo, client, ENC_KEY);

        // Stale version (genBefore.identityVersion - 1) must not touch newer generation row
        await expect(
          manager.checkConnection(userFence.id, seededGen.id, genBefore.identityVersion - 1, async () => {}),
        ).rejects.toBeInstanceOf(NotionOAuthError);
        await expect(
          manager.execute(userFence.id, seededGen.id, genBefore.identityVersion - 1, async () => 'no'),
        ).rejects.toBeInstanceOf(NotionOAuthError);

        const genAfter = (await db.inspectRow(seededGen.id))!;
        expect(genAfter.xmin).toBe(genBefore.xmin);
        expect(genAfter.authFailureCode).toBe('refresh_retryable');
        expect(genAfter.refreshInFlight).toBe(true);
        expect(genAfter.identityVersion).toBe(genBefore.identityVersion);

        // Disconnected row must never be touched by checkConnection or execute
        const userDisc = await db.person('user-r2-disc');
        const seededDisc = await db.seedConnection({
          userId: userDisc.id,
          sessionId: userDisc.sid,
          encryptionKey: ENC_KEY,
          appId: 'notion-app-1',
        });
        await db.repo.disconnect(userDisc.id, seededDisc.id);
        const discBefore = (await db.inspectRow(seededDisc.id))!;
        expect(discBefore.status).toBe('disconnected');

        await expect(
          manager.checkConnection(userDisc.id, seededDisc.id, discBefore.identityVersion, async () => {}),
        ).rejects.toBeInstanceOf(NotionOAuthError);
        await expect(
          manager.execute(userDisc.id, seededDisc.id, discBefore.identityVersion, async () => 'no'),
        ).rejects.toBeInstanceOf(NotionOAuthError);

        const discAfter = (await db.inspectRow(seededDisc.id))!;
        expect(discAfter.xmin).toBe(discBefore.xmin);
        expect(discAfter.status).toBe('disconnected');
        expect(discAfter.authFailureCode).toBeNull();
      }
    });

    it('R3-A: execute() post-commit lost acknowledgement (real PG save UPDATE commits, PoolClient.query wrapper throws after commit) never dispatches unacknowledged token and subsequent call uses verified persisted PG state with 0 extra refreshes', async () => {
      const wsId = randomUUID();
      const actorId = randomUUID();
      const botId = randomUUID();
      const user = await db.person('user-r3-exec-postcommit');
      const seeded = await db.seedConnection({
        userId: user.id,
        sessionId: user.sid,
        encryptionKey: ENC_KEY,
        appId: 'notion-app-1',
        workspaceId: wsId,
        actorId,
        botId,
        accessToken: 'syn_r3_old_exec',
        refreshToken: 'syn_r3_old_ref_exec',
      });
      const before = (await db.inspectRow(seeded.id))!;

      loopback.clearRoutes();
      loopback.resetLedger();
      loopback.enqueue('POST', '/oauth/token', {
        kind: 'json',
        status: 200,
        body: {
          access_token: 'syn_r3_committed_exec',
          refresh_token: 'syn_r3_committed_ref_exec',
          workspace_id: wsId,
          workspace_name: 'Committed WS',
          bot_id: botId,
          owner: { type: 'user', user: { id: actorId } },
        },
      });
      loopback.enqueue('GET', '/users/me', {
        kind: 'json',
        status: 200,
        body: { object: 'user', type: 'bot', id: botId },
      });

      let committedRowCount = 0;
      let poolConnectCount = 0;
      // Boundary: real PostgreSQL PoolClient.query executes and commits the token-save UPDATE,
      // then the query wrapper throws before returning acknowledgement to NotionTokenManager.
      const postCommitLostAckRepo = new Proxy(db.repo, {
        get(target, prop, receiver) {
          if (prop === 'withOwner') {
            return async (uId: string, action: (client: pg.PoolClient) => Promise<unknown>) => {
              poolConnectCount++;
              return target.withOwner(uId, async (realClient) => {
                const origQuery = realClient.query.bind(realClient);
                const wrappedClient = new Proxy(realClient, {
                  get(cTarget, cProp) {
                    if (cProp === 'query') {
                      return async (sql: any, params?: any) => {
                        const text = typeof sql === 'string' ? sql : String(sql?.text ?? '');
                        if (
                          /UPDATE\s+notion_connections/i.test(text) &&
                          /workspace_name\s*=/i.test(text) &&
                          /refresh_in_flight\s*=\s*false/i.test(text)
                        ) {
                          const realRes = await origQuery(sql, params);
                          committedRowCount = realRes.rowCount ?? 0;
                          throw new Error(
                            'ECONNRESET: simulated lost PG response after token-save UPDATE committed',
                          );
                        }
                        return origQuery(sql, params);
                      };
                    }
                    return Reflect.get(cTarget, cProp);
                  },
                });
                return action(wrappedClient);
              });
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });

      const client = new NotionOAuthClient(loopback.oauthConfig('notion-app-1'));
      const faultedManager = new NotionTokenManager(postCommitLostAckRepo, client, ENC_KEY);

      const seenTokens: string[] = [];
      await expect(
        faultedManager.execute(user.id, seeded.id, seeded.identity_version, async (tok) => {
          seenTokens.push(tok);
          if (tok === 'syn_r3_old_exec') throw new NotionOAuthError('HTTP 401', true);
          return 'UNACKNOWLEDGED_TOKEN_MUST_NEVER_DISPATCH';
        }),
      ).rejects.toMatchObject({
        reason: 'rotation_unknown',
        requestState: 'possibly_sent',
      });

      expect(committedRowCount).toBe(1);
      expect(seenTokens).toEqual(['syn_r3_old_exec']);
      expect(poolConnectCount).toBe(1);
      expect(loopback.countPath('/oauth/token')).toBe(1);

      // Independent PG inspection confirms replacement credentials committed durably in PostgreSQL
      const committedState = (await db.inspectRow(seeded.id))!;
      expect(committedState.status).toBe('active');
      expect(committedState.refreshInFlight).toBe(false);
      expect(committedState.authFailureCode).toBeNull();
      expect(committedState.configPresent).toBe(true);
      expect(committedState.configFingerprint).not.toBe(before.configFingerprint);

      // Subsequent invocation reads verified persisted PG state directly — 0 additional /oauth/token calls!
      const cleanManager = new NotionTokenManager(db.repo, client, ENC_KEY);
      const nextOut = await cleanManager.execute(
        user.id,
        seeded.id,
        seeded.identity_version,
        async (tok) => fingerprintSecret(tok),
      );
      expect(nextOut).toBe(fingerprintSecret('syn_r3_committed_exec'));
      expect(loopback.countPath('/oauth/token')).toBe(1);
    });

    it('R3-B: checkConnection() post-commit lost acknowledgement (real PG recovery UPDATE commits, PoolClient.query wrapper throws after commit) rejects with rotation_unknown without invoking verifyFn and subsequent check/execute uses verified persisted PG state with 0 extra refreshes', async () => {
      const wsId = randomUUID();
      const actorId = randomUUID();
      const botId = randomUUID();
      const user = await db.person('user-r3-check-postcommit');
      const seeded = await db.seedConnection({
        userId: user.id,
        sessionId: user.sid,
        encryptionKey: ENC_KEY,
        appId: 'notion-app-1',
        workspaceId: wsId,
        actorId,
        botId,
        accessToken: 'syn_r3_old_check',
        refreshToken: 'syn_r3_old_ref_check',
      });
      await db.pool.query(
        `UPDATE notion_connections
            SET status = 'reconnect_required',
                auth_failure_code = 'refresh_retryable',
                refresh_in_flight = false
          WHERE id = $1`,
        [seeded.id],
      );
      const before = (await db.inspectRow(seeded.id))!;

      loopback.clearRoutes();
      loopback.resetLedger();
      loopback.enqueue('POST', '/oauth/token', {
        kind: 'json',
        status: 200,
        body: {
          access_token: 'syn_r3_committed_check',
          refresh_token: 'syn_r3_committed_ref_check',
          workspace_id: wsId,
          workspace_name: 'Recovered WS',
          bot_id: botId,
          owner: { type: 'user', user: { id: actorId } },
        },
      });
      loopback.enqueue('GET', '/users/me', {
        kind: 'json',
        status: 200,
        body: { object: 'user', type: 'bot', id: botId },
      });

      let committedRowCount = 0;
      const postCommitCheckRepo = new Proxy(db.repo, {
        get(target, prop, receiver) {
          if (prop === 'withOwner') {
            return async (uId: string, action: (client: pg.PoolClient) => Promise<unknown>) =>
              target.withOwner(uId, async (realClient) => {
                const origQuery = realClient.query.bind(realClient);
                const wrappedClient = new Proxy(realClient, {
                  get(cTarget, cProp) {
                    if (cProp === 'query') {
                      return async (sql: any, params?: any) => {
                        const text = typeof sql === 'string' ? sql : String(sql?.text ?? '');
                        if (
                          /UPDATE\s+notion_connections/i.test(text) &&
                          /SET\s+status\s*=\s*'active'/i.test(text)
                        ) {
                          const realRes = await origQuery(sql, params);
                          committedRowCount = realRes.rowCount ?? 0;
                          throw new Error(
                            'ECONNRESET: simulated lost PG response after checkConnection UPDATE committed',
                          );
                        }
                        return origQuery(sql, params);
                      };
                    }
                    return Reflect.get(cTarget, cProp);
                  },
                });
                return action(wrappedClient);
              });
          }
          return Reflect.get(target, prop, receiver);
        },
      });

      const client = new NotionOAuthClient(loopback.oauthConfig('notion-app-1'));
      const faultedManager = new NotionTokenManager(postCommitCheckRepo, client, ENC_KEY);

      let verifyInvocations = 0;
      await expect(
        faultedManager.checkConnection(user.id, seeded.id, seeded.identity_version, async () => {
          verifyInvocations++;
        }),
      ).rejects.toMatchObject({
        reason: 'rotation_unknown',
        requestState: 'possibly_sent',
      });

      expect(committedRowCount).toBe(1);
      expect(verifyInvocations).toBe(0);
      expect(loopback.countPath('/oauth/token')).toBe(1);

      const committedState = (await db.inspectRow(seeded.id))!;
      expect(committedState.status).toBe('active');
      expect(committedState.refreshInFlight).toBe(false);
      expect(committedState.authFailureCode).toBeNull();
      expect(committedState.configFingerprint).not.toBe(before.configFingerprint);

      // Subsequent checkConnection delegates to verified persisted active state with 0 additional /oauth/token calls
      const cleanManager = new NotionTokenManager(db.repo, client, ENC_KEY);
      const verifiedFingerprints: Array<string | null> = [];
      const checkOut = await cleanManager.checkConnection(
        user.id,
        seeded.id,
        seeded.identity_version,
        async (tok) => {
          verifiedFingerprints.push(fingerprintSecret(tok));
        },
      );
      expect(checkOut).toEqual({ recovered: false });
      expect(verifiedFingerprints).toEqual([fingerprintSecret('syn_r3_committed_check')]);
      expect(loopback.countPath('/oauth/token')).toBe(1);
    });
  });

  describe('4. Genuine PostgreSQL concurrency, pg_locks serialization & fenced stale-refresh barriers', () => {
    it('handles two concurrent 403 callers with zero refresh calls and active credentials preserved', async () => {
      const alice = await db.person('alice-conc-403');
      const seeded = await db.seedConnection({
        userId: alice.id,
        sessionId: alice.sid,
        encryptionKey: ENC_KEY,
        appId: 'notion-app-1',
        accessToken: 'syn_conc_403_tok',
        refreshToken: 'syn_conc_403_ref',
        databases: [{ id: PERMITTED_DB, title: 'Ops' }],
      });
      const before = (await db.inspectRow(seeded.id))!;

      loopback.clearRoutes();
      loopback.enqueue(
        'GET',
        `/databases/${FORBIDDEN_DB}`,
        { kind: 'json', status: 403, body: { object: 'error', status: 403, code: 'restricted_resource' } },
        { kind: 'json', status: 403, body: { object: 'error', status: 403, code: 'restricted_resource' } },
      );

      const client = new NotionOAuthClient(loopback.oauthConfig('notion-app-1'));
      const manager = new NotionTokenManager(db.repo, client, ENC_KEY);

      const results = await Promise.allSettled([
        manager.execute(alice.id, seeded.id, seeded.identity_version, (tok) =>
          client.validateDatabases(tok, [FORBIDDEN_DB], AbortSignal.timeout(3000)),
        ),
        manager.execute(alice.id, seeded.id, seeded.identity_version, (tok) =>
          client.validateDatabases(tok, [FORBIDDEN_DB], AbortSignal.timeout(3000)),
        ),
      ]);

      expect(results[0].status).toBe('rejected');
      expect(results[1].status).toBe('rejected');
      expect(loopback.countPath('/oauth/token')).toBe(0);

      const after = (await db.inspectRow(seeded.id))!;
      expect(after.status).toBe('active');
      expect(after.configFingerprint).toBe(before.configFingerprint);
      expect(after.xmin).toBe(before.xmin);
    });

    it('serializes two concurrent 401 callers via real PostgreSQL advisory lock (pg_locks waiter verified) with single rotation and durable checkpoint', async () => {
      const alice = await db.person('alice-conc-401');
      const wsId = randomUUID();
      const actorId = randomUUID();
      const botId = randomUUID();
      const seeded = await db.seedConnection({
        userId: alice.id,
        sessionId: alice.sid,
        encryptionKey: ENC_KEY,
        appId: 'notion-app-1',
        workspaceId: wsId,
        actorId,
        botId,
        accessToken: 'syn_conc_expired_gen1',
        refreshToken: 'syn_conc_refresh_gen1',
      });

      const refreshEntered = createDeferred<void>();
      const releaseRefresh = createDeferred<void>();
      let checkpointWhileLocked: InspectedNotionRow | null = null;

      loopback.clearRoutes();
      loopback.enqueue('POST', '/oauth/token', {
        kind: 'json',
        status: 200,
        onRequest: async () => {
          checkpointWhileLocked = await db.inspectRow(seeded.id);
          refreshEntered.resolve();
          await releaseRefresh.promise;
        },
        body: {
          access_token: 'syn_conc_fresh_gen2',
          refresh_token: 'syn_conc_refresh_gen2',
          workspace_id: wsId,
          workspace_name: 'Serialized WS',
          bot_id: botId,
          owner: { type: 'user', user: { id: actorId } },
        },
      });
      loopback.enqueue('GET', '/users/me', {
        kind: 'json',
        status: 200,
        body: { object: 'user', type: 'bot', id: botId },
      });

      const client = new NotionOAuthClient(loopback.oauthConfig('notion-app-1'));
      const manager = new NotionTokenManager(db.repo, client, ENC_KEY);

      const op = async (tok: string) => {
        if (tok === 'syn_conc_expired_gen1') {
          throw new NotionOAuthError('HTTP 401', true);
        }
        return fingerprintSecret(tok);
      };

      const call1 = manager.execute(alice.id, seeded.id, seeded.identity_version, op);
      let call2: Promise<string | null> | undefined;
      try {
        await refreshEntered.promise;

        // Launch concurrent second 401 caller while call1 holds owner advisory lock inside /oauth/token
        call2 = manager.execute(alice.id, seeded.id, seeded.identity_version, op);

        const lockSnap = await waitForOwnerLockWaiter(db.pool, alice.id);
        expect(lockSnap.grantedCount).toBe(1);
        expect(lockSnap.waitingCount).toBe(1);
        const observedLockedCheckpoint = checkpointWhileLocked as InspectedNotionRow | null;
        expect(observedLockedCheckpoint?.refreshInFlight).toBe(true);
        expect(observedLockedCheckpoint?.authFailureCode).toBe('access_rejected');

        releaseRefresh.resolve();
        const [r1, r2] = await Promise.all([call1, call2]);

        expect(r1).toBe(fingerprintSecret('syn_conc_fresh_gen2'));
        expect(r2).toBe(fingerprintSecret('syn_conc_fresh_gen2'));
        expect(loopback.countPath('/oauth/token')).toBe(1);

        const after = (await db.inspectRow(seeded.id))!;
        expect(after.status).toBe('active');
        expect(after.authFailureCode).toBeNull();
        expect(after.refreshInFlight).toBe(false);
      } finally {
        releaseRefresh.resolve();
        await Promise.allSettled([call1, ...(call2 ? [call2] : [])]);
      }
    });

    it('blocks disconnect on real PostgreSQL owner advisory lock while owner operation is in flight, then commits disconnected state', async () => {
      const alice = await db.person('alice-disc-wait');
      const seeded = await db.seedConnection({
        userId: alice.id,
        sessionId: alice.sid,
        encryptionKey: ENC_KEY,
        appId: 'notion-app-1',
        accessToken: 'syn_disc_wait_tok',
        refreshToken: 'syn_disc_wait_ref',
      });
      const vBefore = seeded.identity_version;

      const opHoldingLock = createDeferred<void>();
      const releaseOp = createDeferred<void>();

      const client = new NotionOAuthClient(loopback.oauthConfig('notion-app-1'));
      const manager = new NotionTokenManager(db.repo, client, ENC_KEY);

      const inFlightExec = manager.execute(alice.id, seeded.id, vBefore, async () => {
        opHoldingLock.resolve();
        await releaseOp.promise;
        return 'completed-before-disconnect';
      });

      await opHoldingLock.promise;

      let disconnectFinished = false;
      const disconnectPromise = db.repo.disconnect(alice.id, seeded.id).then((res) => {
        disconnectFinished = true;
        return res;
      });

      // Verify disconnect is genuinely waiting in pg_locks on the advisory lock!
      const lockSnap = await waitForOwnerLockWaiter(db.pool, alice.id);
      expect(lockSnap.grantedCount).toBe(1);
      expect(lockSnap.waitingCount).toBe(1);
      expect(disconnectFinished).toBe(false);

      releaseOp.resolve();
      expect(await inFlightExec).toBe('completed-before-disconnect');
      await disconnectPromise;
      expect(disconnectFinished).toBe(true);

      const after = (await db.inspectRow(seeded.id))!;
      expect(after.status).toBe('disconnected');
      expect(after.configPresent).toBe(false);
      expect(after.identityVersion).toBe(vBefore + 1);
      expect(after.authFailureCode).toBeNull();
    });

    it('fences stale refresh (both succeeding and failing) so it cannot dispatch tokens or overwrite disconnected/reconnected state', async () => {
      const wsId = randomUUID();
      const actorId = randomUUID();
      const botId = randomUUID();

      // Helper creating a repo wrapper that releases advisory lock right when /oauth/token starts so a concurrent
      // disconnect/reconnect transaction can commit on PG before the stale refresh reaches its fenced SQL UPDATE!
      const makeSplitLockRepo = (onTokenEnterUnlockUserId: string) => {
        let holderClient: pg.PoolClient | null = null;
        return {
          repo: new Proxy(db.repo, {
            get(target, prop, receiver) {
              if (prop === 'withOwner') {
                return async (uId: string, action: (c: pg.PoolClient) => Promise<unknown>) =>
                  target.withOwner(uId, async (c) => {
                    holderClient = c;
                    return action(c);
                  });
              }
              return Reflect.get(target, prop, receiver);
            },
          }),
          releaseEarly: async () => {
            if (holderClient) {
              await holderClient.query("SELECT pg_advisory_unlock(hashtext('ati-notion-owner'),hashtext($1))", [
                onTokenEnterUnlockUserId,
              ]);
            }
          },
        };
      };

      // Case 1: Stale refresh returns 200 AFTER concurrent disconnect committed
      {
        const user = await db.person('user-stale-after-disc');
        const seeded = await db.seedConnection({
          userId: user.id,
          sessionId: user.sid,
          encryptionKey: ENC_KEY,
          appId: 'notion-app-1',
          workspaceId: wsId,
          actorId,
          botId,
          accessToken: 'syn_stale_disc_old',
          refreshToken: 'syn_stale_disc_ref',
        });

        const split = makeSplitLockRepo(user.id);
        loopback.clearRoutes();
        loopback.enqueue('POST', '/oauth/token', {
          kind: 'json',
          status: 200,
          onRequest: async () => {
            await split.releaseEarly();
            // Concurrent real disconnect commits status='disconnected', config=NULL, identity_version+1
            await db.repo.disconnect(user.id, seeded.id);
          },
          body: {
            access_token: 'syn_stale_disc_fresh_must_drop',
            refresh_token: 'syn_stale_disc_ref2',
            workspace_id: wsId,
            workspace_name: 'WS',
            bot_id: botId,
            owner: { type: 'user', user: { id: actorId } },
          },
        });
        loopback.enqueue('GET', '/users/me', {
          kind: 'json',
          status: 200,
          body: { object: 'user', type: 'bot', id: botId },
        });

        const client = new NotionOAuthClient(loopback.oauthConfig('notion-app-1'));
        const manager = new NotionTokenManager(split.repo, client, ENC_KEY);

        const seenTokens: string[] = [];
        await expect(
          manager.execute(user.id, seeded.id, seeded.identity_version, async (tok) => {
            seenTokens.push(tok);
            if (tok === 'syn_stale_disc_old') throw new NotionOAuthError('HTTP 401', true);
            return 'STALE_TOKEN_LEAKED';
          }),
        ).rejects.toBeInstanceOf(NotionOAuthError);

        expect(seenTokens).toEqual(['syn_stale_disc_old']);
        const after = (await db.inspectRow(seeded.id))!;
        expect(after.status).toBe('disconnected');
        expect(after.configPresent).toBe(false);
        expect(after.identityVersion).toBe(seeded.identity_version + 1);
      }

      // Case 2: Stale refresh FAILS (503) AFTER concurrent reconnect committed new version & fresh ciphertext
      {
        const wsId2 = randomUUID();
        const actorId2 = randomUUID();
        const botId2 = randomUUID();
        const user = await db.person('user-stale-fail-after-reconn');
        const seeded = await db.seedConnection({
          userId: user.id,
          sessionId: user.sid,
          encryptionKey: ENC_KEY,
          appId: 'notion-app-1',
          workspaceId: wsId2,
          actorId: actorId2,
          botId: botId2,
          accessToken: 'syn_v1_old',
          refreshToken: 'syn_v1_ref',
        });

        const split = makeSplitLockRepo(user.id);
        let reconnectedFingerprint: string | null = null;

        loopback.clearRoutes();
        loopback.enqueue('POST', '/oauth/token', {
          kind: 'json',
          status: 503,
          onRequest: async () => {
            await split.releaseEarly();
            // User completes fresh OAuth reconnect -> increments identity_version and stores fresh v2 credentials
            await db.repo.start({
              userId: user.id,
              sessionId: user.sid,
              stateHash: NotionConnectionRepo.hash('reconn-s'),
              browserHash: NotionConnectionRepo.hash('reconn-b'),
            });
            const consumed = (await db.repo.consume({
              userId: user.id,
              sessionId: user.sid,
              state: 'reconn-s',
              browser: 'reconn-b',
            }))!;
            const v2Cipher = encryptCredentials(
              { accessToken: 'syn_v2_reconnected', refreshToken: 'syn_v2_ref', botId: botId2 },
              ENC_KEY,
            );
            reconnectedFingerprint = fingerprintSecret(v2Cipher);
            await db.repo.save(user.id, consumed.id, {
              appId: 'notion-app-1',
              workspaceId: wsId2,
              workspaceName: 'Reconnected WS',
              actorId: actorId2,
              botId: botId2,
              config: v2Cipher,
              scopes: ['read_content'],
            });
          },
          body: { object: 'error', status: 503, code: 'service_unavailable' },
        });

        const client = new NotionOAuthClient(loopback.oauthConfig('notion-app-1'));
        const manager = new NotionTokenManager(split.repo, client, ENC_KEY);

        await expect(
          manager.execute(user.id, seeded.id, seeded.identity_version, async () => {
            throw new NotionOAuthError('HTTP 401', true);
          }),
        ).rejects.toBeInstanceOf(NotionOAuthError);

        // Stale v1 failure MUST NOT clobber v2 reconnected active row or wipe v2 ciphertext!
        const after = (await db.inspectRow(seeded.id))!;
        expect(after.status).toBe('active');
        expect(after.identityVersion).toBe(seeded.identity_version + 1);
        expect(after.authFailureCode).toBeNull();
        expect(after.refreshInFlight).toBe(false);
        expect(after.configPresent).toBe(true);
        expect(after.configFingerprint).toBe(reconnectedFingerprint);
      }
    });

    it('R4: destroys lock-bearing pooled PostgreSQL client on failed/false pg_advisory_unlock (proven via real pg_backend_pid() and pg_locks) so next borrower gets a fresh backend session and other sessions acquire the owner lock deterministically', async () => {
      const userA = await db.person('user-r4-aborted-tx-unlock');
      const userB = await db.person('user-r4-false-unlock');
      const singleSessionPool = new pg.Pool({
        connectionString: db.schemaDatabaseUrl,
        max: 1,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5000,
      });

      try {
        const singleRepo = new NotionConnectionRepo(singleSessionPool);
        const contenderRepo = new NotionConnectionRepo(db.pool);

        // Case 1: Pure real PostgreSQL reproduction (zero mocks/proxies):
        // Aborted transaction inside withOwner causes real PG pg_advisory_unlock to fail with 25P02 while backend session still holds the session-level advisory lock!
        let pid1 = 0;
        let caughtAbortedErr: any;
        try {
          await singleRepo.withOwner(userA.id, async (c) => {
            pid1 = (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
            await c.query('BEGIN');
            await c.query('SELECT 1 / 0'); // SQLSTATE 22012 -> leaves backend session in aborted tx state
          });
        } catch (err) {
          caughtAbortedErr = err;
        }

        // Original action error (22012 division by zero) must be preserved, not masked by unlock 25P02
        expect(caughtAbortedErr).toBeDefined();
        expect(pid1).toBeGreaterThan(0);

        // Poll briefly (up to 400ms) for backend socket teardown on PG side when client.release(err) destroys pid1
        const unlockDeadline = Date.now() + 400;
        while (Date.now() < unlockDeadline) {
          const snap = await inspectOwnerAdvisoryLocks(db.pool, userA.id);
          if (snap.grantedCount === 0) break;
          await new Promise((r) => setTimeout(r, 15));
        }

        const lockedPidsRes = await db.pool.query<{ pid: number; granted: boolean }>(
          `SELECT pid, granted
             FROM pg_locks
            WHERE locktype = 'advisory'
              AND classid = hashtext('ati-notion-owner')
              AND objid = hashtext($1)`,
          [userA.id],
        );
        const lockedPids = lockedPidsRes.rows.filter((r) => r.granted).map((r) => r.pid);
        const locksAfterFailure = await inspectOwnerAdvisoryLocks(db.pool, userA.id);

        // Probe whether another PG session can acquire userA's owner advisory lock right now
        const probeClient = await db.pool.connect();
        let otherSessionAcquired = false;
        try {
          const tryRes = await probeClient.query<{ acquired: boolean }>(
            "SELECT pg_try_advisory_lock(hashtext('ati-notion-owner'),hashtext($1)) AS acquired",
            [userA.id],
          );
          otherSessionAcquired = Boolean(tryRes.rows[0]?.acquired);
          if (otherSessionAcquired) {
            await probeClient.query(
              "SELECT pg_advisory_unlock(hashtext('ati-notion-owner'),hashtext($1))",
              [userA.id],
            );
          }
        } finally {
          probeClient.release();
        }

        // Probe next borrower from singleSessionPool (max: 1)
        const nextBorrowerClient = await singleSessionPool.connect();
        let pid2 = 0;
        let nextBorrowerTaintedByAbortedTx = false;
        try {
          try {
            const r = await nextBorrowerClient.query<{ pid: number }>(
              'SELECT pg_backend_pid() AS pid',
            );
            pid2 = r.rows[0]!.pid;
          } catch {
            nextBorrowerTaintedByAbortedTx = true;
            await nextBorrowerClient.query('ROLLBACK').catch(() => {});
            const r = await nextBorrowerClient.query<{ pid: number }>(
              'SELECT pg_backend_pid() AS pid',
            );
            pid2 = r.rows[0]!.pid;
          }
        } finally {
          nextBorrowerClient.release(
            nextBorrowerTaintedByAbortedTx ? new Error('cleanup tainted borrower') : undefined,
          );
        }

        expect({
          lockedPidsAfterWithOwner: lockedPids,
          grantedCount: locksAfterFailure.grantedCount,
          waitingCount: locksAfterFailure.waitingCount,
          reusedSamePooledBackendPid: pid2 === pid1,
          nextBorrowerTaintedByAbortedTx,
          otherSessionAcquiredDeterministically: otherSessionAcquired,
          preservedOriginalErrorCode: String(caughtAbortedErr?.code ?? ''),
        }).toEqual({
          lockedPidsAfterWithOwner: [],
          grantedCount: 0,
          waitingCount: 0,
          reusedSamePooledBackendPid: false,
          nextBorrowerTaintedByAbortedTx: false,
          otherSessionAcquiredDeterministically: true,
          preservedOriginalErrorCode: '22012',
        });
        expect(pid2).toBeGreaterThan(0);

        // Full contenderRepo.withOwner(userA.id, ...) acquires and releases userA's owner lock deterministically
        let contenderPid = 0;
        const contenderOut = await contenderRepo.withOwner(userA.id, async (c) => {
          contenderPid = (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
          const midLocks = await inspectOwnerAdvisoryLocks(db.pool, userA.id);
          expect(midLocks.grantedCount).toBe(1);
          return 'contender-acquired';
        });
        expect(contenderOut).toBe('contender-acquired');
        expect(contenderPid).not.toBe(pid1);
        expect((await inspectOwnerAdvisoryLocks(db.pool, userA.id)).grantedCount).toBe(0);

        // Case 2: Unlock returning unlocked=false after action succeeds must throw unlock error AND destroy pooled client
        let pid3 = 0;
        await expect(
          singleRepo.withOwner(userB.id, async (c) => {
            pid3 = (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
            // Release advisory lock prematurely so withOwner's finally observes pg_advisory_unlock(...) = false
            await c.query("SELECT pg_advisory_unlock(hashtext('ati-notion-owner'),hashtext($1))", [
              userB.id,
            ]);
            return 'action-ok-but-unlock-false';
          }),
        ).rejects.toThrow(/advisory_unlock|owner lock/i);

        const postFalseBorrower = await singleSessionPool.connect();
        let pid4 = 0;
        try {
          pid4 = (await postFalseBorrower.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
            .pid;
        } finally {
          postFalseBorrower.release();
        }
        expect(pid4).toBeGreaterThan(0);
        expect(pid4).not.toBe(pid3);
        expect((await inspectOwnerAdvisoryLocks(db.pool, userB.id)).grantedCount).toBe(0);
      } finally {
        await singleSessionPool.end().catch(() => {});
      }
    });
  });
});
