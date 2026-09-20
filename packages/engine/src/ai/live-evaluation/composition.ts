import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { G1_DATABASE_URL, openDatabase, type Database } from "@wap/db";
import { createOfflineReviewedCatalog } from "../local-catalog.js";
import {
  buildCatalogEmbeddingRows,
} from "../catalog-embedding.js";
import { PgvectorCatalogIndex, PgvectorToolRetriever } from "../pgvector-index.js";
import { createAiPorts } from "../providers/registry.js";
import type {
  AiProviderCallContext,
  AiProviderCredentials,
  AiPorts,
  AuthorizeProviderCall,
  FetchLike,
  ProviderCallLedger,
} from "../providers/registry.js";
import type { AiProviderConfig } from "../providers/config.js";
import type { ProviderPriceCard } from "./pricing.js";
import type { LiveProfileConfig } from "./contracts.js";
import {
  parseEvaluationDatabaseIdentity,
  sameEvaluationDatabase,
} from "./database-identity.js";
import {
  createLiveEvaluationRuntime,
  type LiveEvaluationRuntime,
} from "./runtime.js";
import type { LiveEvaluationSessionContext } from "./runner.js";

export interface LiveEvaluationCompositionOptions {
  readonly root: string;
  readonly campaignId: string;
  readonly profile: LiveProfileConfig;
  readonly userId: string;
  readonly evalDatabaseUrl?: string;
  readonly appDatabaseUrl?: string;
  readonly credentials: AiProviderCredentials;
  readonly ledger: ProviderCallLedger;
  readonly authorizeCall?: AuthorizeProviderCall;
  readonly fetchImpl?: FetchLike;
  readonly priceCard?: ProviderPriceCard;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertDatabaseIsolation(evalUrl: string, appUrl?: string): void {
  const effectiveAppUrl = appUrl?.trim() || G1_DATABASE_URL;
  const evaluation = parseEvaluationDatabaseIdentity(evalUrl);
  const application = parseEvaluationDatabaseIdentity(effectiveAppUrl, "DATABASE_URL");
  if (sameEvaluationDatabase(evaluation, application)) {
    throw new Error("AI_EVAL_DATABASE_URL must target a different database");
  }
}

function providerConfig(profile: LiveProfileConfig): AiProviderConfig {
  return {
    planning: profile.planning,
    queryExpansion: profile.queryExpansion,
    embedding: profile.embedding,
    limits: {
      requestTimeoutMs: profile.limits?.requestTimeoutMs ?? 45_000,
      trialDeadlineMs: profile.limits?.trialDeadlineMs ?? 120_000,
      maxPlanningCalls: profile.limits?.maxPlanningCalls ?? 3,
      maxReplanCalls: profile.limits?.maxReplanCalls ?? 2,
      maxQueryExpansionCalls: profile.limits?.maxQueryExpansionCalls ?? 1,
      reservationEstimateMicros:
        profile.limits?.reservationEstimateMicros ?? 100_000,
    },
  };
}

function probeUsage(
  usage:
    | Readonly<{
        readonly inputTokens?: number;
        readonly cachedInputTokens?: number;
        readonly outputTokens?: number;
        readonly totalTokens?: number;
      }>
    | null
    | undefined,
): Readonly<Record<string, number>> | null {
  return usage ? { ...usage } : null;
}

function assertRoleScope(
  options: LiveEvaluationCompositionOptions,
  request: Parameters<AuthorizeProviderCall>[0],
): void {
  if (request.campaignId !== options.campaignId) {
    throw new Error("provider call campaign scope does not match runtime");
  }
  const expected =
    request.purpose === "embedding"
      ? options.profile.embedding
      : request.purpose === "query_expansion"
        ? options.profile.queryExpansion
        : options.profile.planning;
  if (request.provider !== expected.provider || request.model !== expected.model) {
    throw new Error("provider call role does not match frozen profile");
  }
}

async function loadCatalog(root: string) {
  const raw = JSON.parse(await readFile(join(root, "testdata/tools.json"), "utf8"));
  return createOfflineReviewedCatalog(raw);
}

/** Concrete evaluator-only composition. It never changes the API runtime default denial. */
export async function createLiveEvaluationRuntimeComposition(
  options: LiveEvaluationCompositionOptions,
): Promise<LiveEvaluationRuntime> {
  let catalog: Awaited<ReturnType<typeof loadCatalog>>;
  try {
    catalog = await loadCatalog(options.root);
  } catch (error) {
    throw error;
  }
  let database: Database | undefined;
  let index: PgvectorCatalogIndex | undefined;
  const getIndex = (): PgvectorCatalogIndex => {
    if (index) return index;
    if (!options.evalDatabaseUrl?.trim()) {
      throw new Error(
        "AI_EVAL_DATABASE_URL is required for index and semantic session phases",
      );
    }
    assertDatabaseIsolation(options.evalDatabaseUrl, options.appDatabaseUrl);
    database = openDatabase(options.evalDatabaseUrl);
    index = new PgvectorCatalogIndex(database, options.userId);
    return index;
  };
  const config = providerConfig(options.profile);
  let closed = false;

  const portsFor = (
    context: AiProviderCallContext,
    ledger: ProviderCallLedger,
  ): AiPorts =>
    createAiPorts({
      config,
      credentials: options.credentials,
      ledger,
      callContext: context,
      authorizeCall: async (request) => {
        assertRoleScope(options, request);
        await options.authorizeCall?.(request);
      },
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.priceCard ? { priceCard: options.priceCard } : {}),
    });

