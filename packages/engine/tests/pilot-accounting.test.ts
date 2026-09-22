import { describe, it, expect } from "vitest";
import {
  calculatePilotCallCost,
  assertCampaignBudgetAvailable,
  recordPilotCallMetrics,
} from "../src/index.js";
import type { Database } from "@wap/db";

describe("Pilot Token & Cost Accounting (BE-21)", () => {
  describe("calculatePilotCallCost", () => {
    it("calculates cost accurately for gemini-1.5-flash", () => {
      // 1000 input tokens: 1000 * 75000 / 1M = 75 micros
      // 500 output tokens: 500 * 300000 / 1M = 150 micros
      // Total = 225 micros
      const cost = calculatePilotCallCost("gemini-1.5-flash", 1000, 500);
      expect(cost).toBe(225);
    });

    it("calculates cost accurately for gemini-1.5-pro", () => {
      // 1000 input: 1000 * 1250000 / 1M = 1250 micros
      // 200 output: 200 * 5000000 / 1M = 1000 micros
      // Total = 2250 micros
      const cost = calculatePilotCallCost("gemini-1.5-pro", 1000, 200);
      expect(cost).toBe(2250);
    });

    it("rounds up fractional micros with Math.ceil", () => {
      // 1 input token on flash: 1 * 75000 / 1M = 0.075 micros -> ceil = 1 micro
      const cost = calculatePilotCallCost("gemini-1.5-flash", 1, 0);
      expect(cost).toBe(1);
    });

    it("throws on negative token values", () => {
      expect(() => calculatePilotCallCost("gemini-1.5-flash", -10, 50)).toThrow(
        "Token counts must be non-negative",
      );
    });
  });

  describe("assertCampaignBudgetAvailable", () => {
    it("passes when budget is sufficient", async () => {
      const mockDb = {
        client: async () => [
          {
            campaign_id: "camp-1",
            limit_micros: 100_000,
            held_micros: 10_000,
            committed_micros: 20_000,
            halted: false,
          },
        ],
      } as unknown as Database;

      await expect(
        assertCampaignBudgetAvailable(mockDb, "camp-1", 5_000),
      ).resolves.not.toThrow();
    });

    it("throws BUDGET_EXCEEDED when cost exceeds remaining headroom", async () => {
      const mockDb = {
        client: async () => [
          {
            campaign_id: "camp-1",
            limit_micros: 100_000,
            held_micros: 50_000,
            committed_micros: 45_000,
            halted: false,
          },
        ],
      } as unknown as Database;

      await expect(
        assertCampaignBudgetAvailable(mockDb, "camp-1", 10_000),
      ).rejects.toThrow("Campaign budget exceeded");
    });

    it("throws CAMPAIGN_HALTED when campaign is marked halted", async () => {
      const mockDb = {
        client: async () => [
          {
            campaign_id: "camp-1",
            limit_micros: 100_000,
            held_micros: 0,
            committed_micros: 0,
            halted: true,
          },
        ],
      } as unknown as Database;

      await expect(
        assertCampaignBudgetAvailable(mockDb, "camp-1", 5_000),
      ).rejects.toThrow("Campaign camp-1 is halted");
    });

    it("throws CAMPAIGN_NOT_FOUND when campaign does not exist", async () => {
      const mockDb = {
        client: async () => [],
      } as unknown as Database;

      await expect(
        assertCampaignBudgetAvailable(mockDb, "non-existent", 5_000),
      ).rejects.toThrow("Campaign non-existent not found");
    });
  });

  describe("recordPilotCallMetrics", () => {
    it("inserts call record and updates committed_micros in a transaction", async () => {
      const executedSql: string[] = [];
      let committed = 10_000;

      const mockDb = {
        client: {
          begin: async (fn: (tx: any) => Promise<any>) => {
            const tx = async (strings: TemplateStringsArray, ...values: any[]) => {
              const sql = strings.join("?");
              executedSql.push(sql);
              if (sql.includes("SELECT limit_micros")) {
                return [
                  {
                    limit_micros: 100_000,
                    committed_micros: committed,
                    halted: false,
                  },
                ];
              }
              if (sql.includes("INSERT INTO ai_provider_calls")) {
                return [];
              }
              if (sql.includes("UPDATE ai_provider_campaigns")) {
                committed += values[0];
                return [];
              }
              return [];
            };
            return fn(tx);
          },
        },
      } as unknown as Database;

      await recordPilotCallMetrics(mockDb, {
        callId: "call-101",
        runId: "run-202",
        campaignId: "camp-1",
        userId: "user-a",
        provider: "google",
        model: "gemini-1.5-flash",
        inputTokens: 1000,
        outputTokens: 500,
        costMicros: 225,
        status: "succeeded",
      });

      expect(executedSql.some((s) => s.includes("INSERT INTO ai_provider_calls"))).toBe(
        true,
      );
      expect(
        executedSql.some((s) => s.includes("UPDATE ai_provider_campaigns")),
      ).toBe(true);
      expect(committed).toBe(10_225);
    });
  });
});
