import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { DEMO_USER_ID, migrate, openDatabase, seedDemo } from "@wap/db";
import {
  createReviewedCatalogSnapshot,
  toolContentHash,
} from "../src/ai/catalog.js";
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
    provenance: {
      provider: "test-provider",
      model,
      dimensions: PGVECTOR_DIMENSIONS,
      preprocessingVersion: "embedding-policy-v1:test",
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
});
