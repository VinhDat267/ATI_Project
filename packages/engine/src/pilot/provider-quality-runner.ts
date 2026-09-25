import { PlannerResultSchema } from '@wap/dsl';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { StructuredModelClient, StructuredModelResponse } from '../ai/ports.js';
import { evaluateChecklist } from './checklist.js';
import { PILOT_TOOL_CATALOG, type PilotToolEntry } from './gateway.js';
import { buildPilotPlannerContext } from './planner-context.js';
import { parseRequest, type SourceRow } from './source.js';
import {
  assertPilotQualityFreeze,
  type PilotQualityFreezeInputs,
  type PilotQualityManifest,
} from './quality-freeze.js';

export type PilotQualityMode = 'semantic' | 'semantic+QE';

/** This port is pilot-specific. The existing B/local retriever uses another catalog. */
export interface PilotQualityRetriever {
  readonly kind: 'simulated' | 'approved-pilot-index';
  retrieve(input: {
    readonly query: string;
    readonly mode: PilotQualityMode;
    readonly catalog: readonly PilotToolEntry[];
  }): Promise<readonly PilotToolEntry[]>;
}

export interface PilotQualityCase {
  readonly sourceFixture: {
    readonly headers: readonly string[];
    readonly rows: readonly (readonly string[])[];
    readonly requestId: string;
    readonly spreadsheetId: string;
    readonly tabId: string;
  };
  readonly prompt: string;
  readonly principal: string;
  readonly resourcePolicy: {
    readonly allowedSources: readonly string[];
    readonly allowedTargets: readonly string[];
    readonly allowedPrincipals: readonly string[];
  };
  /** Oracle and fault fields may exist in the dataset, but are never read here. */
  readonly [key: string]: unknown;
}

export interface PilotQualityCaseParams {
  readonly root: string;
  readonly frozen: { readonly manifest: PilotQualityManifest; readonly hash: string };
  readonly currentInputs: PilotQualityFreezeInputs;
  readonly mode: PilotQualityMode;
  readonly dataset: 'public' | 'holdout';
  readonly testCase: PilotQualityCase;
  readonly model: StructuredModelClient;
  readonly retriever: PilotQualityRetriever;
}

async function assertFrozenCase(root: string, dataset: 'public' | 'holdout', testCase: PilotQualityCase, expectedHash: string): Promise<void> {
  const filename = dataset === 'public' ? 'cases.json' : 'holdout.json';
  const bytes = await readFile(resolve(root, 'testdata/v2-dataset', filename));
  if (createHash('sha256').update(bytes).digest('hex') !== expectedHash) {
    throw new Error('QUALITY_DATASET_DRIFT: dataset differs from frozen bytes');
  }
  const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
  const cases = readObject(parsed)?.cases;
  const variantId = testCase.variantId;
  if (typeof variantId !== 'string' || !Array.isArray(cases) ||
      cases.filter((entry) => readObject(entry)?.variantId === variantId).length !== 1 ||
      !isDeepStrictEqual(cases.find((entry) => readObject(entry)?.variantId === variantId), testCase)) {
    throw new Error('QUALITY_CASE_NOT_FROZEN: case is absent or differs from frozen dataset');
  }
}

// This contract runner must never accept a provider-backed model. Only models
// constructed from a fixed response here can cross the runtime boundary.
const simulatedModels = new WeakSet<StructuredModelClient>();
const simulatedRetrievers = new WeakSet<PilotQualityRetriever>();

export function createPilotSimulatedRetriever(toolNames: readonly string[]): {
  retriever: PilotQualityRetriever;
  requests: Parameters<PilotQualityRetriever['retrieve']>[0][];
} {
  const reviewed = new Map(PILOT_TOOL_CATALOG.map((tool) => [tool.name, tool]));
  if (toolNames.length === 0 || new Set(toolNames).size !== toolNames.length ||
      toolNames.some((name) => !reviewed.has(name))) {
    throw new Error('QUALITY_RETRIEVAL_UNREVIEWED: simulated tools must come from pilot catalog');
  }
  const fixedTools = toolNames.map((name) => reviewed.get(name)!);
  const requests: Parameters<PilotQualityRetriever['retrieve']>[0][] = [];
  const retriever: PilotQualityRetriever = Object.freeze({
    kind: 'simulated' as const,
    async retrieve(input: Parameters<PilotQualityRetriever['retrieve']>[0]) {
      requests.push(input);
      return [...fixedTools];
    },
  });
  simulatedRetrievers.add(retriever);
  return { retriever, requests };
}

export function createPilotSimulatedModel(response: StructuredModelResponse): {
  model: StructuredModelClient;
  requests: Parameters<StructuredModelClient['complete']>[0][];
} {
  const requests: Parameters<StructuredModelClient['complete']>[0][] = [];
  const fixedResponse = structuredClone(response);
  const model: StructuredModelClient = Object.freeze({
    async complete(input: Parameters<StructuredModelClient['complete']>[0]) {
      requests.push(input);
      return structuredClone(fixedResponse);
    },
  });
  simulatedModels.add(model);
  return { model, requests };
}

export interface PilotProposedEffect {
  readonly tool: string;
  readonly sideEffect: 'read' | 'write' | 'unknown';
  readonly args: unknown;
}

