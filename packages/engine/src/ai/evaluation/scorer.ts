/**
 * Deterministic fixture scorer for AI-04 offline evaluation.
 *
 * This deliberately interprets read fixtures and records write intents only.
 * It never opens an MCP connection, changes a database, or dispatches a write.
 */
import { isDeepStrictEqual } from "node:util";
import {
  PlannerResultSchema,
  buildRuntime,
  evaluate,
  normalizeToolResult,
  resolveArgs,
  resolveValue,
  validateGraph,
  validateToolCall,
  type ResolveContext,
  type TrustedTool,
} from "@wap/dsl";
import { validateManualPlan } from "../../snapshot.js";
import type { EvalCase, EvaluationRuntime } from "./contracts.js";

export interface EvaluationScore {
  readonly outcomeValid: boolean;
  readonly candidateKind: "plan" | "refusal" | "clarification" | null;
  readonly kindCorrect: boolean;
  /** null when the candidate is a valid non-plan outcome. */
  readonly planValid: boolean | null;
  /** null when semantic plan execution is not applicable. */
  readonly taskCorrect: boolean | null;
  /** null when semantic plan execution is not applicable. */
  readonly outputCorrect: boolean | null;
  readonly writeIntents: readonly {
    readonly server: "task_hub" | "filesystem";
    readonly name: string;
    readonly args: Record<string, unknown>;
  }[];
  readonly issues: readonly string[];
}

export interface ScoreCandidateRequest {
  readonly fixture: EvalCase;
  readonly runtime: EvaluationRuntime;
  readonly registry: readonly TrustedTool[];
  readonly candidate: unknown;
}

/** Macro-recall building block: no gold tools means the metric is not applicable. */
export function retrievalRecall(
  selectedIdentities: readonly string[],
  goldIdentities: readonly string[],
): number | null {
  const gold = new Set(goldIdentities);
  if (!gold.size) return null;
  const selected = new Set(selectedIdentities);
  let matched = 0;
  for (const identity of gold) if (selected.has(identity)) matched++;
  return matched / gold.size;
}

function scoreInvalidOutcome(issues: readonly string[]): EvaluationScore {
  return {
    outcomeValid: false,
    candidateKind: null,
    kindCorrect: false,
    planValid: false,
    taskCorrect: false,
    outputCorrect: false,
    writeIntents: [],
    issues,
  };
}

/**
 * Score a candidate planner output against a frozen hand-authored fixture.
 * A passing result is executable under the real DSL policies and reproduces
 * the fixture's observed reads, intended writes, and final outputs.
 */
