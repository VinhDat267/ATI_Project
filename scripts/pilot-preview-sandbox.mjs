import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '@wap/db';
import { loadPilotConfig } from '@wap/engine';
import { createApi } from '../apps/api/dist/app.js';
import { hashPassword } from '../apps/api/dist/auth.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const values = new Map();
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const flag = args[i];
  const value = args[i + 1];
  if (!['--request-id', '--output'].includes(flag) || !value || values.has(flag)) {
    throw new Error('Usage: node scripts/pilot-preview-sandbox.mjs --request-id ID --output NEW_FILE');
  }
  values.set(flag, value);
}
if (values.size !== 2 || args.length !== 4) {
  throw new Error('Usage: node scripts/pilot-preview-sandbox.mjs --request-id ID --output NEW_FILE');
}
if (process.env.PILOT_V2_WRITE_ENABLED === 'true') {
  throw new Error('PREVIEW_WRITE_GATE: PILOT_V2_WRITE_ENABLED must be false');
}

const databaseUrl = process.env.PILOT_PREVIEW_DATABASE_URL;
if (!databaseUrl) throw new Error('PILOT_PREVIEW_DATABASE_URL is required');
const parsedDatabase = new URL(databaseUrl);
if (parsedDatabase.hostname !== '127.0.0.1' ||
    !/^\/wap_pilot_preview_[0-9]{8}$/.test(parsedDatabase.pathname)) {
  throw new Error('PREVIEW_DATABASE_SCOPE: use an isolated loopback pilot preview database');
}
const pilotConfig = loadPilotConfig();
if (!pilotConfig.enabled || !pilotConfig.trello?.listId?.trim()) {
  throw new Error('PREVIEW_CONFIG: pilot and target list must be enabled');
}
const principal = process.env.PILOT_PREVIEW_PRINCIPAL?.trim() || pilotConfig.principals[0];
if (!principal || !pilotConfig.principals.includes(principal)) {
  throw new Error('PREVIEW_PRINCIPAL: principal must be allowlisted');
}
const policy = {
  enabled: true,
  principals: pilotConfig.principals,
  spreadsheetId: pilotConfig.spreadsheetId,
  tabId: pilotConfig.tabId,
  boardId: pilotConfig.boardId,
};

// Reserve the artifact before any SaaS GET or database mutation.
const artifact = await open(values.get('--output'), 'wx', 0o600);
const db = openDatabase(databaseUrl);
let api;
try {
  const users = await db.client`SELECT email FROM users WHERE id = ${principal}`;
  if (users.length !== 1) throw new Error('PREVIEW_PRINCIPAL: no local seeded user');
  const password = randomBytes(24).toString('base64');
  api = createApi({
    db,
    config: {
      host: '127.0.0.1', port: 0, userId: principal, email: users[0].email,
      passwordHash: await hashPassword(password), sessionTtlMs: 60_000,
      cursorKey: randomBytes(32), plannerMode: 'disabled',
      allowNewRuns: true, allowProviderCalls: false,
    },
    pilotConfig, pilotPolicy: policy, pilotLiveWriteEnabled: false,
    requestLogger: () => {},
  });
  const base = await api.listen();
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: users[0].email, password }),
  });
  if (!login.ok) throw new Error(`PREVIEW_LOGIN_FAILED: HTTP ${login.status}`);
  const { token } = await login.json();
  if (!token) throw new Error('PREVIEW_LOGIN_FAILED: missing token');
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const origin = base.replace(/\/api\/v1$/, '');
  const createdResponse = await fetch(`${origin}/pilot/v2/runs`, {
    method: 'POST', headers,
    body: JSON.stringify({
      spreadsheetId: pilotConfig.spreadsheetId, tabId: pilotConfig.tabId,
      requestId: values.get('--request-id'),
      userPrompt: 'Chuẩn bị một thẻ Trello từ yêu cầu sandbox để chủ run xem trước và quyết định.',
      timeZone: 'Asia/Ho_Chi_Minh',
    }),
  });
  if (createdResponse.status !== 202) {
    const failure = await createdResponse.json().catch(() => ({}));
    throw new Error(`PREVIEW_CREATE_FAILED: HTTP ${createdResponse.status} ${failure.error?.code ?? ''}`);
  }
  const created = await createdResponse.json();
  const detailResponse = await fetch(`${origin}/pilot/v2/runs/${created.runId}`, { headers });
  if (!detailResponse.ok) throw new Error(`PREVIEW_DETAIL_FAILED: HTTP ${detailResponse.status}`);
  const detail = await detailResponse.json();
  const action = detail.preview?.actions?.[0];
  if (detail.status !== 'awaiting_approval' || !detail.checklistResult?.valid ||
      detail.preview?.actions?.length !== 1 || action.tool !== 'trello.create_card' ||
      action.args?.listId !== pilotConfig.trello.listId) {
    throw new Error('PREVIEW_INVALID: expected one reviewed Trello action and valid intake');
  }
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  const workingTreeDirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim());
  const evidence = {
    observedAt: new Date().toISOString(), commit, workingTreeDirty,
    evidenceLabel: 'CONFIRMED_API_PREVIEW', liveWriteEnabled: false, writesAttempted: 0,
    runId: created.runId, sourceKey: created.sourceKey,
    sourceRevision: created.sourceRevision, status: detail.status,
    checklistResult: detail.checklistResult, preview: detail.preview,
  };
  await artifact.writeFile(`${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(JSON.stringify({
    status: detail.status, runId: created.runId,
    listName: action.args.listName, listId: action.args.listId,
    title: action.args.title, expiresAt: detail.preview.expiresAt,
    evidencePath: values.get('--output'), writesAttempted: 0,
  }) + '\n');
} finally {
  await api?.close();
  await db.close();
  await artifact.close();
}
