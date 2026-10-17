/**
 * W4-03 usable-plan study: joins the facilitator's sheet with what PostgreSQL
 * recorded for each turn, classifies every turn by the definition fixed in
 * PROTOCOL.md, and summarises the rate with a Wilson 95% interval.
 * Reads only; never exports chat text.
 */
import type pg from 'pg';

export type Decision = 'duyet' | 'huy' | 'bo-cuoc';
export type Intent = 'co' | 'khong' | '';
export type Reason = 'khong-tim-thay-hoi-thoai' | 'khong-co-ke-hoach' | 'huy' | 'bo-cuoc' | 'sua-qua-nhieu' | 'khong-dung-y';

export interface SheetRow {
  participant: string;
  turn: number;
  conversationId: string;
  decision: Decision;
  matchesIntent: Intent;
  note: string;
}
export interface TurnFacts {
  conversationId: string;
  plans: number;
  superseded: number;
  clarifications: number;
  refusals: number;
  /** From the first user message to the first saved plan, the moment the preview appears. */
  firstPreviewMs: number | null;
  lastPlanStatus: string | null;
  /** Rows in execution_steps: executePlan creates every step as pending before anything runs. */
  executionRows: number;
  /** Steps that turned running at least once (started_at is set only then). */
  startedSteps: number;
  succeededSteps: number;
}
export interface TurnResult extends SheetRow {
  facts: TurnFacts | null;
  /** Each plan after the first replaced one through "Sửa qua Chat"; clarifications create no plan. */
  edits: number;
  usable: boolean;
  reason: Reason | '';
}
export interface Report {
  total: number;
  usable: number;
  participants: number;
  meetsMinimum: boolean;
  /** Participant codes with fewer than MIN_TURNS_PER_PARTICIPANT turns. */
  shortParticipants: string[];
  interval: { low: number; high: number } | null;
  csv: string;
  summary: string;
}

