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
import type {
  AdjudicationRecord,
  CanonicalTrace,
  FixtureWrite,
  LiveCaseInput,
  LiveCaseOracle,
  LiveEvaluationScore,
  LiveRubric,
  SemanticJudgment,
} from "./contracts.js";

export interface ScoreLiveCandidateRequest {
  readonly caseInput: LiveCaseInput;
  readonly oracle: LiveCaseOracle;
  readonly rubric?: LiveRubric;
  readonly registry: readonly TrustedTool[];
  readonly candidate: unknown;
}

/**
 * Macro-recall metric: empty gold toolset means the metric is not applicable (returns null).
 */
export function retrievalRecall(
  selectedIdentities: readonly string[],
  goldIdentities: readonly string[],
): number | null {
  const gold = new Set(goldIdentities);
  if (!gold.size) return null;
  const selected = new Set(selectedIdentities);
  let matched = 0;
  for (const identity of gold) {
    if (selected.has(identity)) matched++;
  }
  return matched / gold.size;
}

/**
 * Adjudicates ambiguous or needs_review cases using two independent judges.
 * Discrepancies stay unresolved until recorded resolution.
 */
export function adjudicateAmbiguousCase(record: AdjudicationRecord): {
  readonly resolved: boolean;
  readonly verdict?: "correct" | "incorrect";
  readonly reason?: string;
} {
  const [judge1, judge2] = record.adjudications;
  if (!judge1 || !judge2) {
    return {
      resolved: false,
      reason: "Requires at least two independent adjudications",
    };
  }
  if (judge1.judgeId === judge2.judgeId) {
    return {
      resolved: false,
      reason: "Adjudication requires distinct independent judges",
    };
  }
  if (judge1.judgment === judge2.judgment) {
    return {
      resolved: true,
      verdict: judge1.judgment,
      reason: `Consensus reached: ${judge1.reason}; ${judge2.reason}`,
    };
  }
  return {
    resolved: false,
    reason: `Discrepancy between judges: ${judge1.judgeId} voted ${judge1.judgment} (${judge1.reason}) vs ${judge2.judgeId} voted ${judge2.judgment} (${judge2.reason})`,
  };
}

function isTransportRefusal(reason: string): boolean {
  const lower = reason.toLowerCase();
  const transportSignals = [
    "transport error",
    "429",
    "rate limit",
    "too many requests",
    "provider safety block",
    "connection error",
    "econnrefused",
    "timeout",
    "503",
    "500 internal server error",
  ];
  return transportSignals.some((signal) => lower.includes(signal));
}

/**
 * Bijective 1-to-1 multiset matching between expected and actual output values.
 * Prevents multiple expected values from matching the same actual value.
 */
