export interface EmbeddingUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}
export interface EmbeddingResult {
  readonly embedding: readonly number[];
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  readonly preprocessingVersion: string;
  readonly catalogHash?: string;
  readonly usage?: EmbeddingUsage | null;
  readonly latencyMs?: number;
  readonly requestId?: string | null;
}
export interface EmbeddingPort {
  embed(input: {
    readonly text: string;
    readonly signal?: AbortSignal;
  }): Promise<EmbeddingResult>;
}
export interface StructuredModelUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}
export interface StructuredModelResponse {
  readonly output: unknown;
  readonly provider: string;
  readonly model: string;
  readonly usage?: StructuredModelUsage | null;
  readonly requestId?: string | null;
  readonly latencyMs?: number;
}
export interface StructuredModelClient {
  complete(input: {
    readonly systemPrompt: string;
    readonly userPrompt: string;
    readonly schema: unknown;
    readonly signal?: AbortSignal;
  }): Promise<StructuredModelResponse>;
}
