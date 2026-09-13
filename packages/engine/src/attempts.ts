import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { normalizeToolResult, validateToolCall, type Step } from "@wap/dsl";
import { Store } from "./store.js";
import type { Gateway, GatewayResult } from "./gateway.js";
import {
  EngineError,
  BeforeDispatchError,
  canonicalJson,
  json,
  toolTrace,
  type EngineTool,
} from "./snapshot.js";
type Certainty =
  "confirmed" | "known_not_applied" | "before_dispatch" | "unknown";
export interface AttemptOutcome {
  ok: boolean;
  output: unknown;
  certainty: Certainty;
  message: string | null;
}
function knownToolError(result: GatewayResult) {
  if (!result.isError) return false;
  try {
    const item = result.content?.[0] as
      { type?: string; text?: string } | undefined;
    const code =
      item?.type === "text" ? JSON.parse(item.text ?? "").code : undefined;
    return ["BAD_ARGS", "BAD_RANGE", "NOT_FOUND", "NOT_AUTHORIZED"].includes(
      code,
    );
  } catch {
    return false;
  }
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
  const maximum = isWrite ? 1 : step.retry.max_attempts;
  for (let attempt = 1; attempt <= maximum; attempt++) {
    const attemptId = randomUUID(),
      started = Date.now();
    try {
      await store.db.client.begin(async (tx) => {
        await store.assertWorker(tx);
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
        if (!state || state.attempts !== attempt)
          throw new EngineError("CONFLICT", "Attempt has already been claimed");
        await tx`INSERT INTO step_attempts(id,step_state_id,attempt_no,workflow_version_id,tool_snapshot,resolved_args,operation_id,outcome_certainty)
        VALUES (${attemptId},${state.id},${attempt},${run.workflow_version_id},${tx.json(json(toolTrace(tool)))},${tx.json(json(args))},${auth?.operation_id ?? null},'unknown')`;
        await store.emit(tx, runId, "step.started", {
          step_id: step.id,
          description: step.description,
          tool: step.tool,
          side_effect: tool.sideEffect,
          attempt_no: attempt,
        });
        await store.emit(tx, runId, "step.attempt", {
          step_id: step.id,
          attempt_no: attempt,
          resolved_args: args,
        });
      });
    } catch (error) {
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
      await store.assertWorker();
      const response = await gateway.call(
        tool.name,
        args,
        auth,
        step.timeout_ms,
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
            !isWrite || knownToolError(response)
              ? "known_not_applied"
              : "unknown",
          message: response.isError
            ? "MCP tool rejected the request"
            : "MCP output failed its reviewed schema",
        };
    } catch (error) {
      if (error instanceof EngineError)
        outcome = {
          ok: false,
          output: null,
          certainty: "before_dispatch",
          message: error.message,
        };
    }
    // A valid reply alone is insufficient evidence that a local write committed.
    if (isWrite && outcome.ok) {
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
        };
    }
    const retry =
      !isWrite &&
      !outcome.ok &&
      outcome.message === "MCP call failed or timed out" &&
      attempt < maximum;
    await store.db.client.begin(async (tx) => {
      await store.run(tx, runId, true);
      const done =
        await tx`UPDATE step_attempts SET ended_at=now(),duration_ms=${Date.now() - started},result=${tx.json(json(outcome.output))},outcome_certainty=${outcome.certainty},error_message=${outcome.message},error_class=${outcome.ok ? null : retry ? "transient" : "fatal"} WHERE id=${attemptId} AND ended_at IS NULL RETURNING id`;
      if (!done.length)
        throw new EngineError(
          "CONFLICT",
          "Completed attempts cannot be overwritten",
        );
      await tx`UPDATE step_states SET status=${outcome.ok ? "succeeded" : retry ? "running" : "failed"},output=${tx.json(json(outcome.output))},last_error=${outcome.message},last_error_class=${outcome.ok ? null : retry ? "transient" : "fatal"},ended_at=${retry ? null : new Date()} WHERE run_id=${runId} AND step_id=${step.id}`;
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
          error_class: "fatal",
          on_error: step.on_error,
        });
    });
    if (!retry) return outcome;
    const waitMs = Math.min(
      step.retry.initial_delay_ms * 2 ** (attempt - 1),
      30000,
    );
    await store.db.client.begin(async (tx) => {
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
