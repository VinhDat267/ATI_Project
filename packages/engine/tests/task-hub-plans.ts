import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WorkflowPlanSchema, type WorkflowPlan } from "@wap/dsl";

const root = fileURLToPath(new URL("../../../", import.meta.url));

export function makeMovePlan(): WorkflowPlan {
  const raw = JSON.parse(
    readFileSync(path.join(root, "testdata/dev-hand-plans/th-move.json"), "utf8"),
  );
  return WorkflowPlanSchema.parse(raw);
}

export function makeCreatePlan(withNotify = false): WorkflowPlan {
  return WorkflowPlanSchema.parse({
    version: "1.0",
    name: "Create local card",
    source_prompt: "Tạo card Docs ở Backlog.",
    steps: [
      {
        id: "create",
        description: "Create Docs",
        tool: {
          server: "task_hub",
          name: "create_card",
          args: {
            board_id: "board_a",
            list_name: "Backlog",
            title: "Docs",
          },
        },
        side_effect: "write",
        depends_on: [],
        idempotency_key: "${runtime.run_id}_create",
      },
      ...(withNotify
        ? [
            {
              id: "notify",
              description: "Notify",
              tool: {
                server: "task_hub",
                name: "send_slack_message",
                args: {
                  channel: "#team",
                  text: "Đã tạo card Docs.",
                },
              },
              side_effect: "write",
              depends_on: ["create"],
              idempotency_key: "${runtime.run_id}_notify",
            },
          ]
        : []),
    ],
    outputs: {},
  });
}

export function makeMembersPlan(): WorkflowPlan {
  return WorkflowPlanSchema.parse({
    version: "1.0",
    name: "Read workload",
    source_prompt: "Liệt kê thành viên board_a.",
    steps: [
      {
        id: "read",
        description: "Read workload",
        tool: {
          server: "task_hub",
          name: "list_members",
          args: {
            board_id: "board_a",
          },
        },
        side_effect: "read",
        depends_on: [],
      },
    ],
    outputs: {
      members: "${steps.read.output.members}",
    },
  });
}
