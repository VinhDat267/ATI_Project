import { describe, expect, it } from "vitest";
import {
  assertAiLiveApproval,
  parseAiLiveApprovalRecord,
} from "../src/ai/providers/approval.js";

const approval = {
  kind: "ai-live-approval",
  campaignId: "campaign-1",
  phase: "smoke",
  profileId: "google-only",
  configHash: "a".repeat(64),
  providers: ["google"],
  models: { planning: "gemini-3.8-flash", embedding: "gemini-embedding-2" },
  budgetMicros: 2_000_000,
  approvedAt: "2026-09-19T00:00:00.000Z",
  expiresAt: "2026-09-19T01:00:00.000Z",
} as const;

describe("non-secret live approval boundary", () => {
  it("accepts a scoped non-secret approval and rejects expired/mismatched scope", () => {
    const parsed = parseAiLiveApprovalRecord(approval);
    expect(() =>
      assertAiLiveApproval(
        parsed,
        approval,
        new Date("2026-09-19T00:30:00.000Z"),
      ),
    ).not.toThrow();
    expect(() =>
      assertAiLiveApproval(
        parsed,
        { ...approval, profileId: "openai-only" },
        new Date("2026-09-19T00:30:00.000Z"),
      ),
    ).toThrow(/scope/i);
    expect(() =>
      assertAiLiveApproval(
        parsed,
        approval,
        new Date("2026-09-19T02:00:00.000Z"),
      ),
    ).toThrow(/expired/i);
  });

  it("rejects credentials in an approval artifact", () => {
    expect(() =>
      parseAiLiveApprovalRecord({ ...approval, GEMINI_API_KEY: "canary" }),
    ).toThrow(/credential|token|secret/i);
  });

  it("requires a canonical SHA-256 config hash and rejects unknown fields", () => {
    expect(() =>
      parseAiLiveApprovalRecord({ ...approval, configHash: "not-a-hash" }),
    ).toThrow(/configHash/i);
    expect(() =>
      parseAiLiveApprovalRecord({ ...approval, unexpected: true }),
    ).toThrow(/unknown|field|shape/i);
  });

  it("requires an approval that is already valid and matches provider/model scope", () => {
    const parsed = parseAiLiveApprovalRecord(approval);
    expect(() =>
      assertAiLiveApproval(
        parsed,
        { ...approval, providers: ["openai"] },
        new Date("2026-09-19T00:30:00.000Z"),
      ),
    ).toThrow(/provider/i);
    expect(() =>
      assertAiLiveApproval(
        parsed,
        { ...approval, models: { planning: "gpt-5.6-terra" } },
        new Date("2026-09-19T00:30:00.000Z"),
      ),
    ).toThrow(/model/i);
    expect(() =>
      assertAiLiveApproval(
        parsed,
        approval,
        new Date("2026-09-18T23:59:59.000Z"),
      ),
    ).toThrow(/not yet|valid/i);
  });
});
