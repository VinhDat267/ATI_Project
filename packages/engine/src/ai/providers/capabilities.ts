export type AiProvider = "openai" | "google";

export interface ProviderCapability {
  readonly generationModels: readonly string[];
  readonly embeddingModels: readonly string[];
}

export const providerCapabilities: Record<AiProvider, ProviderCapability> = {
  openai: {
    generationModels: ["gpt-5.6-terra"],
    embeddingModels: ["text-embedding-3-large", "text-embedding-3-small"],
  },
  google: {
    generationModels: [
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-2.5-flash",
    ],
    embeddingModels: ["gemini-embedding-001", "gemini-embedding-2"],
  },
};

export function assertProviderModel(
  provider: AiProvider,
  purpose: "generation" | "embedding",
  model: string,
): void {
  const models =
    providerCapabilities[provider][
      purpose === "generation" ? "generationModels" : "embeddingModels"
    ];
  if (!models.includes(model)) {
    throw new Error(`Unsupported ${provider} ${purpose} model: ${model}`);
  }
}
