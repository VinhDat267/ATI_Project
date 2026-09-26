import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StructuredModelClient } from '../src/ai/ports.js';
import { ProviderClientError } from '../src/ai/providers/registry.js';
import { PILOT_TOOL_CATALOG } from '../src/pilot/gateway.js';
import { createPilotQualityFreeze, type PilotQualityFreezeInputs } from '../src/pilot/quality-freeze.js';
import { createPilotSimulatedModel, createPilotSimulatedRetriever, preparePilotQualitySource, runPilotMeasuredQualityCase, runPilotProviderQualityCase, type PilotQualityRetriever } from '../src/pilot/provider-quality-runner.js';
import type { PilotQualityMeasuredGate } from '../src/pilot/quality-journal.js';
import { runPilotProviderQualityCli } from '../src/pilot/provider-quality-cli.js';

const root = resolve(import.meta.dirname, '../../..');
const cases = JSON.parse(readFileSync(resolve(root, 'testdata/v2-dataset/cases.json'), 'utf8')).cases;
const fixture = cases[0];
const incompleteFixture = cases.find((entry: { variantId: string }) => entry.variantId === 'V2-09-vi');
const missingFixture = cases.find((entry: { variantId: string }) => entry.variantId === 'V2-11-vi');
const unsupportedTypeFixture = cases.find((entry: { variantId: string }) => entry.variantId === 'V2-20-vi');

function inputs(): PilotQualityFreezeInputs {
  return {
    campaignId: 'contract-test', commit: 'a'.repeat(40), provider: 'test-provider', model: 'test-model',
    modes: ['semantic', 'semantic+QE'],
    priceEvidence: { source: 'contract fixture', sourceSha256: 'b'.repeat(64), observedAt: '2026-09-23T00:00:00Z', currency: 'USD', inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2 },
    budget: { maxCalls: 10, maxInputTokens: 1000, maxOutputTokens: 1000, maxCostMicros: 1000 },
    rubric: { version: 'contract-test', adjudicator: 'test reviewer', thresholds: { minimumCasePassRate: 0.8 } },
  };
}

function fakePorts(output: unknown = { kind: 'refusal', reason: 'Human review required' }) {
  const { model, requests } = createPilotSimulatedModel({
    output, provider: 'test-provider', model: 'test-model', requestId: 'fake-call',
    usage: { inputTokens: 3, outputTokens: 4 },
  });
  const simulated = createPilotSimulatedRetriever(['trello.create_card']);
  return { model, retriever: simulated.retriever, requests, retrievals: simulated.requests };
}

function writePlan(boardId = 'board-pilot-001'): unknown {
  return { kind: 'plan', plan: { version: '1.0', name: 'Create card', source_prompt: 'source prompt', steps: [
    { id: 'create', description: 'Create card', tool: { server: 'trello', name: 'trello.create_card', args: { boardId, title: 'Test' } }, side_effect: 'write', idempotency_key: 'intent-1' },
  ] } };
}

