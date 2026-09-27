import { z } from "zod";
import type { V2TestCase } from "./dataset-schema.js";

const JsonCellSchema = z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(),
]);

export const PilotEvaluationInputSchema = z.object({
  language: z.enum(["vi", "en"]),
  prompt: z.string().min(1),
  principal: z.string().min(1),
  sourceFixture: z.object({
    headers: z.array(z.string()),
    rows: z.array(z.array(JsonCellSchema)),
    requestId: z.string().min(1),
    spreadsheetId: z.string().optional(),
    tabId: z.string().optional(),
  }).strict(),
  resourcePolicy: z.object({
    allowedSources: z.array(z.string()),
    allowedTargets: z.array(z.string()),
    allowedPrincipals: z.array(z.string()),
  }).strict(),
}).strict();

export type PilotEvaluationInput = z.infer<typeof PilotEvaluationInputSchema>;

/** Copy only intake fields; dataset labels, faults and grading metadata never enter this boundary. */
export function projectPilotEvaluationInput(record: V2TestCase): PilotEvaluationInput {
  const fixture = record.sourceFixture;
  return PilotEvaluationInputSchema.parse({
    language: record.language,
    prompt: record.prompt,
    principal: record.principal,
    sourceFixture: {
      headers: fixture.headers,
      rows: fixture.rows,
      requestId: fixture.requestId,
      ...(fixture.spreadsheetId === undefined ? {} : { spreadsheetId: fixture.spreadsheetId }),
      ...(fixture.tabId === undefined ? {} : { tabId: fixture.tabId }),
    },
    resourcePolicy: {
      allowedSources: record.resourcePolicy.allowedSources,
      allowedTargets: record.resourcePolicy.allowedTargets,
      allowedPrincipals: record.resourcePolicy.allowedPrincipals,
    },
  });
}
