import type { ReviewedToolInput } from "../src/ai/catalog.js";

export const makeTool = (
  overrides: Partial<ReviewedToolInput> = {},
): ReviewedToolInput => ({
  server: "task_hub",
  name: "list_cards",
  description: "List cards from the local board.",
  sideEffect: "read",
  policyVersion: "b-local-1",
  artifactHash: "a".repeat(64),
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  ...overrides,
});
