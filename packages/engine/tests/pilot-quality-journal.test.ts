import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openPilotQualityJournal, type PilotQualityJournalOptions } from '../src/pilot/quality-journal.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function options(maxCalls = 2): Promise<PilotQualityJournalOptions> {
  const directory = await mkdtemp(join(tmpdir(), 'pilot-quality-journal-'));
  directories.push(directory);
  return { directory, campaignId: 'campaign-1', freezeHash: 'a'.repeat(64),
    provider: 'google', model: 'gemini-test', maxCalls, maxCostUsd: 0, freeTierAttested: true };
}

const input = { variantId: 'V2-01-vi', mode: 'fixed-catalog' as const, dataset: 'public' as const,
  provider: 'google', model: 'gemini-test' };

describe('pilot quality durable journal', () => {
  it('fsyncs a reservation, keeps an interrupted attempt unknown across restart, and prevents replay', async () => {
    const settings = await options();
    const journal = await openPilotQualityJournal(settings);
    const reserved = await journal.authorizeAndReserve(input);
    expect(journal.readState().attempts[0]).toMatchObject({ attemptId: reserved.attemptId, status: 'reserved', usageState: 'unknown' });
    await journal.close();

    const reopened = await openPilotQualityJournal(settings);
    expect(reopened.readState().usedCalls).toBe(1);
    await expect(reopened.authorizeAndReserve(input)).rejects.toThrow('QUALITY_JOURNAL_DUPLICATE');
    await reopened.recordOutcome({ attemptId: reserved.attemptId, status: 'failed', durationMs: 12, error: 'Bearer secret-token-123' });
    expect(reopened.readState().attempts[0]).toMatchObject({ status: 'failed', usageState: 'unknown', unsafeToGrade: true });
    await expect(reopened.authorizeAndReserve(input)).rejects.toThrow('QUALITY_JOURNAL_DUPLICATE');
    await reopened.close();

    const bytes = await readFile(join(settings.directory, (await readdir(settings.directory)).find((name) => name.endsWith('.jsonl'))!), 'utf8');
    expect(bytes).not.toContain('secret-token-123');
  });

  it('holds an exclusive campaign lock and blocks a concurrent writer', async () => {
    const settings = await options();
    const first = await openPilotQualityJournal(settings);
    await expect(openPilotQualityJournal(settings)).rejects.toThrow('QUALITY_JOURNAL_LOCKED');
    await first.close();
    const second = await openPilotQualityJournal(settings);
    await second.close();
  });

  it('enforces the call cap, identity binding, and free-tier zero-cost gate', async () => {
    const settings = await options(1);
    await expect(openPilotQualityJournal({ ...settings, freeTierAttested: false as true })).rejects.toThrow('QUALITY_JOURNAL_ZERO_COST_GATE_REQUIRED');
    await expect(openPilotQualityJournal({ ...settings, maxCostUsd: 1 as 0 })).rejects.toThrow('QUALITY_JOURNAL_ZERO_COST_GATE_REQUIRED');
    const journal = await openPilotQualityJournal(settings);
    await expect(journal.authorizeAndReserve({ ...input, model: 'other' })).rejects.toThrow('QUALITY_JOURNAL_INPUT_MISMATCH');
    await journal.authorizeAndReserve(input);
    await expect(journal.authorizeAndReserve({ ...input, variantId: 'V2-02-vi' })).rejects.toThrow('QUALITY_JOURNAL_CALL_CAP');
    await journal.close();
    await expect(openPilotQualityJournal({ ...settings, freezeHash: 'b'.repeat(64) })).rejects.toThrow('QUALITY_JOURNAL_CAMPAIGN_MISMATCH');
  });

  it('persists a sanitized decoded observation before grading and marks missing usage unknown', async () => {
    const settings = await options();
    const journal = await openPilotQualityJournal(settings);
    const { attemptId } = await journal.authorizeAndReserve(input);
    await journal.recordOutcome({ attemptId, status: 'succeeded', durationMs: 23,
      observation: { result: { title: 'Sample', token: 'secret', text: 'key=another-secret' }, usage: undefined, evidenceLabel: 'PROVIDER_OBSERVED' } });
    const state = journal.readState();
    expect(state.attempts[0]).toMatchObject({ status: 'succeeded', usageState: 'unknown',
      redactionApplied: true, unsafeToGrade: true,
      observation: { result: { title: 'Sample', token: '[REDACTED]', text: '[REDACTED]' } } });
    const second = await journal.authorizeAndReserve({ ...input, variantId: 'V2-02-vi' });
    await journal.recordOutcome({ attemptId: second.attemptId, status: 'succeeded', durationMs: 17,
      observation: { result: { kind: 'refusal' }, usage: { inputTokens: 19, outputTokens: 7 } } });
    expect(journal.readState().attempts[1]).toMatchObject({ status: 'succeeded', usageState: 'reported',
      inputTokens: 19, outputTokens: 7, redactionApplied: false, unsafeToGrade: false });
    await journal.close();
    const reopened = await openPilotQualityJournal(settings);
    expect(reopened.readState().attempts[0]?.observation).toEqual(state.attempts[0]?.observation);
    await reopened.close();
  });

  it('fails closed on a corrupt journal or unavailable output path before a provider can run', async () => {
    const settings = await options();
    const journal = await openPilotQualityJournal(settings);
    await journal.close();
    const filename = (await readdir(settings.directory)).find((name) => name.endsWith('.jsonl'))!;
    await writeFile(join(settings.directory, filename), '{"partial":');
    await expect(openPilotQualityJournal(settings)).rejects.toThrow('QUALITY_JOURNAL_PARTIAL_RECORD');

    const badRoot = join(settings.directory, 'not-a-directory');
    await writeFile(badRoot, 'occupied');
    await expect(openPilotQualityJournal({ ...settings, directory: badRoot })).rejects.toThrow();
  });

  it('persists only bounded failure diagnostics across reopening the journal', async () => {
    const settings = await options();
    const journal = await openPilotQualityJournal(settings);
    const { attemptId } = await journal.authorizeAndReserve(input);
    const failure = { localCode: 'PROVIDER_HTTP_ERROR', httpStatus: 503,
      providerCode: 'service_unavailable', providerStatus: 'UNAVAILABLE', retryAfterMs: 2000 };
    await journal.recordOutcome({ attemptId, status: 'failed', durationMs: 100,
      error: 'secret=not-persisted', failure });
    await journal.close();
    const reopened = await openPilotQualityJournal(settings);
    expect(reopened.readState().attempts[0]).toMatchObject({ status: 'failed', usageState: 'unknown', failure });
    await reopened.close();
    const filename = (await readdir(settings.directory)).find((name) => name.endsWith('.jsonl'))!;
    const bytes = await readFile(join(settings.directory, filename), 'utf8');
    expect(bytes).not.toContain('not-persisted');
    expect(bytes).not.toContain('message');
  });

  it('rejects provider prose and unknown failure fields before persistence', async () => {
    const settings = await options();
    const journal = await openPilotQualityJournal(settings);
    const { attemptId } = await journal.authorizeAndReserve(input);
    await expect(journal.recordOutcome({ attemptId, status: 'failed', durationMs: 2,
      failure: { localCode: 'PROVIDER_HTTP_ERROR', httpStatus: 503, providerCode: null,
        providerStatus: null, retryAfterMs: null, message: 'key=secret' } as never }))
      .rejects.toThrow('QUALITY_JOURNAL_INVALID_FAILURE_DIAGNOSTICS');
    expect(journal.readState().attempts[0]?.status).toBe('reserved');
    await journal.close();
  });
});
