import type { Database } from "@wap/db";
import type {
  ProviderCallLedger,
  ProviderCallReservation,
  ProviderCallSettlement,
} from "./registry.js";
import { ProviderAccountingError } from "./accounting.js";

export interface ProviderCampaignOptions {
  readonly campaignId: string;
  readonly userId: string;
  readonly limitMicros: number;
}

export interface PostgresProviderCallLedgerOptions {
  readonly campaignId: string;
  readonly userId: string;
}

type CampaignRow = {
  campaign_id: string;
  user_id: string;
  limit_micros: string | number;
  held_micros: string | number;
  committed_micros: string | number;
  halted: boolean;
};

type CallRow = {
  call_id: string;
  campaign_id: string;
  user_id: string;
  status: ProviderCallSettlement["status"] | "reserved";
  usage: Record<string, number> | null;
  cost_micros: string | number | null;
  error_code: string | null;
  reservation_held: boolean;
  estimated_cost_micros: string | number;
};

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

function micros(value: string | number | null): number {
  if (value === null) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error("database micros value is invalid");
  return parsed;
}

function normalizedOutcome(outcome: ProviderCallSettlement) {
  return {
    status: outcome.status,
    usage: outcome.usage ? { ...outcome.usage } : null,
    costMicros: outcome.costMicros,
    errorCode: outcome.errorCode ?? null,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

function sameSettlement(
  row: CallRow,
  outcome: ProviderCallSettlement,
): boolean {
  const normalized = normalizedOutcome(outcome);
  return (
    row.status === normalized.status &&
    micros(row.cost_micros) === (normalized.costMicros ?? 0) &&
    (row.cost_micros === null) === (normalized.costMicros === null) &&
    row.error_code === normalized.errorCode &&
    canonicalJson(row.usage) === canonicalJson(normalized.usage)
  );
}

export async function ensurePostgresProviderCampaign(
  db: Database,
  options: ProviderCampaignOptions,
): Promise<void> {
  if (!options.campaignId.trim())
    throw new Error("campaignId must not be empty");
  positiveInteger(options.limitMicros, "limitMicros");
  await db.client.begin(async (tx) => {
    await tx`
      INSERT INTO ai_provider_campaigns(campaign_id,user_id,limit_micros)
      VALUES (${options.campaignId},${options.userId},${options.limitMicros})
      ON CONFLICT (campaign_id) DO NOTHING`;
    const rows = await tx<CampaignRow[]>`
      SELECT campaign_id,user_id,limit_micros,held_micros,committed_micros,halted
      FROM ai_provider_campaigns
      WHERE campaign_id=${options.campaignId}
      FOR UPDATE`;
    const campaign = rows[0];
    if (!campaign)
      throw new ProviderAccountingError(
        "CAMPAIGN_NOT_FOUND",
        `unknown provider campaign ${options.campaignId}`,
      );
    if (
      campaign.user_id !== options.userId ||
      micros(campaign.limit_micros) !== options.limitMicros
    )
      throw new ProviderAccountingError(
        "CAMPAIGN_CONFIG_MISMATCH",
        `provider campaign ${options.campaignId} is bound to different owner or cap`,
      );
  });
}

export class PostgresProviderCallLedger implements ProviderCallLedger {
  private readonly db: Database;
  private readonly campaignId: string;
  private readonly userId: string;

  constructor(
    db: Database,
    options: PostgresProviderCallLedgerOptions,
  ) {
    if (!options.campaignId.trim())
      throw new Error("campaignId must not be empty");
    this.db = db;
    this.campaignId = options.campaignId;
    this.userId = options.userId;
  }

  async reserve(input: ProviderCallReservation): Promise<string> {
    if (input.campaignId !== this.campaignId)
      throw new ProviderAccountingError(
        "CAMPAIGN_CONFIG_MISMATCH",
        "provider reservation campaign does not match ledger campaign",
      );
    if (
      !Number.isSafeInteger(input.estimatedCostMicros) ||
      input.estimatedCostMicros < 0
    )
      throw new Error("estimatedCostMicros must be a non-negative integer");

    return this.db.client.begin(async (tx) => {
      const rows = await tx<CampaignRow[]>`
        SELECT campaign_id,user_id,limit_micros,held_micros,committed_micros,halted
        FROM ai_provider_campaigns
        WHERE campaign_id=${this.campaignId}
        FOR UPDATE`;
      const campaign = rows[0];
      if (!campaign)
        throw new ProviderAccountingError(
          "CAMPAIGN_NOT_FOUND",
          `unknown provider campaign ${this.campaignId}`,
        );
      if (campaign.user_id !== this.userId)
        throw new ProviderAccountingError(
          "CAMPAIGN_CONFIG_MISMATCH",
          `provider campaign ${this.campaignId} belongs to another user`,
        );
      if (campaign.halted)
        throw new ProviderAccountingError(
          "CAMPAIGN_HALTED",
          `provider campaign ${this.campaignId} is halted`,
        );
      const committed = micros(campaign.committed_micros);
      const held = micros(campaign.held_micros);
      const estimate = input.estimatedCostMicros;
      if (committed + held + estimate > micros(campaign.limit_micros))
        throw new ProviderAccountingError(
          "BUDGET_EXCEEDED",
          `provider call reservation exceeds campaign cap of ${micros(campaign.limit_micros)} micros`,
        );
      const rowsInserted = await tx<{ call_id: string }[]>`
        INSERT INTO ai_provider_calls(
          campaign_id,user_id,run_id,profile_id,trial_id,provider,purpose,model,
          request_hash,output_cap,embedding_purpose,estimated_cost_micros
        ) VALUES (
          ${this.campaignId},${this.userId},${input.runId},${input.profileId},
          ${input.trialId ?? null},${input.provider},${input.purpose},${input.model},
          ${input.requestHash},${input.outputCap ?? null},${input.embeddingPurpose ?? null},${estimate}
        )
        RETURNING call_id`;
      const callId = rowsInserted[0]?.call_id;
      if (!callId) throw new Error("provider call insert returned no call id");
      await tx`
        UPDATE ai_provider_campaigns
        SET held_micros=held_micros+${estimate},updated_at=clock_timestamp()
        WHERE campaign_id=${this.campaignId}`;
      return callId;
    });
  }

  async settle(callId: string, outcome: ProviderCallSettlement): Promise<void> {
    const result = await this.db.client.begin(async (tx) => {
      const rows = await tx<CallRow[]>`
        SELECT call_id,campaign_id,user_id,status,usage,cost_micros,error_code,
               reservation_held,estimated_cost_micros
        FROM ai_provider_calls
        WHERE call_id=${callId}
        FOR UPDATE`;
      const call = rows[0];
      if (!call)
        throw new ProviderAccountingError(
          "CALL_NOT_FOUND",
          `unknown provider call ${callId}`,
        );
      if (call.user_id !== this.userId || call.campaign_id !== this.campaignId)
        throw new ProviderAccountingError(
          "CALL_NOT_FOUND",
          `unknown provider call ${callId}`,
        );
      if (call.status !== "reserved") {
        if (sameSettlement(call, outcome))
          return { overrun: false, conflict: false };
        await tx`
          UPDATE ai_provider_campaigns
          SET halted=true,updated_at=clock_timestamp()
          WHERE campaign_id=${this.campaignId}`;
        return { overrun: false, conflict: true };
      }
      const campaignRows = await tx<CampaignRow[]>`
        SELECT campaign_id,user_id,limit_micros,held_micros,committed_micros,halted
        FROM ai_provider_campaigns
        WHERE campaign_id=${this.campaignId}
        FOR UPDATE`;
      const campaign = campaignRows[0];
      if (!campaign)
        throw new ProviderAccountingError(
          "CAMPAIGN_NOT_FOUND",
          `unknown provider campaign ${this.campaignId}`,
        );
      const normalized = normalizedOutcome(outcome);
      const holds = normalized.costMicros === null;
      const nextHeld =
        micros(campaign.held_micros) - micros(call.estimated_cost_micros) +
        (holds ? micros(call.estimated_cost_micros) : 0);
      const nextCommitted =
        micros(campaign.committed_micros) + (normalized.costMicros ?? 0);
      const overrun =
        nextHeld + nextCommitted > micros(campaign.limit_micros);
      await tx`
        UPDATE ai_provider_calls
        SET status=${normalized.status},
            usage=${normalized.usage === null ? null : tx.json(normalized.usage)},
            cost_micros=${normalized.costMicros},
            error_code=${normalized.errorCode},
            reservation_held=${holds},
            settled_at=clock_timestamp()
        WHERE call_id=${callId}`;
      await tx`
        UPDATE ai_provider_campaigns
        SET held_micros=${nextHeld},
            committed_micros=${nextCommitted},
            halted=halted OR ${overrun},
            updated_at=clock_timestamp()
        WHERE campaign_id=${this.campaignId}`;
      return { overrun, conflict: false };
    });
    if (result.conflict)
      throw new ProviderAccountingError(
        "CALL_ALREADY_SETTLED",
        `provider call ${callId} is already settled`,
      );
    if (result.overrun)
      throw new ProviderAccountingError(
        "BUDGET_OVERRUN",
        `provider call settlement caused campaign spend to exceed cap`,
      );
  }
}

export function createPostgresProviderCallLedger(
  db: Database,
  options: PostgresProviderCallLedgerOptions,
): ProviderCallLedger {
  return new PostgresProviderCallLedger(db, options);
}
