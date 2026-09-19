import { createHash } from "node:crypto";
import { hash } from "../snapshot.js";

export const REVIEWED_TOOL_SERIALIZER_VERSION = "reviewed-tool-json-v1";
export const EMBEDDING_ADAPTER_VERSION = "native-embedding-adapter-v1";

export interface EmbeddingPolicyManifest {
  readonly format: "embedding-policy-v1";
  readonly serializerVersion: string;
  readonly adapterVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly apiMode: string;
  readonly dimensions: number;
  readonly documentTask: string;
  readonly queryTask: string;
  readonly normalize: boolean;
  readonly textEncoding: "utf8";
}

export interface EmbeddingPolicyInput {
  readonly provider: string;
  readonly model: string;
  readonly apiMode: string;
  readonly dimensions: number;
  readonly documentTask: string;
  readonly queryTask: string;
  readonly normalize: boolean;
  readonly serializerVersion?: string;
  readonly adapterVersion?: string;
}

export function createEmbeddingPolicyManifest(
  input: EmbeddingPolicyInput,
): EmbeddingPolicyManifest {
  return {
    format: "embedding-policy-v1",
    serializerVersion:
      input.serializerVersion ?? REVIEWED_TOOL_SERIALIZER_VERSION,
    adapterVersion: input.adapterVersion ?? EMBEDDING_ADAPTER_VERSION,
    provider: input.provider,
    model: input.model,
    apiMode: input.apiMode,
    dimensions: input.dimensions,
    documentTask: input.documentTask,
    queryTask: input.queryTask,
    normalize: input.normalize,
    textEncoding: "utf8",
  };
}

/**
 * The preprocessing version is deliberately a content hash, not a mutable
 * human label. A change to the serializer, task instructions or normalization
 * policy therefore creates a new embedding profile and cannot reuse an old
 * active index accidentally.
 */
export function buildEmbeddingPolicyVersion(
  input: EmbeddingPolicyInput,
): string {
  return `embedding-policy-v1:${hash(createEmbeddingPolicyManifest(input))}`;
}

export function isEmbeddingPolicyVersion(value: unknown): value is string {
  return typeof value === "string" && /^embedding-policy-v1:[a-f0-9]{64}$/.test(value);
}

export function hashEmbeddingText(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}