  const runtime = createLiveEvaluationRuntime({
    probe: async (request) => {
      const context = {
        campaignId: request.campaignId,
        runId: `probe-${request.campaignId}`,
        profileId: request.profileId,
        trialId: `probe-${request.profileId}`,
      } satisfies AiProviderCallContext;
      const ports = portsFor(context, options.ledger);
      const calls = [];
      for (const purpose of ["planning", "repair", "replan"] as const) {
        const model = await ports.model.complete({
          purpose,
          systemPrompt: "Return a refusal for this connectivity probe.",
          userPrompt: `Probe the configured ${purpose} provider path.`,
          schema: { type: "object", additionalProperties: true },
          signal: request.signal,
        });
        calls.push({
          role: purpose,
          provider: model.provider,
          model: model.model,
          requestId: model.requestId,
          usage: probeUsage(model.usage),
        });
      }
      const expanded = await ports.queryExpansion.expand({
        query: "probe",
        signal: request.signal,
      });
      calls.push({
        role: "query_expansion",
        provider: expanded.provider,
        model: expanded.model,
        requestId: expanded.requestId,
        usage: probeUsage(expanded.usage),
      });
      for (const purpose of ["document", "query"] as const) {
        const embedding = await ports.embedding.embed({
          text: "probe",
          purpose,
          signal: request.signal,
        });
        calls.push({
          role: `embedding:${purpose}`,
          provider: embedding.provider,
          model: embedding.model,
          requestId: embedding.requestId,
          usage: probeUsage(embedding.usage),
        });
      }
      return { calls };
    },
    index: async (request) => {
      const context = {
        campaignId: request.campaignId,
        runId: `index-${request.campaignId}`,
        profileId: request.profileId,
        trialId: `index-${request.profileId}`,
      } satisfies AiProviderCallContext;
      const ports = portsFor(context, options.ledger);
      const rows = await buildCatalogEmbeddingRows(
        catalog,
        ports.embedding,
        request.signal,
      );
      const active = await getIndex().activate({ catalog, rows });
      return {
        index: {
          id: active.id,
          provenanceHash: sha256(active.provenance),
          vectorHash: active.vectorHash,
          policyHash: active.policyHash,
        },
        rowCount: rows.length,
      };
    },
    createSession: async (
      context,
      ledger = options.ledger,
      variant = "all_tools",
    ) => {
      const ports = portsFor(context, ledger);
      const base = new PgvectorToolRetriever({
        catalog,
        index: getIndex(),
        embeddingPort: ports.embedding,
        queryExpansionPort: ports.queryExpansion,
        expectedEmbeddingProfile: options.profile.embedding,
      });
      const retrievalSession = await base.createSession(variant);
      return {
        model: ports.model,
        retriever: retrievalSession.retriever,
        assertCurrent: retrievalSession.assertCurrent,
      };
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await database?.close();
    },
  });
  return runtime;
}

export type { Database };
