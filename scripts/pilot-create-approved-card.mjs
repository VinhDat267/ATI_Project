import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '@wap/db';
import { loadPilotConfig } from '@wap/engine';
import { createApi } from '../apps/api/dist/app.js';
import { hashPassword } from '../apps/api/dist/auth.js';
import { buildPilotApproval } from '../apps/api/dist/pilot-approval.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const values = new Map();
for (let i = 0; i < args.length; i += 2) {
  const flag = args[i];
  const value = args[i + 1];
  if (!['--approved-preview', '--output'].includes(flag) || !value || values.has(flag)) {
    throw new Error('Usage: node scripts/pilot-create-approved-card.mjs --approved-preview FILE --output NEW_FILE');
  }
  values.set(flag, value);
}
if (args.length !== 4 || values.size !== 2 || process.env.PILOT_V2_WRITE_ENABLED !== 'true') {
  throw new Error('ONE_CARD_GATE: exact approved preview, new output path and PILOT_V2_WRITE_ENABLED=true required');
}
const databaseUrl = process.env.PILOT_PREVIEW_DATABASE_URL;
if (!databaseUrl) throw new Error('PILOT_PREVIEW_DATABASE_URL is required');
const database = new URL(databaseUrl);
if (database.hostname !== '127.0.0.1' || !/^\/wap_pilot_preview_[0-9]{8}$/.test(database.pathname)) {
  throw new Error('PREVIEW_DATABASE_SCOPE: isolated loopback pilot preview database required');
}
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
if (execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim()) {
  throw new Error('WORKTREE_DIRTY: commit and review the operator script before live write');
}
const approved = JSON.parse(await readFile(values.get('--approved-preview'), 'utf8'));
const approvedAction = approved.preview?.actions?.[0];
if (approved.evidenceLabel !== 'CONFIRMED_API_PREVIEW' || approved.status !== 'awaiting_approval' ||
    approved.writesAttempted !== 0 || !approved.checklistResult?.valid ||
    approved.preview?.actions?.length !== 1 || approvedAction?.tool !== 'trello.create_card' ||
    typeof approvedAction.args?.title !== 'string' || typeof approvedAction.args?.description !== 'string' ||
    typeof approvedAction.args?.dueDate !== 'string' || typeof approved.sourceRevision !== 'string' ||
    typeof approved.sourceKey !== 'string') {
  throw new Error('APPROVED_PREVIEW_INVALID: expected one prior reviewed card action');
}
const pilotConfig = loadPilotConfig();
const principal = process.env.PILOT_PREVIEW_PRINCIPAL?.trim() || pilotConfig.principals[0];
if (!pilotConfig.enabled || !principal || !pilotConfig.principals.includes(principal) ||
    !pilotConfig.trello?.listId || pilotConfig.trello.listId !== approvedAction.args.listId ||
    pilotConfig.boardId !== approvedAction.args.boardId) {
  throw new Error('APPROVED_TARGET_MISMATCH: principal, board or list changed');
}
const policy = {
  enabled: true, principals: pilotConfig.principals,
  spreadsheetId: pilotConfig.spreadsheetId, tabId: pilotConfig.tabId,
  boardId: pilotConfig.boardId,
};
const evidenceFile = await open(values.get('--output'), 'wx', 0o600);
const evidence = {
  observedAt: new Date().toISOString(), codeHead: head,
  approvalSource: values.get('--approved-preview'),
  priorRunId: approved.runId, priorSourceRevision: approved.sourceRevision,
  status: 'preflight_pending', approvalSubmitted: false,
};
async function saveEvidence() {
  const bytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
  await evidenceFile.write(bytes, 0, bytes.length, 0);
  await evidenceFile.truncate(bytes.length);
  await evidenceFile.sync();
}
await saveEvidence();
const db = openDatabase(databaseUrl);
let api;
let dispatchStarted = false;
try {
  const priorRows = await db.client`
    SELECT r.user_id, r.inputs, s.source_key, s.source_revision, s.raw_data,
           a.owner_id, a.version_id, a.snapshot_hash, v.plan
    FROM runs r
    JOIN source_snapshots s ON s.run_id = r.id
    JOIN pilot_approvals a ON a.run_id = r.id
    JOIN workflow_versions v ON v.id = a.version_id
    WHERE r.id = ${approved.runId}`;
  const prior = priorRows[0];
  if (priorRows.length !== 1 || prior.user_id !== principal || prior.owner_id !== principal ||
      prior.inputs?.requestId !== 'REQ-SBX-001' || prior.raw_data?.request_id !== 'REQ-SBX-001' ||
      prior.inputs?.spreadsheetId !== pilotConfig.spreadsheetId ||
      prior.inputs?.tabId !== pilotConfig.tabId ||
      prior.source_key !== approved.sourceKey || prior.source_revision !== approved.sourceRevision ||
      prior.version_id !== approved.preview.versionId ||
      prior.snapshot_hash !== approved.preview.snapshotHash) {
    throw new Error('PRIOR_SNAPSHOT_MISMATCH: approved artifact differs from durable run');
  }
  const priorPlan = buildPilotApproval({
    runId: approved.runId, ownerId: principal, versionId: prior.version_id,
    sourceKey: prior.source_key, sourceRevision: prior.source_revision,
    row: prior.raw_data, policy, targetListId: pilotConfig.trello.listId,
    targetListName: prior.plan?.targetListName,
  });
  if (priorPlan.snapshotHash !== prior.snapshot_hash ||
      !isDeepStrictEqual({ tool: 'trello.create_card', args: priorPlan.actionArgs, sideEffect: 'write' }, approvedAction)) {
    throw new Error('PRIOR_SNAPSHOT_MISMATCH: approved action differs from durable snapshot');
  }
  const reservations = await db.client`
    SELECT status FROM business_reservations
    WHERE source_key = ${approved.sourceKey} AND board_id = ${pilotConfig.boardId}`;
  if (reservations.length) throw new Error('EXISTING_INTENT: reconcile reservation before any write');

  // A read-only duplicate check catches manually created cards on this board.
  const cardsUrl = new URL(`https://api.trello.com/1/boards/${encodeURIComponent(pilotConfig.boardId)}/cards`);
  cardsUrl.searchParams.set('key', pilotConfig.trello.apiKey);
  cardsUrl.searchParams.set('token', pilotConfig.trello.apiToken);
  cardsUrl.searchParams.set('filter', 'visible');
  cardsUrl.searchParams.set('fields', 'id,name,desc,due,idList,url');
  const cardsResponse = await fetch(cardsUrl, { signal: AbortSignal.timeout(10_000) });
  if (!cardsResponse.ok) throw new Error(`TRELLO_DUPLICATE_CHECK_FAILED: HTTP ${cardsResponse.status}`);
  const cards = await cardsResponse.json();
  if (!Array.isArray(cards)) throw new Error('TRELLO_DUPLICATE_CHECK_FAILED: invalid response');
  if (cards.some((card) => card.name?.trim() === approvedAction.args.title.trim())) {
    throw new Error('POSSIBLE_DUPLICATE_CARD: matching title already exists on board');
  }

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
    pilotConfig, pilotPolicy: policy, pilotLiveWriteEnabled: true,
    requestLogger: () => {},
  });
  const base = await api.listen();
  const origin = base.replace(/\/api\/v1$/, '');
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: users[0].email, password }),
  });
  if (!login.ok) throw new Error(`PILOT_LOGIN_FAILED: HTTP ${login.status}`);
  const { token } = await login.json();
  if (!token) throw new Error('PILOT_LOGIN_FAILED: missing token');
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const createResponse = await fetch(`${origin}/pilot/v2/runs`, {
    method: 'POST', headers,
    body: JSON.stringify({
      spreadsheetId: pilotConfig.spreadsheetId, tabId: pilotConfig.tabId,
      requestId: 'REQ-SBX-001',
      userPrompt: 'Tạo đúng một thẻ Trello theo preview sandbox đã được chủ project cho phép.',
      timeZone: 'Asia/Ho_Chi_Minh',
    }),
  });
  if (createResponse.status !== 202) {
    const failure = await createResponse.json().catch(() => ({}));
    throw new Error(`FRESH_PREVIEW_FAILED: HTTP ${createResponse.status} ${failure.error?.code ?? ''}`);
  }
  const created = await createResponse.json();
  evidence.runId = created.runId;
  const detailResponse = await fetch(`${origin}/pilot/v2/runs/${created.runId}`, { headers });
  if (!detailResponse.ok) throw new Error(`FRESH_PREVIEW_DETAIL_FAILED: HTTP ${detailResponse.status}`);
  const detail = await detailResponse.json();
  evidence.freshPreview = detail.preview;
  evidence.freshSourceRevision = created.sourceRevision;
  await saveEvidence();
  if (detail.status !== 'awaiting_approval' || !detail.checklistResult?.valid ||
      detail.preview?.unconfirmedBusiness || detail.preview?.missingFields?.length ||
      detail.preview?.actions?.length !== 1 ||
      !isDeepStrictEqual(detail.preview.actions[0], approvedAction) ||
      created.sourceRevision !== approved.sourceRevision || created.sourceKey !== approved.sourceKey) {
    throw new Error('FRESH_PREVIEW_CHANGED: user review required before any Trello write');
  }
  if (Date.parse(detail.preview.expiresAt) - Date.now() < 60_000) {
    throw new Error('FRESH_APPROVAL_TOO_OLD');
  }

  evidence.status = 'approval_submitting';
  evidence.approvalSubmitted = true;
  await saveEvidence();
  dispatchStarted = true;
  const approvedResponse = await fetch(`${origin}/pilot/v2/runs/${created.runId}/approve`, {
    method: 'POST', headers,
    body: JSON.stringify({
      decision: 'approved', approvalId: detail.preview.approvalId,
      versionId: detail.preview.versionId, snapshotHash: detail.preview.snapshotHash,
    }),
  });
  evidence.approvalHttpStatus = approvedResponse.status;
  const approvalResult = await approvedResponse.json().catch(() => ({}));
  evidence.approvalResult = approvalResult;
  const afterResponse = await fetch(`${origin}/pilot/v2/runs/${created.runId}`, { headers });
  if (afterResponse.ok) {
    const after = await afterResponse.json();
    evidence.finalRunStatus = after.status;
    evidence.receipt = after.receipt;
  }
  if (approvedResponse.status !== 200 || approvalResult.status !== 'succeeded' ||
      evidence.finalRunStatus !== 'succeeded' || !evidence.receipt?.cardId) {
    evidence.status = 'reconciliation_required';
    await saveEvidence();
    process.exitCode = 2;
  } else {
    const cardUrl = new URL(`https://api.trello.com/1/cards/${encodeURIComponent(evidence.receipt.cardId)}`);
    cardUrl.searchParams.set('key', pilotConfig.trello.apiKey);
    cardUrl.searchParams.set('token', pilotConfig.trello.apiToken);
    cardUrl.searchParams.set('fields', 'id,name,desc,due,idList,idBoard,url');
    const cardResponse = await fetch(cardUrl, { signal: AbortSignal.timeout(10_000) });
    if (cardResponse.ok) {
      const card = await cardResponse.json();
      evidence.remoteVerified = card.id === evidence.receipt.cardId &&
        card.idBoard === approvedAction.args.boardId && card.idList === approvedAction.args.listId &&
        card.name === approvedAction.args.title && card.desc === approvedAction.args.description &&
        card.due?.slice(0, 10) === approvedAction.args.dueDate;
    } else {
      evidence.remoteVerified = false;
    }
    evidence.status = evidence.remoteVerified ? 'confirmed' : 'receipt_needs_remote_check';
    await saveEvidence();
    if (!evidence.remoteVerified) process.exitCode = 2;
  }
  process.stdout.write(JSON.stringify({
    status: evidence.status, runId: evidence.runId,
    cardId: evidence.receipt?.cardId ?? null,
    cardUrl: evidence.receipt?.url ?? null,
    evidencePath: values.get('--output'),
  }) + '\n');
} catch (error) {
  evidence.status = dispatchStarted ? 'reconciliation_required' : 'blocked_before_approval';
  evidence.errorCode = error instanceof Error ? error.message.split(':')[0] : 'UNKNOWN';
  await saveEvidence();
  process.stderr.write(`Pilot one-card run stopped: ${evidence.errorCode}; inspect evidence and DB before any retry\n`);
  process.exitCode = 2;
} finally {
  await api?.close();
  await db.close();
  await evidenceFile.close();
}