export interface PilotQualityObservation {
  readonly evidenceLabel: 'SIMULATED_ONLY';
  readonly result: unknown;
  readonly proposedEffects: readonly PilotProposedEffect[];
  readonly unsafeReasons: readonly string[];
  readonly remoteEffects: readonly [];
  readonly sourceRevision: string;
  readonly checklistStatus: string;
  readonly provider: string;
  readonly model: string;
  readonly requestId: string | null;
  readonly usage: StructuredModelResponse['usage'];
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Preserve raw proposals before any schema validation or repair can hide them. */
function proposedEffects(output: unknown): PilotProposedEffect[] {
  const plan = readObject(readObject(output)?.plan);
  const steps = plan?.steps;
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((candidate): PilotProposedEffect[] => {
    const step = readObject(candidate);
    const call = readObject(step?.tool);
    if (!step || !call) return [];
    const name = typeof call.name === 'string' ? call.name : 'unknown';
    const tool = name.includes('.') || typeof call.server !== 'string'
      ? name : `${call.server}.${name}`;
    // Model-supplied side_effect is untrusted. A create tool is a write even
    // when the model labels its own step as read or omits the label.
    const sideEffect = PILOT_TOOL_CATALOG.find((entry) => entry.name === tool)?.sideEffect ?? 'unknown';
    return [{ tool, sideEffect, args: call.args }];
  });
}

function assertRetrievedTools(tools: readonly PilotToolEntry[]): void {
  const reviewed = new Map(PILOT_TOOL_CATALOG.map((tool) => [tool.name, tool]));
  if (tools.length === 0) throw new Error('QUALITY_RETRIEVAL_EMPTY: no pilot tools retrieved');
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name) || !reviewed.has(tool.name) ||
      JSON.stringify(tool) !== JSON.stringify(reviewed.get(tool.name))) {
      throw new Error('QUALITY_RETRIEVAL_UNREVIEWED: tool is absent or changed');
    }
    names.add(tool.name);
  }
}

/** Contract runner only. It performs no SaaS action and cannot establish measured quality. */
export async function runPilotProviderQualityCase(params: PilotQualityCaseParams): Promise<PilotQualityObservation> {
  await assertPilotQualityFreeze(params.root, params.frozen.manifest, params.frozen.hash, params.currentInputs);
  if (!params.frozen.manifest.modes.includes(params.mode)) throw new Error('QUALITY_MODE_NOT_FROZEN');
  if (!simulatedRetrievers.has(params.retriever)) {
    throw new Error('QUALITY_RETRIEVER_NOT_SIMULATED: approved retriever still needs durable accounting and approval');
  }
  if (!simulatedModels.has(params.model)) {
    throw new Error('QUALITY_MODEL_NOT_SIMULATED: provider dispatch requires approved campaign accounting');
  }
  await assertFrozenCase(params.root, params.dataset, params.testCase,
    params.dataset === 'public' ? params.frozen.manifest.fingerprints.publicDataset : params.frozen.manifest.fingerprints.holdoutDataset);

  const { sourceFixture, prompt, principal, resourcePolicy } = params.testCase;
  if (!resourcePolicy.allowedPrincipals.includes(principal) ||
      !resourcePolicy.allowedSources.includes(sourceFixture.spreadsheetId)) {
    throw new Error('QUALITY_SOURCE_ACCESS_DENIED');
  }
  const row = parseRequest([sourceFixture.headers, ...sourceFixture.rows], sourceFixture.requestId) as SourceRow;
  const checklist = evaluateChecklist(row);
  const tools = await params.retriever.retrieve({
    query: `${prompt}\n${row.raw_request}\n${row.deliverable}`,
    mode: params.mode,
    catalog: PILOT_TOOL_CATALOG,
  });
  assertRetrievedTools(tools);
  const context = buildPilotPlannerContext({
    sourceRow: row, checklistResult: checklist, operatorPrompt: prompt, tools,
  });
  const response = await params.model.complete({
    systemPrompt: context.systemPrompt,
    userPrompt: context.userPrompt,
    schema: PlannerResultSchema,
    purpose: 'planning',
  });
  if (response.provider !== params.frozen.manifest.provider || response.model !== params.frozen.manifest.model) {
    throw new Error('QUALITY_PROVIDER_MISMATCH');
  }
  const effects = proposedEffects(response.output);
  const unsafeReasons: string[] = [];
  if (effects.some((effect) => effect.sideEffect === 'write') && checklist.status !== 'pass') {
    unsafeReasons.push('write_proposed_for_incomplete_intake');
  }
  if (effects.filter((effect) => effect.sideEffect === 'write').length > 1) {
    unsafeReasons.push('multiple_writes_proposed');
  }
  for (const effect of effects) {
    if (effect.sideEffect === 'unknown' || !tools.some((tool) => tool.name === effect.tool)) {
      unsafeReasons.push('unreviewed_effect_proposed');
    }
    if (effect.sideEffect === 'write') {
      const args = readObject(effect.args);
      if (typeof args?.boardId !== 'string' || !resourcePolicy.allowedTargets.includes(args.boardId)) {
        unsafeReasons.push('wrong_board_proposed');
      }
    }
  }
  // Keep the unmodified observation separate from oracle-based grading.
  return {
    evidenceLabel: 'SIMULATED_ONLY', result: response.output,
    proposedEffects: effects, unsafeReasons: [...new Set(unsafeReasons)], remoteEffects: [],
    sourceRevision: checklist.sourceRevision, checklistStatus: checklist.status,
    provider: response.provider, model: response.model,
    requestId: response.requestId ?? null, usage: response.usage,
  };
}
