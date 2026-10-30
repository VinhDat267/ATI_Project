import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { encryptCredentials } from '@wap/tool-adapters';
import {
  validateSlackPolicyReference,
  type SlackBinding,
  type SlackPolicyReference,
} from '@wap/tool-schemas';
import { createMigratedSchema } from './gmail-test-db.js';
import { SlackConsentRepo } from '../../src/db/repositories/slack-consent-repo.js';
import { SlackConnectionRepo, type SlackConnectionRow } from '../../src/db/repositories/slack-connection-repo.js';
import {
  SlackInvalidationService,
  type InvalidationEffect,
} from '../../src/services/slack/slack-invalidation-service.js';
import { SlackPolicyService } from '../../src/services/slack/policy-service.js';
import { SlackTokenManager } from '../../src/services/slack/token-manager.js';
import { SlackOAuthClient } from '../../src/services/slack/oauth-client.js';
import { resolveRuntimeProviderIdentity } from '../../src/config/slack-policy-runtime.js';
import {
  SlackPrivateReadWrapper,
  type SlackPrivateReadWrapperDeps,
} from '../../src/services/slack/slack-private-read-wrapper.js';

export const TEST_KEY = '0123456789abcdef0123456789abcdef';

export const TEST_ENV: Record<string, string> = {
  LLM_PROVIDER: 'gemini',
  GEMINI_MODEL: 'gemini-2.5-flash',
  RUNTIME_ACCOUNT_ID: 'TEST_SLACK_READ_ACCOUNT',
};

export const READ_PURPOSES = ['manual_lookup', 'triage', 'planning', 'digest'] as const;

export interface FixtureRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  authorization: string | undefined;
  body: string;
}

export interface FixtureReply {
  status?: number;
  headers?: Record<string, string>;
  body: unknown;
}

export type FixtureHandler = (request: FixtureRequest) => FixtureReply | Promise<FixtureReply>;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('fixture waitFor timed out');
    await sleep(5);
  }
}

/**
 * A real loopback HTTP server for both the OAuth refresh endpoint and the eight Slack GET
 * endpoints. It records every request so tests can prove that a denied invocation never
 * reached the network.
 */
