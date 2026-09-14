import { EngineError, type EngineTool } from "./snapshot.js";

const TASK_HUB_LOCAL_WRITES = new Set([
  "append_sheet_rows",
  "send_slack_message",
  "create_card",
  "move_card",
]);

export type ReceiverMode = "local_transaction" | "non_idempotent";

/** Closed mapping from reviewed tool identity to its durable receiver contract. */
export function receiverModeFor(tool: EngineTool): ReceiverMode {
  if (
    tool.sideEffect === "write" &&
    tool.server === "task_hub" &&
    tool.policyVersion === "b-local-1" &&
    TASK_HUB_LOCAL_WRITES.has(tool.name)
  )
    return "local_transaction";
  if (
    tool.sideEffect === "write" &&
    tool.server === "filesystem" &&
    tool.name === "write_file" &&
    tool.policyVersion === "b-local-fs-1"
  )
    return "non_idempotent";
  throw new EngineError(
    "REGISTRY_CHANGED",
    "No reviewed receiver mode for this write",
  );
}
