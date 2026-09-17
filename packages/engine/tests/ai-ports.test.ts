import { describe, expectTypeOf, it } from "vitest";
import type {
  EmbeddingPort,
  EmbeddingResult,
  StructuredModelClient,
  StructuredModelResponse,
} from "../src/ai/ports.js";

describe("provider-neutral AI ports", () => {
  it("keeps structured output unknown until a caller validates it", () => {
    expectTypeOf<StructuredModelResponse["output"]>().toEqualTypeOf<unknown>();
    expectTypeOf<StructuredModelClient["complete"]>()
      .parameter(0)
      .toMatchTypeOf<{
        readonly systemPrompt: string;
        readonly userPrompt: string;
        readonly schema: unknown;
        readonly signal?: AbortSignal;
      }>();
  });

  it("requires provider/model/dimension metadata and supports cancellation", () => {
    expectTypeOf<EmbeddingResult>().toMatchTypeOf<{
      readonly embedding: readonly number[];
      readonly provider: string;
      readonly model: string;
      readonly dimensions: number;
      readonly preprocessingVersion: string;
    }>();
    expectTypeOf<EmbeddingPort["embed"]>().parameter(0).toMatchTypeOf<{
      readonly text: string;
      readonly signal?: AbortSignal;
    }>();
  });
});
