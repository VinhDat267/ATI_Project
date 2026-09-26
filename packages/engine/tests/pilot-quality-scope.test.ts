import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertPilotModelFixtureCompatible, classifyPilotModelQualityCase, pilotQualityHoldoutFile } from '../src/pilot/quality-scope.js';

const root = resolve(import.meta.dirname, '../../..');
const publicCases = JSON.parse(readFileSync(resolve(root, 'testdata/v2-dataset/cases.json'), 'utf8')).cases;

describe('model-only pilot evaluation scope', () => {
  it('accounts for all public cases without grading execution faults as model failures', () => {
    const classified = publicCases.map((entry: any) => ({ entry, scope: classifyPilotModelQualityCase(entry, 'public') }));
    expect(classified.filter((c: any) => c.scope.eligible)).toHaveLength(26);
    expect(classified.filter((c: any) => !c.scope.eligible)).toHaveLength(14);
    expect(classified.filter((c: any) => c.scope.group === 'source-refusal-compliance')).toHaveLength(4);
    for (const c of classified) {
      const peer = classified.find((p: any) => p.entry.caseId === c.entry.caseId && p.entry.language !== c.entry.language);
      expect(peer?.scope).toEqual(c.scope);
    }
  });
  it('excludes approval/revision/reservation/timeout cases even when fault says none', () => {
    for (const caseId of ['V2-13', 'V2-14', 'V2-15', 'V2-16', 'V2-17', 'V2-18', 'V2-19']) {
      expect(classifyPilotModelQualityCase({ caseId, fault: 'none' }, 'public')).toMatchObject({
        eligible: false, reason: 'SYSTEM_ACCEPTANCE_ONLY',
      });
    }
    expect(classifyPilotModelQualityCase({ caseId: 'V2-01', fault: 'timeout' }, 'public').eligible).toBe(false);
  });
  it('requires the independently authored holdout file and rejects unknown IDs', () => {
    expect(pilotQualityHoldoutFile('model-only-v1')).toBe('ai-holdout-v1.json');
    expect(pilotQualityHoldoutFile(undefined)).toBe('holdout.json');
    expect(classifyPilotModelQualityCase({ caseId: 'H-01', fault: 'none' }, 'holdout').eligible).toBe(true);
    expect(classifyPilotModelQualityCase({ caseId: 'H-99', fault: 'none' }, 'holdout').eligible).toBe(false);
  });
  it('rejects legacy unsupported-type plan oracles rather than attributing them to the model', () => {
    const legacy = JSON.parse(readFileSync(resolve(root, 'testdata/v2-dataset/holdout.json'), 'utf8')).cases;
    const entry = legacy.find((c: any) => c.variantId === 'H-03-vi');
    expect(() => assertPilotModelFixtureCompatible(entry, 'holdout')).toThrow('QUALITY_SOURCE_CONTRACT_MISMATCH');
    for (const entry of publicCases.filter((c: any) => classifyPilotModelQualityCase(c, 'public').eligible)) {
      expect(() => assertPilotModelFixtureCompatible(entry, 'public')).not.toThrow();
    }
  });
});
