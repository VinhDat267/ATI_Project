import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buildReport, classifyTurn, parseSheet, readTurnFacts, wilson, withReadOnly, type TurnFacts } from './report-lib.js';

const header = 'participant,turn,conversation_id,decision,matches_intent,note';
const id = () => randomUUID();
const facts = (over: Partial<TurnFacts> = {}): TurnFacts => ({
  conversationId: id(), plans: 1, superseded: 0, clarifications: 0, refusals: 0,
  firstPreviewMs: 9000, lastPlanStatus: 'rejected', executedSteps: 0, succeededSteps: 0, ...over,
});

describe('parseSheet', () => {
  it('reads the facilitator sheet, including quoted notes with commas', () => {
    const a = id(), b = id();
    const rows = parseSheet(`${header}\nP01,1,${a},duyet,co,\nP01,2,${b},huy,,"Không đúng kênh, muốn Slack"\n`);
    expect(rows).toEqual([
      { participant: 'P01', turn: 1, conversationId: a, decision: 'duyet', matchesIntent: 'co', note: '' },
      { participant: 'P01', turn: 2, conversationId: b, decision: 'huy', matchesIntent: '', note: 'Không đúng kênh, muốn Slack' },
    ]);
  });
  it.each([
    ['a name instead of a code', `Lan,1,${id()},duyet,co,`, /participant/],
    ['an unknown decision', `P01,1,${id()},approve,co,`, /decision/],
    ['an approval without the intent answer', `P01,1,${id()},duyet,,`, /matches_intent/],
    ['a conversation id that is not a UUID', 'P01,1,abc,duyet,co,', /conversation_id/],
    ['a turn that is not a positive integer', `P01,0,${id()},duyet,co,`, /turn/],
  ])('rejects %s', (_label, line, message) => {
    expect(() => parseSheet(`${header}\n${line}\n`)).toThrow(message);
  });
  it('rejects a missing column and duplicate turns or conversations', () => {
    expect(() => parseSheet('participant,turn,conversation_id,decision\nP01,1,x,duyet\n')).toThrow(/matches_intent/);
    const c = id();
    expect(() => parseSheet(`${header}\nP01,1,${c},duyet,co,\nP01,1,${id()},huy,,\n`)).toThrow(/P01.*1/);
    expect(() => parseSheet(`${header}\nP01,1,${c},duyet,co,\nP02,1,${c},huy,,\n`)).toThrow(/conversation_id/);
  });
});

describe('classifyTurn', () => {
  const row = (over: Record<string, unknown> = {}) => ({ participant: 'P01', turn: 1, conversationId: id(), decision: 'duyet' as const, matchesIntent: 'co' as const, note: '', ...over });
  it.each([
    ['approved first plan', facts(), row(), true, ''],
    ['approved after one edit', facts({ plans: 2, superseded: 1 }), row(), true, ''],
    ['a clarification does not count as an edit', facts({ clarifications: 2 }), row(), true, ''],
    ['two edits', facts({ plans: 3, superseded: 2 }), row(), false, 'sua-qua-nhieu'],
    ['cancelled', facts(), row({ decision: 'huy', matchesIntent: '' }), false, 'huy'],
    ['gave up', facts(), row({ decision: 'bo-cuoc', matchesIntent: '' }), false, 'bo-cuoc'],
    ['approved but not what was meant', facts(), row({ matchesIntent: 'khong' }), false, 'khong-dung-y'],
    ['no plan at all', facts({ plans: 0, firstPreviewMs: null, lastPlanStatus: null, refusals: 1 }), row(), false, 'khong-co-ke-hoach'],
  ])('%s', (_label, turnFacts, sheetRow, usable, reason) => {
    const result = classifyTurn(sheetRow, { ...turnFacts, conversationId: sheetRow.conversationId });
    expect(result).toMatchObject({ usable, reason, edits: Math.max(0, turnFacts.plans - 1) });
  });
  it('marks a conversation missing from the database', () => {
    expect(classifyTurn(row(), null)).toMatchObject({ usable: false, reason: 'khong-tim-thay-hoi-thoai' });
  });
});

describe('wilson', () => {
  it.each([[14, 20, 0.4810, 0.8545], [3, 5, 0.2307, 0.8824], [0, 20, 0, 0.1611], [20, 20, 0.8389, 1]])('%i/%i', (k, n, low, high) => {
    const interval = wilson(k, n)!;
    expect(interval.low).toBeCloseTo(low, 4);
    expect(interval.high).toBeCloseTo(high, 4);
  });
  it('has no interval without turns', () => expect(wilson(0, 0)).toBeNull());
});

