/**
 * Sinh JSON Schema từ Zod để đưa vào LLM structured output.
 * Chạy: npm run schema:json
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { z } from "zod";
import {
  LlmPlanDraftSchema,
  WorkflowPlanSchema,
  PlannerResultSchema,
} from "../src/schema.js";

mkdirSync("generated", { recursive: true });

writeFileSync(
  "generated/workflow-plan.schema.json",
  JSON.stringify(z.toJSONSchema(WorkflowPlanSchema, { io: "input" }), null, 2),
);

// Bản rút gọn — đây là schema đưa cho LLM
writeFileSync(
  "generated/llm-plan-draft.schema.json",
  JSON.stringify(z.toJSONSchema(LlmPlanDraftSchema, { io: "input" }), null, 2),
);
writeFileSync(
  "generated/planner-result.schema.json",
  JSON.stringify(z.toJSONSchema(PlannerResultSchema, { io: "input" }), null, 2),
);

console.log("Đã sinh JSON Schema vào generated/");
