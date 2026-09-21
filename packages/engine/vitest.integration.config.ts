import { defineConfig } from "vitest/config";

const integrationTimeoutMs = Number(
  process.env.ATI_ENGINE_INTEGRATION_TIMEOUT_MS ?? "120000",
);

export default defineConfig({
  test: {
    include: ["tests/**/*.integration.test.ts"],
    fileParallelism: false,
    testTimeout: integrationTimeoutMs,
    hookTimeout: integrationTimeoutMs,
  },
});
