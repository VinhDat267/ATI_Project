/**
 * W4-04: every prompt of LIVE_APP_PROMPTS_FILE through the web UI in a new
 * conversation, timed from send to the first visible response, then
 * cancelled. Writes batch.json after each turn and summary.md at the end.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import pg from 'pg';
import { loginAtLoginPage, parseLatencyPrompts, runLatencyBatch, summarizeLatency } from './batch';

const email = process.env.CHAT_ADMIN_EMAIL;
const password = process.env.CHAT_ADMIN_PASSWORD;
const connectionString = process.env.DATABASE_URL;
const promptsFile = process.env.LIVE_APP_PROMPTS_FILE || 'evaluations/live-app/latency-prompts.json';
const runDir = resolve(process.env.LIVE_APP_RUN_DIR || join('docs/ai-evidence/V3-LIVE-EXECUTION', `latency-${new Date().toISOString().replace(/[:.]/g, '-')}`));
const number = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
};
const pauseMs = number('LIVE_APP_PAUSE_MS', 5000);
const timeoutMs = number('LIVE_APP_TURN_TIMEOUT_MS', 120_000);
const graceMs = number('LIVE_APP_GRACE_MS', 60_000);
if (!email || !password || !connectionString) throw new Error('Latency run requires CHAT_ADMIN_* and DATABASE_URL');

test('live app latency: every prompt through the UI, every plan cancelled', async ({ page }) => {
  mkdirSync(runDir, { recursive: true });
  const raw = readFileSync(promptsFile, 'utf8');
  const only = (process.env.LIVE_APP_ONLY ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  const all = parseLatencyPrompts(raw);
  const unknown = only.filter((id) => !all.some((item) => item.id === id));
  if (unknown.length) throw new Error(`LIVE_APP_ONLY names unknown prompts: ${unknown.join(', ')}`);
  const prompts = only.length ? all.filter((item) => only.includes(item.id)) : all;
  const meta = {
    promptsFile, promptsSha256: createHash('sha256').update(raw).digest('hex'), subset: only.length ? only : undefined,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    requestedModel: process.env.LLM_MODEL ?? null, webUrl: process.env.LIVE_APP_WEB_URL || 'http://127.0.0.1:5174',
    pauseMs, timeoutMs, graceMs, startedAt: new Date().toISOString(),
  };
  const pool = new pg.Pool({ connectionString });
  try {
    await loginAtLoginPage(page, email!, password!);
    const turns = await runLatencyBatch(page, pool, prompts, {
      pauseMs, timeoutMs, graceMs,
      onTurn: (turn, done) => {
        console.log(`${turn.id}: ${turn.uiKind} ${turn.visibleMs ?? '—'} ms`);
        writeFileSync(join(runDir, 'batch.json'), `${JSON.stringify({ ...meta, complete: false, turns: done }, null, 2)}\n`);
      },
    });
    const summary = summarizeLatency(turns);
    writeFileSync(join(runDir, 'batch.json'), `${JSON.stringify({ ...meta, complete: true, finishedAt: new Date().toISOString(), turns }, null, 2)}\n`);
    writeFileSync(join(runDir, 'summary.md'), summary.markdown);
    console.log(summary.markdown);
    expect(summary.executionSteps).toBe(0);
    expect(summary.openPlans).toBe(0);
  } finally {
    await pool.end();
  }
});
