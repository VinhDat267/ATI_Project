import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm } from "node:fs/promises";
import { createLiveJournal } from "../src/ai/live-evaluation/journal.js";
import {
  JournaledProviderCallLedger,
  restoreProviderCallRecords,
} from "../src/ai/live-evaluation/ledger.js";
import type {
  ProviderCallReservation,
  ProviderCallSettlement,
} from "../src/ai/providers/accounting.js";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));

async function createTempJournalPath(name: string): Promise<string> {
  const dir = resolve(root, ".artifacts", `ledger-${name}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return join(dir, "journal.jsonl");
}

function reservation(estimatedCostMicros = 100): ProviderCallReservation {
  return {
    campaignId: "campaign-1",
    runId: "run-1",
    profileId: "openai-only",
    trialId: "trial-1",
    provider: "openai",
    purpose: "planning",
    model: "gpt-5.6-terra",
    requestHash: "request-hash",
    estimatedCostMicros,
  };
}

describe("journal-backed provider call ledger", () => {
  it("persists reservations before settlement and holds estimates against the budget", async () => {
    const journalPath = await createTempJournalPath("budget");
    const journal = await createLiveJournal(journalPath);
    const ledger = new JournaledProviderCallLedger({
      campaignLimitMicros: 150,
      journal,
    });
    try {
      const firstCall = await ledger.reserve(reservation(100));
      expect(firstCall).toMatch(/^provider-call-/);
      await expect(ledger.reserve(reservation(51))).rejects.toMatchObject({
        code: "BUDGET_EXCEEDED",
      });
      expect(ledger.records()[0]).toMatchObject({
        callId: firstCall,
        status: "reserved",
        reservationHeld: true,
        trialId: "trial-1",
      });
    } finally {
      await journal.close();
      await rm(resolve(journalPath, ".."), { recursive: true, force: true });
    }
  });

  it("settles exact usage, keeps unknown cost held, and makes same settlement idempotent", async () => {
    const journalPath = await createTempJournalPath("settlement");
    const journal = await createLiveJournal(journalPath);
    const ledger = new JournaledProviderCallLedger({
      campaignLimitMicros: 1_000,
      journal,
    });
    const outcome: ProviderCallSettlement = {
      status: "succeeded",
      usage: { totalTokens: 10 },
      costMicros: 75,
      errorCode: null,
    };
    try {
      const callId = await ledger.reserve(reservation(100));
      await ledger.settle(callId, outcome);
      await expect(ledger.settle(callId, outcome)).resolves.toBeUndefined();
      expect(ledger.records()[0]).toMatchObject({
        status: "succeeded",
        costMicros: 75,
        reservationHeld: false,
      });

      const unknownCallId = await ledger.reserve(reservation(100));
      const unknown: ProviderCallSettlement = {
        status: "ambiguous",
        usage: null,
        costMicros: null,
        errorCode: "PROVIDER_TIMEOUT",
      };
      await ledger.settle(unknownCallId, unknown);
      await expect(
        ledger.settle(unknownCallId, {
          ...unknown,
          errorCode: "DIFFERENT_ERROR",
        }),
      ).rejects.toMatchObject({ code: "CALL_ALREADY_SETTLED" });
      expect(
        ledger.records().find((record) => record.callId === unknownCallId),
      ).toMatchObject({ reservationHeld: true, costMicros: null });
    } finally {
      await journal.close();
      await rm(resolve(journalPath, ".."), { recursive: true, force: true });
    }
  });

  it("reconstructs reservations and settlements from journal events", async () => {
    const journalPath = await createTempJournalPath("replay");
    const journal = await createLiveJournal(journalPath);
    const ledger = new JournaledProviderCallLedger({
      campaignLimitMicros: 1_000,
      journal,
    });
    try {
      const callId = await ledger.reserve(reservation());
      await ledger.settle(callId, {
        status: "failed",
        usage: null,
        costMicros: null,
        errorCode: "PROVIDER_HTTP_ERROR",
      });
      const replay = await journal.replay();
      const records = restoreProviderCallRecords(replay.events);
      expect(records).toEqual(ledger.records());
    } finally {
      await journal.close();
      await rm(resolve(journalPath, ".."), { recursive: true, force: true });
    }
  });
});
