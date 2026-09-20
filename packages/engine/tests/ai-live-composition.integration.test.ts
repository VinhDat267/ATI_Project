import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { DEMO_USER_ID, migrate, openDatabase, seedDemo } from "@wap/db";
import {
  createOfflineReviewedCatalog,
} from "../src/ai/local-catalog.js";
import { PgvectorCatalogIndex, PGVECTOR_DIMENSIONS } from "../src/ai/pgvector-index.js";
import { InMemoryProviderCallLedger } from "../src/ai/providers/accounting.js";
import { parseLiveEvalConfigFile } from "../src/ai/live-evaluation/dataset.js";
import { createLiveEvaluationRuntimeComposition } from "../src/ai/live-evaluation/composition.js";

const adminUrl = "postgresql://wap:wap@127.0.0.1:55532/wap_g1";
const dbName = `engine_live_composition_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${dbName}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
let database: ReturnType<typeof openDatabase>;
type TestProvider = "openai" | "google";
type ProviderMatrixCase = readonly [
  string,
  readonly TestProvider[],
  readonly TestProvider[],
];
const providerMatrix: readonly ProviderMatrixCase[] = [
  ["openai-only", ["openai"], ["openai"]],
  ["google-only", ["google"], ["google"]],
  ["openai-google", ["openai", "google"], ["google"]],
  ["google-openai", ["google", "openai"], ["openai"]],
];

function vector(): number[] {
  return Array.from({ length: PGVECTOR_DIMENSIONS }, (_, index) =>
    index === 0 ? 1 : 0,
  );
}

async function readLiveConfig() {
  return parseLiveEvalConfigFile(
    JSON.parse(
      await readFile(join(projectRoot, "testdata", "ai-live-eval-config.json"), "utf8"),
    ),
  );
}

async function readCatalog() {
  return createOfflineReviewedCatalog(
    JSON.parse(await readFile(join(projectRoot, "testdata", "tools.json"), "utf8")),
  );
}

describe("AI live evaluator native composition", () => {
  beforeAll(async () => {
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);
    await migrate(databaseUrl.href);
    database = openDatabase(databaseUrl.href);
    await seedDemo(database, DEMO_USER_ID);
  });

  afterAll(async () => {
    await database?.close();
    await admin.unsafe(`DROP DATABASE "${dbName}" WITH (FORCE)`);
    await admin.end();
  });

  it("indexes the reviewed 8+2 catalog with fake transport and persisted provenance", async () => {
    const profile = (await readLiveConfig()).resolveProfile("openai-only");
    const ledger = new InMemoryProviderCallLedger({ campaignLimitMicros: 5_000_000 });
    const requests: string[] = [];
    const runtime = await createLiveEvaluationRuntimeComposition({
      root: projectRoot,
      campaignId: "composition-it",
      profile,
      userId: DEMO_USER_ID,
      evalDatabaseUrl: databaseUrl.href,
      appDatabaseUrl: adminUrl,
      credentials: { OPENAI_API_KEY: "transport-test-key" },
      ledger,
      fetchImpl: async (input) => {
        requests.push(String(input));
        return new Response(
          JSON.stringify({
            id: `embedding-${requests.length}`,
            model: profile.embedding.model,
            data: [{ embedding: vector() }],
            usage: { prompt_tokens: 12, total_tokens: 12 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    try {
      const result = await runtime.index({
        campaignId: "composition-it",
        profileId: profile.id,
        phase: "index",
      });
      expect(result.rowCount).toBe(10);
      expect(result.index.vectorHash).toMatch(/^[a-f0-9]{64}$/);
      expect(requests).toHaveLength(10);

      const catalog = await readCatalog();
      const active = await new PgvectorCatalogIndex(database, DEMO_USER_ID).activeIndex(
        catalog,
      );
      expect(active).toMatchObject({
        provenance: {
          provider: "openai",
          model: "text-embedding-3-large",
          dimensions: PGVECTOR_DIMENSIONS,
          catalogHash: catalog.catalogHash,
        },
        vectorHash: result.index.vectorHash,
        policyHash: result.index.policyHash,
      });
      expect(ledger.records()).toHaveLength(10);
      expect(ledger.records().every((record) => record.status === "succeeded")).toBe(
        true,
      );
    } finally {
      await runtime.close();
    }
  });

  it.each(providerMatrix)(
    "runs the %s planning/embedding profile through native codecs and QE",
    async (profileId, expectedGenerationProviders, expectedEmbeddingProviders) => {
      const profile = (await readLiveConfig()).resolveProfile(profileId);
      const ledger = new InMemoryProviderCallLedger({ campaignLimitMicros: 5_000_000 });
      const credentialReads = { OPENAI_API_KEY: 0, GEMINI_API_KEY: 0 };
      const credentials = new Proxy(
        {
          OPENAI_API_KEY: "transport-openai-key",
          GEMINI_API_KEY: "transport-google-key",
        },
        {
          get(target, property, receiver) {
            if (property === "OPENAI_API_KEY" || property === "GEMINI_API_KEY") {
              credentialReads[property]++;
            }
            return Reflect.get(target, property, receiver);
          },
        },
      );
      const requestModels: string[] = [];
      const runtime = await createLiveEvaluationRuntimeComposition({
        root: projectRoot,
        campaignId: `matrix-${profileId}`,
        profile,
        userId: DEMO_USER_ID,
        evalDatabaseUrl: databaseUrl.href,
        appDatabaseUrl: adminUrl,
        credentials,
        ledger,
        fetchImpl: async (input, init) => {
          const url = String(input);
          const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          const model = typeof body.model === "string" ? body.model.replace(/^models\//, "") : "";
          requestModels.push(model);
          if (url.includes("embedContent") || url.endsWith("/embeddings")) {
            return new Response(
              JSON.stringify(
                url.includes("embedContent")
                  ? {
                      model,
                      embedding: { values: vector() },
                      usageMetadata: { promptTokenCount: 12, totalTokenCount: 12 },
                    }
                  : {
                      id: `embedding-${requestModels.length}`,
                      model,
                      data: [{ embedding: vector() }],
                      usage: { prompt_tokens: 12, total_tokens: 12 },
                    },
              ),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }
          const isQueryExpansion = JSON.stringify(body).includes("Expand the retrieval query");
          const output = isQueryExpansion
            ? { queries: ["reviewed cards"] }
            : {
                result: {
                  kind: "refusal",
                  plan: null,
                  refusal: { reason: "transport matrix refusal" },
                  clarification: null,
                },
              };
          return new Response(
            JSON.stringify({
              id: `response-${requestModels.length}`,
              model,
              status: "completed",
              output_text: JSON.stringify(output),
              usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 },
              usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, totalTokenCount: 16 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      });

      try {
        const indexed = await runtime.index({
          campaignId: `matrix-${profileId}`,
          profileId,
          phase: "index",
        });
        expect(indexed.rowCount).toBe(10);
        const session = await runtime.createSession(
          {
            campaignId: `matrix-${profileId}`,
            runId: `run-${profileId}`,
            profileId,
            trialId: `trial-${profileId}`,
          },
          ledger,
          "semantic_qe",
        );
        await expect(
          session.retriever.retrieve({
            query: "show reviewed cards",
            variant: "semantic_qe",
            topK: 10,
          }),
        ).resolves.toMatchObject({ tools: expect.any(Array) });
        await expect(
          session.model.complete({
            systemPrompt: "Return a refusal.",
            userPrompt: "Matrix probe.",
            schema: { type: "object" },
          }),
        ).resolves.toMatchObject({
          provider: profile.planning.provider,
          model: profile.planning.model,
          output: { kind: "refusal" },
        });

        expect(requestModels.filter((model) => model === profile.embedding.model)).toHaveLength(12);
        expect(ledger.records()).toHaveLength(14);
        expect(
          new Set(ledger.records().map((record) => record.provider)),
        ).toEqual(new Set([...expectedGenerationProviders, ...expectedEmbeddingProviders]));
        if (!expectedGenerationProviders.includes("openai") && !expectedEmbeddingProviders.includes("openai")) {
          expect(credentialReads.OPENAI_API_KEY).toBe(0);
        }
        if (!expectedGenerationProviders.includes("google") && !expectedEmbeddingProviders.includes("google")) {
          expect(credentialReads.GEMINI_API_KEY).toBe(0);
        }
      } finally {
        await runtime.close();
      }
    },
  );
});
