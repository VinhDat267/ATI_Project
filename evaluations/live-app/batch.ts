/**
 * W4-04 batch latency through the real web UI. Each prompt gets a new
 * conversation; the turn measures the time from clicking send to the first
 * visible response (plan preview, clarification, refusal, answer or planning
 * error) and reads the server's share from PostgreSQL. Every plan is
 * cancelled. This module never clicks the approve button, so nothing in a
 * batch reaches an external service.
 */
import type { Page } from '@playwright/test';
import type pg from 'pg';

/** Service ids of SERVICE_REGISTRY; a test keeps the two equal. */
export const SERVICES = ['trello', 'slack', 'github', 'sheets', 'calendar', 'notion', 'telegram', 'jira'];
export interface LatencyPrompt { id: string; services: string[]; prompt: string }
export type UiKind = 'plan' | 'clarification' | 'refusal' | 'answer' | 'error' | 'timeout';
export type ServerKind = 'plan' | 'clarification' | 'refusal' | 'answer' | 'error';
export interface ServerTiming {
  kind: ServerKind | null;
  /** User message saved → working memory saved: planner, model, directory and searches. */
  plannerMs: number | null;
  /** Working memory saved → response saved: labels, hash and storage. */
  saveMs: number | null;
  /** User message saved → response saved. */
  serverMs: number | null;
  plans: number;
  planStatuses: string[];
  executionSteps: number;
}
export interface LatencyTurn {
  id: string;
  services: string[];
  serviceCount: number;
  startedAt: string;
  conversationId: string | null;
  uiKind: UiKind;
  /** Click on send → response visible. */
  visibleMs: number | null;
  /** visibleMs − serverMs: request to the API, SSE delivery and rendering. */
  frontendMs: number | null;
  server: ServerTiming | null;
  /** The conversation has a saved response and no open plan, as read after the batch's final pass. */
  resolved: boolean;
}

const COMPOSER = /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/;
const SEND = /^(Gửi|Gửi tin nhắn|Gửi yêu cầu)$/;
/** Cockpit sections that end the planning wait; moment 2 and the slow-planning view do not. */
export const RESPONSE_SELECTOR = 'section[data-moment="3"], section[data-moment="4"], section[data-moment="refusal"], section[data-moment="answer"], #view-server';
const OPEN_PLAN = ['pending', 'approved', 'executing'];

export function parseLatencyPrompts(text: string): LatencyPrompt[] {
  const file = JSON.parse(text) as { version?: unknown; prompts?: unknown };
  if (file.version !== 1 || !Array.isArray(file.prompts) || !file.prompts.length) throw new Error('Prompts file needs version 1 and a non-empty prompts list');
  const ids = new Set<string>();
  return file.prompts.map((entry, index) => {
    const { id, services, prompt } = (entry ?? {}) as Partial<LatencyPrompt>;
    const where = `prompts[${index}]`;
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id) || ids.has(id)) throw new Error(`${where}: id must be a unique lowercase code`);
    if (!Array.isArray(services) || !services.length || new Set(services).size !== services.length || !services.every((s) => SERVICES.includes(s)))
      throw new Error(`${where}: services must list distinct service ids`);
    if (typeof prompt !== 'string' || prompt.trim().length < 10) throw new Error(`${where}: prompt must be a full chat request`);
    ids.add(id);
    return { id, services, prompt };
  });
}

export function uiKindOf(moment: string | null, elementId: string | null): UiKind {
  if (elementId === 'view-server') return 'error';
  return moment === '4' ? 'plan' : moment === '3' ? 'clarification' : moment === 'refusal' ? 'refusal' : moment === 'answer' ? 'answer' : 'timeout';
}

export interface TimingRow {
  user_at: Date | null; memory_at: Date | null; response_at: Date | null; response_type: string | null;
  plans: number; plan_statuses: string[] | null; execution_steps: number;
}
const RESPONSE_TYPES: Record<string, ServerKind> = { plan: 'plan', clarification: 'clarification', refusal: 'refusal', answer: 'answer', planning_error: 'error' };
export function serverTimingFromRow(row: TimingRow): ServerTiming {
  const at = (value: Date | null) => (value ? new Date(value).getTime() : null);
  const user = at(row.user_at), memory = at(row.memory_at), response = at(row.response_at);
  const span = (from: number | null, to: number | null) => (from !== null && to !== null ? to - from : null);
  return {
    kind: row.response_type ? RESPONSE_TYPES[row.response_type] ?? null : null,
    plannerMs: response !== null ? span(user, memory) : null, saveMs: span(memory, response), serverMs: span(user, response),
    plans: row.plans, planStatuses: row.plan_statuses ?? [], executionSteps: row.execution_steps,
  };
}

