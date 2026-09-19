import { describe, expect, it } from "vitest";
import {
  AiProviderConfigError,
  readAiProviderConfig,
  type AiProviderConfig,
} from "../src/ai/providers/config.js";
import {
  buildEmbeddingPolicyVersion,
  hashEmbeddingText,
  isEmbeddingPolicyVersion,
} from "../src/ai/embedding-policy.js";
import { createHash } from "node:crypto";

const baseEnv = {
  AI_PLANNING_PROVIDER: "openai",
  AI_PLANNING_MODEL: "gpt-5.6-terra",
  AI_EMBEDDING_PROVIDER: "openai",
  AI_EMBEDDING_MODEL: "text-embedding-3-large",
};

describe("provider configuration", () => {
  it("requires an explicit model when planning uses Google", () => {
    expect(() =>
      readAiProviderConfig({
        ...baseEnv,
        AI_PLANNING_PROVIDER: "google",
      }),
    ).toThrow(/AI_PLANNING_MODEL/);
  });

  it("resolves independent planner, QE, and embedding profiles", () => {
    const config = readAiProviderConfig({
      AI_PLANNING_PROVIDER: "google",
      AI_PLANNING_MODEL: "gemini-3.8-flash",
      AI_QE_PROVIDER: "openai",
      AI_QE_MODEL: "gpt-5.6-terra",
      AI_EMBEDDING_PROVIDER: "google",
      AI_EMBEDDING_MODEL: "gemini-embedding-2",
      AI_EMBEDDING_DIMENSIONS: "1536",
    });

    expect(config.planning.provider).toBe("google");
    expect(config.queryExpansion).toMatchObject({
      provider: "openai",
      model: "gpt-5.6-terra",
    });
    expect(config.embedding).toMatchObject({
      provider: "google",
      model: "gemini-embedding-2",
      dimensions: 1536,
    });
  });

  it("rejects an incomplete QE override and unsupported dimensions", () => {
    expect(() =>
      readAiProviderConfig({
        ...baseEnv,
        AI_QE_PROVIDER: "google",
      }),
    ).toThrow(AiProviderConfigError);
    expect(() =>
      readAiProviderConfig({
        ...baseEnv,
        AI_EMBEDDING_DIMENSIONS: "3072",
      }),
    ).toThrow(/1536/);
    expect(() =>
      readAiProviderConfig({
        ...baseEnv,
        AI_OPENAI_BASE_URL: "http://proxy.invalid",
      }),
    ).toThrow(/BASE_URL/);
    expect(() =>
      readAiProviderConfig({
        ...baseEnv,
        AI_REQUEST_TIMEOUT_MS: "5000",
        AI_TRIAL_DEADLINE_MS: "1000",
      }),
    ).toThrow(/DEADLINE|TIMEOUT/);
    expect(() =>
      readAiProviderConfig({
        ...baseEnv,
        AI_PLANNING_PROVIDER: "google",
        AI_PLANNING_MODEL: "gemini-3.8-flash",
        AI_REASONING_EFFORT: "low",
      }),
    ).toThrow(/OpenAI-only/);
  });

  it("does not resolve credentials while parsing non-secret configuration", () => {
    const env = {
      ...baseEnv,
      OPENAI_API_KEY: "secret-canary",
      GEMINI_API_KEY: "other-secret-canary",
    };
    const config: AiProviderConfig = readAiProviderConfig(env);
    expect(JSON.stringify(config)).not.toContain("secret-canary");
    expect(JSON.stringify(config)).not.toContain("other-secret-canary");
  });

  it("builds a strict versioned manifest and hashes exact UTF-8 text bytes", () => {
    const version = buildEmbeddingPolicyVersion({
      provider: "google",
      model: "gemini-embedding-001",
      apiMode: "embedContent",
      dimensions: 1536,
      documentTask: "RETRIEVAL_DOCUMENT",
      queryTask: "RETRIEVAL_QUERY",
      normalize: true,
    });
    expect(version).toMatch(/^embedding-policy-v1:[a-f0-9]{64}$/);
    expect(isEmbeddingPolicyVersion(version)).toBe(true);
    expect(isEmbeddingPolicyVersion("embedding-policy-v1:test")).toBe(false);
    expect(isEmbeddingPolicyVersion("prefix-embedding-policy-v1:abc")).toBe(false);
    const expected = createHash("sha256")
      .update(Buffer.from("café", "utf8"))
      .digest("hex");
    expect(hashEmbeddingText("café")).toBe(expected);
  });
});
