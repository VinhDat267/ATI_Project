import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const { describe, it } = process.env.VITEST
  ? await import('vitest')
  : await import('node:test');

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../..');

describe('SLACK-07 · Slack Triage Evaluation Harness & Frozen Dataset Gates', () => {
  it('AC1: loads 50+ diverse pre-labelled cases across all 8 required categories and verifies frozen SHA-256 integrity', async () => {
    const {
      loadFrozenSlackDataset,
      verifyFrozenDatasetIntegrity,
      REQUIRED_SLACK_EVAL_CATEGORIES,
    } = await import('../../scripts/eval-slack-triage.mjs');

    const dataset = loadFrozenSlackDataset(rootDir);
    assert.ok(dataset.cases.length >= 50, `Expected >= 50 cases, got ${dataset.cases.length}`);
    assert.equal(dataset.cases.length, Object.keys(dataset.labels.items).length);

    const observedCategories = new Set(dataset.cases.map((c) => c.category));
    for (const category of REQUIRED_SLACK_EVAL_CATEGORIES) {
      assert.ok(observedCategories.has(category), `Missing required category: ${category}`);
    }

    const integrity = verifyFrozenDatasetIntegrity(dataset);
    assert.equal(integrity.valid, true);
    assert.match(integrity.casesSha256, /^[a-f0-9]{64}$/);
    assert.match(integrity.labelsSha256, /^[a-f0-9]{64}$/);

    // Tampering with a case or label must fail integrity verification
    const tampered = structuredClone(dataset);
    tampered.cases[0].messages[0].text = 'Tampered after freeze';
    assert.throws(
      () => verifyFrozenDatasetIntegrity(tampered),
      /SLACK_EVAL_DATASET_HASH_MISMATCH/,
    );
  });

  it('F1 Gate: blocks builder model defaults, unverified providers, training-enabled providers, and missing org consent before any evaluation', async () => {
    const { verifyEvaluationProviderGate } = await import('../../scripts/eval-slack-triage.mjs');

    // Builder model hardcode must be rejected
    assert.throws(
      () =>
        verifyEvaluationProviderGate({
          evaluationMode: 'synthetic_offline',
          providerId: 'gemini-3.8-flash-high',
          providerVerified: true,
          noTraining: true,
          maxRetentionDays: 1,
          consentStatus: 'granted',
          policyVersion: '2026-10-28.v1',
          requestedRetentionDays: 1,
        }),
      /SLACK_EVAL_BUILDER_MODEL_FORBIDDEN/,
    );

    // Training-enabled provider must be rejected
    assert.throws(
      () =>
        verifyEvaluationProviderGate({
          evaluationMode: 'synthetic_offline',
          providerId: 'eval-synthetic-fixture-v1',
          providerVerified: true,
          noTraining: false,
          maxRetentionDays: 1,
          consentStatus: 'granted',
          policyVersion: '2026-10-28.v1',
          requestedRetentionDays: 1,
        }),
      /SLACK_EVAL_POLICY_DENIED:provider_unverified/,
    );

    // Missing org consent must be rejected
    assert.throws(
      () =>
        verifyEvaluationProviderGate({
          evaluationMode: 'synthetic_offline',
          providerId: 'eval-synthetic-fixture-v1',
          providerVerified: true,
          noTraining: true,
          maxRetentionDays: 1,
          consentStatus: 'pending',
          policyVersion: '2026-10-28.v1',
          requestedRetentionDays: 1,
        }),
      /SLACK_EVAL_POLICY_DENIED:consent_missing/,
    );

    // Live source evaluation without concrete authorization must be rejected
    assert.throws(
      () =>
        verifyEvaluationProviderGate({
          evaluationMode: 'live_source',
          providerId: 'eval-authorized-v1',
          providerVerified: true,
          noTraining: true,
          maxRetentionDays: 1,
          consentStatus: 'granted',
          policyVersion: '2026-10-28.v1',
          requestedRetentionDays: 1,
        }),
      /SLACK_EVAL_LIVE_AUTHORIZATION_REQUIRED/,
    );

    // Valid synthetic offline gate passes
    const gate = verifyEvaluationProviderGate({
      evaluationMode: 'synthetic_offline',
      providerId: 'eval-synthetic-fixture-v1',
      providerVerified: true,
      noTraining: true,
      maxRetentionDays: 7,
      consentStatus: 'granted',
      policyVersion: '2026-10-28.v1',
      requestedRetentionDays: 1,
    });
    assert.equal(gate.allowed, true);
  });

  it(
    'AC2 & AC3: executes 3-run protocol across Rules, AI, and Hybrid modes meeting Precision >= 90%, Recall >= 85%, 0 unapproved writes, and 0 cross-user leaks',
    { timeout: 30000 },
    async () => {
      const {
        runSlackTriageBenchmark,
        formatSlackTriageReportMarkdown,
      } = await import('../../scripts/eval-slack-triage.mjs');

      const report = await runSlackTriageBenchmark({ rootDir, runs: 3 });

      assert.equal(report.runsPerMode, 3);
      assert.equal(report.totalRuns, 9);
      assert.equal(report.hardGates.unapprovedWrites, 0);
      assert.equal(report.hardGates.crossUserLeaks, 0);
      assert.equal(report.hardGates.passed, true);

      // Check all 3 modes have 3 runs each
      for (const mode of ['rules', 'ai', 'hybrid']) {
        const modeSummary = report.modes[mode];
        assert.ok(modeSummary, `Missing mode summary for ${mode}`);
        assert.equal(modeSummary.runs.length, 3);
        for (const run of modeSummary.runs) {
          assert.equal(run.unapprovedWrites, 0);
          assert.equal(run.crossUserLeaks, 0);
        }
      }

      // AC2: Hybrid mode must achieve Precision >= 90% and Recall >= 85% on all 3 runs
      for (const run of report.modes.hybrid.runs) {
        assert.ok(
          run.precision >= 0.9,
          `Expected hybrid precision >= 0.90, got ${run.precision}`,
        );
        assert.ok(
          run.recall >= 0.85,
          `Expected hybrid recall >= 0.85, got ${run.recall}`,
        );
      }

      // Markdown report formatting check
      const markdown = formatSlackTriageReportMarkdown(report);
      assert.match(markdown, /# Báo cáo Đánh giá Phân loại Trợ lý Slack \(SLACK-07\)/);
      assert.match(markdown, /Unapproved Writes \| 0/);
      assert.match(markdown, /Cross-User Leaks \| 0/);
      assert.match(markdown, /NOT_RUN/);
    },
  );

  it('requires real runtime sources and rejects standalone execution without apps/ or packages/', async () => {
    const { assertRuntimeSourcesExist } = await import('../../scripts/eval-slack-triage.mjs');
    assert.throws(
      () => assertRuntimeSourcesExist(resolve(rootDir, 'evaluations')),
      /SLACK_EVAL_RUNTIME_SOURCES_MISSING/,
    );
  });

  it('AC3 Negative Gate: fails immediately if a simulated fault introduces an unapproved write or cross-user leak', async () => {
    const { assertHardSafetyGates } = await import('../../scripts/eval-slack-triage.mjs');

    assert.throws(
      () => assertHardSafetyGates({ unapprovedWrites: 1, crossUserLeaks: 0 }),
      /SLACK_EVAL_HARD_GATE_FAILED:unapproved_writes=1/,
    );

    assert.throws(
      () => assertHardSafetyGates({ unapprovedWrites: 0, crossUserLeaks: 1 }),
      /SLACK_EVAL_HARD_GATE_FAILED:cross_user_leaks=1/,
    );
  });

  it('AC5 & AC6: preserves .env.example default-off flags and verifies 354-method inventory contract', () => {
    const envExample = readFileSync(resolve(rootDir, '.env.example'), 'utf8');
    assert.doesNotMatch(envExample, /^MYSLACK_ENABLED=on$/m);
    assert.doesNotMatch(envExample, /^MYSLACK_AUTOMATION_ENABLED=on$/m);
    assert.doesNotMatch(envExample, /^MYSLACK_WRITES_ENABLED=on$/m);

    const inventory = JSON.parse(
      readFileSync(resolve(rootDir, 'docs/slack/method-inventory.json'), 'utf8'),
    );
    assert.equal(inventory.methods.length, 354);
    const searchMethods = inventory.methods.filter((m) => m.method.startsWith('search.'));
    assert.equal(searchMethods.length, 3);
    for (const sm of searchMethods) {
      assert.equal(sm.disposition, 'probe_required');
      assert.ok(sm.userScopes.includes('search:read'));
    }
  });
});
