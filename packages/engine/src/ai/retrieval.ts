import { hash } from "../snapshot.js";
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
  QueryExpansionUsage,
} from "./ports.js";

export interface EmbeddingProvenance {
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  readonly preprocessingVersion: string;
  readonly catalogHash: string;
}
export interface ToolEmbeddingRow {
  readonly server: string;
  readonly name: string;
  readonly vector: readonly number[];
  readonly contentHash: string;
  readonly provenance: EmbeddingProvenance;
}
export type RetrievalVariant = "all_tools" | "semantic" | "semantic_qe";
export class RetrievalValidationError extends Error {
  constructor(
    message: string,
    readonly code = "INVALID_RETRIEVAL",
  ) {
    super(message);
    this.name = "RetrievalValidationError";
  }
}
export interface RetrievalRequest {
  readonly query: string;
  readonly variant: RetrievalVariant;
  readonly topK: number;
  readonly signal?: AbortSignal;
}
export interface RetrievalResult {
  readonly tools: readonly ReviewedCatalogTool[];
  readonly scores: readonly {
    readonly tool: ReviewedCatalogTool;
    readonly score: number;
  }[];
  readonly variant: RetrievalVariant;
  readonly topK: number;
  readonly queryHash: string;
  readonly latencyMs: number;
  readonly expandedQueries?: readonly string[];
  readonly expansionUsage?: QueryExpansionUsage | null;
}
export interface ToolRetriever {
  retrieve(input: RetrievalRequest): Promise<RetrievalResult>;
}

