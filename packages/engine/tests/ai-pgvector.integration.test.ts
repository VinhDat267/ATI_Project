import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { DEMO_USER_ID, migrate, openDatabase, seedDemo } from "@wap/db";
import {
  createReviewedCatalogSnapshot,
  toolContentHash,
} from "../src/ai/catalog.js";
import { serializeReviewedToolForEmbedding } from "../src/ai/catalog-embedding.js";
import { hashEmbeddingText } from "../src/ai/embedding-policy.js";
import {
  PgvectorCatalogIndex,
  PgvectorToolRetriever,
  PGVECTOR_DIMENSIONS,
} from "../src/ai/pgvector-index.js";
import type { ToolEmbeddingRow } from "../src/ai/retrieval.js";
import { makeTool } from "./ai-fixtures.js";

const adminUrl = "postgresql://wap:wap@127.0.0.1:55532/wap_g1";
const dbName = `engine_ai_it_${randomUUID().replaceAll("-", "")}`;
const url = new URL(adminUrl);
url.pathname = `/${dbName}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
let db: ReturnType<typeof openDatabase>;

function vector(position: number): number[] {
  return Array.from({ length: PGVECTOR_DIMENSIONS }, (_, index) =>
    index === position ? 1 : 0,
  );
}

function rowsFor(
  catalog: ReturnType<typeof createReviewedCatalogSnapshot>,
  model = "embedding-a",
): ToolEmbeddingRow[] {
  return catalog.tools.map((tool, index) => ({
    server: tool.server,
    name: tool.name,
    purpose: "document" as const,
    vector: vector(index),
    contentHash: toolContentHash(tool),
    embeddingTextHash: hashEmbeddingText(
      serializeReviewedToolForEmbedding(tool),
    ),
    provenance: {
      provider: "test-provider",
      model,
      dimensions: PGVECTOR_DIMENSIONS,
      preprocessingVersion: `embedding-policy-v1:${"0".repeat(64)}`,
      catalogHash: catalog.catalogHash,
    },
  }));
}

describe("AI-01 pgvector reviewed catalog index", () => {
  beforeAll(async () => {
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);
    await migrate(url.href);
    db = openDatabase(url.href);
    await seedDemo(db);
  });

  afterAll(async () => {
    await db?.close();
    await admin.unsafe(`DROP DATABASE "${dbName}" WITH (FORCE)`);
    await admin.end();
  });

  it("atomically activates a complete provenance-bound index and performs exact cosine search", async () => {
    const catalog = createReviewedCatalogSnapshot([
      makeTool({ name: "alpha" }),
      makeTool({ name: "beta" }),
    ]);
    const index = new PgvectorCatalogIndex(db, DEMO_USER_ID);
    const first = await index.activate({ catalog, rows: rowsFor(catalog) });
    expect(first.provenance.model).toBe("embedding-a");

    const retriever = new PgvectorToolRetriever({
      catalog,
      index,
      embeddingPort: {
        async embed() {
          return {
            embedding: vector(0),
            purpose: "query" as const,
            ...first.provenance,
            usage: null,
          };
        },
      },
    });
    await expect(
      retriever.retrieve({ query: "alpha", variant: "semantic", topK: 2 }),
    ).resolves.toMatchObject({
      tools: [{ name: "alpha" }, { name: "beta" }],
      scores: [{ score: 1 }, { score: 0 }],
    });

    await expect(
      index.activate({ catalog, rows: rowsFor(catalog).slice(0, 1) }),
    ).rejects.toThrow(/one row|incomplete/i);
    await expect(index.activeIndex(catalog)).resolves.toMatchObject({
      id: first.id,
      provenance: { model: "embedding-a" },
    });

    const second = await index.activate({
      catalog,
      rows: rowsFor(catalog, "embedding-b"),
    });
    expect(second.id).not.toBe(first.id);
    await expect(index.activeIndex(catalog)).resolves.toMatchObject({
      id: second.id,
      provenance: { model: "embedding-b" },
    });
    const states = await db.client<{ state: string; count: number }[]>`
      SELECT state,count(*)::int AS count
      FROM reviewed_embedding_indexes
      WHERE user_id=${DEMO_USER_ID} AND catalog_hash=${catalog.catalogHash}
      GROUP BY state`;
    expect(
      states.sort((left, right) => left.state.localeCompare(right.state)),
    ).toEqual([
      { state: "active", count: 1 },
      { state: "superseded", count: 1 },
    ]);

    await Promise.all([
      index.activate({ catalog, rows: rowsFor(catalog, "embedding-c") }),
      index.activate({ catalog, rows: rowsFor(catalog, "embedding-d") }),
    ]);
    await expect(index.activeIndex(catalog)).resolves.toMatchObject({
      provenance: { model: expect.stringMatching(/^embedding-[cd]$/) },
    });
    const concurrentStates = await db.client<
      {
        state: string;
        count: number;
      }[]
    >`
      SELECT state,count(*)::int AS count
      FROM reviewed_embedding_indexes
      WHERE user_id=${DEMO_USER_ID} AND catalog_hash=${catalog.catalogHash}
      GROUP BY state`;
    expect(
      concurrentStates.sort((left, right) =>
        left.state.localeCompare(right.state),
      ),
    ).toEqual([
      { state: "active", count: 1 },
      { state: "superseded", count: 3 },
    ]);
  });

  it("pins persisted fingerprints and rejects a superseded index", async () => {
    const catalog = createReviewedCatalogSnapshot([
      makeTool({ name: "pin-alpha" }),
      makeTool({ name: "pin-beta" }),
    ]);
    const index = new PgvectorCatalogIndex(db, DEMO_USER_ID);
    const active = await index.activate({
      catalog,
      rows: rowsFor(catalog, "pin-model-a"),
    });
    const pinned = await index.pin(catalog, active.provenance);
    expect(pinned).toMatchObject({
      id: active.id,
      provenance: active.provenance,
      vectorHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      policyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await expect(index.assertCurrent(catalog, pinned)).resolves.toBeUndefined();
    const mutatedVector = `[${Array.from({ length: PGVECTOR_DIMENSIONS }, (_, index) => (index === 0 ? 0.5 : 0)).join(",")}]`;
    await db.client`
      UPDATE reviewed_tool_embeddings
      SET embedding=${mutatedVector}::vector
      WHERE index_id=${pinned.id} AND tool_server='task_hub' AND tool_name='pin-alpha'`;
    await expect(index.assertCurrent(catalog, pinned)).rejects.toMatchObject({
      code: "INDEX_CHANGED",
    });
    await index.activate({
      catalog,
      rows: rowsFor(catalog, "pin-model-b"),
    });
    await expect(index.assertCurrent(catalog, pinned)).rejects.toMatchObject({
      code: "INDEX_CHANGED",
    });
  });

  it("keeps one pinned index for a semantic retrieval session", async () => {
    const catalog = createReviewedCatalogSnapshot([
      makeTool({ name: "session-alpha" }),
      makeTool({ name: "session-beta" }),
    ]);
    const index = new PgvectorCatalogIndex(db, DEMO_USER_ID);
    const first = await index.activate({
      catalog,
      rows: rowsFor(catalog, "session-model-a"),
    });
    const retriever = new PgvectorToolRetriever({
      catalog,
      index,
      embeddingPort: {
        async embed() {
          return {
            embedding: vector(0),
            purpose: "query" as const,
            ...first.provenance,
            usage: null,
          };
        },
      },
    });
    const session = await retriever.createSession("semantic");
    await index.activate({
      catalog,
      rows: rowsFor(catalog, "session-model-b"),
    });

    await expect(session.assertCurrent()).rejects.toMatchObject({
      code: "INDEX_CHANGED",
    });
    await expect(
      session.retriever.retrieve({
        query: "session",
        variant: "semantic",
        topK: 1,
      }),
    ).rejects.toMatchObject({ code: "INDEX_CHANGED" });
  });

  it("discards a semantic result when the active index changes during query embedding", async () => {
    const catalog = createReviewedCatalogSnapshot([
      makeTool({ name: "race-alpha" }),
      makeTool({ name: "race-beta" }),
    ]);
    const index = new PgvectorCatalogIndex(db, DEMO_USER_ID);
    const first = await index.activate({
      catalog,
      rows: rowsFor(catalog, "race-model-a"),
    });
    let resolveEmbedding!: (value: any) => void;
    let signalEmbeddingStarted!: () => void;
    const embeddingStarted = new Promise<void>((resolve) => {
      signalEmbeddingStarted = resolve;
    });
    const retriever = new PgvectorToolRetriever({
      catalog,
      index,
      embeddingPort: {
        async embed() {
          signalEmbeddingStarted();
          return new Promise((resolve) => {
            resolveEmbedding = resolve;
          });
        },
      },
    });
    const pending = retriever.retrieve({
      query: "race",
      variant: "semantic",
      topK: 1,
    });
    await embeddingStarted;
    await index.activate({ catalog, rows: rowsFor(catalog, "race-model-b") });
    resolveEmbedding({
      embedding: vector(0),
      purpose: "query",
      ...first.provenance,
      usage: null,
    });
    await expect(pending).rejects.toMatchObject({ code: "INDEX_CHANGED" });
  });
});
