import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertPilotQualityFreeze,
  createPilotQualityFreeze,
  hashPilotQualityFreeze,
  type PilotQualityFreezeInputs,
} from '../src/pilot/quality-freeze.js';

const paths = [
  'testdata/v2-dataset/cases.json',
  'testdata/v2-dataset/holdout.json',
  'packages/engine/src/pilot/planner-context.ts',
  'packages/engine/src/pilot/checklist.ts',
  'packages/engine/src/pilot/decision-engine.ts',
  'packages/engine/src/pilot/source.ts',
  'packages/engine/src/pilot/provider-quality-runner.ts',
  'packages/engine/src/pilot/provider-quality-cli.ts',
  'packages/engine/src/pilot/gateway.ts',
  'packages/dsl/src/prompts.ts',
  'testdata/tools.json',
] as const;

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pilot-quality-freeze-'));
  roots.push(root);
  for (const [index, path] of paths.entries()) {
    const target = join(root, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, `fixture-${index}`);
  }
  return root;
}

function inputs(): PilotQualityFreezeInputs {
  return {
    campaignId: 'test-campaign',
    commit: 'a'.repeat(40),
    provider: 'test-provider',
    model: 'test-model',
    modes: ['semantic', 'semantic+QE'],
    priceEvidence: {
      source: 'https://example.test/prices',
      sourceSha256: 'b'.repeat(64),
      observedAt: '2026-09-23T00:00:00.000Z',
      currency: 'USD',
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 2,
    },
    budget: { maxCalls: 100, maxInputTokens: 100000, maxOutputTokens: 50000, maxCostMicros: 1000000 },
    rubric: {
      version: 'test-v1',
      adjudicator: 'independent reviewer',
      thresholds: { minimumCasePassRate: 0.8, minimumMissingFieldPrecision: 0.7, minimumMissingFieldRecall: 0.7 },
    },
  };
}

describe('pilot v2 quality freeze', () => {
  it('binds every input artifact to its raw bytes and rejects drift', async () => {
    const root = await fixtureRoot();
    const frozen = await createPilotQualityFreeze(root, inputs());
    for (const [index, path] of paths.entries()) {
      await assertPilotQualityFreeze(root, frozen.manifest, frozen.hash, inputs());
      await writeFile(join(root, path), `changed-${index}`);
      await expect(assertPilotQualityFreeze(root, frozen.manifest, frozen.hash, inputs()))
        .rejects.toThrow(/fingerprint mismatch/i);
      await writeFile(join(root, path), `fixture-${index}`);
    }
  });

  it('rejects changed settings, including mode, budget, provider, price and numeric threshold', async () => {
    const root = await fixtureRoot();
    const frozen = await createPilotQualityFreeze(root, inputs());
    const variations: PilotQualityFreezeInputs[] = [
      { ...inputs(), modes: ['semantic'] },
      { ...inputs(), budget: { ...inputs().budget, maxCalls: 101 } },
      { ...inputs(), provider: 'different-provider' },
      { ...inputs(), provider: 'test-provider ' },
      { ...inputs(), model: 'different-model' },
      { ...inputs(), priceEvidence: { ...inputs().priceEvidence, observedAt: '2026-09-24T00:00:00.000Z' } },
      { ...inputs(), priceEvidence: { ...inputs().priceEvidence, inputUsdPerMillionTokens: 3 } },
      { ...inputs(), priceEvidence: { ...inputs().priceEvidence, sourceSha256: 'c'.repeat(64) } },
      { ...inputs(), rubric: { ...inputs().rubric, thresholds: { ...inputs().rubric.thresholds, minimumCasePassRate: 0.9 } } },
    ];
    for (const changed of variations) {
      await expect(assertPilotQualityFreeze(root, frozen.manifest, frozen.hash, changed))
        .rejects.toThrow(/execution mismatch/i);
    }
  });

  it('rejects tampered manifest, wrong hash, and unapproved missing inputs', async () => {
    const root = await fixtureRoot();
    const frozen = await createPilotQualityFreeze(root, inputs());
    expect(Object.isFrozen(frozen.manifest.rubric.thresholds)).toBe(true);
    const tampered = structuredClone(frozen.manifest);
    tampered.budget.maxCalls += 1;
    await expect(assertPilotQualityFreeze(root, tampered, frozen.hash, inputs()))
      .rejects.toThrow(/manifest hash mismatch/i);
    await expect(assertPilotQualityFreeze(root, frozen.manifest, '0'.repeat(64), inputs()))
      .rejects.toThrow(/manifest hash mismatch/i);
    await expect(createPilotQualityFreeze(root, { ...inputs(), provider: '' }))
      .rejects.toThrow(/invalid quality freeze/i);
    await expect(createPilotQualityFreeze(root, { ...inputs(), rubric: { ...inputs().rubric, thresholds: {} } }))
      .rejects.toThrow(/invalid quality freeze/i);
  });

  it('makes the manifest hash deterministic for exact matching', async () => {
    const root = await fixtureRoot();
    const frozen = await createPilotQualityFreeze(root, inputs());
    expect(frozen.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashPilotQualityFreeze(frozen.manifest)).toBe(frozen.hash);
    expect(frozen.manifest.fingerprints.publicDataset).toBe(
      createHash('sha256').update('fixture-0').digest('hex'),
    );
    await expect(assertPilotQualityFreeze(root, frozen.manifest, frozen.hash, inputs())).resolves.toBeUndefined();
  });
});
