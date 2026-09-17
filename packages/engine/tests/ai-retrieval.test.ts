import { describe, expect, it } from "vitest";
import {
  InMemoryToolRetriever,
  RetrievalValidationError,
  type ToolEmbeddingRow,
} from "../src/ai/retrieval.js";
import {
  createReviewedCatalogSnapshot,
  toolContentHash,
} from "../src/ai/catalog.js";
import { makeTool } from "./ai-fixtures.js";
import type { EmbeddingPort, EmbeddingResult } from "../src/ai/ports.js";

const provenance = {
  provider: "test-provider",
  model: "test-embedding",
  dimensions: 2,
  preprocessingVersion: "v1",
};

function embeddingPort(vector: readonly number[]): EmbeddingPort {
  return {
    async embed(): Promise<EmbeddingResult> {
      return { embedding: vector, ...provenance, usage: null };
    },
  };
}

function rowsFor(
  catalog: ReturnType<typeof createReviewedCatalogSnapshot>,
  vectors: Record<string, readonly number[]>,
): ToolEmbeddingRow[] {
  return catalog.tools.map((tool) => ({
    server: tool.server,
    name: tool.name,
    vector: vectors[`${tool.server}.${tool.name}`] ?? [1, 0],
    contentHash: toolContentHash(tool),
    provenance: { ...provenance, catalogHash: catalog.catalogHash },
  }));
}

