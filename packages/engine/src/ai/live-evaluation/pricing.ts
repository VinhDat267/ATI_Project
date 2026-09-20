import { z } from "zod";
import type { AiPurpose } from "../providers/config.js";
import type { ProviderCallUsage } from "../providers/accounting.js";

export const ProviderPriceEntrySchema = z
  .object({
    inputMicrosPerMillion: z.number().int().nonnegative().optional(),
    cachedInputMicrosPerMillion: z.number().int().nonnegative().optional(),
    outputMicrosPerMillion: z.number().int().nonnegative().optional(),
    reasoningMicrosPerMillion: z.number().int().nonnegative().optional(),
  })
  .strict();

export type ProviderPriceEntry = z.infer<typeof ProviderPriceEntrySchema>;

export const ProviderPriceCardSchema = z
  .object({
    version: z.string().min(1),
    entries: z.record(z.string(), ProviderPriceEntrySchema),
  })
  .strict();

export type ProviderPriceCard = z.infer<typeof ProviderPriceCardSchema>;

export function validateProviderPriceCard(card: unknown): ProviderPriceCard {
  return ProviderPriceCardSchema.parse(card);
}

export interface ProviderPriceContext {
  readonly provider: "openai" | "google";
  readonly apiMode: string;
}

function rate(value: number | undefined, field: string): bigint {
  if (value === undefined) return 0n;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return BigInt(value);
}

function tokens(value: number | undefined, field: string): bigint {
  if (value === undefined) return 0n;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return BigInt(value);
}

/** Computes conservative integer micro-USD cost; missing evidence stays unknown. */
export function priceProviderCall(
  purpose: AiPurpose,
  model: string,
  usage: ProviderCallUsage | null,
  card: ProviderPriceCard,
  context?: ProviderPriceContext,
): number | null {
  if (!usage) return null;
  validateProviderPriceCard(card);
  const entry = context
    ? card.entries[`${context.provider}:${context.apiMode}:${purpose}:${model}`]
    : card.entries[model];
  if (!entry) return null;

  const input = tokens(usage.inputTokens, "usage.inputTokens");
  const cached = tokens(usage.cachedInputTokens, "usage.cachedInputTokens");
  const output = tokens(usage.outputTokens, "usage.outputTokens");
  const reasoning = tokens(usage.reasoningTokens, "usage.reasoningTokens");
  if (cached > input)
    throw new Error("cached input tokens exceed input tokens");

  if (purpose === "embedding") {
    if (
      usage.inputTokens === undefined ||
      entry.inputMicrosPerMillion === undefined
    ) {
      return null;
    }
  } else {
    // If input is billable, inputTokens must be present
    if (
      (entry.inputMicrosPerMillion ?? 0) > 0 &&
      usage.inputTokens === undefined
    ) {
      return null;
    }
    // If output is billable, outputTokens must be present
    if (
      (entry.outputMicrosPerMillion ?? 0) > 0 &&
      usage.outputTokens === undefined
    ) {
      return null;
    }
    // If reasoning is billable, reasoningTokens must be present
    if (
      (entry.reasoningMicrosPerMillion ?? 0) > 0 &&
      usage.reasoningTokens === undefined
    ) {
      return null;
    }
    // If model reported usage fields that have no corresponding rate on the price card
    if (
      (usage.inputTokens !== undefined &&
        entry.inputMicrosPerMillion === undefined) ||
      (usage.outputTokens !== undefined &&
        entry.outputMicrosPerMillion === undefined) ||
      (usage.reasoningTokens !== undefined &&
        entry.reasoningMicrosPerMillion === undefined)
    ) {
      return null;
    }
    // If usage has neither inputTokens nor outputTokens, but card has rates, return null
    if (
      usage.inputTokens === undefined &&
      usage.outputTokens === undefined &&
      (entry.inputMicrosPerMillion !== undefined ||
        entry.outputMicrosPerMillion !== undefined)
    ) {
      return null;
    }
  }



  const inputRate = rate(entry.inputMicrosPerMillion, "inputMicrosPerMillion");
  const cachedRate = rate(
    entry.cachedInputMicrosPerMillion ?? entry.inputMicrosPerMillion,
    "cachedInputMicrosPerMillion",
  );
  const outputRate = rate(
    entry.outputMicrosPerMillion,
    "outputMicrosPerMillion",
  );

  const numerator =
    (input - cached) * inputRate +
    cached * cachedRate +
    output * outputRate +
    reasoning *
      rate(entry.reasoningMicrosPerMillion, "reasoningMicrosPerMillion");
  const micros = (numerator + 999_999n) / 1_000_000n;
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("provider cost exceeds safe integer range");
  }
  return Number(micros);
}

export interface CalculateReservationBoundOptions {
  readonly purpose: AiPurpose;
  readonly model: string;
  readonly inputLimitTokens: number;
  readonly outputCapTokens?: number;
  readonly priceCard?: ProviderPriceCard;
  readonly context?: ProviderPriceContext;
}

/**
 * Calculates a conservative upper bound for a provider call reservation.
 * Returns null if the price card or rate entries cannot prove a finite bound.
 */
export function calculateReservationBoundMicros(
  options: CalculateReservationBoundOptions,
): number | null {
  if (!options.priceCard) return null;
  validateProviderPriceCard(options.priceCard);
  const entry = options.context
    ? options.priceCard.entries[
        `${options.context.provider}:${options.context.apiMode}:${options.purpose}:${options.model}`
      ]
    : options.priceCard.entries[options.model];
  if (!entry) return null;

  const inputCap = tokens(options.inputLimitTokens, "inputLimitTokens");
  const outputCap = tokens(options.outputCapTokens ?? 0, "outputCapTokens");

  const inputRate = rate(entry.inputMicrosPerMillion, "inputMicrosPerMillion");
  const outputRate = rate(
    entry.outputMicrosPerMillion,
    "outputMicrosPerMillion",
  );
  const reasoningRate = rate(
    entry.reasoningMicrosPerMillion,
    "reasoningMicrosPerMillion",
  );

  if (options.purpose === "embedding") {
    if (entry.inputMicrosPerMillion === undefined) return null;
    const numerator = inputCap * inputRate;
    const micros = (numerator + 999_999n) / 1_000_000n;
    if (micros > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("provider reservation bound exceeds safe integer range");
    }
    return Number(micros);
  }

  if (
    (inputCap > 0n && entry.inputMicrosPerMillion === undefined) ||
    (outputCap > 0n && entry.outputMicrosPerMillion === undefined)
  ) {
    return null;
  }

  const maxOutputRate = outputRate + reasoningRate;
  const numerator = inputCap * inputRate + outputCap * maxOutputRate;
  const micros = (numerator + 999_999n) / 1_000_000n;
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("provider reservation bound exceeds safe integer range");
  }
  return Number(micros);
}
