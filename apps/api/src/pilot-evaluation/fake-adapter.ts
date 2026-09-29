import type { PilotAccountedPlanner } from "../pilot-planner.js";
import { FakeScriptIdSchema, type FrozenManifest } from "./contracts.js";

export type FakeEnvelope = Awaited<ReturnType<PilotAccountedPlanner["propose"]>>;

/** Builtin data-only fixtures; no transport, model registry, or arbitrary callback. */
export async function invokeBuiltinFake(
  script: string, manifest: FrozenManifest, signal: AbortSignal,
): Promise<FakeEnvelope> {
  const name = FakeScriptIdSchema.parse(script);
  if (signal.aborted) throw new Error("FAKE_ABORTED");
  if (name === "throw") throw new Error("FAKE_FAILURE");
  if (name === "delayed") await new Promise((resolve) => setTimeout(resolve, manifest.timeoutMs + 100));
  const proposal = name === "clarification" ? { kind: "clarification", question: "Need details" } :
    name === "refusal" ? { kind: "refusal", reason: "Cannot proceed" } :
    name === "invalid" ? { kind: "plan", tool: "unreviewed.tool" } :
    { kind: "plan", tool: "trello.create_card" };
  return { proposal,
    usage: name === "unknown" || name === "missing_usage" ? null :
      { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    costMicros: name === "unknown" ? null : manifest.estimatedCostMicros,
  };
}
