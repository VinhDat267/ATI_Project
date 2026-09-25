import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StructuredModelClient } from '../src/ai/ports.js';
import { PILOT_TOOL_CATALOG } from '../src/pilot/gateway.js';
import { createPilotQualityFreeze, type PilotQualityFreezeInputs } from '../src/pilot/quality-freeze.js';
import { createPilotSimulatedModel, createPilotSimulatedRetriever, runPilotProviderQualityCase, type PilotQualityRetriever } from '../src/pilot/provider-quality-runner.js';
import { runPilotProviderQualityCli } from '../src/pilot/provider-quality-cli.js';

const root = resolve(import.meta.dirname, '../../..');
const cases = JSON.parse(readFileSync(resolve(root, 'testdata/v2-dataset/cases.json'), 'utf8')).cases;
const fixture = cases[0];
const incompleteFixture = cases.find((entry: { variantId: string }) => entry.variantId === 'V2-09-vi');

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
      .rejects.toThrow(/approved pilot retriever/i);
    expect(ports.requests).toHaveLength(0);
    expect(await runPilotProviderQualityCli(['--phase', 'public', '--mode', 'semantic', '--execute'], deps))
      .toMatchObject({ status: 'SIMULATED_ONLY' });
    expect(ports.requests).toHaveLength(1);
  });
});
