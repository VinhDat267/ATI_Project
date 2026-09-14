import { describe, expect, it } from "vitest";
import { EngineError, type EngineTool } from "../src/snapshot.js";
import { receiverModeFor } from "../src/receiver-policy.js";

const makeTool = (
  server: "task_hub" | "filesystem",
  name: string,
  sideEffect: "read" | "write" = "write",
  policyVersion = server === "task_hub" ? "b-local-1" : "b-local-fs-1",
): EngineTool => ({
  server,
  name,
  sideEffect,
  policyVersion,
  inputSchema: {},
  outputSchema: {},
  artifactHash: "b".repeat(64),
});

describe("closed receiver policy", () => {
  it.each(["append_sheet_rows", "send_slack_message", "create_card", "move_card"])(
    "maps reviewed task_hub write %s to a local transaction",
    (name) => {
      expect(receiverModeFor(makeTool("task_hub", name))).toBe(
        "local_transaction",
      );
    },
  );

  it("maps the reviewed filesystem write to non_idempotent", () => {
    expect(receiverModeFor(makeTool("filesystem", "write_file"))).toBe(
      "non_idempotent",
    );
  });

  it.each([
    makeTool("task_hub", "list_cards", "read"),
    makeTool("task_hub", "delete_card"),
    makeTool("task_hub", "create_card", "write", "wrong"),
    makeTool("filesystem", "read_file", "read"),
    makeTool("filesystem", "write_file", "write", "wrong"),
  ])("fails closed for an unreviewed receiver mode", (tool) => {
    expect(() => receiverModeFor(tool)).toThrowError(EngineError);
    expect(() => receiverModeFor(tool)).toThrowError(/No reviewed receiver mode/);
  });
});
