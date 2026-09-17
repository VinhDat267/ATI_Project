import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  InMemoryToolRetriever,
  RetrievalValidationError,
  type ToolEmbeddingRow,
} from "../src/ai/retrieval.js";
import {
  CatalogValidationError,
  createReviewedCatalogSnapshot,
  toolContentHash,
} from "../src/ai/catalog.js";
import { loadLocalReviewedCatalog } from "../src/ai/local-catalog.js";
import type { EngineTool } from "../src/snapshot.js";
import type {
  EmbeddingPort,
  EmbeddingResult,
  QueryExpansionPort,
  QueryExpansionResult,
} from "../src/ai/ports.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));

const PROVENANCE = {
  provider: "openai-compatible",
  model: "text-embedding-3-small",
  dimensions: 1536,
  preprocessingVersion: "v1",
};

function currentReviewedGatewayTools(): EngineTool[] {
  const manifest = JSON.parse(
    readFileSync(path.join(root, "testdata", "tools.json"), "utf8"),
  ) as {
    servers: {
      slug: EngineTool["server"];
      tools: (Omit<EngineTool, "server" | "artifactHash"> & {
        description: string;
        evidence: string;
      })[];
    }[];
  };
  return manifest.servers.flatMap((server) =>
    server.tools.map(
      ({ description: _description, evidence: _evidence, ...tool }) => ({
        ...tool,
        server: server.slug,
        artifactHash: "a".repeat(64),
      }),
    ),
  );
}

/**
 * Deterministic pseudo-embedding for testing retrieval ranking without network calls.
 * Generates a unit vector in 1536 dimensions derived from character hashing.
 */
function deterministicEmbedding(text: string, dimensions = 1536): readonly number[] {
  const vec = new Float64Array(dimensions);
  const normalized = text.toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    const idx = (code * 37 + i * 17) % dimensions;
    vec[idx] = (vec[idx] ?? 0) + 1.0;
  }
  // Ensure non-zero
  vec[0] = (vec[0] ?? 0) + 0.01;
  let normSq = 0;
  for (let i = 0; i < dimensions; i++) {
    normSq += vec[i]! * vec[i]!;
  }
  const norm = Math.sqrt(normSq);
  return Array.from(vec, (v) => v / norm);
}

interface TestCase {
  readonly id: string;
  readonly split: "dev" | "holdout";
  readonly prompt: string;
  readonly expected_result: {
    readonly kind: "plan" | "refusal" | "clarification";
    readonly plan?: {
      readonly steps: readonly {
        readonly tool: {
          readonly server: string;
          readonly name: string;
        };
      }[];
    };
  };
}

function loadTestCases(): readonly TestCase[] {
  const data = JSON.parse(
    readFileSync(path.join(root, "testdata", "test-cases.json"), "utf8"),
  ) as { cases: readonly TestCase[] };
  return data.cases;
}

