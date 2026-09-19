import { describe, expect, it, vi } from "vitest";
import {
  buildCatalogEmbeddingRows,
  serializeReviewedToolForEmbedding,
} from "../src/ai/catalog-embedding.js";
import { hashEmbeddingText } from "../src/ai/embedding-policy.js";
import {
  createReviewedCatalogSnapshot,
  toolContentHash,
} from "../src/ai/catalog.js";
import {
  PgvectorToolRetriever,
  validatePgvectorActivation,
} from "../src/ai/pgvector-index.js";
import type { EmbeddingPort } from "../src/ai/ports.js";
import { RetrievalValidationError } from "../src/ai/retrieval.js";
import { makeTool } from "./ai-fixtures.js";

const PROFILE = {
  provider: "openai",
  model: "text-embedding-3-large",
  dimensions: 1536,
  preprocessingVersion: `embedding-policy-v1:${"0".repeat(64)}`,
};

const vector = (first = 1): readonly number[] =>
  Array.from({ length: 1536 }, (_, index) => (index === 0 ? first : 0));

function embeddingPort(
  overrides: Partial<EmbeddingPort["embed"]> = {},
): EmbeddingPort {
  return {
    async embed(input) {
      return {
        embedding: vector(),
        ...PROFILE,
        purpose: input.purpose,
        usage: null,
        ...(overrides as object),
      } as Awaited<ReturnType<EmbeddingPort["embed"]>>;
    },
  };
}

