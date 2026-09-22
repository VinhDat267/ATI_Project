import type { z } from "zod";
import {
  CreateRunSchema,
  PlannerResultSchema,
  type PlannerResult,
} from "@wap/dsl";
import type { PilotPlannerContext } from "./pilot/planner-context.js";

export type CreateRun = z.infer<typeof CreateRunSchema>;

export interface PlannerPort {
  readonly mode: "dev_fixture" | "ai";
  produce(input: {
    runId: string;
    userId: string;
    request: CreateRun;
    runtime: Record<string, string>;
    pilotContext?: PilotPlannerContext;
    signal?: AbortSignal;
  }): Promise<PlannerResult>;
}

export function parsePlannerResult(value: unknown): PlannerResult {
  return PlannerResultSchema.parse(value);
}
