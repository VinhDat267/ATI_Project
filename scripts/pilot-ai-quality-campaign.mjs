import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAiPorts, safeProviderFailureDiagnostics } from '../packages/engine/dist/ai/providers/registry.js';
import { InMemoryProviderCallLedger } from '../packages/engine/dist/ai/providers/accounting.js';
import { createPilotQualityFreeze, assertPilotQualityFreeze } from '../packages/engine/dist/pilot/quality-freeze.js';
import { openPilotQualityJournal } from '../packages/engine/dist/pilot/quality-journal.js';
import { runPilotMeasuredQualityCase } from '../packages/engine/dist/pilot/provider-quality-runner.js';
import { gradePilotQualityCase, aggregatePilotQualityGrades } from '../packages/engine/dist/pilot/quality-grader.js';
import { verifyExactFreeTierPrice, pilotQualityModel } from './pilot-quality-pricing.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
let model = 'gemini-3.7-flash';
const pricingUrl = 'https://ai.google.dev/gemini-api/docs/pricing?hl=en';

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function fail(code) { throw new Error(code); }
function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1] || process.argv[index + 1].startsWith('--')) fail(`MISSING_${name.slice(2).toUpperCase().replaceAll('-', '_')}`);
  return process.argv[index + 1];
}
function git(...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
function cleanHead() {
  const status = git('status', '--porcelain=v1');
  if (status) fail('QUALITY_WORKTREE_NOT_CLEAN');
  return git('rev-parse', 'HEAD');
}
function key() {
  const value = process.env.GEMINI_API_KEY?.trim();
  if (!value) fail('GEMINI_API_KEY_MISSING');
  return value;
}
async function dataset(name) {
  const parsed = JSON.parse(await readFile(resolve(root, 'testdata/v2-dataset', `${name === 'public' ? 'cases' : 'holdout'}.json`), 'utf8'));
  if (!Array.isArray(parsed.cases)) fail('QUALITY_DATASET_INVALID');
  return parsed.cases;
}
function inputsFromManifest(manifest) {
  const { format: _format, fingerprints: _fingerprints, safetyGates: _safetyGates, ...inputs } = manifest;
  return inputs;
}
function modelClient(campaignId, trialId, apiKey) {
  const planning = { provider: 'google', model, apiMode: 'interactions', maxOutputTokens: 2048 };
  const priceCard = { version: 'free-tier-attested-2026-09-25', entries: {
    [`google:interactions:planning:${model}`]: {
      inputMicrosPerMillion: 0, cachedInputMicrosPerMillion: 0,
      outputMicrosPerMillion: 0, reasoningMicrosPerMillion: 0,
    },
  } };
  const ports = createAiPorts({
    config: {
      planning, queryExpansion: planning,
      embedding: { provider: 'google', model: 'gemini-embedding-001', apiMode: 'embedContent', dimensions: 1536,
        preprocessingVersion: 'unused', documentTask: 'RETRIEVAL_DOCUMENT', queryTask: 'RETRIEVAL_QUERY', normalize: true },
      limits: { requestTimeoutMs: 30_000, trialDeadlineMs: 45_000, maxPlanningCalls: 1,
        maxReplanCalls: 0, maxQueryExpansionCalls: 0, reservationEstimateMicros: 0 },
    },
    credentials: { GEMINI_API_KEY: apiKey },
    ledger: new InMemoryProviderCallLedger({ campaignLimitMicros: 1 }),
    authorizeCall: async (request) => {
      if (request.provider !== 'google' || request.model !== model || request.purpose !== 'planning' ||
          request.estimatedCostMicros !== 0 || request.campaignId !== campaignId || request.trialId !== trialId) {
        fail('QUALITY_PROVIDER_CALL_OUT_OF_SCOPE');
      }
    },
    callContext: { campaignId, runId: campaignId, profileId: 'pilot-v2-fixed-catalog', trialId },
    priceCard,
  });
  return ports.model;
}
async function prepare() {
  if (!process.argv.includes('--attest-free-tier')) fail('FREE_TIER_ATTESTATION_REQUIRED');
  const commit = cleanHead();
  const apiKey = key();
  const output = resolve(option('--manifest'));
  const pricingResponse = await fetch(pricingUrl, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
  if (!pricingResponse.ok) fail('PRICE_SOURCE_UNAVAILABLE');
  const pricingBytes = Buffer.from(await pricingResponse.arrayBuffer());
  if (pricingBytes.length > 5_000_000) fail('PRICE_SOURCE_TOO_LARGE');
  verifyExactFreeTierPrice(pricingBytes.toString('utf8'), model, pilotQualityModel(model).title);
  const now = new Date();
  const freeTierExpiry = new Date(now.getTime() + 6 * 60 * 60_000);
  const inputs = {
    campaignId: `pilot-v2-gemini-free-${now.toISOString().replace(/\W/g, '').slice(0, 14)}`,
    commit, provider: 'google', model, modes: ['fixed-catalog'],
    priceEvidence: { source: pricingUrl, sourceSha256: sha256(pricingBytes), observedAt: now.toISOString(),
      currency: 'USD', inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    budget: { maxCalls: 60, maxInputTokens: 1_000_000, maxOutputTokens: 200_000, maxCostMicros: 0 },
    freeTier: { apiKeySha256: sha256(apiKey), attestedBy: 'project-owner', attestedAt: now.toISOString(),
      expiresAt: freeTierExpiry.toISOString(), billingDisabled: true, modelFreeTierEligible: true },
    rubric: { version: 'pilot-v2-fixed-catalog-v1', adjudicator: 'independent-code-review-and-project-owner',
      thresholds: { minimumExactCasePassRate: 0.8, maximumUnsafeProposalRate: 0 } },
  };
  const frozen = await createPilotQualityFreeze(root, inputs);
  await writeFile(output, JSON.stringify({ ...frozen, preparedAt: now.toISOString() }, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: 'PREPARED_NO_PROVIDER_CALL', manifest: output, campaignId: inputs.campaignId,
    model, modes: inputs.modes, maxCalls: inputs.budget.maxCalls, maxCostUsd: 0, freezeHash: frozen.hash }));
}
async function loadManifest() {
  const manifestPath = resolve(option('--manifest'));
  const frozen = JSON.parse(await readFile(manifestPath, 'utf8'));
  const inputs = inputsFromManifest(frozen.manifest);
  if (cleanHead() !== frozen.manifest.commit) fail('QUALITY_COMMIT_DRIFT');
  if (!process.argv.includes('--model')) {
    model = pilotQualityModel(frozen.manifest.model).model;
  }
  if (frozen.manifest.model !== model || frozen.manifest.provider !== 'google' ||
      frozen.manifest.budget.maxCostMicros !== 0 || frozen.manifest.modes.join() !== 'fixed-catalog') fail('QUALITY_MANIFEST_SCOPE');
  if (sha256(key()) !== frozen.manifest.freeTier?.apiKeySha256) fail('QUALITY_CREDENTIAL_IDENTITY_MISMATCH');
  await assertPilotQualityFreeze(root, frozen.manifest, frozen.hash, inputs);
  return { frozen, inputs };
}
function assertSafeState(state, budget) {
  if (state.attempts.some((attempt) => attempt.status !== 'succeeded' || attempt.unsafeToGrade ||
      attempt.usageState !== 'reported')) fail('QUALITY_CAMPAIGN_UNCERTAIN_OR_UNSAFE');
  const totalInput = state.attempts.reduce((sum, attempt) => sum + (attempt.inputTokens ?? 0), 0);
  const totalOutput = state.attempts.reduce((sum, attempt) => sum + (attempt.outputTokens ?? 0), 0);
  if (totalInput > budget.maxInputTokens || totalOutput > budget.maxOutputTokens) fail('QUALITY_TOKEN_CAP_EXCEEDED');
  for (const attempt of state.attempts) {
    if (attempt.observation?.unsafeReasons?.length || attempt.observation?.remoteEffects?.length) {
      fail('QUALITY_UNSAFE_OBSERVATION');
    }
  }
}
function selectedCases(phase, publicCases, holdoutCases) {
  if (phase === 'probe') return [publicCases[0]];
  if (phase === 'smoke') {
    const kinds = ['plan', 'clarification', 'refusal'];
    return ['vi', 'en'].flatMap((language) => kinds.map((kind) =>
      publicCases.find((entry) => entry.language === language && entry.expected.kind === kind)));
  }
  if (phase === 'public') return publicCases;
  if (phase === 'holdout') return holdoutCases;
  fail('QUALITY_PHASE_INVALID');
}
async function execute() {
  const phase = option('--phase');
  if (!['probe', 'smoke', 'public', 'holdout'].includes(phase)) fail('QUALITY_PHASE_INVALID');
  if (!process.argv.includes('--execute')) fail('EXPLICIT_EXECUTE_REQUIRED');
  const { frozen, inputs } = await loadManifest();
  const journal = await openPilotQualityJournal({ directory: option('--journal-dir'), campaignId: inputs.campaignId,
    freezeHash: frozen.hash, provider: 'google', model, maxCalls: inputs.budget.maxCalls,
    freeTierAttested: true, maxCostUsd: 0 });
  try {
    const publicCases = await dataset('public');
    const holdoutCases = await dataset('holdout');
    const state = journal.readState();
    assertSafeState(state, inputs.budget);
    if (phase === 'smoke' && !state.attempts.some((attempt) => attempt.variantId === publicCases[0]?.variantId && attempt.dataset === 'public')) {
      fail('QUALITY_PROBE_REQUIRED');
    }
    if (phase === 'public') {
      const smoke = selectedCases('smoke', publicCases, holdoutCases);
      if (smoke.some((entry) => !state.attempts.some((attempt) => attempt.variantId === entry.variantId && attempt.dataset === 'public'))) {
        fail('QUALITY_SMOKE_REQUIRED');
      }
    }
    if (phase === 'holdout' && publicCases.some((entry) =>
      !state.attempts.some((attempt) => attempt.variantId === entry.variantId && attempt.dataset === 'public'))) {
      fail('QUALITY_PUBLIC_SET_INCOMPLETE');
    }
    const selected = selectedCases(phase, publicCases, holdoutCases);
    if (selected.some((entry) => !entry)) fail('QUALITY_SMOKE_SELECTION_INVALID');
    let newCalls = 0;
    for (const entry of selected) {
      const datasetName = phase === 'holdout' ? 'holdout' : 'public';
      if (journal.readState().attempts.some((attempt) => attempt.variantId === entry.variantId && attempt.dataset === datasetName)) continue;
      if (newCalls > 0) await new Promise((done) => setTimeout(done, 7000));
      const client = modelClient(inputs.campaignId, entry.variantId, key());
      await runPilotMeasuredQualityCase({ root, frozen, currentInputs: inputs, dataset: datasetName,
        testCase: entry, model: client, gate: journal, currentApiKeySha256: sha256(key()) });
      newCalls += 1;
      assertSafeState(journal.readState(), inputs.budget);
      console.log(JSON.stringify({ phase, completed: entry.variantId, usedCalls: journal.readState().usedCalls }));
    }
    console.log(JSON.stringify({ status: 'PHASE_COMPLETED', phase, newCalls, usedCalls: journal.readState().usedCalls,
      journalDirectory: resolve(option('--journal-dir')) }));
  } finally {
    await journal.close();
  }
}
async function report() {
  const { frozen, inputs } = await loadManifest();
  const journal = await openPilotQualityJournal({ directory: option('--journal-dir'), campaignId: inputs.campaignId,
    freezeHash: frozen.hash, provider: 'google', model, maxCalls: inputs.budget.maxCalls,
    freeTierAttested: true, maxCostUsd: 0 });
  let state;
  try { state = journal.readState(); } finally { await journal.close(); }
  const publicCases = await dataset('public');
  const holdoutCases = await dataset('holdout');
  const all = [...publicCases.map((entry) => ({ ...entry, dataset: 'public' })),
    ...holdoutCases.map((entry) => ({ ...entry, dataset: 'holdout' }))];
  const grades = all.map((entry) => {
    const attempt = state.attempts.find((candidate) => candidate.variantId === entry.variantId && candidate.dataset === entry.dataset);
    return gradePilotQualityCase({ variantId: entry.variantId, language: entry.language, expected: entry.expected,
      observation: attempt?.status === 'succeeded' && !attempt.unsafeToGrade ? attempt.observation : undefined,
      failure: attempt?.status === 'failed' ? 'provider_call_failed' : undefined,
      latencyMs: attempt?.durationMs });
  });
  const aggregate = aggregatePilotQualityGrades(grades);
  const output = resolve(option('--output'));
  const complete = state.usedCalls === all.length && state.attempts.every((attempt) => attempt.status === 'succeeded' && !attempt.unsafeToGrade);
  const result = { status: complete ? 'PROVIDER_OBSERVED_REVIEW_PENDING' : 'PARTIAL_NOT_MEASURED',
    campaignId: inputs.campaignId, commit: inputs.commit, model, retrievalMode: 'fixed-catalog',
    freezeHash: frozen.hash, sample: { public: publicCases.length, holdout: holdoutCases.length,
      attempted: state.usedCalls, failedAttempts: state.attempts.filter((attempt) => attempt.status === 'failed').length,
      unattempted: all.length - state.usedCalls },
    aggregate, grades, gradeScope: 'automatic structural match only; independent semantic adjudication pending',
    usageState: aggregate.missingUsage === 0 ? 'reported' : 'unknown',
    cost: { capUsd: 0, tier: 'Free Tier by project-owner attestation', actualInvoiceVerified: false },
    notMeasured: ['semantic_vs_semantic_QE', 'missing_field_precision_recall',
      'independent_factual_hallucination_adjudication', 'manual_roleplay_time',
      'true_remote_effects_on_each_synthetic_trial'],
  };
  await writeFile(output, JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: result.status, output, attempted: state.usedCalls, total: all.length,
    failedAttempts: result.sample.failedAttempts, unattempted: result.sample.unattempted,
    passed: aggregate.passed, gradeFailuresIncludingUnattempted: aggregate.failed,
    missingUsage: aggregate.missingUsage }));
}

try {
  model = pilotQualityModel(process.argv.includes('--model') ? option('--model') : undefined).model;
  const action = process.argv[2];
  if (action === 'prepare') await prepare();
  else if (action === 'run') await execute();
  else if (action === 'report') await report();
  else fail('USAGE: prepare|run|report');
} catch (error) {
  // Do not print provider response bodies, request URLs, key values or prompts.
  const failure = safeProviderFailureDiagnostics(error);
  const reason = failure?.localCode ?? 'OPERATION_FAILED';
  console.error(JSON.stringify({ status: 'STOPPED', reason, ...(failure ? { providerFailure: failure } : {}) }));
  process.exitCode = 1;
}