/** One conversation's server-side timestamps; the planner saves working memory as soon as it returns. */
export async function readServerTiming(db: pg.Pool | pg.PoolClient, conversationId: string): Promise<ServerTiming> {
  const { rows } = await db.query<TimingRow>(`
    SELECT
      (SELECT min(created_at) FROM messages WHERE conv_id = $1 AND role = 'user') AS user_at,
      (SELECT min(created_at) FROM messages WHERE conv_id = $1 AND metadata->>'type' = 'working_memory') AS memory_at,
      r.created_at AS response_at, r.type AS response_type,
      (SELECT count(*) FROM plans WHERE conv_id = $1)::int AS plans,
      (SELECT array_agg(status ORDER BY created_at) FROM plans WHERE conv_id = $1) AS plan_statuses,
      (SELECT count(*) FROM execution_steps s JOIN plans p ON p.id = s.plan_id WHERE p.conv_id = $1)::int AS execution_steps
    FROM (SELECT 1) one
    LEFT JOIN LATERAL (
      SELECT created_at, metadata->>'type' AS type FROM messages
      WHERE conv_id = $1 AND metadata->>'type' IN ('plan', 'clarification', 'refusal', 'answer', 'planning_error')
      ORDER BY created_at LIMIT 1) r ON true`, [conversationId]);
  return serverTimingFromRow(rows[0]!);
}

export async function loginAtLoginPage(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.getByRole('textbox', { name: COMPOSER }).waitFor({ state: 'visible', timeout: 20_000 });
}

const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function openPlans(pool: pg.Pool, conversationId: string): Promise<number> {
  return Number((await pool.query('SELECT count(*) FROM plans WHERE conv_id = $1 AND status = ANY($2)', [conversationId, OPEN_PLAN])).rows[0].count);
}
async function waitUntil(check: () => Promise<boolean>, timeoutMs: number, everyMs = 250): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do { if (await check()) return true; await delay(everyMs); } while (Date.now() < deadline);
  return check();
}

/** Cancels the conversation's pending plan the way a person does: open it and press "Hủy". */
export async function cancelThroughUi(page: Page, pool: pg.Pool, conversationId: string) {
  if (!(await openPlans(pool, conversationId))) return;
  if (!page.url().endsWith(`/c/${encodeURIComponent(conversationId)}`)) await page.goto(`/c/${encodeURIComponent(conversationId)}`);
  await page.getByRole('button', { name: 'Hủy', exact: true }).click({ timeout: 30_000 });
  if (!(await waitUntil(async () => (await openPlans(pool, conversationId)) === 0, 15_000))) {
    throw new Error(`Plan in conversation ${conversationId} is still open after cancelling`);
  }
}

export interface TurnOptions { timeoutMs: number; graceMs: number }
export async function runLatencyTurn(page: Page, pool: pg.Pool, item: LatencyPrompt, options: TurnOptions): Promise<LatencyTurn> {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: COMPOSER });
  await composer.waitFor({ state: 'visible', timeout: 20_000 });
  await composer.fill(item.prompt);
  const startedAt = new Date().toISOString();
  const sent = Date.now();
  await page.getByRole('button', { name: SEND }).click();
  const response = page.locator(RESPONSE_SELECTOR).first();
  const [visible] = await Promise.all([
    response.waitFor({ state: 'visible', timeout: options.timeoutMs }).then(() => Date.now() - sent, () => null),
    page.waitForURL(/\/c\/[^/]+$/, { timeout: Math.max(options.timeoutMs, 30_000) }).catch(() => undefined),
  ]);
  const conversationId = /\/c\/([^/]+)$/.exec(new URL(page.url()).pathname)?.[1];
  const id = conversationId ? decodeURIComponent(conversationId) : null;
  const uiKind = visible === null ? 'timeout' : uiKindOf(await response.getAttribute('data-moment'), await response.getAttribute('id'));
  let server: ServerTiming | null = null;
  if (id) {
    // The server saves a response before sending it over SSE, so a visible one is already in PostgreSQL.
    // A late one may still be on its way; wait for it so its plan can be cancelled too.
    if (uiKind === 'timeout') await waitUntil(async () => (await readServerTiming(pool, id)).kind !== null, options.graceMs, 1000);
    await cancelThroughUi(page, pool, id);
    server = await readServerTiming(pool, id);
  }
  const turn = { id: item.id, services: item.services, serviceCount: item.services.length, startedAt, conversationId: id, uiKind, visibleMs: visible, frontendMs: null, server, resolved: false };
  return settle(turn, server);
}