const COLUMNS = ['participant', 'turn', 'conversation_id', 'decision', 'matches_intent', 'note'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MIN_TURNS = 20;
export const MIN_PARTICIPANTS = 5;
export const MIN_TURNS_PER_PARTICIPANT = 4;

/** RFC 4180 subset: commas, quoted fields with escaped quotes, CRLF or LF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  const input = text.replace(/^﻿/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) throw new Error('Sheet has an unterminated quoted field');
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

export function parseSheet(text: string): SheetRow[] {
  const [head, ...lines] = parseCsv(text);
  const index = new Map((head ?? []).map((name, i) => [name.trim(), i]));
  for (const column of COLUMNS) if (!index.has(column)) throw new Error(`Sheet is missing the ${column} column`);
  const turns = new Set<string>(), conversations = new Set<string>();
  return lines.map((cells, line) => {
    const get = (column: typeof COLUMNS[number]) => (cells[index.get(column)!] ?? '').trim();
    const where = `row ${line + 2}`;
    const participant = get('participant');
    if (!/^P\d{2,3}$/.test(participant)) throw new Error(`${where}: participant must be a code such as P01, never a name`);
    const turn = Number(get('turn'));
    if (!Number.isInteger(turn) || turn < 1) throw new Error(`${where}: turn must be a positive integer`);
    const conversationId = get('conversation_id').toLowerCase();
    if (!UUID.test(conversationId)) throw new Error(`${where}: conversation_id must be the UUID from /c/<id>`);
    const decision = get('decision');
    if (decision !== 'duyet' && decision !== 'huy' && decision !== 'bo-cuoc') throw new Error(`${where}: decision must be duyet, huy or bo-cuoc`);
    const matchesIntent = get('matches_intent');
    if (matchesIntent !== 'co' && matchesIntent !== 'khong' && matchesIntent !== '') throw new Error(`${where}: matches_intent must be co, khong or empty`);
    if (decision === 'duyet' && matchesIntent === '') throw new Error(`${where}: an approval needs matches_intent co or khong`);
    if (turns.has(`${participant}#${turn}`)) throw new Error(`${where}: ${participant} turn ${turn} appears twice`);
    if (conversations.has(conversationId)) throw new Error(`${where}: conversation_id is used by another turn`);
    turns.add(`${participant}#${turn}`); conversations.add(conversationId);
    return { participant, turn, conversationId, decision, matchesIntent, note: get('note') };
  });
}

/** Runs `fn` in a READ ONLY transaction that is always rolled back. */
export async function withReadOnly<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

export async function readTurnFacts(client: pg.PoolClient | pg.Pool, conversationIds: string[]): Promise<Map<string, TurnFacts>> {
  const { rows } = await client.query(`
    SELECT c.id AS conversation_id,
      (SELECT count(*) FROM plans p WHERE p.conv_id = c.id)::int AS plans,
      (SELECT count(*) FROM plans p WHERE p.conv_id = c.id AND p.status = 'superseded')::int AS superseded,
      (SELECT count(*) FROM messages m WHERE m.conv_id = c.id AND m.metadata->>'type' = 'clarification')::int AS clarifications,
      (SELECT count(*) FROM messages m WHERE m.conv_id = c.id AND m.metadata->>'type' = 'refusal')::int AS refusals,
      (SELECT min(m.created_at) FROM messages m WHERE m.conv_id = c.id AND m.role = 'user') AS first_user_at,
      (SELECT min(p.created_at) FROM plans p WHERE p.conv_id = c.id) AS first_plan_at,
      (SELECT p.status FROM plans p WHERE p.conv_id = c.id ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS last_plan_status,
      (SELECT count(*) FROM execution_steps s JOIN plans p ON p.id = s.plan_id WHERE p.conv_id = c.id)::int AS execution_rows,
      (SELECT count(*) FROM execution_steps s JOIN plans p ON p.id = s.plan_id WHERE p.conv_id = c.id AND s.started_at IS NOT NULL)::int AS started_steps,
      (SELECT count(*) FROM execution_steps s JOIN plans p ON p.id = s.plan_id WHERE p.conv_id = c.id AND s.status = 'succeeded')::int AS succeeded_steps
    FROM conversations c WHERE c.id = ANY($1::uuid[])`, [conversationIds]);
  return new Map(rows.map((row) => [row.conversation_id, {
    conversationId: row.conversation_id,
    plans: row.plans, superseded: row.superseded, clarifications: row.clarifications, refusals: row.refusals,
    firstPreviewMs: row.first_user_at && row.first_plan_at ? new Date(row.first_plan_at).getTime() - new Date(row.first_user_at).getTime() : null,
    lastPlanStatus: row.last_plan_status ?? null,
    executionRows: row.execution_rows, startedSteps: row.started_steps, succeededSteps: row.succeeded_steps,
  }]));
}

/** PROTOCOL.md definition: approved on the first plan or after at most one edit, and the participant confirms it matches intent. */
export function classifyTurn(row: SheetRow, facts: TurnFacts | null): TurnResult {
  const edits = facts ? Math.max(0, facts.plans - 1) : 0;
  const reason: Reason | '' = !facts ? 'khong-tim-thay-hoi-thoai'
    : facts.plans === 0 ? 'khong-co-ke-hoach'
    : row.decision === 'huy' ? 'huy'
    : row.decision === 'bo-cuoc' ? 'bo-cuoc'
    : edits > 1 ? 'sua-qua-nhieu'
    : row.matchesIntent !== 'co' ? 'khong-dung-y'
    : '';
  return { ...row, facts, edits, usable: reason === '', reason };
}

/** Wilson score interval, 95% (z = 1.96). */
export function wilson(k: number, n: number, z = 1.959963984540054): { low: number; high: number } | null {
  if (n === 0) return null;
  const p = k / n, denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

const percent = (value: number) => `${(value * 100).toFixed(1).replace('.', ',')}%`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
const csvCell = (value: unknown) => {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
function quantile(sorted: number[], q: number): number {
  const position = (sorted.length - 1) * q, lower = Math.floor(position), upper = Math.ceil(position);
  const low = sorted[lower] ?? 0, high = sorted[upper] ?? low;
  return low + (high - low) * (position - lower);
}

export function buildReport(turns: TurnResult[]): Report {
  const total = turns.length, usable = turns.filter((t) => t.usable).length;
  const perParticipant = new Map<string, number>();
  for (const t of turns) perParticipant.set(t.participant, (perParticipant.get(t.participant) ?? 0) + 1);
  const participants = perParticipant.size;
  const counts = [...perParticipant].sort(([a], [b]) => a.localeCompare(b));
  const shortParticipants = counts.filter(([, count]) => count < MIN_TURNS_PER_PARTICIPANT).map(([code]) => code);
  const meetsMinimum = total >= MIN_TURNS && participants >= MIN_PARTICIPANTS && shortParticipants.length === 0;
  const interval = wilson(usable, total);
  const header = ['participant', 'turn', 'conversation_id', 'plans', 'superseded', 'edits', 'clarifications', 'refusals', 'first_preview_ms', 'last_plan_status',
    'execution_rows', 'started_steps', 'decision', 'matches_intent', 'usable', 'reason', 'note'];
  const csv = [header.join(','), ...turns.map((t) => [t.participant, t.turn, t.conversationId, t.facts?.plans ?? '', t.facts?.superseded ?? '', t.edits,
    t.facts?.clarifications ?? '', t.facts?.refusals ?? '', t.facts?.firstPreviewMs ?? '', t.facts?.lastPlanStatus ?? '', t.facts?.executionRows ?? '',
    t.facts?.startedSteps ?? '', t.decision, t.matchesIntent, t.usable ? 'co' : 'khong', t.reason, t.note].map(csvCell).join(','))].join('\n') + '\n';

  const reasons = new Map<string, number>();
  for (const t of turns) if (!t.usable) reasons.set(t.reason, (reasons.get(t.reason) ?? 0) + 1);
  const previews = turns.map((t) => t.facts?.firstPreviewMs).filter((ms): ms is number => typeof ms === 'number').sort((a, b) => a - b);
  const statuses = new Map<string, number>();
  for (const t of turns) { const s = t.facts?.lastPlanStatus ?? '(không có kế hoạch)'; statuses.set(s, (statuses.get(s) ?? 0) + 1); }
  const started = turns.filter((t) => (t.facts?.startedSteps ?? 0) > 0).length;

  const lines = [
    '# W4-03 · Tỉ lệ kế hoạch dùng được',
    '',
    `- Lượt: **${total}**, người tham gia: **${participants}**. Mẫu tối thiểu (≥ ${MIN_TURNS} lượt, ≥ ${MIN_PARTICIPANTS} người, mỗi người ≥ ${MIN_TURNS_PER_PARTICIPANT} lượt): **${meetsMinimum ? 'đạt' : 'chưa đạt'}**.`,
    `- Lượt theo người: ${counts.map(([code, count]) => `${code} ${count}`).join(', ') || '(không có)'}.${shortParticipants.length ? ` Chưa đủ ${MIN_TURNS_PER_PARTICIPANT} lượt: ${shortParticipants.join(', ')}.` : ''}`,
    `- Dùng được: **${usable}/${total}**${interval ? ` = **${percent(usable / total)}**, khoảng tin cậy 95% (Wilson) **${percent(interval.low)} – ${percent(interval.high)}**` : ''}.`,
    previews.length ? `- Thời gian tới kế hoạch đầu tiên (${previews.length} lượt có kế hoạch): p50 ${seconds(quantile(previews, 0.5))}, p95 ${seconds(quantile(previews, 0.95))}.` : '- Không có lượt nào có kế hoạch.',
    // A started step is a fact from PostgreSQL; whether a real run was allowed is only in the sheet.
    `- Lượt có bước đã bắt đầu chạy: ${started}${started ? '. Quy trình chỉ xem không chạy bước nào; đối chiếu với phiếu để biết các lượt này có được phép chạy thật không.' : ' (đúng quy trình chỉ xem).'}`,
    '',
    '## Không dùng được, theo nguyên nhân',
    '',
    '| Nguyên nhân | Số lượt |',
    '|---|---|',
    ...(reasons.size ? [...reasons].sort((a, b) => b[1] - a[1]).map(([reason, count]) => `| ${reason} | ${count} |`) : ['| (không có) | 0 |']),
    '',
    '## Trạng thái cuối của kế hoạch',
    '',
    '| Trạng thái | Số lượt |',
    '|---|---|',
    ...[...statuses].sort((a, b) => b[1] - a[1]).map(([status, count]) => `| ${status} | ${count} |`),
    '',
  ];
  return { total, usable, participants, meetsMinimum, shortParticipants, interval, csv, summary: lines.join('\n') };
}
