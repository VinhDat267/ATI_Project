import type { AiProvider, AiPurpose } from "./config.js";

export interface ProviderCallReservation {
  readonly campaignId: string;
  readonly runId: string;
  readonly profileId: string;
  /** Evaluation trial scope. Optional for ordinary API calls. */
  readonly trialId?: string;
  readonly provider: AiProvider;
  readonly purpose: AiPurpose;
  readonly model: string;
  readonly requestHash: string;
  readonly outputCap?: number;
  readonly embeddingPurpose?: "document" | "query";
  readonly estimatedCostMicros: number;
}

export interface ProviderCallUsage {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly totalTokens?: number;
}

export interface ProviderCallSettlement {
  readonly status:
    "succeeded" | "failed" | "invalid_output" | "ambiguous" | "cancelled";
  readonly usage: ProviderCallUsage | null;
  readonly costMicros: number | null;
  readonly errorCode?: string | null;
}

export interface ProviderCallRecord extends ProviderCallReservation {
  readonly callId: string;
  readonly status: ProviderCallSettlement["status"] | "reserved";
  readonly usage: ProviderCallUsage | null;
  readonly costMicros: number | null;
  readonly errorCode: string | null;
  readonly reservationHeld: boolean;
}

export class ProviderAccountingError extends Error {
  readonly code:
    | "BUDGET_EXCEEDED"
    | "CALL_NOT_FOUND"
    | "CALL_ALREADY_SETTLED"
    | "BUDGET_OVERRUN"
    | "CAMPAIGN_NOT_FOUND"
    | "CAMPAIGN_CONFIG_MISMATCH"
    | "CAMPAIGN_HALTED";

  constructor(code: ProviderAccountingError["code"], message: string) {
    super(message);
    this.name = "ProviderAccountingError";
    this.code = code;
  }
}

export class InMemoryProviderCallLedger {
  private readonly limitMicros: number;
  private readonly store = new Map<string, ProviderCallRecord>();
  private sequence = 0;

  constructor(options: { campaignLimitMicros: number }) {
    if (
      !Number.isInteger(options.campaignLimitMicros) ||
      options.campaignLimitMicros <= 0
    ) {
      throw new Error("campaignLimitMicros must be a positive integer");
    }
    this.limitMicros = options.campaignLimitMicros;
  }

  async reserve(input: ProviderCallReservation): Promise<string> {
    if (
      !Number.isFinite(input.estimatedCostMicros) ||
      input.estimatedCostMicros < 0
    ) {
      throw new Error("estimatedCostMicros must be non-negative");
    }
    const committed = [...this.store.values()].reduce(
      (sum, record) =>
        sum +
        (record.costMicros ??
          (record.reservationHeld ? record.estimatedCostMicros : 0)),
      0,
    );
    if (committed + input.estimatedCostMicros > this.limitMicros) {
      throw new ProviderAccountingError(
        "BUDGET_EXCEEDED",
        `provider call reservation exceeds campaign cap of ${this.limitMicros} micros`,
      );
    }
    const callId = `provider-call-${++this.sequence}`;
    this.store.set(callId, {
      ...input,
      callId,
      status: "reserved",
      usage: null,
      costMicros: null,
      errorCode: null,
      reservationHeld: true,
    });
    return callId;
  }

  async settle(callId: string, outcome: ProviderCallSettlement): Promise<void> {
    const current = this.store.get(callId);
    if (!current) {
      throw new ProviderAccountingError(
        "CALL_NOT_FOUND",
        `unknown provider call ${callId}`,
      );
    }
    if (current.status !== "reserved") {
      throw new ProviderAccountingError(
        "CALL_ALREADY_SETTLED",
        `provider call ${callId} is already settled`,
      );
    }
    this.store.set(callId, {
      ...current,
      status: outcome.status,
      usage: outcome.usage,
      costMicros: outcome.costMicros,
      errorCode: outcome.errorCode ?? null,
      reservationHeld:
        outcome.status === "ambiguous" || outcome.costMicros === null,
    });
    const committed = [...this.store.values()].reduce(
      (sum, record) =>
        sum +
        (record.costMicros ??
          (record.reservationHeld ? record.estimatedCostMicros : 0)),
      0,
    );
    if (committed > this.limitMicros) {
      throw new ProviderAccountingError(
        "BUDGET_OVERRUN",
        `provider call settlement caused campaign spend of ${committed} micros to exceed cap of ${this.limitMicros} micros`,
      );
    }
  }

  records(): ProviderCallRecord[] {
    return [...this.store.values()].map((record) => ({ ...record }));
  }
}
