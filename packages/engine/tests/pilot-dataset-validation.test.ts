import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { V2DatasetSchema, type V2Dataset } from '../src/pilot/dataset-schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

const casesPath = path.join(rootDir, 'testdata/v2-dataset/cases.json');
const holdoutPath = path.join(rootDir, 'testdata/v2-dataset/holdout.json');

describe('V2 Evaluation Dataset Validation (BE-24)', () => {
  it('cases.json exists and strictly conforms to V2DatasetSchema', () => {
    expect(fs.existsSync(casesPath)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
    const parsed = V2DatasetSchema.safeParse(raw);
    if (!parsed.success) {
      console.error('Validation errors:', parsed.error.format());
    }
    expect(parsed.success).toBe(true);
  });

  it('holdout.json exists and strictly conforms to V2DatasetSchema', () => {
    expect(fs.existsSync(holdoutPath)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(holdoutPath, 'utf8'));
    const parsed = V2DatasetSchema.safeParse(raw);
    if (!parsed.success) {
      console.error('Holdout validation errors:', parsed.error.format());
    }
    expect(parsed.success).toBe(true);
  });

  it('cases.json contains exactly 20 cases with 40 variants (20 vi + 20 en)', () => {
    const data: V2Dataset = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
    expect(data.cases).toHaveLength(40);

    const viVariants = data.cases.filter((c) => c.language === 'vi');
    const enVariants = data.cases.filter((c) => c.language === 'en');
    expect(viVariants).toHaveLength(20);
    expect(enVariants).toHaveLength(20);

    // Verify all V2-01 to V2-20 exist
    for (let i = 1; i <= 20; i++) {
      const caseId = `V2-${String(i).padStart(2, '0')}`;
      expect(viVariants.some((c) => c.caseId === caseId)).toBe(true);
      expect(enVariants.some((c) => c.caseId === caseId)).toBe(true);
    }
  });

  it('holdout.json contains exactly 10 cases with 20 variants (10 vi + 10 en)', () => {
    const data: V2Dataset = JSON.parse(fs.readFileSync(holdoutPath, 'utf8'));
    expect(data.cases).toHaveLength(20);

    const viVariants = data.cases.filter((c) => c.language === 'vi');
    const enVariants = data.cases.filter((c) => c.language === 'en');
    expect(viVariants).toHaveLength(10);
    expect(enVariants).toHaveLength(10);

    // Verify all H-01 to H-10 exist
    for (let i = 1; i <= 10; i++) {
      const caseId = `H-${String(i).padStart(2, '0')}`;
      expect(viVariants.some((c) => c.caseId === caseId)).toBe(true);
      expect(enVariants.some((c) => c.caseId === caseId)).toBe(true);
    }
  });

  it('enforces variantId uniqueness within each dataset file', () => {
    const casesData: V2Dataset = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
    const caseVariantIds = casesData.cases.map((c) => c.variantId);
    expect(new Set(caseVariantIds).size).toBe(caseVariantIds.length);

    const holdoutData: V2Dataset = JSON.parse(fs.readFileSync(holdoutPath, 'utf8'));
    const holdoutVariantIds = holdoutData.cases.map((c) => c.variantId);
    expect(new Set(holdoutVariantIds).size).toBe(holdoutVariantIds.length);
  });

  it('ensures zero caseId overlap between cases.json and holdout.json', () => {
    const casesData: V2Dataset = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
    const holdoutData: V2Dataset = JSON.parse(fs.readFileSync(holdoutPath, 'utf8'));

    const caseIds = new Set(casesData.cases.map((c) => c.caseId));
    for (const hCase of holdoutData.cases) {
      expect(caseIds.has(hCase.caseId)).toBe(false);
    }
  });

  it('verifies all records have origin reconstructed_synthetic and evidence verdict NOT_RUN', () => {
    const casesData: V2Dataset = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
    const holdoutData: V2Dataset = JSON.parse(fs.readFileSync(holdoutPath, 'utf8'));
    const all = [...casesData.cases, ...holdoutData.cases];

    for (const item of all) {
      expect(item.origin).toBe('reconstructed_synthetic');
      expect(item.evidence.verdict).toBe('NOT_RUN');
      expect(item.evidence.mode).toBe('CONTRACT_TESTED');
    }
  });

  it('enforces writeCount invariant: UC1 and UC3 have 0 writes, UC2 has 1 write', () => {
    const casesData: V2Dataset = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
    for (const item of casesData.cases) {
      if (item.expected.kind === 'refusal' || item.expected.kind === 'clarification') {
        expect(item.expected.writeCount).toBe(0);
      }
      if (item.caseId === 'V2-03' || item.caseId === 'V2-04') {
        expect(item.expected.writeCount).toBe(0);
      }
      if (item.caseId === 'V2-01' || item.caseId === 'V2-02') {
        expect(item.expected.writeCount).toBe(1);
      }
    }
  });

  it('guarantees zero real credentials or API secrets in prompts and fixtures', () => {
    const casesData: V2Dataset = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
    const holdoutData: V2Dataset = JSON.parse(fs.readFileSync(holdoutPath, 'utf8'));
    const rawContent = JSON.stringify([...casesData.cases, ...holdoutData.cases]);

    // Check for common real secret patterns
    expect(rawContent).not.toMatch(/ghp_[a-zA-Z0-9]{36}/);
    expect(rawContent).not.toMatch(/sk-[a-zA-Z0-9]{32,}/);
    expect(rawContent).not.toMatch(/AIza[0-9A-Za-z-_]{35}/);
    expect(rawContent).not.toMatch(/password123|supersecret/i);
  });

  it('verifies every fixture matches the exact standard 8-column header specification', () => {
    const casesData: V2Dataset = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
    const holdoutData: V2Dataset = JSON.parse(fs.readFileSync(holdoutPath, 'utf8'));
    const all = [...casesData.cases, ...holdoutData.cases];
    const expectedHeaders = [
      'request_id',
      'client_ref',
      'request_type',
      'raw_request',
      'deliverable',
      'due_date',
      'decision_status',
      'source_note',
    ];

    for (const item of all) {
      expect(item.sourceFixture.headers).toEqual(expectedHeaders);
      for (const row of item.sourceFixture.rows) {
        expect(row).toHaveLength(expectedHeaders.length);
      }
    }
  });
});
