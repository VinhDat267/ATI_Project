import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PlannerResultSchema, type PlannerResult } from "@wap/dsl";
import type { CreateRun, PlannerPort } from "@wap/engine";

export interface DevPlanner extends PlannerPort {
  readonly b02Prompt: string;
  readonly entries: readonly { id: string; prompt: string; sha256: string }[];
}

type Entry = {
  id: string;
  prompt: string;
  result: PlannerResult;
  sha256: string;
};

function bytesHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function loadDevPlanner(root: string): DevPlanner {
  const casesText = readFileSync(
    path.join(root, "testdata", "test-cases.json"),
    "utf8",
  );
  const cases = JSON.parse(casesText).cases as Array<Record<string, unknown>>;
  const b02 = cases.filter((item) => item.id === "b02" && item.split === "dev");
  if (b02.length !== 1) throw new Error("DEV_PLANNER_B02_ENTRY_INVALID");
  const b02Case = b02[0]!;
  const b02Result = PlannerResultSchema.parse(b02Case.expected_result);
  const entries: Entry[] = [
    {
      id: "b02",
      prompt: String(b02Case.prompt),
      result: b02Result,
      sha256: bytesHash(JSON.stringify(b02Case.expected_result)),
    },
  ];
  for (const id of ["fs-copy-notify", "fs-card-export"] as const) {
    const file = path.join(root, "testdata", "dev-hand-plans", `${id}.json`);
    const text = readFileSync(file, "utf8");
    const plan = JSON.parse(text);
    const result = PlannerResultSchema.parse({ kind: "plan", plan });
    entries.push({
      id,
      prompt: String(plan.source_prompt),
      result,
      sha256: bytesHash(text),
    });
  }
  const prompts = new Set<string>();
  for (const entry of entries) {
    const normalized = entry.prompt.trim();
    if (prompts.has(normalized))
      throw new Error("DEV_PLANNER_DUPLICATE_PROMPT");
    prompts.add(normalized);
  }
  return {
    mode: "dev_fixture",
    b02Prompt: entries[0]!.prompt,
    entries: entries.map(({ id, prompt, sha256 }) => ({ id, prompt, sha256 })),
    async produce(input: {
      runId: string;
      userId: string;
      request: CreateRun;
      runtime: Record<string, string>;
    }) {
      const entry = entries.find(
        (candidate) =>
          candidate.prompt.trim() === input.request.source_prompt.trim(),
      );
      if (!entry)
        return {
          kind: "clarification",
          question:
            "Bản demo hiện chỉ chạy các yêu cầu mẫu đã liệt kê. Hãy chọn một yêu cầu mẫu.",
        };
      return structuredClone(entry.result);
    },
  };
}
