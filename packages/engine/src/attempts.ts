import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  normalizeToolResult,
  validateToolCall,
  type ErrorClass,
  type Step,
} from "@wap/dsl";
import { Store, type Tx } from "./store.js";
import type { Gateway, GatewayResult, CallContext } from "./gateway.js";
import {
  EngineError,
  BeforeDispatchError,
  canonicalJson,
  json,
  toolTrace,
  type EngineTool,
} from "./snapshot.js";
import { receiverModeFor } from "./receiver-policy.js";
type Certainty =
  "confirmed" | "known_not_applied" | "before_dispatch" | "unknown";
export interface AttemptOutcome {
  ok: boolean;
  output: unknown;
  certainty: Certainty;
  message: string | null;
  errorClass?: ErrorClass;
}
export type AttemptGuard = (tx: Tx) => Promise<void>;
function extractErrorCode(
  result: GatewayResult | undefined,
): string | undefined {
  if (!result?.isError) return undefined;
  try {
    const item = result.content?.[0] as
      { type?: string; text?: string } | undefined;
    if (item?.type === "text" && item.text) {
      const parsed = JSON.parse(item.text) as { code?: string };
      return parsed.code;
    }
  } catch {
    // If not JSON, check plain text
    const text = (result.content?.[0] as { text?: string } | undefined)?.text;
    if (text && ["BAD_ARGS", "BAD_RANGE", "NOT_FOUND"].includes(text)) {
      return text;
    }
  }
  return undefined;
}
function knownToolError(tool: EngineTool, result: GatewayResult) {
  if (tool.server !== "task_hub") return false;
  if (!result.isError) return false;
  const code = extractErrorCode(result);
  return (
    code !== undefined &&
    ["BAD_ARGS", "BAD_RANGE", "NOT_FOUND", "NOT_AUTHORIZED"].includes(code)
  );
}
function classifyOutcomeError(
  tool: EngineTool,
  response: GatewayResult | undefined,
  isBeforeDispatch: boolean,
): ErrorClass {
  if (isBeforeDispatch) return "bad_args";
  if (!response) return "fatal";
  const code = extractErrorCode(response);
  if (code === "BAD_ARGS" || code === "BAD_RANGE") return "bad_args";
  if (code === "NOT_FOUND") return "bad_tool";
  if (!response.isError) return "bad_assumption";
  return "fatal";
}
/** Persist intent before transport. Complete an attempt once, retaining every retry. */
export async function callStep(
  store: Store,
  gateway: Gateway,
  runId: string,
  step: Step,
  tool: EngineTool,
  args: Record<string, unknown>,
  auth?: Record<string, string>,
  beforeMutation?: AttemptGuard,
): Promise<AttemptOutcome> {
  const isWrite = tool.sideEffect === "write";
  const checked = validateToolCall(
    tool,
    args,
    isWrite ? "execution" : "dry_run",
  );
  if (!checked.ok)
    throw new BeforeDispatchError(
      checked.issues.map((i) => i.message).join("; "),
    );
  const receiverMode = isWrite ? receiverModeFor(tool) : undefined;
  const maximum = isWrite ? 1 : step.retry.max_attempts;
  const [initialStepState] = await store.db.client`
    SELECT attempts FROM step_states WHERE run_id=${runId} AND step_id=${step.id}
  `;
  const baseAttempts = initialStepState?.attempts ?? 0;
  for (let attempt = 1; attempt <= maximum; attempt++) {
    const attemptId = randomUUID(),
      started = Date.now();
    let context: CallContext | undefined;
    try {
      context = await store.db.client.begin(async (tx) => {
        await store.assertWorker(tx);
        await beforeMutation?.(tx);
        const run = await store.run(tx, runId, true);
        if (
          run.cancel_requested_at ||
          run.status !== (isWrite ? "running" : "dry_running")
        )
          throw new EngineError(
            "CANCELLED",
            "Run is no longer available for dispatch",
          );
        const [state] =
          await tx`UPDATE step_states SET status='running',attempts=attempts+1,started_at=COALESCE(started_at,now()) WHERE run_id=${runId} AND step_id=${step.id} RETURNING id,attempts`;
        if (!state || state.attempts !== baseAttempts + attempt)
          throw new EngineError("CONFLICT", "Attempt has already been claimed");
        await tx`INSERT INTO step_attempts(id,step_state_id,attempt_no,workflow_version_id,tool_snapshot,resolved_args,operation_id,outcome_certainty)
        VALUES (${attemptId},${state.id},${state.attempts},${run.workflow_version_id},${tx.json(json(toolTrace(tool)))},${tx.json(json(args))},${auth?.operation_id ?? null},'unknown')`;
        await store.emit(tx, runId, "step.started", {
          step_id: step.id,
          description: step.description,
          tool: step.tool,
          side_effect: tool.sideEffect,
          attempt_no: state.attempts,
        });
        await store.emit(tx, runId, "step.attempt", {
          step_id: step.id,
          attempt_no: state.attempts,
          resolved_args: args,
        });
        return { timeZone: run.time_zone };
      });
    } catch (error) {
      if (
        error instanceof EngineError &&
        (error.code === "LEASE_LOST" || error.code === "STALE_REPLAN")
      )
        throw error;
      throw new BeforeDispatchError(
        error instanceof EngineError
          ? error.message
          : "Dispatch preparation failed before calling MCP",
      );
    }
    let outcome: AttemptOutcome = {
      ok: false,
      output: null,
      certainty: isWrite ? "unknown" : "known_not_applied",
      message: "MCP call failed or timed out",
    };
    try {
      try {
        await store.assertWorker();
      } catch (error) {
        throw new BeforeDispatchError(
          error instanceof EngineError
            ? error.message
            : "Worker lease is no longer active",
        );
      }
      const response = await gateway.call(
        { server: tool.server, name: tool.name },
        args,
        auth,
        step.timeout_ms,
        {
          timeZone: context!.timeZone,
          worker: {
            id: store.workerId,
            assertActive: () => store.assertWorker(),
          },
        },
      );
      const result = normalizeToolResult(tool, response);
      if (result.ok)
        outcome = {
          ok: true,
          output: result.output,
          certainty: "confirmed",
          message: null,
        };
      else
        outcome = {
          ok: false,
          output: null,
          certainty:
            !isWrite || knownToolError(tool, response)
              ? "known_not_applied"
              : "unknown",
          message: response.isError
            ? "MCP tool rejected the request"
            : "MCP output failed its reviewed schema",
          errorClass: classifyOutcomeError(tool, response, false),
        };
    } catch (error) {
      if (error instanceof BeforeDispatchError)
        outcome = {
          ok: false,
          output: null,
          certainty: "before_dispatch",
          message: error.message,
          errorClass: classifyOutcomeError(tool, undefined, true),
        };
    }
    // A valid reply alone is insufficient evidence that a local write committed.
    if (isWrite && outcome.ok && receiverMode === "local_transaction") {
      const [receipt] = await store.db
        .client`SELECT * FROM hub_receipts WHERE user_id=${store.userId} AND operation_id=${auth!.operation_id!}`;
      const [op] = await store.db
        .client`SELECT payload_hash FROM tool_operations WHERE operation_id=${auth!.operation_id!} AND user_id=${store.userId}`;
      if (
        !receipt ||
        !op ||
        receipt.payload_hash !== op.payload_hash ||
        receipt.tool_name !== tool.name ||
        receipt.policy_version !== tool.policyVersion ||
        canonicalJson(receipt.result) !== canonicalJson(outcome.output)
      )
        outcome = {
          ok: false,
          output: null,
          certainty: "unknown",
          message: "Local receipt does not confirm the reported write result",
          errorClass: "fatal",
        };
    }
    const retry =
      !isWrite &&
      !outcome.ok &&
      outcome.message === "MCP call failed or timed out" &&
      attempt < maximum;
    const resolvedErrorClass = outcome.ok
      ? null
      : retry
        ? "transient"
        : (outcome.errorClass ?? "fatal");
    await store.db.client.begin(async (tx) => {
      await beforeMutation?.(tx);
      await store.run(tx, runId, true);
      const done =
        await tx`UPDATE step_attempts SET ended_at=now(),duration_ms=${Date.now() - started},result=${tx.json(json(outcome.output))},outcome_certainty=${outcome.certainty},error_message=${outcome.message},error_class=${resolvedErrorClass} WHERE id=${attemptId} AND ended_at IS NULL RETURNING id`;
      if (!done.length)
        throw new EngineError(
          "CONFLICT",
          "Completed attempts cannot be overwritten",
        );
      await tx`UPDATE step_states SET status=${outcome.ok ? "succeeded" : retry ? "running" : "failed"},output=${tx.json(json(outcome.output))},last_error=${outcome.message},last_error_class=${resolvedErrorClass},ended_at=${retry ? null : new Date()} WHERE run_id=${runId} AND step_id=${step.id}`;
      if (isWrite)
        await tx`UPDATE tool_operations SET state=${outcome.ok ? "succeeded" : outcome.certainty === "unknown" ? "unknown" : "known_failed"},result=${tx.json(json(outcome.output))},error_message=${outcome.message},completed_at=now() WHERE operation_id=${auth!.operation_id!} AND state='in_flight'`;
      if (outcome.ok)
        await store.emit(tx, runId, "step.succeeded", {
          step_id: step.id,
          attempts: attempt,
          duration_ms: Date.now() - started,
          deduplicated: false,
        });
      else if (!retry)
        await store.emit(tx, runId, "step.failed", {
          step_id: step.id,
          attempts: attempt,
          error_message: outcome.message!,
          error_class: resolvedErrorClass ?? "fatal",
          on_error: step.on_error,
        });
    });
    if (!retry) return outcome;
    const waitMs = Math.min(
      step.retry.initial_delay_ms * 2 ** (attempt - 1),
      30000,
    );
    await store.db.client.begin(async (tx) => {
      await beforeMutation?.(tx);
      await store.run(tx, runId, true);
      await store.emit(tx, runId, "step.retrying", {
        step_id: step.id,
        attempt_no: attempt,
        max_attempts: maximum,
        error_message: outcome.message!,
        error_class: "transient",
        delay_ms: waitMs,
      });
    });
    await delay(waitMs);
  }
  throw new EngineError("INTERNAL", "Attempt loop exhausted unexpectedly");
}
