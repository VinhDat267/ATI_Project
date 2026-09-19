import { describe, expect, it } from "vitest";
import {
  InMemoryProviderCallLedger,
  type ProviderCallReservation,
} from "../src/ai/providers/accounting.js";

const reservation: ProviderCallReservation = {
  campaignId: "campaign-1",
  runId: "run-1",
  profileId: "google-only",
  provider: "google",
  purpose: "embedding",
  model: "gemini-embedding-2",
  requestHash: "a".repeat(64),
  estimatedCostMicros: 500,
};

describe("provider call accounting", () => {
  it("keeps unknown cost unknown after an ambiguous timeout", async () => {
    const ledger = new InMemoryProviderCallLedger({
      campaignLimitMicros: 1000,
    });
    const callId = await ledger.reserve(reservation);
    await ledger.settle(callId, {
      status: "ambiguous",
      usage: null,
      costMicros: null,
      errorCode: "TIMEOUT_AFTER_DISPATCH",
    });
    const record = ledger.records()[0]!;
    expect(record.costMicros).toBeNull();
    expect(record.reservationHeld).toBe(true);
  });

  it("rejects a reservation that would exceed the campaign cap", async () => {
    const ledger = new InMemoryProviderCallLedger({ campaignLimitMicros: 100 });
    await expect(
      ledger.reserve({ ...reservation, estimatedCostMicros: 101 }),
    ).rejects.toMatchObject({
      code: "BUDGET_EXCEEDED",
    });
  });

  it("records provider usage even when candidate decoding fails", async () => {
    const ledger = new InMemoryProviderCallLedger({
      campaignLimitMicros: 10_000,
    });
    const callId = await ledger.reserve(reservation);
    await ledger.settle(callId, {
      status: "invalid_output",
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      costMicros: 42,
      errorCode: "SCHEMA_INVALID",
    });
    expect(ledger.records()[0]).toMatchObject({
      status: "invalid_output",
      costMicros: 42,
      usage: { totalTokens: 14 },
    });
  });
});
