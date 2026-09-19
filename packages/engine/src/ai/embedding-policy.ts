import { hash } from "../snapshot.js";

export const REVIEWED_TOOL_SERIALIZER_VERSION = "reviewed-tool-json-v1";

/**
 * The preprocessing version is deliberately a content hash, not a mutable
 * human label. A change to the serializer, task instructions or normalization
 * policy therefore creates a new embedding profile and cannot reuse an old
 * active index accidentally.
 */
export function buildEmbeddingPolicyVersion(input: {
  readonly provider: string;
  readonly model: string;
  readonly apiMode: string;
  readonly dimensions: number;
  readonly documentTask: string;
  readonly queryTask: string;
  readonly normalize: boolean;
}): string {
  return `embedding-policy-v1:${hash({
    serializer: REVIEWED_TOOL_SERIALIZER_VERSION,
    provider: input.provider,
    model: input.model,
    apiMode: input.apiMode,
    dimensions: input.dimensions,
    documentTask: input.documentTask,
    queryTask: input.queryTask,
    normalize: input.normalize,
  })}`;
}
