import { describe, expect, it } from "vitest";
import {
  serializeReviewedToolForEmbedding,
} from "../src/ai/catalog-embedding.js";
import { hashEmbeddingText } from "../src/ai/embedding-policy.js";
import { makeTool } from "./ai-fixtures.js";

describe("embedding preprocessing identity", () => {
  it("serializes nested schema key order canonically", () => {
    const left = makeTool({
      inputSchema: { properties: { b: { type: "string" }, a: { type: "number" } }, type: "object" },
      outputSchema: { required: ["a"], type: "object" },
    });
    const right = makeTool({
      inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "string" } } },
      outputSchema: { type: "object", required: ["a"] },
    });
    expect(serializeReviewedToolForEmbedding(left)).toBe(
      serializeReviewedToolForEmbedding(right),
    );
    expect(hashEmbeddingText(serializeReviewedToolForEmbedding(left))).toBe(
      hashEmbeddingText(serializeReviewedToolForEmbedding(right)),
    );
  });

  it("changes the text hash when reviewed content changes", () => {
    const original = serializeReviewedToolForEmbedding(makeTool());
    const changed = serializeReviewedToolForEmbedding(
      makeTool({ description: "Changed description" }),
    );
    expect(hashEmbeddingText(original)).not.toBe(hashEmbeddingText(changed));
  });
});