describe('buildReport', () => {
  it('summarises the rate, interval, reasons and minimum sample without chat text', () => {
    const turns = Array.from({ length: 20 }, (_, i) => {
      const sheetRow = { participant: `P0${(i % 5) + 1}`, turn: Math.floor(i / 5) + 1, conversationId: id(),
        decision: (i < 15 ? 'duyet' : 'huy') as 'duyet' | 'huy', matchesIntent: (i < 14 ? 'co' : i < 15 ? 'khong' : '') as 'co' | 'khong' | '', note: 'ghi chú, có dấu phẩy' };
      return classifyTurn(sheetRow, { ...facts({ firstPreviewMs: 1000 * (i + 1) }), conversationId: sheetRow.conversationId });
    });
    const report = buildReport(turns);
    expect(report).toMatchObject({ total: 20, usable: 14, participants: 5, meetsMinimum: true });
    expect(report.interval!.low).toBeCloseTo(0.481, 3);
    expect(report.summary).toContain('14/20');
    expect(report.summary).toContain('70,0%');
    expect(report.summary).toContain('48,1%');
    expect(report.summary).toMatch(/huy.*5/);
    expect(report.summary).toMatch(/khong-dung-y.*1/);
    expect(report.csv.split('\n')[0]).toBe('participant,turn,conversation_id,plans,edits,clarifications,refusals,first_preview_ms,last_plan_status,executed_steps,decision,matches_intent,usable,reason,note');
    expect(report.csv).toContain('"ghi chú, có dấu phẩy"');
  });
  it('flags a sample below 20 turns or 5 participants', () => {
    const one = classifyTurn({ participant: 'P01', turn: 1, conversationId: id(), decision: 'duyet', matchesIntent: 'co', note: '' }, null);
    expect(buildReport([one])).toMatchObject({ meetsMinimum: false });
    const fourPeople = Array.from({ length: 20 }, (_, i) => classifyTurn(
      { participant: `P0${(i % 4) + 1}`, turn: Math.floor(i / 4) + 1, conversationId: id(), decision: 'duyet', matchesIntent: 'co', note: '' }, facts()));
    expect(buildReport(fourPeople)).toMatchObject({ total: 20, participants: 4, meetsMinimum: false });
  });
});

describe('PostgreSQL', () => {
  const base = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3';
  const schema = `usable_plan_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: base });
  const url = new URL(base); url.searchParams.set('options', `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: url.href, max: 4 });
  type Seeded = 'first' | 'oneEdit' | 'twoEdits' | 'cancelled' | 'clarified';
  const conversations = {} as Record<Seeded, string>;
  const at = (seconds: number) => new Date(Date.UTC(2026, 9, 23, 2, 0, seconds)).toISOString();

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const directory = fileURLToPath(new URL('../../db/v3/', import.meta.url));
    for (const file of (await readdir(directory)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
      await pool.query(await readFile(`${directory}/${file}`, 'utf8'));
    }
    const user = (await pool.query("INSERT INTO users (email, name, password) VALUES ($1, 'Điều phối', NULL) RETURNING id", [`${id()}@example.test`])).rows[0].id;
    // Each turn is its own conversation; statuses follow the preview-only protocol (cancel after recording).
    const seed = async (name: Seeded, plans: string[], extra: Array<[string, string]> = []) => {
      const conv = (await pool.query('INSERT INTO conversations (user_id) VALUES ($1) RETURNING id', [user])).rows[0].id;
      conversations[name] = conv;
      await pool.query("INSERT INTO messages (conv_id, role, content, created_at) VALUES ($1, 'user', 'nội dung riêng tư', $2)", [conv, at(0)]);
      for (const [type, when] of extra) {
        await pool.query("INSERT INTO messages (conv_id, role, content, metadata, created_at) VALUES ($1, 'assistant', 'x', $2, $3)", [conv, { type }, when]);
      }
      for (const [index, status] of plans.entries()) {
        await pool.query("INSERT INTO plans (conv_id, plan_json, plan_hash, status, expires_at, created_at) VALUES ($1, '{}', 'h', $2, now() + interval '30 minutes', $3)",
          [conv, status, at(8 + index * 30)]);
      }
    };
    await seed('first', ['rejected']);
    await seed('oneEdit', ['superseded', 'rejected']);
    await seed('twoEdits', ['superseded', 'superseded', 'rejected']);
    await seed('cancelled', ['rejected']);
    await seed('clarified', ['rejected'], [['clarification', at(4)]]);
  });
  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  });

  it('reads per-turn facts and classifies the four protocol cases plus a clarification', async () => {
    const sheet = parseSheet([header,
      `P01,1,${conversations.first},duyet,co,`,
      `P01,2,${conversations.oneEdit},duyet,co,`,
      `P01,3,${conversations.twoEdits},duyet,co,`,
      `P01,4,${conversations.cancelled},huy,,`,
      `P01,5,${conversations.clarified},duyet,co,`,
    ].join('\n'));
    const found = await withReadOnly(pool, (client) => readTurnFacts(client, sheet.map((r) => r.conversationId)));
    expect(found.get(conversations.first)).toMatchObject({ plans: 1, superseded: 0, firstPreviewMs: 8000, lastPlanStatus: 'rejected', executedSteps: 0 });
    expect(found.get(conversations.twoEdits)).toMatchObject({ plans: 3, superseded: 2, lastPlanStatus: 'rejected', firstPreviewMs: 8000 });
    expect(found.get(conversations.clarified)).toMatchObject({ clarifications: 1, plans: 1 });
    const turns = sheet.map((row) => classifyTurn(row, found.get(row.conversationId) ?? null));
    expect(turns.map((t) => [t.usable, t.reason])).toEqual([[true, ''], [true, ''], [false, 'sua-qua-nhieu'], [false, 'huy'], [true, '']]);
    expect(buildReport(turns)).toMatchObject({ total: 5, usable: 3 });
    expect(buildReport(turns).csv).not.toContain('nội dung riêng tư');
  });

  it('runs inside a read-only transaction', async () => {
    const before = Number((await pool.query('SELECT count(*) FROM plans')).rows[0].count);
    await expect(withReadOnly(pool, (client) => client.query("INSERT INTO plans (conv_id, plan_json, plan_hash, expires_at) VALUES ($1, '{}', 'h', now())", [conversations.first])))
      .rejects.toThrow(/read-only transaction/);
    expect(Number((await pool.query('SELECT count(*) FROM plans')).rows[0].count)).toBe(before);
  });
});
