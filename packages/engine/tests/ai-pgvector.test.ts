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
    vector: vector(),
    contentHash: toolContentHash(tool),
    provenance: {
      provider: "test",
      model: "test-model",
      dimensions: 1536,
      preprocessingVersion: "v1",
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
          vector: [1, 0],
          contentHash: toolContentHash(catalog.tools[0]!),
          provenance: {
            provider: "test",
            model: "test-model",
            dimensions: 2,
            preprocessingVersion: "v1",
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
});
