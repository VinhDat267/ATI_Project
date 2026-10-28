import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { createPersonalSheetsAdapter, encryptCredentials } from '@wap/tool-adapters';
import type { PlanResponse } from '@wap/tool-schemas';
import { ChatService, type ChatServiceOptions } from '../../src/services/chat-service.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { createMySheetsConnectionLookup } from '../../src/services/gmail/connection-reference.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { ScheduleRepo } from '../../src/db/repositories/schedule-repo.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const W = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const R = '3DziOXt2ZTC7pHOfMxDfDBliowWsrvndu96QixG4wrpu';
const key = '0123456789abcdef0123456789abcdef';
const selected = [
  { id: W, title: 'Report writable', canEdit: true },
  { id: R, title: 'Report read only', canEdit: false },
];
const plan: PlanResponse = {
  kind: 'plan', thinking: 'Find the report, then append.', summary: 'Append to report', warnings: [],
  steps: [
    { id: 'find', tool: 'mysheets.list_spreadsheets', description: 'Find report', args: { query: 'Report', limit: 1 }, dependsOn: [] },
    { id: 'append', tool: 'mysheets.append_rows', description: 'Append row',
      args: { spreadsheetId: { $ref: 'find.output.0.id' }, sheet: 'Sheet1', rows: [['test']] }, dependsOn: ['find'] },
  ],
};