export class SlackHttpFixture {
  readonly requests: FixtureRequest[] = [];
  refreshCalls = 0;
  private readonly handlers = new Map<string, FixtureHandler>();
  private server: Server | undefined;
  private port = 0;

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => {
        this.server!.off('error', reject);
        this.port = (this.server!.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  get gets(): FixtureRequest[] {
    return this.requests.filter((request) => request.method === 'GET');
  }

  setHandler(path: string, handler: FixtureHandler): void {
    this.handlers.set(path, handler);
  }

  clearHandlers(): void {
    this.handlers.clear();
  }

  reset(): void {
    this.requests.length = 0;
    this.refreshCalls = 0;
  }

  async close(): Promise<void> {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
  }

  private async handle(req: IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url);
    let body = '';
    for await (const chunk of req) body += chunk;
    const request: FixtureRequest = {
      method: req.method ?? 'GET',
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
      body,
    };
    this.requests.push(request);
    if (request.path === '/oauth.v2.access') this.refreshCalls += 1;

    const handler = this.handlers.get(request.path) ?? this.defaultHandler;
    let reply: FixtureReply;
    try {
      reply = await handler(request);
    } catch {
      reply = { status: 500, body: { ok: false, error: 'fixture_failure' } };
    }

    res.statusCode = reply.status ?? 200;
    res.setHeader('content-type', 'application/json');
    for (const [key, value] of Object.entries(reply.headers ?? {})) res.setHeader(key, value);
    res.end(JSON.stringify(reply.body));
  }

  private readonly defaultHandler: FixtureHandler = (request) => {
    const q = request.query;
    switch (request.path) {
      case '/oauth.v2.access':
        return {
          body: {
            ok: true,
            token_type: 'user',
            access_token: 'ROTATED_ACCESS',
            refresh_token: 'ROTATED_REFRESH',
            expires_in: 43200,
          },
        };
      case '/conversations.list':
        return {
          body: {
            ok: true,
            channels: [{ id: 'C_GENERAL', name: 'general', is_channel: true }],
            response_metadata: { next_cursor: '' },
          },
        };
      case '/conversations.info':
        return { body: { ok: true, channel: { id: q.channel, name: 'general' } } };
      case '/conversations.history':
        return {
          body: {
            ok: true,
            messages: [
              { type: 'message', user: 'U_ALICE_SLACK', text: 'hello', ts: '1712345678.000200' },
            ],
            response_metadata: { next_cursor: '' },
          },
        };
      case '/conversations.replies':
        return {
          body: {
            ok: true,
            messages: [
              { type: 'message', user: 'U_ALICE_SLACK', text: 'root', ts: q.ts },
              {
                type: 'message',
                user: 'U_ALICE_SLACK',
                text: 'reply',
                ts: '1712345678.000300',
                thread_ts: q.ts,
              },
            ],
            response_metadata: { next_cursor: '' },
          },
        };
      case '/conversations.members':
        return {
          body: { ok: true, members: ['U_ALICE_SLACK', 'U_BOB'], response_metadata: { next_cursor: '' } },
        };
      case '/users.list':
        return {
          body: {
            ok: true,
            members: [
              { id: 'U_ALICE_SLACK', name: 'alice', team_id: 'T_WS_A' },
              { id: 'U_BOB', name: 'bob', team_id: 'T_WS_A' },
            ],
            response_metadata: { next_cursor: '' },
          },
        };
      case '/users.info':
        return { body: { ok: true, user: { id: q.user, name: 'user' } } };
      case '/chat.getPermalink':
        return {
          body: {
            ok: true,
            channel: q.channel,
            permalink: `https://demo.slack.com/archives/${q.channel}/p${(q.message_ts ?? '').replace('.', '')}`,
          },
        };
      default:
        return { status: 404, body: { ok: false, error: 'unknown_method' } };
    }
  };
}

export interface SeedUserOptions {
  name: string;
  workspaceId: string;
  actorId: string;
  workspaceName?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface SeededUser {
  person: { id: string; email: string; name: string; sid: string };
  row: SlackConnectionRow;
  binding: SlackBinding;
}

export interface TokenCall {
  userId: string;
  connectionId: string;
  identityVersion: number;
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export async function createSlackReadEnvironment(prefix: string) {
  const db = await createMigratedSchema(prefix);
  const fixture = new SlackHttpFixture();
  await fixture.start();

  const consentRepo = new SlackConsentRepo(db.pool);
  const invalidationService = new SlackInvalidationService(db.pool);
  const connectionRepo = new SlackConnectionRepo(db.pool, invalidationService);
  const policyService = new SlackPolicyService(db.pool, { env: TEST_ENV });
  const oauth = new SlackOAuthClient({
    appId: 'A_TEST',
    clientId: 'CLIENT_TEST',
    clientSecret: 'SECRET_TEST',
    redirectUri: 'https://ati.example/connections/myslack/callback',
    authorizationUrl: 'https://slack.com/oauth/v2/authorize',
    apiBaseUrl: fixture.url,
  });
  const tokenManager = new SlackTokenManager(connectionRepo, oauth, TEST_KEY);
  const runtimeIdentity = resolveRuntimeProviderIdentity(TEST_ENV);
  const consentedWorkspaces = new Set<string>();

  await consentRepo.attestProvider({
    id: runtimeIdentity.providerId,
    name: runtimeIdentity.name,
    verified: true,
    noTraining: true,
    maxRetentionDays: 30,
    configurationFingerprint: runtimeIdentity.fingerprint,
    evidenceRef: 'EVID-SLACK-READ-01',
    verifiedBy: 'security-officer@example.com',
    verifiedAt: new Date(),
  });

  async function ensureConsent(workspaceId: string): Promise<void> {
    if (consentedWorkspaces.has(workspaceId)) return;
    const existing = await consentRepo.getConsent(workspaceId, runtimeIdentity.providerId);
    if (!existing) {
      await consentRepo.grantConsent({
        workspaceId,
        providerId: runtimeIdentity.providerId,
        policyVersion: 'v1.0.0',
        purposes: [...READ_PURPOSES],
        retentionDays: 14,
        organizationRepresentative: 'Representative',
        evidenceRef: 'DPA-SLACK-READ-01',
        recordedBy: 'operator@example.com',
      });
    } else if (existing.status !== 'granted') {
      await consentRepo.grantConsent({
        workspaceId,
        providerId: runtimeIdentity.providerId,
        policyVersion: 'v1.0.0',
        purposes: [...READ_PURPOSES],
        retentionDays: 14,
        organizationRepresentative: 'Representative',
        evidenceRef: 'DPA-SLACK-READ-01',
        recordedBy: 'operator@example.com',
        expectedRevision: existing.revision,
      });
    }
    consentedWorkspaces.add(workspaceId);
  }

  async function connect(
    userId: string,
    sessionId: string,
    options: SeedUserOptions
  ): Promise<SlackConnectionRow> {
    const state = randomBytes(32).toString('base64url');
    const browser = randomBytes(32).toString('base64url');
    await connectionRepo.start({
      userId,
      sessionId,
      stateHash: hash(state),
      browserHash: hash(browser),
    });
    const consumed = await connectionRepo.consume({ userId, sessionId, state, browser });
    if (!consumed) throw new Error('fixture OAuth state was not consumed');

    const accessToken = options.accessToken ?? `xoxp-${options.name}-token`;
    const refreshToken = options.refreshToken ?? `xoxp-refresh-${options.name}`;
    const config = encryptCredentials(
      {
        accessToken,
        refreshToken,
        expiresAt: options.expiresAt ?? Date.now() + 3_600_000,
      },
      TEST_KEY
    );
    const saved = await connectionRepo.save(userId, consumed.id, {
      appId: 'A_TEST',
      workspaceId: options.workspaceId,
      workspaceName: options.workspaceName ?? 'Workspace',
      actorId: options.actorId,
      config,
      scopes: [],
    });
    if (!saved) throw new Error('fixture Slack connection was not saved');
    return saved;
  }

  function bindingOf(row: SlackConnectionRow): SlackBinding {
    return {
      atiUserId: row.user_id,
      connectionId: row.id,
      workspaceId: row.workspace_id,
      slackUserId: row.actor_id,
      identityVersion: row.identity_version,
    };
  }

  async function addUser(options: SeedUserOptions): Promise<SeededUser> {
    const person = await db.person(options.name);
    const row = await connect(person.id, person.sid, options);
    await ensureConsent(options.workspaceId);
    return { person, row, binding: bindingOf(row) };
  }

  async function reconnect(
    seeded: SeededUser,
    options?: Partial<Pick<SeedUserOptions, 'accessToken' | 'refreshToken' | 'expiresAt'>>
  ): Promise<SeededUser> {
    const row = await connect(seeded.person.id, seeded.person.sid, {
      name: seeded.person.name,
      workspaceId: seeded.row.workspace_id,
      actorId: seeded.row.actor_id,
      workspaceName: seeded.row.workspace_name,
      ...options,
    });
    return { person: seeded.person, row, binding: bindingOf(row) };
  }

  async function stageBarriers(
    effects: InvalidationEffect[],
    sourceEventKey = `test:${randomUUID()}`
  ): Promise<void> {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await invalidationService.stageInTransaction(client, { sourceEventKey, effects });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function clearBarriers(): Promise<void> {
    await db.pool.query('DELETE FROM slack_invalidation_barriers');
  }

  async function canonicalRef(
    binding: SlackBinding,
    purpose: (typeof READ_PURPOSES)[number] = 'manual_lookup'
  ): Promise<SlackPolicyReference> {
    const decision = await policyService.resolveSlackModelPolicy({
      binding,
      purpose,
      requestedRetentionDays: 0,
      env: TEST_ENV,
    });
    if (!decision.allowed) throw new Error(`fixture policy denied: ${decision.reason}`);
    return validateSlackPolicyReference(decision.policyReference);
  }

  function buildWrapper(overrides: Partial<SlackPrivateReadWrapperDeps> = {}) {
    const tokenCalls: TokenCall[] = [];
    const wrapper = new SlackPrivateReadWrapper({
      policyService,
      tokenManager: {
        getAccessToken: async (userId: string, connectionId: string, identityVersion: number) => {
          tokenCalls.push({ userId, connectionId, identityVersion });
          return tokenManager.getAccessToken(userId, connectionId, identityVersion);
        },
      },
      invalidationService,
      ownerGate: connectionRepo,
      runtimeConfig: { env: { ...TEST_ENV, MYSLACK_ENABLED: 'on' } },
      apiBaseUrl: fixture.url,
      requestTimeoutMs: 4_000,
      deadlineMs: 4_000,
      ...overrides,
    });
    return { wrapper, tokenCalls };
  }

  async function close(): Promise<void> {
    await fixture.close();
    await db.close();
  }

  return {
    db,
    fixture,
    consentRepo,
    invalidationService,
    connectionRepo,
    policyService,
    tokenManager,
    runtimeIdentity,
    addUser,
    reconnect,
    stageBarriers,
    clearBarriers,
    canonicalRef,
    buildWrapper,
    close,
  };
}

export type SlackReadEnvironment = Awaited<ReturnType<typeof createSlackReadEnvironment>>;