describe("bounded exact in-memory retrieval", () => {
  it("returns every reviewed tool for all_tools without invoking embeddings", async () => {
    const catalog = createReviewedCatalogSnapshot([
      makeTool({ name: "alpha" }),
      makeTool({ name: "beta" }),
    ]);
    let calls = 0;
    const port: EmbeddingPort = {
      embed: async () => {
        calls++;
        throw new Error("must not embed");
      },
    };
    const retriever = new InMemoryToolRetriever({
      catalog,
      rows: [],
      embeddingPort: port,
    });

    await expect(
      retriever.retrieve({ query: "anything", variant: "all_tools", topK: 3 }),
    ).resolves.toMatchObject({
      tools: catalog.tools,
      variant: "all_tools",
    });
    expect(calls).toBe(0);
  });

  it("rejects deferred semantic_qe before invoking the embedding port", async () => {
    const catalog = createReviewedCatalogSnapshot([makeTool()]);
    let calls = 0;
    const port: EmbeddingPort = {
      embed: async () => {
        calls++;
        return { embedding: [1, 0], ...provenance, usage: null };
      },
    };
    const retriever = new InMemoryToolRetriever({
      catalog,
      rows: rowsFor(catalog, {}),
      embeddingPort: port,
    });
    await expect(
      retriever.retrieve({ query: "x", variant: "semantic_qe", topK: 3 }),
    ).rejects.toThrow(/semantic_qe|unsupported/i);
    expect(calls).toBe(0);
  });

  it("ranks by exact cosine and breaks equal scores by qualified identity, independent of row order", async () => {
    const catalog = createReviewedCatalogSnapshot([
      makeTool({ name: "zeta" }),
      makeTool({ name: "alpha" }),
      makeTool({ name: "middle" }),
    ]);
    const rows = rowsFor(catalog, {
      "task_hub.zeta": [1, 0],
      "task_hub.alpha": [1, 0],
      "task_hub.middle": [0, 1],
    });
    const retriever = new InMemoryToolRetriever({
      catalog,
      rows: rows.reverse(),
      embeddingPort: embeddingPort([1, 0]),
    });

    const result = await retriever.retrieve({
      query: "cards",
      variant: "semantic",
      topK: 10,
    });
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "alpha",
      "zeta",
      "middle",
    ]);
    expect(result.scores.map((entry) => entry.score)).toEqual([1, 1, 0]);
  });

  it("caps topK to the catalog size and rejects zero, fractional, negative, or oversized values", async () => {
    const catalog = createReviewedCatalogSnapshot([
      makeTool({ name: "alpha" }),
    ]);
    const retriever = new InMemoryToolRetriever({
      catalog,
      rows: rowsFor(catalog, {}),
      embeddingPort: embeddingPort([1, 0]),
    });
    await expect(
      retriever.retrieve({ query: "x", variant: "semantic", topK: 10 }),
    ).resolves.toMatchObject({ tools: [catalog.tools[0]] });
    for (const topK of [0, -1, 1.5, 11]) {
      await expect(
        retriever.retrieve({ query: "x", variant: "semantic", topK }),
      ).rejects.toThrow(RetrievalValidationError);
    }
  });

  it("fails closed on missing, duplicate, foreign, malformed, or provenance-drifted rows", async () => {
    const catalog = createReviewedCatalogSnapshot([
      makeTool({ name: "alpha" }),
      makeTool({ name: "beta" }),
    ]);
    const rows = rowsFor(catalog, {});
    await expect(
      new InMemoryToolRetriever({
        catalog,
        rows: rows.slice(0, 1),
        embeddingPort: embeddingPort([1, 0]),
      }).retrieve({ query: "x", variant: "semantic", topK: 3 }),
    ).rejects.toThrow(/missing/i);
    await expect(
      new InMemoryToolRetriever({
        catalog,
        rows: [rows[0]!, rows[0]!, rows[1]!],
        embeddingPort: embeddingPort([1, 0]),
      }).retrieve({ query: "x", variant: "semantic", topK: 3 }),
    ).rejects.toThrow(/duplicate/i);
    await expect(
      new InMemoryToolRetriever({
        catalog,
        rows: [...rows, { ...rows[0]!, name: "foreign" }],
        embeddingPort: embeddingPort([1, 0]),
      }).retrieve({ query: "x", variant: "semantic", topK: 3 }),
    ).rejects.toThrow(/foreign/i);
    await expect(
      new InMemoryToolRetriever({
        catalog,
        rows: rows.map((row) => ({ ...row, vector: [0, 0] })),
        embeddingPort: embeddingPort([1, 0]),
      }).retrieve({ query: "x", variant: "semantic", topK: 3 }),
    ).rejects.toThrow(/zero/i);
    await expect(
      new InMemoryToolRetriever({
        catalog,
        rows: rows.map((row) => ({
          ...row,
          provenance: { ...row.provenance, model: "other" },
        })),
        embeddingPort: embeddingPort([1, 0]),
      }).retrieve({ query: "x", variant: "semantic", topK: 3 }),
    ).rejects.toThrow(/provenance/i);
    await expect(
      new InMemoryToolRetriever({
        catalog,
        rows: rows.map((row) => ({ ...row, vector: [1, Number.NaN] })),
        embeddingPort: embeddingPort([1, 0]),
      }).retrieve({ query: "x", variant: "semantic", topK: 3 }),
    ).rejects.toThrow(/non-finite/i);
    await expect(
      new InMemoryToolRetriever({
        catalog,
        rows: rows.map((row) => ({ ...row, vector: [1, 0, 0] })),
        embeddingPort: embeddingPort([1, 0]),
      }).retrieve({ query: "x", variant: "semantic", topK: 3 }),
    ).rejects.toThrow(/dimension/i);
    const sparse = new Array<number>(2);
    sparse[0] = 1;
    await expect(
      new InMemoryToolRetriever({
        catalog,
        rows: rows.map((row, index) =>
          index === 0 ? { ...row, vector: sparse } : row,
        ),
        embeddingPort: embeddingPort([1, 0]),
      }).retrieve({ query: "x", variant: "semantic", topK: 3 }),
    ).rejects.toThrow(/finite|dense|sparse/i);
    await expect(
      new InMemoryToolRetriever({
        catalog,
        rows: rows.map((row) => ({ ...row, contentHash: "0".repeat(64) })),
        embeddingPort: embeddingPort([1, 0]),
      }).retrieve({ query: "x", variant: "semantic", topK: 3 }),
    ).rejects.toThrow(/content hash/i);
  });

  it("rejects query vectors that do not share the indexed embedding space", async () => {
    const catalog = createReviewedCatalogSnapshot([makeTool()]);
    const rows = rowsFor(catalog, {});
    const wrongDimension: EmbeddingPort = {
      embed: async () => ({
        embedding: [1, 0, 0],
        ...provenance,
        dimensions: 3,
        usage: null,
      }),
    };
    await expect(
      new InMemoryToolRetriever({
        catalog,
        rows,
        embeddingPort: wrongDimension,
      }).retrieve({ query: "x", variant: "semantic", topK: 3 }),
    ).rejects.toThrow(/provenance/i);
    const wrongCatalog: EmbeddingPort = {
      embed: async () => ({
        embedding: [1, 0],
        ...provenance,
        catalogHash: "0".repeat(64),
        usage: null,
      }),
    };
    await expect(
      new InMemoryToolRetriever({
        catalog,
        rows,
        embeddingPort: wrongCatalog,
      }).retrieve({ query: "x", variant: "semantic", topK: 3 }),
    ).rejects.toThrow(/provenance/i);
    const zero: EmbeddingPort = {
      embed: async () => ({ embedding: [0, 0], ...provenance, usage: null }),
    };
    await expect(
      new InMemoryToolRetriever({
        catalog,
        rows,
        embeddingPort: zero,
      }).retrieve({ query: "x", variant: "semantic", topK: 3 }),
    ).rejects.toThrow(/zero/i);
  });

  it("ranks from an owned vector copy even if a caller mutates a row while embedding is pending", async () => {
    const catalog = createReviewedCatalogSnapshot([
      makeTool({ name: "alpha" }),
      makeTool({ name: "beta" }),
    ]);
    const rows = rowsFor(catalog, {
      "task_hub.alpha": [1, 0],
      "task_hub.beta": [0, 1],
    });
    let release!: (result: EmbeddingResult) => void;
    const port: EmbeddingPort = {
      embed: () => {
        (rows[0]!.vector as number[])[0] = 0;
        (rows[0]!.vector as number[])[1] = 1;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    };
    const pending = new InMemoryToolRetriever({
      catalog,
      rows,
      embeddingPort: port,
    }).retrieve({ query: "x", variant: "semantic", topK: 2 });
    release({ embedding: [1, 0], ...provenance, usage: null });
    await expect(pending).resolves.toMatchObject({
      tools: [{ name: "alpha" }, { name: "beta" }],
      scores: [{ score: 1 }, { score: 0 }],
    });
  });

  it("rejects cancellation before and after query embedding so late results cannot escape", async () => {
    const catalog = createReviewedCatalogSnapshot([makeTool()]);
    const before = new AbortController();
    before.abort();
    const retriever = new InMemoryToolRetriever({
      catalog,
      rows: rowsFor(catalog, {}),
      embeddingPort: embeddingPort([1, 0]),
    });
    await expect(
      retriever.retrieve({
        query: "x",
        variant: "semantic",
        topK: 3,
        signal: before.signal,
      }),
    ).rejects.toThrow(/cancel/i);

    let release!: (result: EmbeddingResult) => void;
    const afterPort: EmbeddingPort = {
      embed: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    };
    const after = new AbortController();
    const pending = new InMemoryToolRetriever({
      catalog,
      rows: rowsFor(catalog, {}),
      embeddingPort: afterPort,
    }).retrieve({
      query: "x",
      variant: "semantic",
      topK: 3,
      signal: after.signal,
    });
    after.abort();
    release({ embedding: [1, 0], ...provenance, usage: null });
    await expect(pending).rejects.toThrow(/cancel/i);
  });
});