describe('pilot v2 provider quality runner', () => {
  it('keeps oracle labels out of provider input and observed decision', async () => {
    const frozen = await createPilotQualityFreeze(root, inputs());
    const ports = fakePorts();
    const base = { root, frozen, currentInputs: inputs(), mode: 'semantic' as const, dataset: 'public' as const, model: ports.model, retriever: ports.retriever };
    const first = await runPilotProviderQualityCase({ ...base, testCase: fixture });
    const request = JSON.stringify(ports.requests[0]);
    const second = await runPilotProviderQualityCase({ ...base, testCase: fixture });
    expect(ports.requests[1]).toEqual(ports.requests[0]);
    expect(second.result).toEqual(first.result);
    expect(request).not.toMatch(/"(?:caseId|fault|expected|evidence|verdict)"/);
    const userPrompt = (ports.requests[0] as { userPrompt: string }).userPrompt;
    const catalog = userPrompt.split('=== RUNTIME PARAMETERS ===')[0];
    expect(catalog).toContain('trello.create_card');
    expect(catalog).not.toContain('trello.get_card');
    expect(ports.retrievals).toHaveLength(2);
  });

  it('changes the model input when source evidence changes', async () => {
    const frozen = await createPilotQualityFreeze(root, inputs());
    const ports = fakePorts();
    const base = { root, frozen, currentInputs: inputs(), mode: 'semantic' as const, dataset: 'public' as const, model: ports.model, retriever: ports.retriever };
    await runPilotProviderQualityCase({ ...base, testCase: fixture });
    await runPilotProviderQualityCase({ ...base, testCase: cases[1] });
    expect(ports.requests[1]).not.toEqual(ports.requests[0]);
    expect(JSON.stringify(ports.requests[1])).toContain(cases[1].sourceFixture.rows[0][3]);
  });

  it('captures an unsafe proposed write on incomplete intake without remote effects', async () => {
    const frozen = await createPilotQualityFreeze(root, inputs());
    const ports = fakePorts(writePlan());
    const observed = await runPilotProviderQualityCase({ root, frozen, currentInputs: inputs(), mode: 'semantic', dataset: 'public', testCase: incompleteFixture, model: ports.model, retriever: ports.retriever });
    expect(observed.proposedEffects).toMatchObject([{ tool: 'trello.create_card', sideEffect: 'write' }]);
    expect(observed.unsafeReasons).toContain('write_proposed_for_incomplete_intake');
    expect(observed.remoteEffects).toEqual([]);
    expect(observed.evidenceLabel).toBe('SIMULATED_ONLY');
  });

  it('treats a create tool as a write even when the model claims read', async () => {
    const frozen = await createPilotQualityFreeze(root, inputs());
    const lie = structuredClone(writePlan()) as any;
    lie.plan.steps[0].side_effect = 'read';
    lie.plan.steps[0].tool.name = 'create_card';
    const ports = fakePorts(lie);
    const observed = await runPilotProviderQualityCase({
      root, frozen, currentInputs: inputs(), mode: 'semantic', dataset: 'public', testCase: incompleteFixture,
      model: ports.model, retriever: ports.retriever,
    });
    expect(observed.proposedEffects[0]?.sideEffect).toBe('write');
    expect(observed.unsafeReasons).toContain('write_proposed_for_incomplete_intake');
  });

  it('checks the manifest before retrieval or model dispatch', async () => {
    const frozen = await createPilotQualityFreeze(root, inputs());
    const ports = fakePorts();
    await expect(runPilotProviderQualityCase({ root, frozen: { ...frozen, hash: '0'.repeat(64) }, currentInputs: inputs(), mode: 'semantic', dataset: 'public', testCase: fixture, model: ports.model, retriever: ports.retriever }))
      .rejects.toThrow(/manifest hash mismatch/i);
    expect(ports.requests).toHaveLength(0);
    expect(ports.retrievals).toHaveLength(0);
  });

  it('blocks an arbitrary retriever before its callback or model dispatch', async () => {
    const frozen = await createPilotQualityFreeze(root, inputs());
    const ports = fakePorts();
    const retriever: PilotQualityRetriever = {
      kind: 'simulated',
      async retrieve() {
        retrievalCalls += 1;
        return [{ ...PILOT_TOOL_CATALOG[0]!, name: 'trello.unsafe_create' }];
      },
    };
    let retrievalCalls = 0;
    await expect(runPilotProviderQualityCase({
      root, frozen, currentInputs: inputs(), mode: 'semantic', dataset: 'public', testCase: fixture,
      model: ports.model, retriever,
    })).rejects.toThrow(/QUALITY_RETRIEVER_NOT_SIMULATED/);
    expect(retrievalCalls).toBe(0);
    expect(ports.requests).toHaveLength(0);
  });

  it('rejects an unreviewed tool at simulated retriever construction', () => {
    expect(() => createPilotSimulatedRetriever(['trello.unsafe_create'])).toThrow(/UNREVIEWED/);
  });

  it('rejects an arbitrary model before retrieval or provider dispatch', async () => {
    const frozen = await createPilotQualityFreeze(root, inputs());
    const ports = fakePorts();
    let calls = 0;
    const providerBackedModel: StructuredModelClient = {
      async complete() {
        calls += 1;
        throw new Error('unexpected provider dispatch');
      },
    };
    await expect(runPilotProviderQualityCase({
      root, frozen, currentInputs: inputs(), mode: 'semantic', dataset: 'public', testCase: fixture,
      model: providerBackedModel, retriever: ports.retriever,
    })).rejects.toThrow(/QUALITY_MODEL_NOT_SIMULATED/);
    expect(calls).toBe(0);
    expect(ports.retrievals).toHaveLength(0);
  });

  it('rejects a modified case before retrieval or model dispatch', async () => {
    const frozen = await createPilotQualityFreeze(root, inputs());
    const ports = fakePorts();
    const changed = structuredClone(fixture);
    changed.sourceFixture.rows[0][3] = 'Unlisted request text';
    await expect(runPilotProviderQualityCase({
      root, frozen, currentInputs: inputs(), mode: 'semantic', dataset: 'public',
      testCase: changed, model: ports.model, retriever: ports.retriever,
    })).rejects.toThrow(/QUALITY_CASE_NOT_FROZEN/);
    expect(ports.retrievals).toHaveLength(0);
    expect(ports.requests).toHaveLength(0);
  });
});

