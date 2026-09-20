import { describe, expect, it } from "vitest";
import { priceProviderCall } from "../src/ai/live-evaluation/pricing.js";

describe("ai-live price card accounting", () => {
  it("prices input, cached input and output with conservative micro-USD rounding", () => {
    expect(
      priceProviderCall(
        "planning",
        "model-1",
        { inputTokens: 1_000_001, cachedInputTokens: 1, outputTokens: 1 },
        {
          version: "test-price-v1",
          entries: {
            "model-1": {
              inputMicrosPerMillion: 2_000_000,
              cachedInputMicrosPerMillion: 1_000_000,
              outputMicrosPerMillion: 4_000_000,
            },
          },
        },
      ),
    ).toBe(2_000_005);
  });

  it("keeps cost unknown when usage or required price is missing", () => {
    const card = { version: "test-price-v1", entries: {} };
    expect(priceProviderCall("embedding", "model-1", null, card)).toBeNull();
    expect(
      priceProviderCall("embedding", "model-1", { inputTokens: 10 }, card),
    ).toBeNull();
  });

  it("rejects impossible cached usage", () => {
    expect(() =>
      priceProviderCall(
        "planning",
        "model-1",
        { inputTokens: 1, cachedInputTokens: 2 },
        { version: "test-price-v1", entries: { "model-1": {} } },
      ),
    ).toThrow(/cached input tokens/i);
  });
});
