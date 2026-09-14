import { randomUUID } from "node:crypto";
import { CreateRunSchema, RunAcceptedSchema, buildRuntime } from "@wap/dsl";
import { Store } from "./store.js";
import { EngineError } from "./snapshot.js";

/** Persist an accepted planning request and its prepare outbox row atomically. */
export async function accept(store: Store, value: unknown) {
  const request = CreateRunSchema.parse(value);
  const runId = randomUUID();
  const workflowId = randomUUID();
  let runtime: Record<string, string>;
  try {
    runtime = buildRuntime({
      runId,
      userId: store.userId,
      timeZone: request.time_zone,
    });
  } catch {
    throw new EngineError(
      "INVALID_INPUT",
      "time_zone must be a valid IANA timezone",
    );
  }
  await store.db.client.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(638019815)`;
    const active = await tx`SELECT 1 FROM runs WHERE status::text NOT IN
      ('succeeded','failed','rejected','cancelled','expired','refused','needs_input','reconciliation_required') LIMIT 1`;
    if (active.length)
      throw new EngineError("ACTIVE_RUN", "A run is already active");
    await tx`INSERT INTO workflows(id,user_id,name,source_prompt)
      VALUES (${workflowId},${store.userId},'Pending plan',${request.source_prompt})`;
    await tx`INSERT INTO runs(id,user_id,workflow_id,source_prompt,inputs,runtime,time_zone)
      VALUES (${runId},${store.userId},${workflowId},${request.source_prompt},${tx.json(request.inputs)},${tx.json(runtime)},${request.time_zone})`;
    await store.emit(
      tx,
      runId,
      "run.status",
      {
        status: "planning",
        previous: null,
      },
      "prepare",
    );
  });
  return RunAcceptedSchema.parse({ run_id: runId, status: "planning" });
}
