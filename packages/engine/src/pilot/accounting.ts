import type { Database } from "@wap/db";
import { ProviderAccountingError } from "../ai/providers/accounting.js";

export interface ModelCostRate {
  /** Cost per million input tokens in micro-dollars (1 USD = 1,000,000 micros) */
  inputPerMillionMicros: number;
  /** Cost per million output tokens in micro-dollars */
  outputPerMillionMicros: number;
}

export const PILOT_DEFAULT_MODEL_RATES: Record<string, ModelCostRate> = {
  "gemini-1.5-flash": {
    inputPerMillionMicros: 75_000, // $0.075 / 1M
    outputPerMillionMicros: 300_000, // $0.30 / 1M
  },
  "gemini-1.5-pro": {
    inputPerMillionMicros: 1_250_000, // $1.25 / 1M
    outputPerMillionMicros: 5_000_000, // $5.00 / 1M
  },
  "gemini-2.0-flash": {
    inputPerMillionMicros: 100_000, // $0.10 / 1M
    outputPerMillionMicros: 400_000, // $0.40 / 1M
  },
  "mock-model": {
    inputPerMillionMicros: 100_000,
    outputPerMillionMicros: 200_000,
  },
};

/**
 * Calculates the total cost of a model invocation in micro-dollars (micros).
 */
export function calculatePilotCallCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  customRates?: Record<string, ModelCostRate>,
): number {
  if (inputTokens < 0 || outputTokens < 0) {
    throw new Error("Token counts must be non-negative");
  }
  const rates = customRates ?? PILOT_DEFAULT_MODEL_RATES;
  const fallback: ModelCostRate = rates["gemini-1.5-flash"] ?? {
    inputPerMillionMicros: 75_000,
    outputPerMillionMicros: 300_000,
  };
  const rate = rates[model] ?? fallback;

  const inputCost = Math.ceil((inputTokens * rate.inputPerMillionMicros) / 1_000_000);
  const outputCost = Math.ceil((outputTokens * rate.outputPerMillionMicros) / 1_000_000);
  return inputCost + outputCost;
}

export interface RecordPilotCallParams {
  callId: string;
  runId: string;
  campaignId: string;
  userId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  status: "succeeded" | "failed" | "rejected";
}

/**
 * Checks whether the campaign has enough budget available for an estimated call.
 */
export async function assertCampaignBudgetAvailable(
  db: Database,
  campaignId: string,
  estimatedCostMicros: number,
): Promise<void> {
  const rows = await db.client<
    Array<{
      campaign_id: string;
      limit_micros: string | number;
      held_micros: string | number;
      committed_micros: string | number;
      halted: boolean;
    }>
  >`
    SELECT campaign_id, limit_micros, held_micros, committed_micros, halted
    FROM ai_provider_campaigns
    WHERE campaign_id = ${campaignId}
    LIMIT 1
  `;

  const campaign = rows[0];
  if (!campaign) {
    throw new ProviderAccountingError(
      "CAMPAIGN_NOT_FOUND",
      `Campaign ${campaignId} not found`,
    );
  }

  if (campaign.halted) {
    throw new ProviderAccountingError(
      "CAMPAIGN_HALTED",
      `Campaign ${campaignId} is halted`,
    );
  }

  const limit = Number(campaign.limit_micros);
  const held = Number(campaign.held_micros);
  const committed = Number(campaign.committed_micros);

  if (committed + held + estimatedCostMicros > limit) {
    throw new ProviderAccountingError(
      "BUDGET_EXCEEDED",
      `Campaign budget exceeded for ${campaignId}`,
    );
  }
}

/**
 * Records a durable AI provider call metric in the database and commits cost to the campaign.
 */
export async function recordPilotCallMetrics(
  db: Database,
  params: RecordPilotCallParams,
): Promise<void> {
  await db.client.begin(async (tx) => {
    // 1. Verify campaign exists and lock it
    const rows = await tx<
      Array<{
        limit_micros: string | number;
        committed_micros: string | number;
        halted: boolean;
      }>
    >`
      SELECT limit_micros, committed_micros, halted
      FROM ai_provider_campaigns
      WHERE campaign_id = ${params.campaignId}
      FOR UPDATE
    `;

    const campaign = rows[0];
    if (!campaign) {
      throw new ProviderAccountingError(
        "CAMPAIGN_NOT_FOUND",
        `Campaign ${params.campaignId} not found`,
      );
    }

    // 2. Insert call record into ai_provider_calls
    await tx`
      INSERT INTO ai_provider_calls(
        call_id,
        campaign_id,
        user_id,
        run_id,
        provider,
        model,
        estimated_cost_micros,
        actual_cost_micros,
        status,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        created_at
      )
      VALUES (
        ${params.callId},
        ${params.campaignId},
        ${params.userId},
        ${params.runId},
        ${params.provider},
        ${params.model},
        ${params.costMicros},
        ${params.costMicros},
        ${params.status},
        ${params.inputTokens},
        ${params.outputTokens},
        ${params.inputTokens + params.outputTokens},
        NOW()
      )
    `;

    // 3. Update campaign committed micros
    await tx`
      UPDATE ai_provider_campaigns
      SET committed_micros = committed_micros + ${params.costMicros}
      WHERE campaign_id = ${params.campaignId}
    `;
  });
}