type IndexRow = ToolEmbeddingRow & { readonly identity: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function compareIdentity(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function cancelled(): RetrievalValidationError {
  return new RetrievalValidationError("retrieval cancelled", "CANCELLED");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw cancelled();
}

function validateTopK(topK: number): void {
  if (!Number.isInteger(topK) || topK < 1 || topK > 10)
    throw new RetrievalValidationError(
      "topK must be an integer between 1 and 10",
    );
}

function validateVector(
  vector: readonly number[],
  dimensions: number,
  label: string,
): void {
  if (!Array.isArray(vector) || vector.length !== dimensions)
    throw new RetrievalValidationError(`${label} vector has wrong dimension`);
  let normSquared = 0;
  for (let index = 0; index < dimensions; index++) {
    if (!Object.hasOwn(vector, index))
      throw new RetrievalValidationError(`${label} vector must be dense`);
    const value = vector[index];
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new RetrievalValidationError(
        `${label} vector contains a non-finite value`,
      );
    normSquared += value * value;
  }
  if (!Number.isFinite(normSquared) || normSquared === 0)
    throw new RetrievalValidationError(`${label} vector must not be zero`);
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

function validateProvenance(
  value: unknown,
  label: string,
): EmbeddingProvenance {
  if (!isRecord(value))
    throw new RetrievalValidationError(`${label} provenance is missing`);
  const provider = value.provider;
  const model = value.model;
  const dimensions = value.dimensions;
  const preprocessingVersion = value.preprocessingVersion;
  const catalogHash = value.catalogHash;
  if (
    typeof provider !== "string" ||
    provider.trim().length === 0 ||
    typeof model !== "string" ||
    model.trim().length === 0 ||
    typeof dimensions !== "number" ||
    !Number.isInteger(dimensions) ||
    dimensions < 1 ||
    typeof preprocessingVersion !== "string" ||
    preprocessingVersion.trim().length === 0 ||
    typeof catalogHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(catalogHash)
  )
    throw new RetrievalValidationError(`${label} provenance is malformed`);
  return { provider, model, dimensions, preprocessingVersion, catalogHash };
}

function validateIndexRows(
  catalog: ReviewedCatalogSnapshot,
  rows: readonly ToolEmbeddingRow[],
): { rows: readonly IndexRow[]; provenance: EmbeddingProvenance } {
  const expected = new Map(
    catalog.tools.map((tool) => [qualifiedToolIdentity(tool), tool]),
  );
  const seen = new Set<string>();
  const validated: IndexRow[] = [];
  let provenance: EmbeddingProvenance | undefined;

  for (const row of rows) {
    if (
      !isRecord(row) ||
      typeof row.server !== "string" ||
      typeof row.name !== "string"
    )
      throw new RetrievalValidationError("embedding row is malformed");
    const identity = qualifiedToolIdentity({
      server: row.server,
      name: row.name,
    });
    const tool = expected.get(identity);
    if (!tool)
      throw new RetrievalValidationError(`foreign embedding row: ${identity}`);
    if (seen.has(identity))
      throw new RetrievalValidationError(
        `duplicate embedding row: ${identity}`,
      );
    seen.add(identity);

    const rowProvenance = validateProvenance(
      row.provenance,
      `embedding row ${identity}`,
    );
    if (provenance && !sameProvenance(provenance, rowProvenance))
      throw new RetrievalValidationError("embedding row provenance mismatch");
    provenance ??= rowProvenance;
    if (rowProvenance.catalogHash !== catalog.catalogHash)
      throw new RetrievalValidationError("embedding row catalog hash mismatch");
    if (row.contentHash !== toolContentHash(tool))
      throw new RetrievalValidationError(
        `embedding row content hash mismatch: ${identity}`,
      );
    validateVector(
      row.vector,
      rowProvenance.dimensions,
      `embedding row ${identity}`,
    );
    validated.push(
      Object.freeze({
        server: row.server,
        name: row.name,
        vector: Object.freeze([...row.vector]),
        contentHash: row.contentHash,
        provenance: Object.freeze({ ...rowProvenance }),
        identity,
      }),
    );
  }

  if (seen.size !== expected.size)
    throw new RetrievalValidationError(
      "missing embedding row for reviewed catalog tool",
    );
  if (!provenance)
    throw new RetrievalValidationError("embedding index has no provenance");
  return { rows: validated, provenance };
}

function validateQueryEmbedding(
  result: EmbeddingResult,
  expected: EmbeddingProvenance,
): void {
  if (!isRecord(result))
    throw new RetrievalValidationError("query embedding result is malformed");
  const dimensions = result.dimensions;
  if (
    result.provider !== expected.provider ||
    result.model !== expected.model ||
    result.preprocessingVersion !== expected.preprocessingVersion ||
    dimensions !== expected.dimensions ||
    (result.catalogHash !== undefined &&
      result.catalogHash !== expected.catalogHash)
  )
    throw new RetrievalValidationError("query embedding provenance mismatch");
  if (!Number.isInteger(dimensions) || dimensions < 1)
    throw new RetrievalValidationError("query embedding dimension is invalid");
  validateVector(result.embedding, dimensions, "query");
}

function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export class InMemoryToolRetriever implements ToolRetriever {
  private readonly catalog: ReviewedCatalogSnapshot;
  private readonly rows: readonly ToolEmbeddingRow[];
  private readonly embeddingPort: EmbeddingPort;
  private readonly queryExpansionPort?: QueryExpansionPort;

  constructor(input: {
    catalog: ReviewedCatalogSnapshot;
    rows: readonly ToolEmbeddingRow[];
    embeddingPort: EmbeddingPort;
    queryExpansionPort?: QueryExpansionPort;
  }) {
    this.catalog = input.catalog;
    this.rows = input.rows;
    this.embeddingPort = input.embeddingPort;
    this.queryExpansionPort = input.queryExpansionPort;
  }

  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    validateTopK(request.topK);
    if (typeof request.query !== "string" || request.query.trim().length === 0)
      throw new RetrievalValidationError("query must be non-empty");
    throwIfAborted(request.signal);
    const started = Date.now();

    if (request.variant === "all_tools") {
      return {
        tools: this.catalog.tools,
        scores: [],
        variant: request.variant,
        topK: request.topK,
        queryHash: hash(request.query),
        latencyMs: Date.now() - started,
      };
    }

    if (request.variant === "semantic_qe") {
      if (!this.queryExpansionPort) {
        throw new RetrievalValidationError(
          "QueryExpansionPort is required for semantic_qe variant",
          "MISSING_QUERY_EXPANSION_PORT",
        );
      }
      const index = validateIndexRows(this.catalog, this.rows);
      throwIfAborted(request.signal);

      let expansion: QueryExpansionResult;
      try {
        expansion = await this.queryExpansionPort.expand({
          query: request.query,
          signal: request.signal,
        });
      } catch (error) {
        if (request.signal?.aborted) throw cancelled();
        throw error;
      }
      throwIfAborted(request.signal);

      if (!expansion || !Array.isArray(expansion.queries)) {
        throw new RetrievalValidationError(
          "query expansion result must contain a queries array",
        );
      }

      // Max 6 intents from expansion per spec, trimmed and non-empty
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
        let queryEmbedding: EmbeddingResult;
        try {
          queryEmbedding = await this.embeddingPort.embed({
            text: queryText,
            signal: request.signal,
          });
        } catch (error) {
          if (request.signal?.aborted) throw cancelled();
          throw error;
        }
        throwIfAborted(request.signal);
        validateQueryEmbedding(queryEmbedding, index.provenance);
        embeddings.push(queryEmbedding);
      }

      const byIdentity = new Map(
        this.catalog.tools.map((tool) => [qualifiedToolIdentity(tool), tool]),
      );

      const scored = index.rows
        .map((row) => {
          const tool = byIdentity.get(row.identity)!;
          let maxScore = -Infinity;
          for (const emb of embeddings) {
            const score = cosine(emb.embedding, row.vector);
            if (score > maxScore) {
              maxScore = score;
            }
          }
          return { tool, score: maxScore };
        })
        .sort(
          (left, right) =>
            right.score - left.score ||
            compareIdentity(
              qualifiedToolIdentity(left.tool),
              qualifiedToolIdentity(right.tool),
            ),
        );

      if (scored.some(({ score }) => !Number.isFinite(score)))
        throw new RetrievalValidationError("cosine score is non-finite");

      const selected = scored.slice(
        0,
        Math.min(request.topK, this.catalog.tools.length),
      );
      throwIfAborted(request.signal);

      return {
        tools: selected.map(({ tool }) => tool),
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
      throw new RetrievalValidationError(
        `retrieval variant is unsupported: ${String(request.variant)}`,
        "UNSUPPORTED_VARIANT",
      );

    const index = validateIndexRows(this.catalog, this.rows);
    throwIfAborted(request.signal);
    let queryEmbedding: EmbeddingResult;
    try {
      queryEmbedding = await this.embeddingPort.embed({
        text: request.query,
        signal: request.signal,
      });
    } catch (error) {
      if (request.signal?.aborted) throw cancelled();
      throw error;
    }
    throwIfAborted(request.signal);
    validateQueryEmbedding(queryEmbedding, index.provenance);
    throwIfAborted(request.signal);

    const byIdentity = new Map(
      this.catalog.tools.map((tool) => [qualifiedToolIdentity(tool), tool]),
    );
    const scored = index.rows
      .map((row) => {
        const tool = byIdentity.get(row.identity)!;
        return { tool, score: cosine(queryEmbedding.embedding, row.vector) };
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          compareIdentity(
            qualifiedToolIdentity(left.tool),
            qualifiedToolIdentity(right.tool),
          ),
      );
    if (scored.some(({ score }) => !Number.isFinite(score)))
      throw new RetrievalValidationError("cosine score is non-finite");
    const selected = scored.slice(
      0,
      Math.min(request.topK, this.catalog.tools.length),
    );
    throwIfAborted(request.signal);
    return {
      tools: selected.map(({ tool }) => tool),
      scores: selected,
      variant: request.variant,
      topK: request.topK,
      queryHash: hash(request.query),
      latencyMs: Date.now() - started,
    };
  }
}