/** A saved response and no plan left pending, approved or executing. */
export const isSettled = (server: ServerTiming | null) => !!server && server.kind !== null && !server.planStatuses.some((s) => OPEN_PLAN.includes(s));
function settle(turn: LatencyTurn, server: ServerTiming | null): LatencyTurn {
  const frontendMs = turn.visibleMs !== null && server?.serverMs != null ? turn.visibleMs - server.serverMs : null;
  return { ...turn, server, frontendMs, resolved: isSettled(server) };
}

export interface BatchOptions extends TurnOptions {
  pauseMs: number;
  /** After the last prompt: total time to wait for responses still missing, so their plans can be cancelled. */
  finalWaitMs: number;
  onTurn?: (turn: LatencyTurn, turns: LatencyTurn[]) => void;
}
export async function runLatencyBatch(page: Page, pool: pg.Pool, prompts: LatencyPrompt[], options: BatchOptions): Promise<LatencyTurn[]> {
  const turns: LatencyTurn[] = [];
  for (const [index, item] of prompts.entries()) {
    if (index > 0 && options.pauseMs > 0) await delay(options.pauseMs);
    const turn = await runLatencyTurn(page, pool, item, options);
    turns.push(turn);
    options.onTurn?.(turn, turns);
  }
  // Final pass: wait for responses still missing, cancel anything open, then read every conversation again.
  // A turn stays unresolved when its response has not arrived by then; the batch must not be reported complete.
  const deadline = Date.now() + options.finalWaitMs;
  for (const [index, turn] of turns.entries()) {
    const id = turn.conversationId;
    if (!id) continue;
    await waitUntil(async () => (await readServerTiming(pool, id)).kind !== null, Math.max(0, deadline - Date.now()), 1000);
    await cancelThroughUi(page, pool, id);
    turns[index] = settle(turn, await readServerTiming(pool, id));
  }
  return turns;
}

