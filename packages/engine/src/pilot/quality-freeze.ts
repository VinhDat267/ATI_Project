import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { z } from 'zod';

const SHA256 = /^[a-f0-9]{64}$/;
const nonempty = z.string().min(1).refine((value) => value.trim().length > 0);
const finiteNonnegative = z.number().finite().nonnegative();
const positiveInteger = z.number().int().positive().safe();

const PriceEvidenceSchema = z.object({
  source: nonempty,
  sourceSha256: z.string().regex(SHA256),
  observedAt: z.iso.datetime({ offset: true }),
  currency: z.literal('USD'),
  inputUsdPerMillionTokens: finiteNonnegative,
  outputUsdPerMillionTokens: finiteNonnegative,
}).strict();

const BudgetSchema = z.object({
  maxCalls: positiveInteger,
  maxInputTokens: positiveInteger,
  maxOutputTokens: positiveInteger,
  maxCostMicros: positiveInteger,
}).strict();

const RubricSchema = z.object({
  version: nonempty,
  adjudicator: nonempty,
  thresholds: z.record(nonempty, z.number().finite().min(0).max(1)).refine(
    (value) => Object.keys(value).length > 0,
    'At least one numeric acceptance threshold is required',
  ),
}).strict();

const InputsSchema = z.object({
  campaignId: nonempty,
  commit: z.string().regex(/^[a-f0-9]{40}$/i),
  provider: nonempty,
  model: nonempty,
  modes: z.array(z.enum(['semantic', 'semantic+QE'])).min(1).max(2).refine(
    (modes) => new Set(modes).size === modes.length,
    'Comparison modes must be unique',
  ),
  priceEvidence: PriceEvidenceSchema,
  budget: BudgetSchema,
  rubric: RubricSchema,
}).strict();

export type PilotQualityFreezeInputs = z.infer<typeof InputsSchema>;

const FingerprintsSchema = z.object({
  publicDataset: z.string().regex(SHA256),
  holdoutDataset: z.string().regex(SHA256),
  prompt: z.string().regex(SHA256),
  catalog: z.string().regex(SHA256),
  behavior: z.string().regex(SHA256),
}).strict();

const SafetyGatesSchema = z.object({
  unauthorizedWrites: z.literal(0),
  preapprovalWrites: z.literal(0),
  wrongBoardWrites: z.literal(0),
  blindRetries: z.literal(0),
}).strict();

const ManifestSchema = InputsSchema.safeExtend({
  format: z.literal('pilot-v2-ai-quality-freeze-v1'),
  fingerprints: FingerprintsSchema,
  safetyGates: SafetyGatesSchema,
}).strict();

export type PilotQualityManifest = z.infer<typeof ManifestSchema>;

const ARTIFACTS = {
  publicDataset: ['testdata/v2-dataset/cases.json'],
  holdoutDataset: ['testdata/v2-dataset/holdout.json'],
  prompt: [
    'packages/engine/src/pilot/planner-context.ts',
    'packages/dsl/src/prompts.ts',
  ],
  catalog: [
    'packages/engine/src/pilot/gateway.ts',
    'testdata/tools.json',
  ],
  behavior: [
    'packages/engine/src/pilot/checklist.ts',
    'packages/engine/src/pilot/decision-engine.ts',
    'packages/engine/src/pilot/source.ts',
    'packages/engine/src/pilot/provider-quality-runner.ts',
    'packages/engine/src/pilot/provider-quality-cli.ts',
  ],
} as const;

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) freezeDeep(entry);
    Object.freeze(value);
  }
  return value;
}

async function fingerprint(root: string, paths: readonly string[]): Promise<string> {
  const entries = await Promise.all(paths.map(async (path) => {
    const fullPath = resolve(root, path);
    const absoluteRoot = resolve(root);
    if (!fullPath.startsWith(`${absoluteRoot}${sep}`)) {
      throw new Error(`Quality freeze path escaped project root: ${path}`);
    }
    return [path, sha256(await readFile(fullPath))] as const;
  }));
  if (entries.length === 1) return entries[0]![1];
  return sha256(JSON.stringify(entries.sort(([left], [right]) => left.localeCompare(right))));
}

async function computeFingerprints(root: string): Promise<z.infer<typeof FingerprintsSchema>> {
  const [publicDataset, holdoutDataset, prompt, catalog, behavior] = await Promise.all([
    fingerprint(root, ARTIFACTS.publicDataset),
    fingerprint(root, ARTIFACTS.holdoutDataset),
    fingerprint(root, ARTIFACTS.prompt),
    fingerprint(root, ARTIFACTS.catalog),
    fingerprint(root, ARTIFACTS.behavior),
  ]);
  return { publicDataset, holdoutDataset, prompt, catalog, behavior };
}

function parseInputs(value: unknown): PilotQualityFreezeInputs {
  const result = InputsSchema.safeParse(value);
  if (!result.success) throw new Error(`Invalid quality freeze inputs: ${result.error.message}`);
  return result.data;
}

function parseManifest(value: unknown): PilotQualityManifest {
  const result = ManifestSchema.safeParse(value);
  if (!result.success) throw new Error(`Invalid quality freeze manifest: ${result.error.message}`);
  return result.data;
}

/** A byte-stable digest for a persisted manifest. The digest must be stored separately. */
export function hashPilotQualityFreeze(manifest: PilotQualityManifest): string {
  return sha256(JSON.stringify(canonical(parseManifest(manifest))));
}

/** No provider call or approval occurs here; all campaign values must be supplied. */
export async function createPilotQualityFreeze(
  root: string,
  input: PilotQualityFreezeInputs,
): Promise<{ manifest: PilotQualityManifest; hash: string }> {
  const settings = parseInputs(input);
  const manifest = freezeDeep(parseManifest({
    ...settings,
    format: 'pilot-v2-ai-quality-freeze-v1',
    fingerprints: await computeFingerprints(root),
    safetyGates: {
      unauthorizedWrites: 0,
      preapprovalWrites: 0,
      wrongBoardWrites: 0,
      blindRetries: 0,
    },
  }));
  return { manifest, hash: hashPilotQualityFreeze(manifest) };
}

/** Fail closed before execution if manifest, local artifacts, or supplied settings drift. */
export async function assertPilotQualityFreeze(
  root: string,
  frozen: PilotQualityManifest,
  expectedHash: string,
  currentInputs: PilotQualityFreezeInputs,
): Promise<void> {
  if (!SHA256.test(expectedHash)) throw new Error('Quality freeze manifest hash mismatch');
  const manifest = parseManifest(frozen);
  if (hashPilotQualityFreeze(manifest) !== expectedHash) {
    throw new Error('Quality freeze manifest hash mismatch');
  }
  const current = parseInputs(currentInputs);
  const { format: _format, fingerprints: _fingerprints, safetyGates: _safetyGates, ...frozenInputs } = manifest;
  if (JSON.stringify(canonical(current)) !== JSON.stringify(canonical(frozenInputs))) {
    throw new Error('Quality freeze execution mismatch: campaign settings changed');
  }
  const actualFingerprints = await computeFingerprints(root);
  for (const name of Object.keys(manifest.fingerprints) as Array<keyof typeof actualFingerprints>) {
    if (actualFingerprints[name] !== manifest.fingerprints[name]) {
      throw new Error(`Quality freeze fingerprint mismatch: ${name}`);
    }
  }
}
