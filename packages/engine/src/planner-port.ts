import type { z } from "zod";
import {
  CreateRunSchema,
  PlannerResultSchema,
  type PlannerResult,
} from "@wap/dsl";

export type CreateRun = z.infer<typeof CreateRunSchema>;

export interface PlannerPort {
  readonly mode: "dev_fixture" | "ai";
  produce(input: {
    runId: string;
    userId: string;
    request: CreateRun;
    runtime: Record<string, string>;
  }): Promise<PlannerResult>;
}

export function parsePlannerResult(value: unknown): PlannerResult {
  return PlannerResultSchema.parse(value);
}