describe("T4 catalog embedding and live index gates", () => {
  it("serializes reviewed identity, schemas and policy deterministically", () => {
    const tool = makeTool({
      description: "Read a card",
      inputSchema: { type: "object", properties: { id: { type: "string" } } },
      outputSchema: {
        type: "object",
        properties: { title: { type: "string" } },
      },
      sideEffect: "read",
      policyVersion: "policy-v1",
    });
    const first = serializeReviewedToolForEmbedding(tool);
    const second = serializeReviewedToolForEmbedding({ ...tool });
    expect(first).toBe(second);
    expect(first).toContain('"format":"reviewed-tool-json-v1"');
    expect(first).toContain('"identity":"task_hub.list_cards"');
    expect(first).toContain('"side_effect":"read"');
    expect(first).toContain('"input_schema"');
  });

  it("builds one document row per reviewed tool with text hash and provenance", async () => {
    const catalog = createReviewedCatalogSnapshot([
      makeTool({ name: "alpha" }),
      makeTool({ name: "beta" }),
    ]);
    const calls: string[] = [];
    const embeddings: EmbeddingPort = {
      async embed(input) {
        calls.push(`${input.purpose}:${input.text}`);
        return {
          embedding: vector(),
          ...PROFILE,
          purpose: input.purpose,
          usage: null,
        };
      },
    };
    const rows = await buildCatalogEmbeddingRows(catalog, embeddings);
    expect(rows).toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.startsWith("document:"))).toBe(true);
    expect(rows.every((row) => row.purpose === "document")).toBe(true);
    expect(rows.every((row) => row.embeddingTextHash?.length === 64)).toBe(
      true,
    );
    expect(
      rows.every((row) => row.provenance.catalogHash === catalog.catalogHash),
    ).toBe(true);
    expect(validatePgvectorActivation(catalog, rows).rows).toHaveLength(2);
  });

  it("rejects catalog/profile drift inside one embedding batch", async () => {
    const catalog = createReviewedCatalogSnapshot([
      makeTool({ name: "alpha" }),
      makeTool({ name: "beta" }),
    ]);
    let calls = 0;
    await expect(
      buildCatalogEmbeddingRows(catalog, {
        async embed(input) {
          calls++;
          return {
            embedding: vector(),
            ...PROFILE,
            model: calls === 2 ? "gemini-embedding-2" : PROFILE.model,
            purpose: input.purpose,
            usage: null,
          };
        },
      }),
    ).rejects.toThrow(/provenance mismatch/i);
    expect(calls).toBe(2);

    await expect(
      buildCatalogEmbeddingRows(catalog, {
        async embed(input) {
          return {
            embedding: vector(),
            ...PROFILE,
            purpose: input.purpose,
            catalogHash: "0".repeat(64),
            usage: null,
          };
        },
      }),
    ).rejects.toThrow(/catalog hash mismatch/i);
  });

  it("rejects synthetic provider provenance before activation", async () => {
    const catalog = createReviewedCatalogSnapshot([makeTool()]);
    await expect(
      buildCatalogEmbeddingRows(
        catalog,
        embeddingPort({
          provider: "offline-synthetic",
          preprocessingVersion: `embedding-policy-v1:${"0".repeat(64)}`,
        }),
      ),
    ).rejects.toMatchObject({ code: "SYNTHETIC_PROVENANCE" });
    expect(() =>
      validatePgvectorActivation(catalog, [
        {
          server: "task_hub",
          name: "list_cards",
          purpose: "document",
          vector: vector(),
          contentHash: toolContentHash(catalog.tools[0]!),
          embeddingTextHash: hashEmbeddingText(
            serializeReviewedToolForEmbedding(catalog.tools[0]!),
          ),
          provenance: {
            ...PROFILE,
            provider: "offline-synthetic",
            catalogHash: catalog.catalogHash,
          },
        },
      ]),
    ).toThrow(/synthetic/i);
  });

  it("rejects a legacy index that lacks the provenance policy version", () => {
    const catalog = createReviewedCatalogSnapshot([makeTool()]);
    expect(() =>
      validatePgvectorActivation(catalog, [
        {
          server: "task_hub",
          name: "list_cards",
          purpose: "document",
          vector: vector(),
          contentHash: toolContentHash(catalog.tools[0]!),
          embeddingTextHash: hashEmbeddingText(
            serializeReviewedToolForEmbedding(catalog.tools[0]!),
          ),
          provenance: {
            ...PROFILE,
            preprocessingVersion: "legacy-v1",
            catalogHash: catalog.catalogHash,
          },
        },
      ]),
    ).toThrow(/policy version|provenance/i);
  });

  it("stops the batch with a cancellation error and never returns a partial activation", async () => {
    const catalog = createReviewedCatalogSnapshot([
      makeTool({ name: "alpha" }),
      makeTool({ name: "beta" }),
    ]);
    const controller = new AbortController();
    let calls = 0;
    const embeddings: EmbeddingPort = {
      async embed(input) {
        calls++;
        controller.abort();
        return {
          embedding: vector(),
          ...PROFILE,
          purpose: input.purpose,
          usage: null,
        };
      },
    };
    await expect(
      buildCatalogEmbeddingRows(catalog, embeddings, controller.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(calls).toBe(1);
  });

  it("checks the expected active profile before query expansion or embedding", async () => {
    const catalog = createReviewedCatalogSnapshot([makeTool()]);
    const active = {
      id: "index-a",
      provenance: { ...PROFILE, catalogHash: catalog.catalogHash },
    };
    const index = {
      activeIndex: vi.fn(async () => active),
      search: vi.fn(),
    } as never;
    const queryExpansion = { expand: vi.fn() };
    const embedding = { embed: vi.fn() } as unknown as EmbeddingPort;
    const retriever = new PgvectorToolRetriever({
      catalog,
      index,
      embeddingPort: embedding,
      queryExpansionPort: queryExpansion,
      expectedEmbeddingProfile: {
        ...PROFILE,
        model: "gemini-embedding-2",
      },
    });
    await expect(
      retriever.retrieve({ query: "find", variant: "semantic_qe", topK: 1 }),
    ).rejects.toMatchObject({ code: "EMBEDDING_PROFILE_MISMATCH" });
    expect(queryExpansion.expand).not.toHaveBeenCalled();
    expect(embedding.embed).not.toHaveBeenCalled();
  });
});