describe('MySheets planning lookup through PostgreSQL and native HTTP', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let owner: Awaited<ReturnType<typeof db.person>>, credentials: CredentialRepo;
  let server: Server, origin: string, mode: 'ok' | 'hang' | 401 | 503, reads: number;
  let titles: Record<string, string>, events: Array<{ event: string; payload: any }>;
  let dispatched: Promise<void>, closed: Promise<void>, onDispatch: () => void, onClose: () => void;
  const pending = new Set<ServerResponse>();

  beforeAll(async () => { db = await createMigratedSchema('mysheets_planning_lookup'); });
  beforeEach(async () => {
    owner = await db.person('Sheets owner');
    credentials = new CredentialRepo(db.pool);
    await credentials.saveCredentials('mysheets', encryptCredentials({
      refreshToken: 'local-test-refresh', email: owner.email, selectedSpreadsheets: selected,
      allowedScope: { spreadsheets: [W, R] },
    }, key), owner.id);
    mode = 'ok'; reads = 0; events = [];
    // The writable spreadsheet was renamed after the Picker saved its title.
    titles = { [W]: 'Other', [R]: 'Report read only' };
    dispatched = new Promise<void>(resolve => { onDispatch = resolve; });
    closed = new Promise<void>(resolve => { onClose = resolve; });
    server = createServer((req, res) => {
      reads++;
      if (mode === 'hang') {
        pending.add(res);
        res.on('close', () => { pending.delete(res); onClose(); });
        onDispatch();
        return;
      }
      onDispatch();
      res.setHeader('Content-Type', 'application/json');
      if (typeof mode === 'number') { res.writeHead(mode); res.end('{"error":"unavailable"}'); return; }
      const id = new URL(req.url!, 'http://localhost').pathname.split('/').at(-1)!;
      res.end(JSON.stringify({ spreadsheetId: id, properties: { title: titles[id] } }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterEach(async () => {
    for (const res of pending) res.end('{}');
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    pending.clear();
  });
  afterAll(async () => { await db?.close(); });

  function chat(overrides: Partial<ChatServiceOptions> = {}) {
    const currentEvents = events;
    const factory = new AdapterFactory({
      credentialRepo: credentials, encryptionKey: key,
      mysheetsTokens: { forConnection: () => ({ getAccessToken: async () => 'local-test-token' }) } as any,
      createMySheetsAdapter: input => createPersonalSheetsAdapter({ ...input, apiBaseUrl: origin }),
    });
    return new ChatService({
      msgRepo: new MessageRepo(db.pool), planRepo: new PlanRepo(db.pool),
      planner: { processMessage: async () => structuredClone(plan), routeSchedule: () => { throw new Error('Unused'); } },
      eventEmitter: { emit: (event, payload) => { currentEvents.push({ event, payload }); } },
      mysheetsConnection: createMySheetsConnectionLookup(credentials, key,
        userId => factory.getAdapterForService('mysheets', { userId, phase: 'planning' })),
      getAdapter: (service, context) => factory.getAdapterForService(service, context),
      schedules: { repo: new ScheduleRepo(db.pool, 'Asia/Ho_Chi_Minh'), timeZone: 'Asia/Ho_Chi_Minh' },
      ...overrides,
    });
  }
  async function conversation() {
    return (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])).rows[0].id as string;
  }
  async function send(service: ChatService) {
    const convId = await conversation();
    await service.handleUserMessage({ conversationId: convId, userId: owner.id, content: 'Append to report' });
    await expect.poll(() => events.some(e => e.payload.conversationId === convId &&
      ['error', 'plan_preview', 'refusal'].includes(e.event)), { timeout: 2000 }).toBe(true);
    return convId;
  }
  async function plans(convId: string) {
    return (await db.pool.query('SELECT * FROM plans WHERE conv_id=$1', [convId])).rows;
  }

  it.each([503, 401] as const)('does not save or preview a plan using stale titles after HTTP %s', async status => {
    mode = status;
    const convId = await send(chat());
    expect(reads).toBeGreaterThan(0);
    expect(events.some(e => e.event === 'error')).toBe(true);
    expect(events.some(e => e.event === 'plan_preview')).toBe(false);
    expect(await plans(convId)).toEqual([]);
    const history = await new MessageRepo(db.pool).listMessages(convId);
    expect(history.some(m => m.metadata?.type === 'planning_error')).toBe(true);
  });

  it('refuses the read-only result using current Google titles', async () => {
    const convId = await send(chat());
    expect(events.find(e => e.event === 'refusal')?.payload.reason).toContain('Report read only');
    expect(await plans(convId)).toEqual([]);
  });

  it('previews the writable result when the read-only spreadsheet was renamed', async () => {
    await credentials.saveCredentials('mysheets', encryptCredentials({
      refreshToken: 'local-test-refresh', email: owner.email, selectedSpreadsheets: [selected[1], selected[0]],
      allowedScope: { spreadsheets: [R, W] },
    }, key), owner.id);
    titles = { [R]: 'Other', [W]: 'Report writable' };
    const convId = await send(chat());
    expect(events.some(e => e.event === 'plan_preview')).toBe(true);
    expect(await plans(convId)).toHaveLength(1);
  });

  it('keeps literal spreadsheet targets independent of the discovery provider', async () => {
    mode = 503;
    const literal = structuredClone(plan);
    literal.steps[1]!.args.spreadsheetId = W;
    const convId = await send(chat({ planner: { processMessage: async () => literal, routeSchedule: () => { throw new Error('Unused'); } } }));
    expect(await plans(convId)).toHaveLength(1);
    expect(reads).toBe(0);
  });

  it('treats a malformed configured lookup as a planning error instead of trying another source', async () => {
    const convId = await send(chat({ lookupTool: async () => ({ items: [] }) }));
    expect(events.some(e => e.event === 'error')).toBe(true);
    expect(await plans(convId)).toEqual([]);
    expect(reads).toBe(0);
  });

  it('aborting a scheduled run closes an already dispatched native HTTP lookup and rejects preparation', async () => {
    mode = 'hang';
    const controller = new AbortController();
    const service = chat();
    const convId = await conversation();
    let state = 'pending';
    const prepared = service.planScheduledRun({
      runId: 'test-run', scheduleId: 'test-schedule', scheduleVersion: 1, userId: owner.id,
      name: 'Report', request: 'Append to report', dueAt: new Date(), trigger: 'scheduled',
    }, convId, controller.signal).then(() => { state = 'resolved'; }, () => { state = 'rejected'; });
    await dispatched;
    controller.abort(new Error('Run cancelled'));
    await expect.poll(() => state, { timeout: 1000 }).toBe('rejected');
    await closed;
    await prepared;
    expect(pending.size).toBe(0);
    expect(await plans(convId)).toEqual([]);
  });

  it('bounds chat validation and closes native HTTP when the lookup deadline expires', async () => {
    mode = 'hang';
    const convId = await send(chat({ mysheetsLookupTimeoutMs: 200 }));
    await closed;
    expect(reads).toBe(1);
    expect(pending.size).toBe(0);
    expect(events.some(e => e.event === 'error')).toBe(true);
    expect(await plans(convId)).toEqual([]);
  });

  it('enforces the deadline even when a configured lookup hook ignores cancellation', async () => {
    const convId = await send(chat({ mysheetsLookupTimeoutMs: 200, lookupTool: async () => new Promise(() => {}) }));
    expect(events.some(e => e.event === 'error')).toBe(true);
    expect(await plans(convId)).toEqual([]);
    expect(reads).toBe(0);
  });
});