describe("AI-01: Retrieval Benchmark & FR-NFR-02 Latency Gate", () => {
  const catalog = loadLocalReviewedCatalog(root, currentReviewedGatewayTools());
  const catalogHash = catalog.catalogHash;

  // Build embedding rows for the 10 reviewed tools
  const rows: ToolEmbeddingRow[] = catalog.tools.map((tool) => {
    const toolText = `${tool.server}.${tool.name}: ${tool.description}`;
    return {
      server: tool.server,
      name: tool.name,
      vector: deterministicEmbedding(toolText, PROVENANCE.dimensions),
      contentHash: toolContentHash(tool),
      provenance: {
        ...PROVENANCE,
        catalogHash,
      },
    };
  });

  const embeddingPort: EmbeddingPort = {
    async embed(req): Promise<EmbeddingResult> {
      return {
        embedding: deterministicEmbedding(req.text, PROVENANCE.dimensions),
        ...PROVENANCE,
        catalogHash,
        usage: null,
      };
    },
  };

  const queryExpansionPort: QueryExpansionPort = {
    async expand(req): Promise<QueryExpansionResult> {
      return {
        queries: [
          req.query,
          `${req.query} task list`,
          `${req.query} details`,
        ],
        usage: { inputTokens: 10, outputTokens: 15, totalTokens: 25 },
        provider: "test-provider",
        model: "test-model",
        latencyMs: 1,
      };
    },
  };

  const retriever = new InMemoryToolRetriever({
    catalog,
    rows,
    embeddingPort,
    queryExpansionPort,
  });

  const testCases = loadTestCases();

  it("benchmarks recall across top-K (3, 5, 10) and verifies p95 latency <= 500ms (FR-NFR-02)", async () => {
    const variants = ["all_tools", "semantic", "semantic_qe"] as const;
    const topKs = [3, 5, 10] as const;
    const repetitions = 3;

    const latencies: number[] = [];
    const recallStats: Record<string, number[]> = {};

    for (const variant of variants) {
      for (const topK of topKs) {
        const key = `${variant}_top${topK}`;
        recallStats[key] = [];

        for (const testCase of testCases) {
          // Extract gold tools from expected plan steps if plan
          const goldToolNames =
            testCase.expected_result.kind === "plan" &&
            testCase.expected_result.plan
              ? Array.from(
                  new Set(
                    testCase.expected_result.plan.steps.map(
                      (s) => `${s.tool.server}.${s.tool.name}`,
                    ),
                  ),
                )
              : [];

          for (let rep = 0; rep < repetitions; rep++) {
            const start = performance.now();
            const result = await retriever.retrieve({
              query: testCase.prompt,
              variant,
              topK,
            });
            const elapsed = performance.now() - start;
            latencies.push(elapsed);

            // If gold set is non-empty, compute recall
            if (goldToolNames.length > 0) {
              const retrievedNames = new Set(
                result.tools.map((t) => `${t.server}.${t.name}`),
              );
              const hits = goldToolNames.filter((name) =>
                retrievedNames.has(name),
              ).length;
              const recall = hits / goldToolNames.length;
              recallStats[key]!.push(recall);
            }
          }
        }
      }
    }

    // Top-K=10 is the all-tools control: recall must be 1.0 for all cases with non-empty gold tools
    const allToolsRecalls = recallStats["all_tools_top10"]!;
    expect(allToolsRecalls.length).toBeGreaterThan(0);
    for (const r of allToolsRecalls) {
      expect(r).toBe(1.0);
    }

    // Calculate p95 latency
    latencies.sort((a, b) => a - b);
    const p95Index = Math.floor(latencies.length * 0.95);
    const p95Latency = latencies[p95Index]!;

    // Assert FR-NFR-02 requirement: p95 retrieval latency <= 500ms
    expect(p95Latency).toBeLessThanOrEqual(500);

    // Measurement provenance & reporting
    const report = {
      benchmark: "AI-01-retrieval-benchmark",
      catalogSize: catalog.tools.length,
      testCaseCount: testCases.length,
      totalRuns: latencies.length,
      p50LatencyMs: latencies[Math.floor(latencies.length * 0.5)],
      p95LatencyMs: p95Latency,
      p99LatencyMs: latencies[Math.floor(latencies.length * 0.99)],
      maxLatencyMs: latencies[latencies.length - 1],
      recallByVariantAndTopK: Object.fromEntries(
        Object.entries(recallStats).map(([k, v]) => [
          k,
          v.length > 0
            ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(4))
            : "empty_gold_set",
        ]),
      ),
      conditions: {
        environment: "local",
        engine: "InMemoryToolRetriever",
        vectorDimensions: PROVENANCE.dimensions,
        catalog: "10 reviewed tools (8 task_hub + 2 filesystem)",
        confinement: "Does not generalize to unbounded catalogs",
      },
    };

    expect(report.catalogSize).toBe(10);
    expect(report.p95LatencyMs).toBeLessThanOrEqual(500);
  });

  describe("Edge cases: empty gold set, missing tool, duplicate tool, catalog drift, deterministic hash", () => {
    it("handles empty gold set cases (refusals / clarifications) gracefully without error", async () => {
      const refusalCase = testCases.find(
        (c) => c.expected_result.kind === "refusal",
      );
      expect(refusalCase).toBeDefined();

      const result = await retriever.retrieve({
        query: refusalCase!.prompt,
        variant: "semantic",
        topK: 5,
      });

      expect(result.tools.length).toBeLessThanOrEqual(5);
      expect(result.variant).toBe("semantic");
    });

    it("handles queries for tools not present in catalog without error", async () => {
      const result = await retriever.retrieve({
        query: "Perform quantum teleportation and deploy satellite",
        variant: "semantic",
        topK: 3,
      });

      expect(result.tools).toHaveLength(3);
      expect(result.scores).toHaveLength(3);
    });

    it("rejects duplicate tool definitions when creating catalog snapshot", () => {
      const baseTool = catalog.tools[0]!;
      expect(() =>
        createReviewedCatalogSnapshot([baseTool, baseTool]),
      ).toThrow(CatalogValidationError);
    });

    it("rejects retrieval when catalog drift occurs between snapshot and embedding index", async () => {
      const driftedRows: ToolEmbeddingRow[] = rows.map((r, i) =>
        i === 0
          ? {
              ...r,
              provenance: {
                ...r.provenance,
                catalogHash: "f".repeat(64), // drifted hash
              },
            }
          : r,
      );

      const driftedRetriever = new InMemoryToolRetriever({
        catalog,
        rows: driftedRows,
        embeddingPort,
        queryExpansionPort,
      });

      await expect(
        driftedRetriever.retrieve({
          query: "test query",
          variant: "semantic",
          topK: 3,
        }),
      ).rejects.toThrow(RetrievalValidationError);
    });

    it("produces deterministic query hashes and scores across identical repetitions", async () => {
      const query = "Liệt kê task Done của board board_a";
      const res1 = await retriever.retrieve({
        query,
        variant: "semantic_qe",
        topK: 5,
      });
      const res2 = await retriever.retrieve({
        query,
        variant: "semantic_qe",
        topK: 5,
      });

      expect(res1.queryHash).toBe(res2.queryHash);
      expect(res1.tools.map((t) => `${t.server}.${t.name}`)).toEqual(
        res2.tools.map((t) => `${t.server}.${t.name}`),
      );
      expect(res1.scores.map((s) => s.score)).toEqual(
        res2.scores.map((s) => s.score),
      );
    });
  });
});
