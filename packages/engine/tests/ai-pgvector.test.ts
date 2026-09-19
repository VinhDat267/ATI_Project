import { describe, expect, it } from "vitest";
import {
  createReviewedCatalogSnapshot,
  toolContentHash,
} from "../src/ai/catalog.js";
import { validatePgvectorActivation } from "../src/ai/pgvector-index.js";
import { makeTool } from "./ai-fixtures.js";

const vector = (first = 1) =>
  Array.from({ length: 1536 }, (_, index) => (index === 0 ? first : 0));

function rows(catalog: ReturnType<typeof createReviewedCatalogSnapshot>) {
  return catalog.tools.map((tool) => ({
    server: tool.server,
    name: tool.name,
    purpose: "document" as const,
    vector: vector(),
    contentHash: toolContentHash(tool),
    provenance: {
      provider: "test",
      model: "test-model",
      dimensions: 1536,
      preprocessingVersion: "embedding-policy-v1:test",
      catalogHash: catalog.catalogHash,
    },
  }));
}

describe("pgvector catalog activation", () => {
  it("rejects a non-1536 embedding space before it can be persisted", () => {
    const catalog = createReviewedCatalogSnapshot([makeTool()]);
    expect(() =>
      validatePgvectorActivation(catalog, [
        {
          server: "task_hub",
          name: "list_cards",
          purpose: "document",
          vector: [1, 0],
          contentHash: toolContentHash(catalog.tools[0]!),
          provenance: {
            provider: "test",
            model: "test-model",
            dimensions: 2,
            preprocessingVersion: "embedding-policy-v1:test",
            catalogHash: catalog.catalogHash,
          },
        },
      ]),
    ).toThrow(/1536/);
  });

  it("rejects an incomplete, duplicate, foreign, stale, or unusable persisted index", () => {
    const catalog = createReviewedCatalogSnapshot([
      makeTool({ name: "alpha" }),
      makeTool({ name: "beta" }),
    ]);
    const valid = rows(catalog);
    expect(() =>
      validatePgvectorActivation(catalog, valid.slice(0, 1)),
    ).toThrow(/one row|incomplete/i);
    expect(() =>
      validatePgvectorActivation(catalog, [valid[0]!, valid[0]!]),
    ).toThrow(/duplicate/i);
    expect(() =>
      validatePgvectorActivation(catalog, [
        valid[0]!,
        { ...valid[1]!, name: "foreign" },
      ]),
    ).toThrow(/foreign/i);
    expect(() =>
      validatePgvectorActivation(
        catalog,
        valid.map((row) => ({ ...row, contentHash: "0".repeat(64) })),
      ),
    ).toThrow(/content hash/i);
    expect(() =>
      validatePgvectorActivation(
        catalog,
        valid.map((row) => ({ ...row, vector: vector(0) })),
      ),
    ).toThrow(/zero/i);
    expect(() =>
      validatePgvectorActivation(
        catalog,
        valid.map((row) => ({
          ...row,
          provenance: { ...row.provenance, catalogHash: "0".repeat(64) },
        })),
      ),
    ).toThrow(/catalog hash/i);
    const nonFinite = vector();
    nonFinite[17] = Number.NaN;
    expect(() =>
      validatePgvectorActivation(
        catalog,
        valid.map((row) => ({ ...row, vector: nonFinite })),
      ),
    ).toThrow(/finite/i);
  });

  it("rejects semantic_qe when queryExpansionPort is missing", async () => {
    const catalog = createReviewedCatalogSnapshot([makeTool()]);
    const { PgvectorToolRetriever } =
      await import("../src/ai/pgvector-index.js");
    const retriever = new PgvectorToolRetriever({
      catalog,
      index: {} as any,
      embeddingPort: {} as any,
    });
    await expect(
      retriever.retrieve({ query: "test", variant: "semantic_qe", topK: 1 }),
    ).rejects.toThrow(/QueryExpansionPort is required/i);
  });
});
