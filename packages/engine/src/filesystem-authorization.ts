import { createHash } from "node:crypto";
import { z } from "zod";
import { type Store, type Tx } from "./store.js";
import type { FilesystemDispatchContext } from "./gateway-types.js";
import {
  BeforeDispatchError,
  EngineError,
  canonicalJson,
  payloadHash,
} from "./snapshot.js";
import { receiverModeFor } from "./receiver-policy.js";
import { verifyPreview } from "./approval.js";

const AuthorizationSchema = z
  .object({
    approval_id: z.uuid(),
    operation_id: z.uuid(),
    snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const ArgsSchema = z
  .object({ path: z.string(), content: z.string() })
  .strict();

export class FilesystemAlreadyDispatchedError extends Error {
  constructor() {
    super("Filesystem operation already has a committed dispatch reservation");
    this.name = "FilesystemAlreadyDispatchedError";
  }
}

type DispatchContext = FilesystemDispatchContext;

const hashContent = (content: string) =>
  createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex");

function failBefore(error: unknown): never {
  if (error instanceof FilesystemAlreadyDispatchedError) throw error;
  if (error instanceof BeforeDispatchError) throw error;
  if (error instanceof EngineError)
    throw new BeforeDispatchError(`${error.code}: ${error.message}`);
  throw new BeforeDispatchError(
    error instanceof Error ? error.message : "Filesystem authorization failed",
  );
}

function parseContext(context: DispatchContext) {
  const authorization = AuthorizationSchema.safeParse(context.authorization);
  const args = ArgsSchema.safeParse(context.args);
  if (!authorization.success || !args.success)
    throw new BeforeDispatchError("Filesystem authorization or arguments are invalid");
  if (context.tool.server !== "filesystem" || context.tool.name !== "write_file")
    throw new BeforeDispatchError("Filesystem dispatch tool is not write_file");
  if (context.checkedPath.relative !== args.data.path)
    throw new BeforeDispatchError("Filesystem path differs from the approved operation");
  return { authorization: authorization.data, args: args.data };
}

async function loadAndCheck(
  tx: Tx,
  context: DispatchContext,
  mode: "reserve" | "recheck",
) {
  const { authorization, args } = parseContext(context);
  const [operation] = await tx`
    SELECT * FROM tool_operations
    WHERE operation_id=${authorization.operation_id} AND user_id=${context.store.userId}
    FOR UPDATE`;
  if (!operation) throw new BeforeDispatchError("Filesystem operation is not owned by this principal");

  const run = await context.store.run(tx, operation.run_id, true);
  const approval = await context.store.approval(tx, run.id, true);
  if (
    run.status !== "running" ||
    run.cancel_requested_at ||
    run.claimed_by !== context.worker.id ||
    !approval ||
    approval.decision !== "approved" ||
    approval.id !== authorization.approval_id ||
    approval.workflow_version_id !== run.workflow_version_id ||
    approval.snapshot_hash !== authorization.snapshot_hash ||
    operation.workflow_version_id !== run.workflow_version_id ||
    operation.tool_server !== "filesystem" ||
    operation.tool_name !== "write_file" ||
    operation.policy_version !== context.tool.policyVersion ||
    operation.receiver_mode !== "non_idempotent" ||
    operation.state !== "in_flight" ||
    operation.payload_hash !== payloadHash(context.tool, args)
  )
    throw new BeforeDispatchError("Filesystem operation is not currently authorized");

  const snapshot = await verifyPreview(
    context.store,
    tx,
    run,
    approval,
    context.gateway,
  );
  const action = snapshot.actions.find(
    (candidate) => candidate.operation_id === authorization.operation_id,
  );
  if (
    !action ||
    action.server !== "filesystem" ||
    action.tool !== "write_file" ||
    action.policy_version !== context.tool.policyVersion ||
    action.payload_hash !== operation.payload_hash ||
    action.payload_hash !== payloadHash(context.tool, args) ||
    canonicalJson(action.resolved_args) !== canonicalJson(args) ||
    canonicalJson(operation.resolved_args) !== canonicalJson(args)
  )
    throw new BeforeDispatchError("Filesystem operation differs from the approved snapshot");
  if (receiverModeFor(context.tool) !== "non_idempotent")
    throw new BeforeDispatchError("Filesystem write receiver mode is not non-idempotent");

  await context.worker.assertActive();
  const [clock] = await tx`
    SELECT expires_at > clock_timestamp() AS live
    FROM approvals WHERE id=${approval.id}`;
  if (!clock?.live) throw new BeforeDispatchError("Filesystem approval expired");

  const [marker] = await tx`
    SELECT operation_id,relative_path,content_sha256,launch_hash
    FROM filesystem_dispatches
    WHERE operation_id=${authorization.operation_id}
    FOR UPDATE`;
  if (mode === "reserve" && marker)
    throw new FilesystemAlreadyDispatchedError();
  if (mode === "recheck" && !marker)
    throw new BeforeDispatchError("Filesystem dispatch reservation is missing");
  const contentSha256 = hashContent(args.content);
  if (
    marker &&
    (marker.relative_path !== args.path ||
      marker.content_sha256 !== contentSha256 ||
      marker.launch_hash !== context.tool.artifactHash)
  )
    throw new BeforeDispatchError("Filesystem dispatch reservation differs from the approved operation");
  if (mode === "reserve") {
    await tx`
      INSERT INTO filesystem_dispatches
        (operation_id,user_id,run_id,relative_path,content_sha256,launch_hash)
      VALUES
        (${authorization.operation_id},${context.store.userId},${run.id},${args.path},${contentSha256},${context.tool.artifactHash})`;
  }
  return { run, approval, operation, args, authorization, marker };
}

export async function reserveFilesystemDispatch(context: DispatchContext): Promise<void> {
  try {
    await context.worker.assertActive();
    await context.store.db.client.begin(async (tx) => {
      await loadAndCheck(tx, context, "reserve");
    });
  } catch (error) {
    failBefore(error);
  }
}

export async function recheckFilesystemDispatch(context: DispatchContext): Promise<void> {
  try {
    await context.worker.assertActive();
    await context.store.db.client.begin(async (tx) => {
      await loadAndCheck(tx, context, "recheck");
    });
  } catch (error) {
    failBefore(error);
  }
}
