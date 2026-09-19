import { z } from "zod";
import type { Database } from "@wap/db";
import { canonicalJson, hash } from "../snapshot.js";
import {
  qualifiedToolIdentity,
  toolContentHash,
  type ReviewedCatalogSnapshot,
  type ReviewedCatalogTool,
} from "./catalog.js";
import type {
  EmbeddingPort,
  EmbeddingResult,
  QueryExpansionPort,
  QueryExpansionResult,
} from "./ports.js";
import {
  RetrievalValidationError,
  assertExpectedEmbeddingProfile,
  type EmbeddingProvenance,
  type RetrievalRequest,
  type RetrievalResult,
  type RetrievalVariant,
  type ToolEmbeddingRow,
  type ToolRetriever,
  type AiRetrievalSession,
  type ExpectedEmbeddingProfile,
} from "./retrieval.js";
import {
  hashEmbeddingText,
  isEmbeddingPolicyVersion,
  REVIEWED_TOOL_SERIALIZER_VERSION,
} from "./embedding-policy.js";

export const PGVECTOR_DIMENSIONS = 1536;

export interface ValidatedPgvectorActivation {
  readonly rows: readonly ToolEmbeddingRow[];
  readonly provenance: EmbeddingProvenance;
}

function validation(
  message: string,
  code = "INVALID_RETRIEVAL",
): RetrievalValidationError {
  return new RetrievalValidationError(message, code);
}

function compareIdentity(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function serializeReviewedToolForEmbedding(tool: ReviewedCatalogTool): string {
  return canonicalJson({
    format: REVIEWED_TOOL_SERIALIZER_VERSION,
    identity: qualifiedToolIdentity(tool),
    description: tool.description,
    input_schema: tool.inputSchema,
    output_schema: tool.outputSchema,
    side_effect: tool.sideEffect,
    policy_version: tool.policyVersion,
    artifact_hash: tool.artifactHash,
  });
}

function validateVector(vector: readonly number[], label: string): void {
  if (!Array.isArray(vector) || vector.length !== PGVECTOR_DIMENSIONS)
    throw validation(
      `${label} vector must have ${PGVECTOR_DIMENSIONS} dimensions`,
    );
  let normSquared = 0;
  for (let index = 0; index < vector.length; index++) {
    if (!Object.hasOwn(vector, index) || !Number.isFinite(vector[index]!))
      throw validation(`${label} vector must be dense and finite`);
    normSquared += vector[index]! * vector[index]!;
  }
  if (!Number.isFinite(normSquared) || normSquared === 0)
    throw validation(`${label} vector must not be zero`);
}

function sameProvenance(
  left: EmbeddingProvenance,
  right: EmbeddingProvenance,
): boolean {
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    left.dimensions === right.dimensions &&
    left.preprocessingVersion === right.preprocessingVersion &&
    left.catalogHash === right.catalogHash
  );
}

function parseProvenance(value: unknown, label: string): EmbeddingProvenance {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw validation(`${label} provenance is malformed`);
  const record = value as Record<string, unknown>;
  if (record.dimensions !== PGVECTOR_DIMENSIONS)
    throw validation(
      `${label} provenance dimensions must be ${PGVECTOR_DIMENSIONS}`,
    );
  if (
    typeof record.provider !== "string" ||
    !record.provider.trim() ||
    typeof record.model !== "string" ||
    !record.model.trim() ||
    !isEmbeddingPolicyVersion(record.preprocessingVersion) ||
    typeof record.catalogHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.catalogHash)
  )
    throw validation(`${label} provenance is malformed`);
  if (
    /synthetic|fixture|character-hash/i.test(
      `${record.provider}:${record.model}`,
    )
  )
    throw validation(
      `${label} synthetic provenance cannot activate a live index`,
      "SYNTHETIC_PROVENANCE",
    );
  return {
    provider: record.provider,
    model: record.model,
    dimensions: record.dimensions,
    preprocessingVersion: record.preprocessingVersion,
    catalogHash: record.catalogHash,
  };
}

