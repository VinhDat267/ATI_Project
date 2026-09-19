import { canonicalJson } from "../snapshot.js";
import {
  qualifiedToolIdentity,
  toolContentHash,
  type ReviewedCatalogSnapshot,
  type ReviewedCatalogTool,
} from "./catalog.js";
import {
  hashEmbeddingText,
  isEmbeddingPolicyVersion,
  REVIEWED_TOOL_SERIALIZER_VERSION,
} from "./embedding-policy.js";
import type { EmbeddingPort } from "./ports.js";
import {
  RetrievalValidationError,
  type EmbeddingProvenance,
  type ToolEmbeddingRow,
} from "./retrieval.js";
import {
  PGVECTOR_DIMENSIONS,
  validatePgvectorActivation,
} from "./pgvector-index.js";

function validation(message: string, code = "INVALID_RETRIEVAL") {
  return new RetrievalValidationError(message, code);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted)
    throw validation("catalog embedding cancelled", "CANCELLED");
}

/** Canonical input sent to a document embedding provider. */
export function serializeReviewedToolForEmbedding(
  tool: ReviewedCatalogTool,
): string {
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

function rejectSyntheticProvenance(provenance: EmbeddingProvenance): void {
  const marker = `${provenance.provider}:${provenance.model}:${provenance.preprocessingVersion}`;
  if (/synthetic|fixture|character-hash/i.test(marker))
    throw validation(
      "synthetic embedding provenance cannot activate a live catalog index",
      "SYNTHETIC_PROVENANCE",
    );
}

/**
 * Creates a complete, sequential catalog batch. No database write happens in
 * this function; callers must pass the returned complete batch to activate().
 */
export async function buildCatalogEmbeddingRows(
  catalog: ReviewedCatalogSnapshot,
  embeddings: EmbeddingPort,
  signal?: AbortSignal,
): Promise<readonly ToolEmbeddingRow[]> {
  const rows: ToolEmbeddingRow[] = [];
  let expected: EmbeddingProvenance | undefined;
  for (const tool of catalog.tools) {
    throwIfAborted(signal);
    const text = serializeReviewedToolForEmbedding(tool);
    let result;
    try {
      result = await embeddings.embed({ text, purpose: "document", signal });
    } catch (error) {
      if (signal?.aborted)
        throw validation("catalog embedding cancelled", "CANCELLED");
      throw error;
    }
    throwIfAborted(signal);
    if (result.purpose !== "document")
      throw validation("catalog embedding result must have document purpose");
    if (result.dimensions !== PGVECTOR_DIMENSIONS)
      throw validation(
        `catalog embedding dimensions must be ${PGVECTOR_DIMENSIONS}`,
      );
    if (
      result.catalogHash !== undefined &&
      result.catalogHash !== catalog.catalogHash
    )
      throw validation("catalog embedding catalog hash mismatch");
    if (
      typeof result.provider !== "string" ||
      !result.provider.trim() ||
      typeof result.model !== "string" ||
      !result.model.trim() ||
      !isEmbeddingPolicyVersion(result.preprocessingVersion)
    )
      throw validation(
        "catalog embedding provenance is missing the policy version",
      );
    const provenance: EmbeddingProvenance = {
      provider: result.provider,
      model: result.model,
      dimensions: result.dimensions,
      preprocessingVersion: result.preprocessingVersion,
      catalogHash: catalog.catalogHash,
    };
    rejectSyntheticProvenance(provenance);
    if (expected && JSON.stringify(expected) !== JSON.stringify(provenance))
      throw validation("catalog embedding provenance mismatch");
    expected ??= provenance;
    rows.push({
      server: tool.server,
      name: tool.name,
      purpose: "document",
      vector: [...result.embedding],
      contentHash: toolContentHash(tool),
      embeddingTextHash: hashEmbeddingText(text),
      provenance,
    });
  }
  // This validates completeness, vector shape and content hashes before any
  // caller can pass the batch to PgvectorCatalogIndex.activate().
  return validatePgvectorActivation(catalog, rows).rows;
}
