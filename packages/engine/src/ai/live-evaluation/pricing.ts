import type { AiPurpose } from "../providers/config.js";
import type { ProviderCallUsage } from "../providers/accounting.js";

export interface ProviderPriceEntry {
  readonly inputMicrosPerMillion?: number;
  readonly cachedInputMicrosPerMillion?: number;
  readonly outputMicrosPerMillion?: number;
  readonly reasoningMicrosPerMillion?: number;
}

export interface ProviderPriceCard {
  readonly version: string;
  readonly entries: Readonly<Record<string, ProviderPriceEntry>>;
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

  const inputRate = rate(entry.inputMicrosPerMillion, "inputMicrosPerMillion");
  const cachedRate = rate(
    entry.cachedInputMicrosPerMillion ?? entry.inputMicrosPerMillion,
    "cachedInputMicrosPerMillion",
  );
  const outputRate = rate(
    entry.outputMicrosPerMillion,
    "outputMicrosPerMillion",
  );

  if (purpose === "embedding") {
    if (
      usage.inputTokens === undefined ||
      entry.inputMicrosPerMillion === undefined
    )
      return null;
  } else if (
    (usage.inputTokens !== undefined &&
      entry.inputMicrosPerMillion === undefined) ||
    (usage.outputTokens !== undefined &&
      entry.outputMicrosPerMillion === undefined) ||
    (usage.reasoningTokens !== undefined &&
      entry.reasoningMicrosPerMillion === undefined)
  ) {
    return null;
  }

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