/** Validates the complete immutable index before a transaction can persist it. */
export function validatePgvectorActivation(
  catalog: ReviewedCatalogSnapshot,
  rows: readonly ToolEmbeddingRow[],
): ValidatedPgvectorActivation {
  if (
    !Array.isArray(rows) ||
    rows.length !== catalog.tools.length ||
    rows.length === 0
  )
    throw validation(
      "pgvector activation requires one row for every reviewed tool",
    );
  const expected = new Map(
    catalog.tools.map((tool) => [qualifiedToolIdentity(tool), tool]),
  );
  const seen = new Set<string>();
  const validated: ToolEmbeddingRow[] = [];
  let provenance: EmbeddingProvenance | undefined;
  for (const row of rows) {
    if (
      !row ||
      typeof row !== "object" ||
      typeof row.server !== "string" ||
      typeof row.name !== "string"
    )
      throw validation("pgvector activation row is malformed");
    const identity = qualifiedToolIdentity(row);
    const tool = expected.get(identity);
    if (!tool) throw validation(`foreign embedding row: ${identity}`);
    if (seen.has(identity))
      throw validation(`duplicate embedding row: ${identity}`);
    seen.add(identity);
    if (row.purpose !== "document")
      throw validation(`embedding row ${identity} must have document purpose`);
    const rowProvenance = parseProvenance(
      row.provenance,
      `embedding row ${identity}`,
    );
    if (rowProvenance.catalogHash !== catalog.catalogHash)
      throw validation("embedding row catalog hash mismatch");
    if (provenance && !sameProvenance(provenance, rowProvenance))
      throw validation("embedding row provenance mismatch");
    if (row.contentHash !== toolContentHash(tool))
      throw validation(`embedding row content hash mismatch: ${identity}`);
    if (
      typeof row.embeddingTextHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.embeddingTextHash)
    )
      throw validation(
        `embedding row text hash is required and malformed: ${identity}`,
      );
    if (
      row.embeddingTextHash !==
      hashEmbeddingText(serializeReviewedToolForEmbedding(tool))
    )
      throw validation(`embedding row text hash mismatch: ${identity}`);
    validateVector(row.vector, `embedding row ${identity}`);
    provenance ??= rowProvenance;
    validated.push(
      Object.freeze({
        server: row.server,
        name: row.name,
        purpose: "document",
        vector: Object.freeze([...row.vector]),
        contentHash: row.contentHash,
        embeddingTextHash: row.embeddingTextHash,
        provenance: Object.freeze({ ...rowProvenance }),
      }),
    );
  }
  if (seen.size !== expected.size || !provenance)
    throw validation("pgvector activation index is incomplete");
  return Object.freeze({
    rows: Object.freeze(validated),
    provenance: Object.freeze(provenance),
  });
}

function vectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(",")}]`;
}

function validateTopK(topK: number): void {
  if (!Number.isInteger(topK) || topK < 1 || topK > 10)
    throw validation("topK must be an integer between 1 and 10");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw validation("retrieval cancelled", "CANCELLED");
}

function validateQueryEmbedding(
  result: EmbeddingResult,
  expected: EmbeddingProvenance,
): void {
  if (!result || typeof result !== "object")
    throw validation("query embedding result is malformed");
  if (
    result.purpose !== "query" ||
    result.provider !== expected.provider ||
    result.model !== expected.model ||
    result.dimensions !== expected.dimensions ||
    result.preprocessingVersion !== expected.preprocessingVersion ||
    (result.catalogHash !== undefined &&
      result.catalogHash !== expected.catalogHash)
  )
    throw validation("query embedding provenance mismatch");
  validateVector(result.embedding, "query");
}

export interface ActivePgvectorIndex {
  readonly id: string;
  readonly provenance: EmbeddingProvenance;
  readonly vectorHash?: string;
  readonly policyHash?: string;
}

export interface PinnedEmbeddingIndex extends ActivePgvectorIndex {
  readonly vectorHash: string;
  readonly policyHash: string;
}

function policyManifest(
  provenance: EmbeddingProvenance,
): Record<string, unknown> {
  return {
    format: "embedding-policy-v1",
    provider: provenance.provider,
    model: provenance.model,
    dimensions: provenance.dimensions,
    preprocessingVersion: provenance.preprocessingVersion,
  };
}

function parsePersistedVector(value: unknown, label: string): number[] {
  if (Array.isArray(value)) return value.map(Number);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      return trimmed
        .slice(1, -1)
        .split(",")
        .filter((item) => item.length > 0)
        .map((item) => Number(item));
    }
  }
  throw validation(`${label} persisted vector is malformed`);
}

function fingerprintRows(
  rows: readonly {
    tool_server: string;
    tool_name: string;
    content_hash: string;
    purpose: string | null;
    embedding_text_hash: string | null;
    embedding: unknown;
  }[],
  label: string,
): string {
  const normalized = rows
    .map((row) => ({
      server: row.tool_server,
      name: row.tool_name,
      contentHash: row.content_hash,
      purpose: row.purpose,
      embeddingTextHash: row.embedding_text_hash,
      vector: parsePersistedVector(
        row.embedding,
        `${label} ${row.tool_server}.${row.tool_name}`,
      ),
    }))
    .sort((left, right) =>
      compareIdentity(
        `${left.server}.${left.name}`,
        `${right.server}.${right.name}`,
      ),
    );
  return hash(normalized);
}

export class PgvectorCatalogIndex {
  private readonly userId: string;

  constructor(
    private readonly database: Database,
    userId: string,
  ) {
    this.userId = z.uuid().parse(userId);
  }

  async activate(input: {
    readonly catalog: ReviewedCatalogSnapshot;
    readonly rows: readonly ToolEmbeddingRow[];
  }): Promise<PinnedEmbeddingIndex> {
    const activation = validatePgvectorActivation(input.catalog, input.rows);
    const catalogJson = canonicalJson(input.catalog.tools);
    return this.database.client.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${this.userId}:${input.catalog.catalogHash}`}, 0))`;
      const snapshots = await tx<{ catalog_hash: string }[]>`
        INSERT INTO reviewed_catalog_snapshots(user_id,catalog_hash,catalog)
        VALUES (${this.userId},${input.catalog.catalogHash},${tx.json(JSON.parse(catalogJson))})
        ON CONFLICT (user_id,catalog_hash) DO UPDATE
          SET catalog = reviewed_catalog_snapshots.catalog
          WHERE reviewed_catalog_snapshots.catalog = EXCLUDED.catalog
        RETURNING catalog_hash`;
      if (snapshots.length !== 1)
        throw validation(
          "catalog hash collision or persisted catalog mismatch",
        );
      await tx`
        UPDATE reviewed_embedding_indexes SET state='superseded'
        WHERE user_id=${this.userId} AND catalog_hash=${input.catalog.catalogHash} AND state='active'`;
      const inserted = await tx<{ id: string }[]>`
        INSERT INTO reviewed_embedding_indexes(
          user_id,catalog_hash,provider,model,dimensions,preprocessing_version,
          policy_manifest,state
        ) VALUES (
          ${this.userId},${input.catalog.catalogHash},${activation.provenance.provider},
          ${activation.provenance.model},${activation.provenance.dimensions},
          ${activation.provenance.preprocessingVersion},
          ${tx.json(JSON.parse(canonicalJson(policyManifest(activation.provenance))))},'building'
        ) RETURNING id`;
      const id = inserted[0]?.id;
      if (!id) throw validation("could not create pgvector embedding index");
      for (const row of activation.rows) {
        const embeddingTextHash = row.embeddingTextHash;
        if (!embeddingTextHash)
          throw validation(
            "embedding text hash missing after activation validation",
          );
        await tx`
          INSERT INTO reviewed_tool_embeddings(
            index_id,tool_server,tool_name,content_hash,purpose,embedding_text_hash,embedding
          ) VALUES (
            ${id},${row.server},${row.name},${row.contentHash},${row.purpose},
            ${embeddingTextHash},${vectorLiteral(row.vector)}::vector
          )`;
      }
      const persistedRows = await tx<
        {
          tool_server: string;
          tool_name: string;
          content_hash: string;
          purpose: string | null;
          embedding_text_hash: string | null;
          embedding: unknown;
        }[]
      >`
        SELECT tool_server,tool_name,content_hash,purpose,embedding_text_hash,embedding
        FROM reviewed_tool_embeddings WHERE index_id=${id}
        ORDER BY tool_server,tool_name`;
      const count = persistedRows.length;
      if (count !== activation.rows.length)
        throw validation(
          "pgvector embedding index row count changed during activation",
        );
      const vectorHash = fingerprintRows(persistedRows, "activation");
      await tx`
        UPDATE reviewed_embedding_indexes
        SET vector_hash=${vectorHash}, state='active', activated_at=clock_timestamp()
        WHERE id=${id} AND state='building'`;
      return Object.freeze({
        id,
        provenance: activation.provenance,
        vectorHash,
        policyHash: hash(policyManifest(activation.provenance)),
      });
    });
  }

  async activeIndex(
    catalog: ReviewedCatalogSnapshot,
  ): Promise<PinnedEmbeddingIndex> {
    const indexes = await this.database.client<
      {
        id: string;
        provider: string;
        model: string;
        dimensions: number;
        preprocessing_version: string;
        vector_hash: string | null;
        policy_manifest: unknown;
        catalog: unknown;
      }[]
    >`
      SELECT i.id,i.provider,i.model,i.dimensions,i.preprocessing_version,
        i.vector_hash,i.policy_manifest,s.catalog
      FROM reviewed_embedding_indexes i
      JOIN reviewed_catalog_snapshots s
        ON s.user_id=i.user_id AND s.catalog_hash=i.catalog_hash
      WHERE i.user_id=${this.userId} AND i.catalog_hash=${catalog.catalogHash} AND i.state='active'`;
    if (indexes.length !== 1)
      throw validation("no active pgvector index for reviewed catalog");
    const index = indexes[0]!;
    if (canonicalJson(index.catalog) !== canonicalJson(catalog.tools))
      throw validation(
        "persisted catalog does not match the reviewed snapshot",
      );
    const provenance = parseProvenance(
      {
        provider: index.provider,
        model: index.model,
        dimensions: index.dimensions,
        preprocessingVersion: index.preprocessing_version,
        catalogHash: catalog.catalogHash,
      },
      "active pgvector index",
    );
    if (!index.vector_hash || !index.policy_manifest) {
      throw validation(
        "legacy pgvector index lacks persisted fingerprint",
        "LEGACY_INDEX_UNQUERYABLE",
      );
    }
    const expectedManifest = policyManifest(provenance);
    if (
      canonicalJson(index.policy_manifest) !== canonicalJson(expectedManifest)
    )
      throw validation(
        "active pgvector index policy manifest drifted",
        "INDEX_CHANGED",
      );
    const rows = await this.database.client<
      {
        tool_server: string;
        tool_name: string;
        content_hash: string;
        purpose: string | null;
        embedding_text_hash: string | null;
        embedding: unknown;
      }[]
    >`
      SELECT tool_server,tool_name,content_hash,purpose,embedding_text_hash,embedding
      FROM reviewed_tool_embeddings WHERE index_id=${index.id}
      ORDER BY tool_server,tool_name`;
    const expected = new Map(
      catalog.tools.map((tool) => [qualifiedToolIdentity(tool), tool]),
    );
    if (rows.length !== expected.size)
      throw validation("active pgvector index is incomplete");
    const seen = new Set<string>();
    for (const row of rows) {
      const identity = qualifiedToolIdentity({
        server: row.tool_server,
        name: row.tool_name,
      });
      const tool = expected.get(identity);
      if (
        !tool ||
        seen.has(identity) ||
        row.content_hash !== toolContentHash(tool) ||
        row.purpose !== "document" ||
        row.embedding_text_hash !==
          hashEmbeddingText(serializeReviewedToolForEmbedding(tool))
      )
        throw validation(
          "active pgvector index provenance or content drifted",
          "INDEX_CHANGED",
        );
      validateVector(
        parsePersistedVector(row.embedding, `active row ${identity}`),
        `active row ${identity}`,
      );
      seen.add(identity);
    }
    const vectorHash = fingerprintRows(rows, "active index");
    if (vectorHash !== index.vector_hash)
      throw validation(
        "active pgvector index fingerprint drifted",
        "INDEX_CHANGED",
      );
    return Object.freeze({
      id: index.id,
      provenance: Object.freeze(provenance),
      vectorHash,
      policyHash: hash(expectedManifest),
    });
  }

  async pin(
    catalog: ReviewedCatalogSnapshot,
    expectedProfile?: ExpectedEmbeddingProfile,
  ): Promise<PinnedEmbeddingIndex> {
    const active = await this.activeIndex(catalog);
    assertExpectedEmbeddingProfile(active.provenance, expectedProfile);
    return active;
  }

  async assertCurrent(
    catalog: ReviewedCatalogSnapshot,
    pinned: PinnedEmbeddingIndex,
  ): Promise<void> {
    let current: PinnedEmbeddingIndex;
    try {
      current = await this.activeIndex(catalog);
    } catch (error) {
      if (
        error instanceof RetrievalValidationError &&
        error.code === "INDEX_CHANGED"
      )
        throw error;
      throw error;
    }
    if (
      current.id !== pinned.id ||
      current.vectorHash !== pinned.vectorHash ||
      current.policyHash !== pinned.policyHash
    )
      throw validation(
        "active embedding index changed during request",
        "INDEX_CHANGED",
      );
  }

  async search(input: {
    readonly index: PinnedEmbeddingIndex;
    readonly catalog: ReviewedCatalogSnapshot;
    readonly query: readonly number[];
    readonly topK: number;
  }): Promise<readonly { tool: ReviewedCatalogTool; score: number }[]> {
    await this.assertCurrent(input.catalog, input.index);
    const rows = await this.database.client<
      {
        tool_server: string;
        tool_name: string;
        content_hash: string;
        purpose: string | null;
        embedding_text_hash: string | null;
        score: string | number;
      }[]
    >`
      SELECT tool_server,tool_name,content_hash,purpose,embedding_text_hash,
        1 - (embedding <=> ${vectorLiteral(input.query)}::vector) AS score
      FROM reviewed_tool_embeddings
      WHERE index_id=${input.index.id}
      ORDER BY embedding <=> ${vectorLiteral(input.query)}::vector, tool_server ASC, tool_name ASC
      LIMIT ${input.topK}`;
    const tools = new Map(
      input.catalog.tools.map((tool) => [qualifiedToolIdentity(tool), tool]),
    );
    const results = rows.map((row) => {
      const identity = qualifiedToolIdentity({
        server: row.tool_server,
        name: row.tool_name,
      });
      const tool = tools.get(identity);
      const score = Number(row.score);
      if (
        !tool ||
        row.content_hash !== toolContentHash(tool) ||
        row.purpose !== "document" ||
        row.embedding_text_hash !==
          hashEmbeddingText(serializeReviewedToolForEmbedding(tool)) ||
        !Number.isFinite(score)
      )
        throw validation(
          "pgvector search returned drifted or non-finite result",
        );
      return Object.freeze({ tool, score });
    });
    await this.assertCurrent(input.catalog, input.index);
    return results;
  }
}

/** Exact pgvector cosine retriever. It never reads the legacy raw `tools` table. */
export class PgvectorToolRetriever implements ToolRetriever {
  constructor(
    private readonly input: {
      catalog: ReviewedCatalogSnapshot;
      index: PgvectorCatalogIndex;
      embeddingPort: EmbeddingPort;
      queryExpansionPort?: QueryExpansionPort;
      expectedEmbeddingProfile?: ExpectedEmbeddingProfile;
      pinnedIndex?: PinnedEmbeddingIndex;
    },
  ) {}

  /** Pin semantic retrieval once for one planner/replan invocation. */
  async createSession(variant: RetrievalVariant): Promise<AiRetrievalSession> {
    if (variant === "all_tools")
      return {
        retriever: this,
        assertCurrent: async () => {},
      };
    const pinnedIndex = await this.input.index.pin(
      this.input.catalog,
      this.input.expectedEmbeddingProfile,
    );
    const retriever = new PgvectorToolRetriever({
      ...this.input,
      pinnedIndex,
    });
    return {
      retriever,
      assertCurrent: () =>
        this.input.index.assertCurrent(this.input.catalog, pinnedIndex),
    };
  }

  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    validateTopK(request.topK);
    if (typeof request.query !== "string" || request.query.trim().length === 0)
      throw validation("query must be non-empty");
    throwIfAborted(request.signal);
    const started = Date.now();
    if (request.variant === "all_tools")
      return {
        tools: this.input.catalog.tools,
        scores: [],
        variant: request.variant,
        topK: request.topK,
        queryHash: hash(request.query),
        latencyMs: Date.now() - started,
      };

    if (request.variant === "semantic_qe") {
      if (!this.input.queryExpansionPort) {
        throw validation(
          "QueryExpansionPort is required for semantic_qe variant",
          "MISSING_QUERY_EXPANSION_PORT",
        );
      }
      const active =
        this.input.pinnedIndex ??
        (await this.input.index.pin(
          this.input.catalog,
          this.input.expectedEmbeddingProfile,
        ));
      throwIfAborted(request.signal);
      await this.input.index.assertCurrent(this.input.catalog, active);

      let expansion: QueryExpansionResult;
      try {
        expansion = await this.input.queryExpansionPort.expand({
          query: request.query,
          signal: request.signal,
        });
      } catch (error) {
        if (request.signal?.aborted)
          throw validation("retrieval cancelled", "CANCELLED");
        throw error;
      }
      throwIfAborted(request.signal);
      await this.input.index.assertCurrent(this.input.catalog, active);

      if (!expansion || !Array.isArray(expansion.queries)) {
        throw validation("query expansion result must contain a queries array");
      }

      const candidateIntents = expansion.queries
        .filter(
          (q): q is string => typeof q === "string" && q.trim().length > 0,
        )
        .map((q) => q.trim())
        .slice(0, 6);

      const queriesToEmbed = [
        request.query,
        ...candidateIntents.filter((q) => q !== request.query),
      ];

      const embeddings: EmbeddingResult[] = [];
      for (const queryText of queriesToEmbed) {
        throwIfAborted(request.signal);
        await this.input.index.assertCurrent(this.input.catalog, active);
        let queryEmbedding: EmbeddingResult;
        try {
          queryEmbedding = await this.input.embeddingPort.embed({
            text: queryText,
            purpose: "query",
            signal: request.signal,
          });
        } catch (error) {
          if (request.signal?.aborted)
            throw validation("retrieval cancelled", "CANCELLED");
          throw error;
        }
        throwIfAborted(request.signal);
        await this.input.index.assertCurrent(this.input.catalog, active);
        validateQueryEmbedding(queryEmbedding, active.provenance);
        embeddings.push(queryEmbedding);
      }

      const toolScores = new Map<
        string,
        { tool: ReviewedCatalogTool; score: number }
      >();
      for (const emb of embeddings) {
        throwIfAborted(request.signal);
        const results = await this.input.index.search({
          index: active,
          catalog: this.input.catalog,
          query: emb.embedding,
          topK: this.input.catalog.tools.length,
        });
        for (const item of results) {
          const id = qualifiedToolIdentity(item.tool);
          const existing = toolScores.get(id);
          if (!existing || item.score > existing.score) {
            toolScores.set(id, item);
          }
        }
      }

      const sorted = Array.from(toolScores.values()).sort(
        (left, right) =>
          right.score - left.score ||
          compareIdentity(
            qualifiedToolIdentity(left.tool),
            qualifiedToolIdentity(right.tool),
          ),
      );

      const selected = sorted.slice(
        0,
        Math.min(request.topK, this.input.catalog.tools.length),
      );
      throwIfAborted(request.signal);
      await this.input.index.assertCurrent(this.input.catalog, active);

      return {
        tools: selected.map((entry) => entry.tool),
        scores: selected,
        variant: request.variant,
        topK: request.topK,
        queryHash: hash(request.query),
        latencyMs: Date.now() - started,
        expandedQueries: candidateIntents,
        expansionUsage: expansion.usage,
      };
    }

    if (request.variant !== "semantic")
      throw validation(
        `retrieval variant is unsupported in AI-01: ${String(request.variant)}`,
        "UNSUPPORTED_VARIANT",
      );
    const active =
      this.input.pinnedIndex ??
      (await this.input.index.pin(
        this.input.catalog,
        this.input.expectedEmbeddingProfile,
      ));
    throwIfAborted(request.signal);
    await this.input.index.assertCurrent(this.input.catalog, active);
    let query: EmbeddingResult;
    try {
      query = await this.input.embeddingPort.embed({
        text: request.query,
        purpose: "query",
        signal: request.signal,
      });
    } catch (error) {
      if (request.signal?.aborted)
        throw validation("retrieval cancelled", "CANCELLED");
      throw error;
    }
    throwIfAborted(request.signal);
    await this.input.index.assertCurrent(this.input.catalog, active);
    validateQueryEmbedding(query, active.provenance);
    const scores = await this.input.index.search({
      index: active,
      catalog: this.input.catalog,
      query: query.embedding,
      topK: Math.min(request.topK, this.input.catalog.tools.length),
    });
    throwIfAborted(request.signal);
    await this.input.index.assertCurrent(this.input.catalog, active);
    return {
      tools: scores.map((entry) => entry.tool),
      scores,
      variant: request.variant,
      topK: request.topK,
      queryHash: hash(request.query),
      latencyMs: Date.now() - started,
    };
  }
}
