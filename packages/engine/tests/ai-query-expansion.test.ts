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
import type {
  EmbeddingPort,
  EmbeddingResult,
  QueryExpansionPort,
  QueryExpansionResult,
} from "../src/ai/ports.js";

const provenance = {
  provider: "test-provider",
  model: "test-embedding",
  dimensions: 2,
  preprocessingVersion: "v1",
};

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

describe("semantic_qe query expansion retrieval", () => {
  const toolA = makeTool({ name: "append_sheet_rows" });
  const toolB = makeTool({ name: "send_slack_message" });
  const toolC = makeTool({ name: "list_cards" });
  const catalog = createReviewedCatalogSnapshot([toolA, toolB, toolC]);

  const rows = rowsFor(catalog, {
    "task_hub.append_sheet_rows": [1, 0],
    "task_hub.send_slack_message": [0, 1],
    "task_hub.list_cards": [-1, 0],
  });

  it("throws error if queryExpansionPort is missing when variant is semantic_qe", async () => {
    const port: EmbeddingPort = {
      embed: async () => ({ embedding: [1, 0], ...provenance, usage: null }),
    };
    const retriever = new InMemoryToolRetriever({
      catalog,
      rows,
      embeddingPort: port,
    });

    await expect(
      retriever.retrieve({ query: "update sheet", variant: "semantic_qe", topK: 3 }),
    ).rejects.toThrow(/QueryExpansionPort is required/);
  });

  it("expands query, caps intents at 6, and aggregates max scores across subqueries", async () => {
    const expandedIntents = [
      "add row to spreadsheet",
      "write excel data",
      "append table records",
      "insert rows",
      "update sheet columns",
      "sheet report logging",
      "seventh intent that exceeds six",
      "eighth intent that exceeds six",
    ];

    const expandCalls: string[] = [];
    const qePort: QueryExpansionPort = {
      async expand(input): Promise<QueryExpansionResult> {
        expandCalls.push(input.query);
        return {
          queries: expandedIntents,
          provider: "test-llm",
          model: "test-qe",
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          latencyMs: 15,
        };
      },
    };

    const embeddedTexts: string[] = [];
    const embeddingMap: Record<string, readonly number[]> = {
      "update sheet": [0.5, 0.5],
      "add row to spreadsheet": [0.99, 0.01],
      "write excel data": [0.95, 0.05],
      "append table records": [0.90, 0.10],
      "insert rows": [0.85, 0.15],
      "update sheet columns": [0.80, 0.20],
      "sheet report logging": [0.75, 0.25],
    };

    const embPort: EmbeddingPort = {
      async embed(input): Promise<EmbeddingResult> {
        embeddedTexts.push(input.text);
        const vector = embeddingMap[input.text] ?? [0, 1];
        return { embedding: vector, ...provenance, usage: null };
      },
    };

    const retriever = new InMemoryToolRetriever({
      catalog,
      rows,
      embeddingPort: embPort,
      queryExpansionPort: qePort,
    });

    const result = await retriever.retrieve({
      query: "update sheet",
      variant: "semantic_qe",
      topK: 2,
    });

    expect(expandCalls).toEqual(["update sheet"]);
    expect(result.variant).toBe("semantic_qe");
    expect(result.expandedQueries).toHaveLength(6);
    expect(result.expandedQueries).toEqual(expandedIntents.slice(0, 6));
    expect(result.expansionUsage).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    });

    // 1 original query + 6 expanded intents = 7 embeddings
    expect(embeddedTexts).toHaveLength(7);
    expect(embeddedTexts[0]).toBe("update sheet");

    // The tool with vector [1, 0] should have highest score close to 0.99
    expect(result.tools[0]!.name).toBe("append_sheet_rows");
    expect(result.scores[0]!.score).toBeGreaterThan(0.98);
    expect(result.tools).toHaveLength(2);
  });

  it("handles empty or malformed queries array from expansion port gracefully", async () => {
    const qePort: QueryExpansionPort = {
      async expand(): Promise<QueryExpansionResult> {
        return {
          queries: [] as any,
          provider: "test-llm",
          model: "test-qe",
        };
      },
    };

    const embPort: EmbeddingPort = {
      async embed(): Promise<EmbeddingResult> {
        return { embedding: [1, 0], ...provenance, usage: null };
      },
    };

    const retriever = new InMemoryToolRetriever({
      catalog,
      rows,
      embeddingPort: embPort,
      queryExpansionPort: qePort,
    });

    const result = await retriever.retrieve({
      query: "update sheet",
      variant: "semantic_qe",
      topK: 1,
    });

    expect(result.tools).toHaveLength(1);
    expect(result.expandedQueries).toHaveLength(0);
  });

  it("aborts when signal is cancelled during query expansion", async () => {
    const controller = new AbortController();
    const qePort: QueryExpansionPort = {
      async expand(): Promise<QueryExpansionResult> {
        controller.abort();
        throw new Error("aborted");
      },
    };

    const embPort: EmbeddingPort = {
      async embed(): Promise<EmbeddingResult> {
        return { embedding: [1, 0], ...provenance, usage: null };
      },
    };

    const retriever = new InMemoryToolRetriever({
      catalog,
      rows,
      embeddingPort: embPort,
      queryExpansionPort: qePort,
    });

    await expect(
      retriever.retrieve({
        query: "update sheet",
        variant: "semantic_qe",
        topK: 1,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled/i);
  });
});