export function scoreCandidate(request: ScoreCandidateRequest): EvaluationScore {
  const parsed = PlannerResultSchema.safeParse(request.candidate);
  if (!parsed.success)
    return scoreInvalidOutcome(
      parsed.error.issues.map((issue) => `invalid planner result: ${issue.message}`),
    );

  const candidate = parsed.data;
  const kindCorrect = candidate.kind === request.fixture.expected_result.kind;
  if (candidate.kind !== "plan") {
    return {
      outcomeValid: true,
      candidateKind: candidate.kind,
      kindCorrect,
      planValid: null,
      taskCorrect: null,
      outputCorrect: null,
      writeIntents: [],
      issues: kindCorrect ? [] : ["candidate outcome kind differs from fixture"],
    };
  }

  let plan;
  try {
    plan = validateManualPlan(candidate.plan, request.registry);
  } catch (error) {
    return {
      outcomeValid: true,
      candidateKind: candidate.kind,
      kindCorrect,
      planValid: false,
      taskCorrect: false,
      outputCorrect: false,
      writeIntents: [],
      issues: [`plan validation failed: ${(error as Error).message}`],
    };
  }

  const context: ResolveContext = {
    inputs: {},
    stepOutputs: {},
    runtime: buildRuntime({
      now: new Date(request.runtime.now),
      runId: request.runtime.run_id,
      userId: request.runtime.user_id,
      timeZone: request.runtime.time_zone,
    }),
  };
  const issues: string[] = kindCorrect
    ? []
    : ["candidate outcome kind differs from fixture"];
  const writeIntents: {
    server: "task_hub" | "filesystem";
    name: string;
    args: Record<string, unknown>;
  }[] = [];
  const consumedReadFixtures = new Set<number>();

  for (const id of validateGraph(plan).layers.flat()) {
    const step = plan.steps.find((item) => item.id === id);
    if (!step) {
      issues.push(`execution graph referenced missing step: ${id}`);
      continue;
    }

    try {
      if (step.condition && !evaluate(step.condition, context)) continue;
      const tool = request.registry.find(
        (item) =>
          item.server === step.tool.server && item.name === step.tool.name,
      );
      if (!tool) {
        issues.push(`reviewed tool unavailable: ${step.tool.server}.${step.tool.name}`);
        continue;
      }
      const args = resolveArgs(step.tool.args, context);
      const toolCheck = validateToolCall(tool, args, "execution");
      if (!toolCheck.ok) {
        issues.push(
          `resolved tool arguments invalid for ${tool.server}.${tool.name}: ${toolCheck.issues.map((issue) => issue.message).join("; ")}`,
        );
        continue;
      }

      if (tool.sideEffect === "write") {
        if (tool.server !== "task_hub" && tool.server !== "filesystem") {
          issues.push(`write tool is outside fixture allowlist: ${tool.server}.${tool.name}`);
          continue;
        }
        writeIntents.push({ server: tool.server, name: tool.name, args });
        continue;
      }

      const fixtureReadIndex = request.fixture.read_fixture.findIndex(
        (item, index) =>
          !consumedReadFixtures.has(index) &&
          item.server === tool.server &&
          item.name === tool.name &&
          isDeepStrictEqual(item.args, args),
      );
      const fixtureRead =
        fixtureReadIndex < 0
          ? undefined
          : request.fixture.read_fixture[fixtureReadIndex];
      if (!fixtureRead) {
        issues.push(
          `read target or arguments differ from fixture: ${tool.server}.${tool.name}`,
        );
        continue;
      }
      consumedReadFixtures.add(fixtureReadIndex);
      const normalized = normalizeToolResult(tool, {
        structuredContent: fixtureRead.output,
        content: [],
      });
      if (!normalized.ok) {
        issues.push(
          `fixture output violates ${tool.server}.${tool.name} contract: ${normalized.issues.map((issue) => issue.message).join("; ")}`,
        );
        continue;
      }
      context.stepOutputs[id] = normalized.output;
    } catch (error) {
      issues.push(`step ${id} could not be evaluated: ${(error as Error).message}`);
    }
  }

  const unconsumedReads = request.fixture.read_fixture.length - consumedReadFixtures.size;
  if (unconsumedReads)
    issues.push(`${unconsumedReads} read fixture entries not consumed`);

  const writesCorrect = isDeepStrictEqual(
    writeIntents,
    request.fixture.expected_writes,
  );
  if (!writesCorrect) issues.push("write intents differ from fixture");

  let outputCorrect = false;
  try {
    const outputs = Object.fromEntries(
      Object.entries(plan.outputs).map(([key, value]) => [
        key,
        resolveValue(value, context),
      ]),
    );
    outputCorrect = isDeepStrictEqual(outputs, request.fixture.expected_outputs);
    if (!outputCorrect) issues.push("final outputs differ from fixture");
  } catch (error) {
    issues.push(`final outputs could not be resolved: ${(error as Error).message}`);
  }

  return {
    outcomeValid: true,
    candidateKind: candidate.kind,
    kindCorrect,
    planValid: true,
    taskCorrect: kindCorrect && writesCorrect && outputCorrect && issues.length === 0,
    outputCorrect,
    writeIntents,
    issues,
  };
}
