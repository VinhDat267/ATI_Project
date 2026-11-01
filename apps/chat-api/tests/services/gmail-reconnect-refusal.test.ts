import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AIPlanner } from '@wap/planner';
import { createGmailToolAdapter, encryptCredentials } from '@wap/tool-adapters';
import { GMAIL_MODIFY_SCOPE, GMAIL_SERVICE, GMAIL_TOOLS, SERVICE_REGISTRY, SLACK_TOOLS } from '@wap/tool-schemas';
import { startFakeGoogleGmail, type FakeGoogleGmail } from '../../../../scripts/fake-google-gmail.mjs';
import { ChatService } from '../../src/services/chat-service.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { GmailOAuthClient } from '../../src/services/gmail/oauth-client.js';
import { GmailTokenManager } from '../../src/services/gmail/token-manager.js';
import { createGmailConnectionLookup } from '../../src/services/gmail/connection-reference.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

describe('Gmail grant revoked during interactive planning', () => {
  const key = '01234567890123456789012345678901';
  let db: Awaited<ReturnType<typeof createMigratedSchema>>, google: FakeGoogleGmail;
  let credentials: CredentialRepo;
  beforeAll(async () => {
    db = await createMigratedSchema('gmail_reconnect_refusal');
    google = await startFakeGoogleGmail();
    credentials = new CredentialRepo(db.pool);
  });
  afterAll(async () => { await google?.close(); await db?.close(); });
  beforeEach(() => {
    google.settings.refresh = 'ok';
    google.stats.refreshes = 0;
    google.stats.writes = 0;
    google.stats.apiRequests.length = 0;
  });

  async function run(nonGmail = false, followup: 'throw' | 'clarification' = 'throw') {
    const person = await db.person();
    const refreshToken = google.mintRefreshToken();
    const saved = await credentials.saveCredentials('gmail', encryptCredentials({
      refreshToken, email: person.email, scopes: [GMAIL_MODIFY_SCOPE],
    }, key), person.id);
    if (nonGmail) await credentials.markReconnectRequired('gmail', person.id, saved.id);
    const client = new GmailOAuthClient({ clientId: 'gmail-test.apps.googleusercontent.com', clientSecret: 'fake-gmail-secret',
      redirectUri: 'http://127.0.0.1:5174/connections/gmail/callback', ...google.endpoints });
    const tokens = new GmailTokenManager({ client, credentials }).forConnection(person.id, saved.id, refreshToken);
    const adapter = createGmailToolAdapter({ tokens, baseUrl: google.origin });
    let modelCalls = 0;
    const planner = new AIPlanner({
      provider: { name: 'fixture', generatePlan: async () => {
        if (++modelCalls === 1) return JSON.stringify({ kind: 'search', calls: [{
          tool: nonGmail ? 'slack.search_channels' : 'gmail.search_threads',
          args: nonGmail ? { query: 'frontend' } : { query: 'is:unread', limit: 1 },
        }] });
        if (followup === 'clarification') return JSON.stringify({ kind: 'clarification', question: 'Bạn muốn xem thư nào?', context: '' });
        throw new Error('Private provider failure must not reach the user');
      } },
      toolCatalog: nonGmail ? SLACK_TOOLS : GMAIL_TOOLS,
      serviceRegistry: [...SERVICE_REGISTRY, GMAIL_SERVICE], searchMode: 'llm', readAnswers: true, prefetchDirectory: false,
      gatherSearch: async ({ tool, args, signal }) => {
        if (nonGmail) throw new Error('Slack search unavailable');
        return adapter.execute(tool, args, { signal });
      },
    });
    const conversations = new ConversationRepo(db.pool), messages = new MessageRepo(db.pool);
    const conversation = await conversations.createConversation(person.id);
    const events: Array<{ event: string; payload: any }> = [];
    let resolveTerminal!: (value: { event: string; payload: any }) => void;
    const terminal = new Promise<{ event: string; payload: any }>(resolve => { resolveTerminal = resolve; });
    const chat = new ChatService({ msgRepo: messages, convRepo: conversations, planRepo: new PlanRepo(db.pool), planner,
      gmailConnection: createGmailConnectionLookup(credentials, key),
      eventEmitter: { emit: (event, payload) => {
        events.push({ event, payload });
        if (['refusal', 'error', 'answer', 'clarification', 'plan'].includes(event)) resolveTerminal({ event, payload });
      } },
    });
    const ingestion = await chat.handleUserMessage({ conversationId: conversation.id, userId: person.id,
      content: nonGmail ? 'Xem kênh Slack' : 'Cho tôi biết có bao nhiêu thư Gmail chưa đọc.', requestId: 'reconnect-request' });
    const outcome = await terminal;
    const history = await messages.listMessages(conversation.id);
    const plans = (await db.pool.query('SELECT * FROM plans WHERE conv_id=$1', [conversation.id])).rows;
    const status = (await credentials.getPersonalConnectionStatus('gmail', person.id))?.status;
    return { outcome, history, plans, status, events, ingestion, modelCalls, refreshToken };
  }

  it.each(['throw', 'clarification'] as const)('persists a reconnect refusal after real invalid_grant instead of model %s, preserving correlation and idle', async followup => {
    google.settings.refresh = 'invalid_grant';
    const result = await run(false, followup);
    expect(result.status).toBe('reconnect_required');
    expect(google.stats.refreshes).toBe(1);
    expect(result.modelCalls).toBe(2);
    expect(result.outcome).toMatchObject({ event: 'refusal', payload: {
      reason: expect.stringContaining('kết nối lại'), unavailableServices: [{ id: 'gmail', name: 'Gmail' }],
      replyToMessageId: result.ingestion.messageId, requestId: 'reconnect-request',
    } });
    expect(result.history.find(row => row.metadata?.type === 'refusal')).toMatchObject({ role: 'assistant', metadata: {
      unavailableServices: [{ id: 'gmail', name: 'Gmail' }], replyToMessageId: result.ingestion.messageId, requestId: 'reconnect-request',
    } });
    expect(result.history.some(row => row.metadata?.type === 'planning_error')).toBe(false);
    expect(result.events.at(-1)).toMatchObject({ event: 'agent_state', payload: { state: 'idle' } });
    expect(result.plans).toEqual([]);
    expect(google.stats.writes).toBe(0);
    expect(google.stats.apiRequests).toEqual([]);
    expect(JSON.stringify([result.history, result.events])).not.toContain(result.refreshToken);
  });

  it.each(['server_error', 'ok'] as const)('keeps a provider failure generic when Gmail remains active (refresh=%s)', async refresh => {
    google.settings.refresh = refresh;
    const result = await run();
    expect(result.status).toBe('active');
    expect(google.stats.refreshes).toBe(1);
    expect(result.modelCalls).toBe(2);
    expect(result.outcome.event).toBe('error');
    expect(result.history.find(row => row.metadata?.type === 'planning_error')).toBeDefined();
    expect(result.events.some(row => row.event === 'refusal')).toBe(false);
    expect(result.plans).toEqual([]);
    expect(google.stats.writes).toBe(0);
  });

  it('does not blame a disconnected Gmail connection for an unrelated Slack planning failure', async () => {
    const result = await run(true);
    expect(result.status).toBe('reconnect_required');
    expect(google.stats.refreshes).toBe(0);
    expect(result.modelCalls).toBe(2);
    expect(result.outcome.event).toBe('error');
    expect(result.events.some(row => row.event === 'refusal')).toBe(false);
    expect(result.plans).toEqual([]);
  });
});