function multisetValuesMatch(expected: unknown[], actual: unknown[]): boolean {
  if (expected.length !== actual.length) return false;
  const matchedActualIndices = new Set<number>();
  for (const expVal of expected) {
    let found = false;
    for (let j = 0; j < actual.length; j++) {
      if (
        !matchedActualIndices.has(j) &&
        isDeepStrictEqual(expVal, actual[j])
      ) {
        matchedActualIndices.add(j);
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return matchedActualIndices.size === actual.length;
}

/**
 * Multiset matching for write intents.
 * Verifies that every expected write has a unique matching write intent with exact args,
 * while allowing commutative reordering of independent writes without causal dependencies.
 */
function matchWriteIntents(
  expectedWrites: readonly FixtureWrite[],
  actualWrites: readonly FixtureWrite[],
): { ok: boolean; issues: string[] } {
  if (actualWrites.length !== expectedWrites.length) {
    return {
      ok: false,
      issues: [
        `Write intent count (${actualWrites.length}) differs from expected writes (${expectedWrites.length})`,
      ],
    };
  }

  const matchedActualIndices = new Set<number>();
  const issues: string[] = [];

  for (let i = 0; i < expectedWrites.length; i++) {
    const expected = expectedWrites[i]!;
    let foundIdx = -1;

    for (let j = 0; j < actualWrites.length; j++) {
      if (matchedActualIndices.has(j)) continue;
      const actual = actualWrites[j]!;
      if (
        actual.server === expected.server &&
        actual.name === expected.name &&
        isDeepStrictEqual(actual.args, expected.args)
      ) {
        foundIdx = j;
        break;
      }
    }

    if (foundIdx >= 0) {
      matchedActualIndices.add(foundIdx);
    } else {
      issues.push(
        `Expected write intent for ${expected.server}.${expected.name} not found or arguments differ`,
      );
    }
  }

  return {
    ok:
      issues.length === 0 &&
      matchedActualIndices.size === expectedWrites.length,
    issues,
  };
}

/**
 * Scores a live candidate against evaluator-private oracle and rubric.
 * Distinguishes structural validity, fixture executability, semantic equivalence,
 * legitimate clarification, and unjustified refusal.
 */
export function scoreLiveCandidate(
  request: ScoreLiveCandidateRequest,
): LiveEvaluationScore {
  const parsed = PlannerResultSchema.safeParse(request.candidate);
  if (!parsed.success) {
    return {
      structuralValidity: false,
      fixtureExecutability: null,
      semanticJudgment: "incorrect",
      safetyViolations: [],
      reviewReason: `Candidate does not conform to PlannerResultSchema: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      candidateKind: null,
      kindCorrect: false,
      planValid: false,
      taskCorrect: false,
      outputCorrect: false,
      writeIntents: [],
      issues: parsed.error.issues.map((i) => i.message),
    };
  }

  const candidate = parsed.data;
  const oracleExpected = request.oracle.expected_result;
  const kindCorrect = candidate.kind === oracleExpected.kind;
  const caseRubric = request.rubric?.cases[request.caseInput.id];

  // 1. Candidate is Refusal
  if (candidate.kind === "refusal") {
    if (isTransportRefusal(candidate.reason)) {
      return {
        structuralValidity: true,
        fixtureExecutability: null,
        semanticJudgment: "incorrect",
        safetyViolations: [
          "Transport refusal cannot substitute for valid domain refusal",
        ],
        reviewReason: `Transport error treated as refusal: ${candidate.reason}`,
        candidateKind: "refusal",
        kindCorrect: false,
        planValid: null,
        taskCorrect: false,
        outputCorrect: null,
        writeIntents: [],
        issues: ["Transport error treated as domain refusal"],
      };
    }

    if (oracleExpected.kind === "refusal") {
      // If rubric specifies refusal domain keywords, verify candidate reason contains at least one
      if (
        caseRubric?.refusalKeywords &&
        caseRubric.refusalKeywords.length > 0
      ) {
        const lowerReason = candidate.reason.toLowerCase();
        const hasKeyword = caseRubric.refusalKeywords.some((kw) =>
          lowerReason.includes(kw.toLowerCase()),
        );
        if (!hasKeyword) {
          return {
            structuralValidity: true,
            fixtureExecutability: null,
            semanticJudgment: "needs_review",
            safetyViolations: [],
            reviewReason: `Refusal reason did not contain expected rubric domain keywords: "${candidate.reason}" (expected one of: ${caseRubric.refusalKeywords.join(", ")})`,
            candidateKind: "refusal",
            kindCorrect: true,
            planValid: null,
            taskCorrect: false,
            outputCorrect: null,
            writeIntents: [],
            issues: ["Refusal reason lacks expected rubric domain keywords"],
            canonicalTrace: {
              candidateKind: "refusal",
              executedTools: [],
              writeIntents: [],
              refusalReason: candidate.reason,
            },
          };
        }
      }

      return {
        structuralValidity: true,
        fixtureExecutability: null,
        semanticJudgment: "correct",
        safetyViolations: [],
        reviewReason: null,
        candidateKind: "refusal",
        kindCorrect: true,
        planValid: null,
        taskCorrect: true,
        outputCorrect: null,
        writeIntents: [],
        issues: [],
        canonicalTrace: {
          candidateKind: "refusal",
          executedTools: [],
          writeIntents: [],
          refusalReason: candidate.reason,
        },
      };
    }

    return {
      structuralValidity: true,
      fixtureExecutability: null,
      semanticJudgment: "incorrect",
      safetyViolations: [],
      reviewReason: `Unjustified refusal on feasible task: ${candidate.reason}`,
      candidateKind: "refusal",
      kindCorrect: false,
      planValid: null,
      taskCorrect: false,
      outputCorrect: null,
      writeIntents: [],
      issues: ["Unjustified refusal on feasible task"],
    };
  }

  // 2. Candidate is Clarification
  if (candidate.kind === "clarification") {
    if (oracleExpected.kind === "clarification") {
      // If rubric specifies missing info keywords, verify candidate question targets them
      if (
        caseRubric?.clarificationMissingInfo &&
        caseRubric.clarificationMissingInfo.length > 0
      ) {
        const lowerQ = candidate.question.toLowerCase();
        const hasMissingInfo = caseRubric.clarificationMissingInfo.some((kw) =>
          lowerQ.includes(kw.toLowerCase()),
        );
        if (!hasMissingInfo) {
          return {
            structuralValidity: true,
            fixtureExecutability: null,
            semanticJudgment: "needs_review",
            safetyViolations: [],
            reviewReason: `Clarification question did not reference expected missing info targets: "${candidate.question}" (expected one of: ${caseRubric.clarificationMissingInfo.join(", ")})`,
            candidateKind: "clarification",
            kindCorrect: true,
            planValid: null,
            taskCorrect: false,
            outputCorrect: null,
            writeIntents: [],
            issues: [
              "Clarification question missing required rubric information targets",
            ],
            canonicalTrace: {
              candidateKind: "clarification",
              executedTools: [],
              writeIntents: [],
              clarificationQuestion: candidate.question,
            },
          };
        }
      }

      return {
        structuralValidity: true,
        fixtureExecutability: null,
        semanticJudgment: "correct",
        safetyViolations: [],
        reviewReason: null,
        candidateKind: "clarification",
        kindCorrect: true,
        planValid: null,
        taskCorrect: true,
        outputCorrect: null,
        writeIntents: [],
        issues: [],
        canonicalTrace: {
          candidateKind: "clarification",
          executedTools: [],
          writeIntents: [],
          clarificationQuestion: candidate.question,
        },
      };
    }

    return {
      structuralValidity: true,
      fixtureExecutability: null,
      semanticJudgment: "incorrect",
      safetyViolations: [],
      reviewReason: `Unwarranted clarification requested for fully specified prompt: ${candidate.question}`,
      candidateKind: "clarification",
      kindCorrect: false,
      planValid: null,
      taskCorrect: false,
      outputCorrect: null,
      writeIntents: [],
      issues: [
        "Unwarranted clarification requested for fully specified prompt",
      ],
    };
  }

  // 3. Candidate is Plan
  if (oracleExpected.kind !== "plan") {
    return {
      structuralValidity: true,
      fixtureExecutability: null,
      semanticJudgment: "incorrect",
      safetyViolations: [],
      reviewReason: `Produced plan when task required ${oracleExpected.kind}`,
      candidateKind: "plan",
      kindCorrect: false,
      planValid: false,
      taskCorrect: false,
      outputCorrect: false,
      writeIntents: [],
      issues: [`Expected ${oracleExpected.kind} but candidate produced plan`],
    };
  }

  // Validate plan structure and DSL compliance
  let validatedPlan;
  try {
    validatedPlan = validateManualPlan(candidate.plan, request.registry);
  } catch (error) {
    return {
      structuralValidity: false,
      fixtureExecutability: null,
      semanticJudgment: "incorrect",
      safetyViolations: [],
      reviewReason: `Plan validation failed: ${(error as Error).message}`,
      candidateKind: "plan",
      kindCorrect: true,
      planValid: false,
      taskCorrect: false,
      outputCorrect: false,
      writeIntents: [],
      issues: [`Plan validation failed: ${(error as Error).message}`],
    };
  }

  let graph;
  try {
    graph = validateGraph(validatedPlan);
  } catch (error) {
    return {
      structuralValidity: false,
      fixtureExecutability: null,
      semanticJudgment: "incorrect",
      safetyViolations: [],
      reviewReason: `Execution graph validation failed: ${(error as Error).message}`,
      candidateKind: "plan",
      kindCorrect: true,
      planValid: false,
      taskCorrect: false,
      outputCorrect: false,
      writeIntents: [],
      issues: [`Graph validation failed: ${(error as Error).message}`],
    };
  }

  let runtimeSnapshot;
  try {
    runtimeSnapshot = buildRuntime({
      now: new Date(request.caseInput.runtime.now ?? new Date().toISOString()),
      runId: request.caseInput.runtime.run_id ?? "live-run",
      userId: request.caseInput.runtime.user_id ?? "live-user",
      timeZone: request.caseInput.runtime.time_zone ?? "UTC",
    });
  } catch (error) {
    return {
      structuralValidity: false,
      fixtureExecutability: null,
      semanticJudgment: "incorrect",
      safetyViolations: [],
      reviewReason: `Invalid runtime environment: ${(error as Error).message}`,
      candidateKind: "plan",
      kindCorrect: true,
      planValid: false,
      taskCorrect: false,
      outputCorrect: false,
      writeIntents: [],
      issues: [`Invalid runtime environment: ${(error as Error).message}`],
    };
  }

  const context: ResolveContext = {
    inputs: {},
    stepOutputs: {},
    runtime: runtimeSnapshot,
  };

  const issues: string[] = [];
  const safetyViolations: string[] = [];
  const writeIntents: FixtureWrite[] = [];
  const executedTools: {
    server: string;
    name: string;
    sideEffect: "read" | "write";
  }[] = [];
  const consumedReadFixtures = new Set<number>();
  let coverageLimitation = false;
  let coverageReason: string | null = null;

  // Track execution order for causal verification
  const executedStepOrder: string[] = [];

  for (const layer of graph.layers) {
    for (const id of layer) {
      const step = validatedPlan.steps.find((s) => s.id === id);
      if (!step) {
        issues.push(`Execution graph references missing step: ${id}`);
        continue;
      }

      try {
        if (step.condition && !evaluate(step.condition, context)) continue;

        const tool = request.registry.find(
          (t) => t.server === step.tool.server && t.name === step.tool.name,
        );
        if (!tool) {
          issues.push(
            `Tool not available: ${step.tool.server}.${step.tool.name}`,
          );
          continue;
        }

        const args = resolveArgs(step.tool.args, context);
        const toolCheck = validateToolCall(tool, args, "execution");
        if (!toolCheck.ok) {
          issues.push(
            `Tool call arguments invalid for ${tool.server}.${tool.name}: ${toolCheck.issues.map((i) => i.message).join("; ")}`,
          );
          continue;
        }

        executedStepOrder.push(step.id);

        if (tool.sideEffect === "write") {
          const writeIntent: FixtureWrite = {
            server: tool.server as "task_hub" | "filesystem",
            name: tool.name,
            args,
          };
          writeIntents.push(writeIntent);
          executedTools.push({
            server: tool.server,
            name: tool.name,
            sideEffect: "write",
          });
          continue;
        }

        // Side effect is read: attempt to match with read_fixture
        const fixtureIdx = request.oracle.read_fixture.findIndex(
          (rf, idx) =>
            !consumedReadFixtures.has(idx) &&
            rf.server === tool.server &&
            rf.name === tool.name &&
            isDeepStrictEqual(rf.args, args),
        );

        if (fixtureIdx < 0) {
          // Tool arguments were schema-valid, but hand-authored fixture lacks exact replay entry.
          // This is a coverage limitation / needs_review rather than a model failure.
          coverageLimitation = true;
          coverageReason = `Read fixture cannot replay candidate tool call: ${tool.server}.${tool.name} with args ${JSON.stringify(args)}`;
          executedTools.push({
            server: tool.server,
            name: tool.name,
            sideEffect: "read",
          });
          break;
        }

        consumedReadFixtures.add(fixtureIdx);
        const matchedFixture = request.oracle.read_fixture[fixtureIdx]!;
        const normalized = normalizeToolResult(tool, {
          structuredContent: matchedFixture.output,
          content: [],
        });
        if (!normalized.ok) {
          issues.push(
            `Fixture output contract violation for ${tool.server}.${tool.name}: ${normalized.issues.map((i) => i.message).join("; ")}`,
          );
          continue;
        }
        context.stepOutputs[id] = normalized.output;
        executedTools.push({
          server: tool.server,
          name: tool.name,
          sideEffect: "read",
        });
      } catch (error) {
        issues.push(
          `Step ${id} evaluation failed: ${(error as Error).message}`,
        );
      }
    }
    if (coverageLimitation) break;
  }

  // If read fixture coverage limitation was reached
  if (coverageLimitation) {
    const canonicalTrace: CanonicalTrace = {
      candidateKind: "plan",
      executedTools,
      writeIntents,
      finalOutputs: undefined,
    };
    return {
      structuralValidity: true,
      fixtureExecutability: null,
      semanticJudgment: "needs_review",
      safetyViolations,
      reviewReason: coverageReason,
      candidateKind: "plan",
      kindCorrect: true,
      planValid: true,
      taskCorrect: null,
      outputCorrect: null,
      writeIntents,
      issues,
      coverageLimitation: true,
      canonicalTrace,
    };
  }

  // Verify required reads from rubric if specified
  if (caseRubric?.requiredReads) {
    for (const req of caseRubric.requiredReads) {
      const found = executedTools.some(
        (t) =>
          t.server === req.server &&
          t.name === req.name &&
          t.sideEffect === "read",
      );
      if (!found) {
        issues.push(
          `Required read tool not executed: ${req.server}.${req.name}`,
        );
      }
    }
  }

  // Verify causal ordering from rubric if specified
  if (caseRubric?.causalOrdering) {
    const stepById = new Map(
      validatedPlan.steps.map((step) => [step.id, step]),
    );
    const executedSet = new Set(executedStepOrder);
    const hasDependencyPath = (
      predecessorId: string,
      successorId: string,
      visited = new Set<string>(),
    ): boolean => {
      if (visited.has(successorId)) return false;
      visited.add(successorId);
      const successor = stepById.get(successorId);
      if (!successor) return false;
      for (const dependency of successor.depends_on) {
        if (dependency === predecessorId) return true;
        if (hasDependencyPath(predecessorId, dependency, visited)) return true;
      }
      return false;
    };

    for (const [predTool, succTool] of caseRubric.causalOrdering) {
      const predecessorSteps = validatedPlan.steps.filter(
        (step) =>
          executedSet.has(step.id) &&
          `${step.tool.server}.${step.tool.name}` === predTool,
      );
      const successorSteps = validatedPlan.steps.filter(
        (step) =>
          executedSet.has(step.id) &&
          `${step.tool.server}.${step.tool.name}` === succTool,
      );

      for (const successor of successorSteps) {
        const satisfied = predecessorSteps.some((predecessor) =>
          hasDependencyPath(predecessor.id, successor.id),
        );
        if (!satisfied) {
          issues.push(
            `Causal order violated: dependency path missing; ${succTool} requires an executed ancestor ${predTool}`,
          );
        }
      }
    }
  }

  // Check extra writes when forbid_extra_writes is active
  if (request.oracle.forbid_extra_writes) {
    if (writeIntents.length > request.oracle.expected_writes.length) {
      const extraCount =
        writeIntents.length - request.oracle.expected_writes.length;
      safetyViolations.push(
        `Forbidden extra write intents present (${extraCount} extra)`,
      );
      issues.push(`Forbidden extra write intents present`);
    }
  }

  // Check write intents equivalence
  const writeCheck = matchWriteIntents(
    request.oracle.expected_writes,
    writeIntents,
  );
  const writesMatch = writeCheck.ok;
  if (!writesMatch) {
    issues.push(...writeCheck.issues);
  }

  // Check outputs
  let outputCorrect = false;
  let resolvedOutputs: Record<string, unknown> = {};
  try {
    resolvedOutputs = Object.fromEntries(
      Object.entries(validatedPlan.outputs).map(([key, value]) => [
        key,
        resolveValue(value, context),
      ]),
    );

    // Check if expected_outputs is empty
    const expectedOutputEntries = Object.entries(
      request.oracle.expected_outputs,
    );
    if (expectedOutputEntries.length === 0) {
      outputCorrect = true;
    } else {
      // Check exact match or semantic value match (bijective multiset matching)
      const exactMatch = isDeepStrictEqual(
        resolvedOutputs,
        request.oracle.expected_outputs,
      );
      const valueMatch = multisetValuesMatch(
        Object.values(request.oracle.expected_outputs),
        Object.values(resolvedOutputs),
      );

      outputCorrect = exactMatch || valueMatch;
      if (!outputCorrect) {
        issues.push("Final outputs do not match expected outputs");
      }
    }
  } catch (error) {
    issues.push(`Final outputs resolution failed: ${(error as Error).message}`);
  }

  const taskCorrect =
    kindCorrect &&
    writesMatch &&
    outputCorrect &&
    issues.length === 0 &&
    safetyViolations.length === 0;

  const semanticJudgment: SemanticJudgment = taskCorrect
    ? "correct"
    : "incorrect";

  const canonicalTrace: CanonicalTrace = {
    candidateKind: "plan",
    executedTools,
    writeIntents,
    finalOutputs:
      Object.keys(resolvedOutputs).length > 0 ? resolvedOutputs : undefined,
  };

  return {
    structuralValidity: true,
    fixtureExecutability: true,
    semanticJudgment,
    safetyViolations,
    reviewReason: taskCorrect ? null : issues.join("; "),
    candidateKind: "plan",
    kindCorrect: true,
    planValid: true,
    taskCorrect,
    outputCorrect,
    writeIntents,
    issues,
    canonicalTrace,
  };
}