describe('pilot v2 provider quality CLI gate', () => {
  it('requires --execute and refuses a measured campaign without approved pilot retrieval', async () => {
    const frozen = await createPilotQualityFreeze(root, inputs());
    const ports = fakePorts();
    const deps = { root, frozen, currentInputs: inputs(), dataset: 'public' as const, testCase: fixture, model: ports.model, retriever: ports.retriever };
    expect(await runPilotProviderQualityCli(['--phase', 'public', '--mode', 'semantic'], deps))
      .toMatchObject({ status: 'NOT_RUN' });
    expect(ports.requests).toHaveLength(0);
    await expect(runPilotProviderQualityCli(['--phase', 'public', '--mode', 'semantic', '--execute', '--measured'], deps))
      .rejects.toThrow(/fixed-catalog, credential identity and durable campaign gate/i);
    expect(ports.requests).toHaveLength(0);
    expect(await runPilotProviderQualityCli(['--phase', 'public', '--mode', 'semantic', '--execute'], deps))
      .toMatchObject({ status: 'SIMULATED_ONLY' });
    expect(ports.requests).toHaveLength(1);
  });
});

describe('pilot v2 measured provider boundary', () => {
  function freeInputs(): PilotQualityFreezeInputs {
    return {
      ...inputs(), campaignId: 'gemini-free-contract', provider: 'google', model: 'gemini-2.5-flash',
      evaluationProfile: 'model-only-v1',
      modes: ['fixed-catalog'], budget: { ...inputs().budget, maxCostMicros: 0 },
      freeTier: {
        apiKeySha256: 'c'.repeat(64), attestedBy: 'pilot operator',
        attestedAt: '2026-09-25T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z',
        billingDisabled: true, modelFreeTierEligible: true,
      },
    };
  }
  function gate(hash: string) {
    const reservations: unknown[] = [];
    const outcomes: unknown[] = [];
    const value: PilotQualityMeasuredGate = {
      kind: 'durable', campaignId: 'gemini-free-contract', freezeHash: hash,
      async authorizeAndReserve(input) { reservations.push(input); return { attemptId: 'attempt-1' }; },
      async recordOutcome(input) { outcomes.push(input); },
    };
    return { value, reservations, outcomes };
  }
  it('sends only source/checklist/tool context to provider and records observation before returning', async () => {
    const frozen = await createPilotQualityFreeze(root, freeInputs());
    const journal = gate(frozen.hash);
    const requests: unknown[] = [];
    const model: StructuredModelClient = { async complete(input) {
      requests.push(input);
      return { output: writePlan(), provider: 'google', model: 'gemini-2.5-flash',
        requestId: 'fake-provider-request', usage: { inputTokens: 12, outputTokens: 8 } };
    } };
    const result = await runPilotMeasuredQualityCase({ root, frozen, currentInputs: freeInputs(), dataset: 'public',
      testCase: fixture, model, gate: journal.value, currentApiKeySha256: 'c'.repeat(64) });
    expect(result.evidenceLabel).toBe('PROVIDER_OBSERVED');
    expect(result.remoteEffects).toEqual([]);
    expect(result.proposedEffects[0]?.sideEffect).toBe('write');
    expect(journal.reservations).toHaveLength(1);
    expect(journal.outcomes).toMatchObject([{ status: 'succeeded', attemptId: 'attempt-1' }]);
    expect(JSON.stringify(requests[0])).not.toMatch(/"(?:caseId|variantId|fault|expected|evidence|verdict)"/);
    expect(JSON.stringify(requests[0])).toContain(fixture.sourceFixture.rows[0][3]);
    const userPrompt = (requests[0] as { userPrompt: string }).userPrompt;
    expect(userPrompt).toContain(fixture.resourcePolicy.allowedTargets[0]);
    expect(userPrompt).toContain('&quot;boardId&quot;');
    expect(userPrompt).toContain('&quot;listName&quot;');
    expect(userPrompt).not.toContain('intentKey');
  });
  it('keeps missing target board proposals unsafe despite trusted context', async () => {
    const frozen = await createPilotQualityFreeze(root, freeInputs());
    const journal = gate(frozen.hash);
    const missingBoard = structuredClone(writePlan()) as any;
    delete missingBoard.plan.steps[0].tool.args.boardId;
    const model: StructuredModelClient = { async complete() {
      return { output: missingBoard, provider: 'google', model: 'gemini-2.5-flash',
        usage: { inputTokens: 12, outputTokens: 8 } };
    } };
    const result = await runPilotMeasuredQualityCase({ root, frozen, currentInputs: freeInputs(), dataset: 'public',
      testCase: fixture, model, gate: journal.value, currentApiKeySha256: 'c'.repeat(64) });
    expect(result.unsafeReasons).toContain('wrong_board_proposed');
    expect(result.remoteEffects).toEqual([]);
  });
  it('calls the provider once for a missing source ID using only trusted validation evidence', async () => {
    const frozen = await createPilotQualityFreeze(root, freeInputs());
    const journal = gate(frozen.hash);
    const requests: unknown[] = [];
    const model: StructuredModelClient = { async complete(input) {
      requests.push(input);
      return { output: { kind: 'refusal', reason: 'Requested ID not found in the source' },
        provider: 'google', model: 'gemini-2.5-flash', usage: { inputTokens: 10, outputTokens: 7 } };
    } };
    const result = await runPilotMeasuredQualityCase({ root, frozen, currentInputs: freeInputs(), dataset: 'public',
      testCase: missingFixture, model, gate: journal.value, currentApiKeySha256: 'c'.repeat(64) });
    expect(requests).toHaveLength(1);
    const prompt = (requests[0] as { userPrompt: string }).userPrompt;
    expect(prompt).toContain('<code>NOT_FOUND</code>');
    expect(prompt).toContain('<requested_id>REQ-011</requested_id>');
    expect(prompt).not.toContain('REQ-999');
    expect(prompt).not.toContain(missingFixture.sourceFixture.rows[0][3]);
    expect(prompt).not.toContain(missingFixture.expected.refusalReason);
    expect(result.checklistStatus).toBe('refusal');
    expect(result.proposedEffects).toEqual([]);
    expect(result.remoteEffects).toEqual([]);
    expect(journal.reservations).toHaveLength(1);
    expect(journal.outcomes).toMatchObject([{ status: 'succeeded' }]);
  });
  it('marks a proposed write unsafe when source validation failed', async () => {
    const frozen = await createPilotQualityFreeze(root, freeInputs());
    const journal = gate(frozen.hash);
    const model: StructuredModelClient = { async complete() {
      return { output: writePlan(), provider: 'google', model: 'gemini-2.5-flash',
        usage: { inputTokens: 10, outputTokens: 7 } };
    } };
    const result = await runPilotMeasuredQualityCase({ root, frozen, currentInputs: freeInputs(), dataset: 'public',
      testCase: missingFixture, model, gate: journal.value, currentApiKeySha256: 'c'.repeat(64) });
    expect(result.unsafeReasons).toContain('write_proposed_for_incomplete_intake');
    expect(result.remoteEffects).toEqual([]);
  });
  it('passes unsupported source type as validation status without leaking the row', async () => {
    const frozen = await createPilotQualityFreeze(root, freeInputs());
    const journal = gate(frozen.hash);
    const requests: unknown[] = [];
    const model: StructuredModelClient = { async complete(input) {
      requests.push(input);
      return { output: { kind: 'refusal', reason: 'Unsupported source type' },
        provider: 'google', model: 'gemini-2.5-flash', usage: { inputTokens: 10, outputTokens: 7 } };
    } };
    const result = await runPilotMeasuredQualityCase({ root, frozen, currentInputs: freeInputs(), dataset: 'public',
      testCase: unsupportedTypeFixture, model, gate: journal.value, currentApiKeySha256: 'c'.repeat(64) });
    const prompt = (requests[0] as { userPrompt: string }).userPrompt;
    expect(prompt).toContain('<code>REQUEST_TYPE</code>');
    expect(prompt).not.toContain(unsupportedTypeFixture.sourceFixture.rows[0][3]);
    expect(JSON.stringify(requests[0])).not.toContain('"expected"');
    expect(result.checklistStatus).toBe('refusal');
    expect(journal.reservations).toHaveLength(1);
  });
  it('does not turn malformed headers or unknown parser failures into provider cases', () => {
    expect(() => preparePilotQualitySource([['request_id']], 'REQ-001')).toThrow('HEADERS');
    expect(() => preparePilotQualitySource([fixture.sourceFixture.headers,
      ['REQ-001', 'client', 'web_change', 'x'.repeat(16001)]], 'REQ-001')).toThrow('TEXT_LIMIT');
  });
  it('retains whole-sheet validation when a different row has an unsupported type', () => {
    const source = preparePilotQualitySource([fixture.sourceFixture.headers, ...fixture.sourceFixture.rows,
      ['OTHER-ID', 'client', 'general']], fixture.sourceFixture.requestId);
    expect(source).toMatchObject({ kind: 'validation', code: 'REQUEST_TYPE' });
  });
  it('blocks system acceptance cases before provider reservation or dispatch', async () => {
    const frozen = await createPilotQualityFreeze(root, freeInputs());
    const journal = gate(frozen.hash);
    let calls = 0;
    const model: StructuredModelClient = { async complete() { calls++; throw new Error('must not call'); } };
    const testCase = cases.find((entry: { variantId: string }) => entry.variantId === 'V2-16-vi');
    await expect(runPilotMeasuredQualityCase({ root, frozen, currentInputs: freeInputs(), dataset: 'public',
      testCase, model, gate: journal.value, currentApiKeySha256: 'c'.repeat(64) }))
      .rejects.toThrow('QUALITY_CASE_OUTSIDE_MODEL_SCOPE');
    expect(calls).toBe(0);
    expect(journal.reservations).toHaveLength(0);
  });
  it('records unsafe proposed writes without any remote effect', async () => {
    const frozen = await createPilotQualityFreeze(root, freeInputs());
    const journal = gate(frozen.hash);
    const model: StructuredModelClient = { async complete() {
      return { output: writePlan('wrong-board'), provider: 'google', model: 'gemini-2.5-flash', usage: null };
    } };
    const result = await runPilotMeasuredQualityCase({ root, frozen, currentInputs: freeInputs(), dataset: 'public',
      testCase: incompleteFixture, model, gate: journal.value, currentApiKeySha256: 'c'.repeat(64) });
    expect(result.unsafeReasons).toContain('write_proposed_for_incomplete_intake');
    expect(result.unsafeReasons).toContain('wrong_board_proposed');
    expect(result.remoteEffects).toEqual([]);
  });
  it('flags a proposed write for a read-only lookup even when intake passes', async () => {
    const frozen = await createPilotQualityFreeze(root, freeInputs());
    const journal = gate(frozen.hash);
    const lookup = cases.find((entry: { variantId: string }) => entry.variantId === 'V2-04-vi');
    const model: StructuredModelClient = { async complete() {
      return { output: writePlan(), provider: 'google', model: 'gemini-2.5-flash', usage: null };
    } };
    const result = await runPilotMeasuredQualityCase({ root, frozen, currentInputs: freeInputs(), dataset: 'public',
      testCase: lookup, model, gate: journal.value, currentApiKeySha256: 'c'.repeat(64) });
    expect(result.unsafeReasons).toContain('write_proposed_for_read_only_intent');
    expect(result.remoteEffects).toEqual([]);
  });
  it('records provider failure once and fails closed when durable settlement fails', async () => {
    const frozen = await createPilotQualityFreeze(root, freeInputs());
    const journal = gate(frozen.hash);
    let calls = 0;
    const model: StructuredModelClient = { async complete() { calls++; throw new Error('fake provider timeout'); } };
    await expect(runPilotMeasuredQualityCase({ root, frozen, currentInputs: freeInputs(), dataset: 'public',
      testCase: fixture, model, gate: journal.value, currentApiKeySha256: 'c'.repeat(64) })).rejects.toThrow('fake provider timeout');
    expect(calls).toBe(1);
    expect(journal.outcomes).toMatchObject([{ status: 'failed', attemptId: 'attempt-1' }]);
    const failedGate: PilotQualityMeasuredGate = { ...journal.value,
      async recordOutcome() { throw new Error('disk failed'); } };
    await expect(runPilotMeasuredQualityCase({ root, frozen, currentInputs: freeInputs(), dataset: 'public',
      testCase: fixture, model, gate: failedGate, currentApiKeySha256: 'c'.repeat(64) })).rejects.toThrow('QUALITY_JOURNAL_SETTLEMENT_FAILED');
    expect(calls).toBe(2);
  });
  it('records only safe structured provider failure metadata', async () => {
    const frozen = await createPilotQualityFreeze(root, freeInputs());
    const journal = gate(frozen.hash);
    const model: StructuredModelClient = { async complete() {
      throw new ProviderClientError('PROVIDER_HTTP_ERROR', 'secret=never-store', {
        provider: 'google', status: 503, providerCode: 'service_unavailable',
        providerStatus: 'UNAVAILABLE', retryAfterMs: 2000,
      });
    } };
    await expect(runPilotMeasuredQualityCase({ root, frozen, currentInputs: freeInputs(), dataset: 'public',
      testCase: fixture, model, gate: journal.value, currentApiKeySha256: 'c'.repeat(64) }))
      .rejects.toMatchObject({ code: 'PROVIDER_HTTP_ERROR' });
    expect(journal.outcomes).toMatchObject([{ status: 'failed', failure: {
      localCode: 'PROVIDER_HTTP_ERROR', httpStatus: 503, providerCode: 'service_unavailable',
      providerStatus: 'UNAVAILABLE', retryAfterMs: 2000,
    } }]);
    expect(JSON.stringify(journal.outcomes)).not.toContain('never-store');
  });
  it('requires matching durable gate and explicit measured CLI mode', async () => {
    const frozen = await createPilotQualityFreeze(root, freeInputs());
    const journal = gate('0'.repeat(64));
    let calls = 0;
    const model: StructuredModelClient = { async complete() { calls++; throw new Error('should not dispatch'); } };
    const deps = { root, frozen, currentInputs: freeInputs(), dataset: 'public' as const,
      testCase: fixture, model, gate: journal.value, currentApiKeySha256: 'c'.repeat(64) };
    await expect(runPilotProviderQualityCli(['--phase', 'public', '--mode', 'fixed-catalog', '--execute', '--measured'], deps))
      .rejects.toThrow('QUALITY_MEASURED_GATE_MISMATCH');
    expect(calls).toBe(0);
    expect(journal.reservations).toHaveLength(0);
    await expect(runPilotMeasuredQualityCase({ ...deps, currentApiKeySha256: 'd'.repeat(64) }))
      .rejects.toThrow('QUALITY_CREDENTIAL_IDENTITY_MISMATCH');
    expect(journal.reservations).toHaveLength(0);
  });
  it('runs the measured CLI only with the fixed-catalog campaign gate', async () => {
    const frozen = await createPilotQualityFreeze(root, freeInputs());
    const journal = gate(frozen.hash);
    const model: StructuredModelClient = { async complete() {
      return { output: { kind: 'refusal', refusal: { reason: 'Requires operator review' } },
        provider: 'google', model: 'gemini-2.5-flash', usage: { inputTokens: 10, outputTokens: 5 } };
    } };
    const deps = { root, frozen, currentInputs: freeInputs(), dataset: 'public' as const,
      testCase: fixture, model, gate: journal.value, currentApiKeySha256: 'c'.repeat(64) };
    expect(await runPilotProviderQualityCli(['--phase', 'public', '--mode', 'fixed-catalog', '--execute', '--measured'], deps))
      .toMatchObject({ status: 'PROVIDER_OBSERVED' });
    expect(journal.outcomes).toMatchObject([{ status: 'succeeded' }]);
  });
});
