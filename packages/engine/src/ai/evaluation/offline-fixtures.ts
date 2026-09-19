/** Explicit non-network fixtures used by the AI-04 harness CLI. */
import type { StructuredModelClient } from "../ports.js";
import { InMemoryToolRetriever, type ToolEmbeddingRow } from "../retrieval.js";
import { toolContentHash, type ReviewedCatalogSnapshot } from "../catalog.js";
import type { EvalCase } from "./contracts.js";

const DIMENSIONS = 64;
const PREPROCESSING_VERSION = "lowercase-character-hash-v1";

/** A deterministic pseudo-embedding. This is an algorithm label, not a provider model. */
export function characterHashEmbedding(text: string): readonly number[] {
  const vector = new Float64Array(DIMENSIONS);
  const normalized = text.toLowerCase();
  for (let index = 0; index < normalized.length; index++) {
    const slot = (normalized.charCodeAt(index) * 37 + index * 17) % DIMENSIONS;
    vector[slot] = (vector[slot] ?? 0) + 1;
  }
  vector[0] = (vector[0] ?? 0) + 0.01;
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return Array.from(vector, (value) => value / norm);
}

export function createOfflineSyntheticFixtures(input: {
  readonly catalog: ReviewedCatalogSnapshot;
  readonly modelFixture: string;
  readonly embeddingFixture: string;
  readonly expansionFixture: string;
}) {
  const provenance = {
    provider: "offline-synthetic",
    model: input.embeddingFixture,
    dimensions: DIMENSIONS,
    preprocessingVersion: PREPROCESSING_VERSION,
    catalogHash: input.catalog.catalogHash,
  };
  const rows: ToolEmbeddingRow[] = input.catalog.tools.map((tool) => ({
    server: tool.server,
    name: tool.name,
    purpose: "document",
    vector: characterHashEmbedding(
      `${tool.server}.${tool.name}: ${tool.description}`,
    ),
    contentHash: toolContentHash(tool),
    provenance,
  }));
  const embeddingPort = {
    async embed(request: {
      readonly text: string;
      readonly purpose: "document" | "query";
    }) {
      return {
        embedding: characterHashEmbedding(request.text),
        purpose: request.purpose,
        ...provenance,
        usage: null,
        latencyMs: 0,
        requestId: null,
      };
    },
  };
  const queryExpansionPort = {
    async expand(request: { readonly query: string }) {
      return {
        // Identity expansion deliberately consumes no gold labels or fixture answer.
        queries: [request.query],
        provider: "offline-synthetic",
        model: input.expansionFixture,
        usage: null,
        latencyMs: 0,
        requestId: null,
      };
    },
  };
  return {
    retriever: new InMemoryToolRetriever({
      catalog: input.catalog,
      rows,
      embeddingPort,
      queryExpansionPort,
    }),
    modelFor(fixture: EvalCase): StructuredModelClient {
      return {
        async complete() {
          // Explicit oracle replay: the report labels this as harness wiring only.
          return {
            output: fixture.expected_result,
            provider: "offline-synthetic",
            model: input.modelFixture,
            usage: null,
            requestId: null,
            latencyMs: 0,
          };
        },
      };
    },
  };
}