/** Nearest-rank percentile, as in the golden-v2 reports. */
export function percentile(values: number[], p: number): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]! : null;
}
const seconds = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);
const percent = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1).replace('.', ',')}%` : '—');
export const serviceGroup = (count: number) => (count >= 4 ? '≥4' : String(count));
export const UNDER_MS = 15_000;

export interface LatencySummary {
  turns: number;
  under15: number;
  /** Infinity stands for a turn with no visible response: slower than the wait, not left out. */
  byGroup: Record<string, { turns: number; p50: number | null; p95: number | null; max: number | null }>;
  kinds: Record<string, number>;
  executionSteps: number;
  openPlans: number;
  unresolved: Array<{ id: string; conversationId: string | null }>;
  serverShare: number | null;
  markdown: string;
}
export function summarizeLatency(turns: LatencyTurn[], options: { timeoutMs?: number } = {}): LatencySummary {
  const censored = (rows: LatencyTurn[]) => rows.map((t) => t.visibleMs ?? Infinity);
  const stats = (rows: LatencyTurn[]) => ({ turns: rows.length, p50: percentile(censored(rows), 0.5), p95: percentile(censored(rows), 0.95), max: percentile(censored(rows), 1) });
  const show = (ms: number | null) => (ms === Infinity ? `> ${options.timeoutMs != null ? seconds(options.timeoutMs) : 'ngưỡng chờ'}` : seconds(ms));
  const unresolved = turns.filter((t) => !t.resolved).map((t) => ({ id: t.id, conversationId: t.conversationId }));
  const answered = turns.filter((t) => t.visibleMs !== null).length;
  const groups = ['1', '2', '3', '≥4'].filter((group) => turns.some((t) => serviceGroup(t.serviceCount) === group));
  const byGroup = Object.fromEntries(groups.map((group) => [group, stats(turns.filter((t) => serviceGroup(t.serviceCount) === group))]));
  const kinds: Record<string, number> = {};
  for (const turn of turns) kinds[turn.uiKind] = (kinds[turn.uiKind] ?? 0) + 1;
  const under15 = turns.filter((t) => t.visibleMs !== null && t.visibleMs < UNDER_MS).length;
  const split = turns.filter((t) => t.visibleMs !== null && t.server?.serverMs != null);
  const visibleTotal = split.reduce((sum, t) => sum + t.visibleMs!, 0);
  const serverShare = visibleTotal ? split.reduce((sum, t) => sum + t.server!.serverMs!, 0) / visibleTotal : null;
  const executionSteps = turns.reduce((sum, t) => sum + (t.server?.executionSteps ?? 0), 0);
  const openPlans = turns.reduce((sum, t) => sum + (t.server?.planStatuses.filter((s) => OPEN_PLAN.includes(s)).length ?? 0), 0);
  const all = stats(turns);
  const median = (values: Array<number | null | undefined>) => percentile(values.filter((v): v is number => typeof v === 'number'), 0.5);
  const markdown = [
    '# W4-04 · Thời gian tới phản hồi qua giao diện',
    '',
    `- Lượt: **${turns.length}**. Dưới 15 s: **${under15}/${turns.length} = ${percent(under15, turns.length)}** (lượt không có phản hồi tính là không đạt).`,
    `- Có phản hồi: ${answered}/${turns.length}. Toàn bộ ${turns.length} lượt, lượt không có phản hồi tính là chậm hơn ngưỡng chờ: p50 ${show(all.p50)}, p95 ${show(all.p95)}, max ${show(all.max)}.`,
    `- Loại phản hồi: ${Object.entries(kinds).map(([kind, count]) => `${kind} ${count}`).join(', ')}.`,
    `- Phía server (từ lúc lưu câu chat tới lúc lưu phản hồi) chiếm ${serverShare === null ? '—' : percent(serverShare, 1)} tổng thời gian. Trung vị: server ${seconds(median(split.map((t) => t.server!.serverMs)))}, trong đó planner ${seconds(median(split.map((t) => t.server!.plannerMs)))}; phần còn lại (gửi request, SSE, vẽ) ${seconds(median(split.map((t) => t.frontendMs)))}.`,
    '- Thời gian của model không tách được khỏi planner (tra danh mục, tra cứu, kiểm kế hoạch): chat-api không ghi thời gian từng lời gọi model.',
    `- Dòng execution_steps: **${executionSteps}**; kế hoạch còn mở: **${openPlans}** (cả hai phải bằng 0).`,
    `- Lượt chưa xác minh xong: **${unresolved.length}**${unresolved.length ? ` (${unresolved.map((t) => `${t.id}: ${t.conversationId ?? 'không có hội thoại'}`).join(', ')}). Lượt chạy chưa hoàn tất; mở các hội thoại này và hủy kế hoạch còn mở` : ''}.`,
    '',
    '| Số dịch vụ | Lượt | p50 | p95 | max |',
    '|---|---|---|---|---|',
    ...groups.map((group) => `| ${group} | ${byGroup[group]!.turns} | ${show(byGroup[group]!.p50)} | ${show(byGroup[group]!.p95)} | ${show(byGroup[group]!.max)} |`),
    '',
    '| Lượt | Dịch vụ | Phản hồi | Thấy phản hồi | Server | Planner | Frontend |',
    '|---|---|---|---|---|---|---|',
    ...turns.map((t) => `| ${t.id} | ${t.services.join(', ')} | ${t.uiKind} | ${seconds(t.visibleMs)} | ${seconds(t.server?.serverMs ?? null)} | ${seconds(t.server?.plannerMs ?? null)} | ${seconds(t.frontendMs)} |`),
    '',
  ].join('\n');
  return { turns: turns.length, under15, byGroup, kinds, executionSteps, openPlans, unresolved, serverShare, markdown };
}
