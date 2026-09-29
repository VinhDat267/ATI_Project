import { z } from "zod";
import type { PilotPlannerContext, ProviderCallSettlement } from "@wap/engine";

// A model may recommend a branch and the single reviewed tool, never supply
// a target, write arguments, approval, hash or policy decision.
export const PilotPlannerProposalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("plan"), tool: z.literal("trello.create_card") }).strict(),
  z.object({ kind: z.literal("clarification"), question: z.string().trim().min(1).max(500) }).strict(),
  z.object({ kind: z.literal("refusal"), reason: z.string().trim().min(1).max(500) }).strict(),
]);

export type PilotPlannerProposal = z.infer<typeof PilotPlannerProposalSchema>;

export interface PilotPlanner {
  propose(input: {
    runId: string;
    principalId: string;
    sourceKey: string;
    sourceRevision: string;
    context: PilotPlannerContext;
    signal: AbortSignal;
  }): Promise<unknown>;
}

type PilotPlannerInput = Parameters<PilotPlanner["propose"]>[0];
type PilotUsage = NonNullable<ProviderCallSettlement["usage"]>;

/** Carries adapter accounting only; never retain a rejected model proposal. */
export class PilotProposalValidationError extends Error {
  constructor(readonly usage: PilotUsage | null, readonly costMicros: number | null) {
    super("Invalid pilot proposal");
  }
}

/** Trusted server adapter metadata is separate from the untrusted model proposal. */
export interface PilotAccountedPlanner {
  readonly provider: "google" | "openai";
  readonly model: string;
  readonly estimatedCostMicros: number;
  propose(input: PilotPlannerInput): Promise<{
    proposal: unknown;
    usage: PilotUsage | null;
    costMicros: number | null;
  }>;
}

const TokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().safe().optional(),
  cachedInputTokens: z.number().int().nonnegative().safe().optional(),
  outputTokens: z.number().int().nonnegative().safe().optional(),
  reasoningTokens: z.number().int().nonnegative().safe().optional(),
  totalTokens: z.number().int().nonnegative().safe().optional(),
}).strict();

async function callWithTimeout<T>(
  call: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new Error("Invalid pilot planner timeout");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Pilot planner timed out"));
      }, timeoutMs);
    });
    return await Promise.race([call(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** A bounded, optional seam. Production does not install a provider here. */
export async function requestPilotProposal(
  planner: PilotPlanner,
  input: Omit<PilotPlannerInput, "signal">,
  timeoutMs: number,
): Promise<PilotPlannerProposal> {
  return PilotPlannerProposalSchema.parse(await callWithTimeout(
    (signal) => planner.propose({ ...input, signal }), timeoutMs,
  ));
}

/** No cost evidence from the model is accepted; null remains unknown. */
export async function requestAccountedPilotProposal(
  planner: PilotAccountedPlanner,
  input: Omit<PilotPlannerInput, "signal">,
  timeoutMs: number,
): Promise<{ proposal: PilotPlannerProposal; usage: PilotUsage | null; costMicros: number | null }> {
  if (!Number.isSafeInteger(planner.estimatedCostMicros) || planner.estimatedCostMicros <= 0 ||
      !["google", "openai"].includes(planner.provider) || !planner.model.trim())
    throw new Error("Invalid pilot adapter configuration");
  const result = await callWithTimeout(
    (signal) => planner.propose({ ...input, signal }), timeoutMs,
  );
  const envelope = z.object({
    proposal: z.unknown(),
    usage: TokenUsageSchema.nullable(),
    costMicros: z.number().int().nonnegative().safe().nullable(),
  }).strict().parse(result);
  const proposal = PilotPlannerProposalSchema.safeParse(envelope.proposal);
  if (!proposal.success)
    throw new PilotProposalValidationError(envelope.usage, envelope.costMicros);
  return { proposal: proposal.data, usage: envelope.usage, costMicros: envelope.costMicros };
}
