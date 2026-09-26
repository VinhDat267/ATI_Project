import { describe, expect, it } from "vitest";
import { PlannerResultSchema, type PlannerResult } from "@wap/dsl";
import {
  decodePlannerWire,
  encodePlannerWire,
  googlePlannerWireJsonSchema,
  openAiPlannerWireJsonSchema,
} from "../src/ai/providers/wire-schema.js";

const plan: PlannerResult = {
  kind: "plan",
  plan: {
    version: "1.0",
    name: "append rows",
    source_prompt: "append the rows",
    inputs: { sheet_id: { type: "string", required: true } },
    steps: [
      {
        id: "append_rows",
        description: "Append the rows",
        tool: {
          server: "task_hub",
          name: "append_sheet_rows",
          args: {
            sheet_id: "${inputs.sheet_id}",
            rows: [{ value: null }, { value: true }, { value: 4 }],
          },
        },
        depends_on: [],
        condition: null,
        idempotency_key: "run-append",
        side_effect: "write",
        on_error: "fail",
      },
    ],
    outputs: { appended: "${steps.append_rows}" },
  },
};

describe("provider wire codecs", () => {
  it("advertises the DSL input-key rule to both providers and rejects camelCase keys", () => {
    for (const schema of [googlePlannerWireJsonSchema, openAiPlannerWireJsonSchema]) {
      expect(schema.$defs.wireInput.properties.key).toHaveProperty('description',
        'Input variable name must match /^[a-z][a-z0-9_]{0,31}$/; use snake_case such as spreadsheet_id. Tool argument keys keep their reviewed tool schema names.');
    }
    const wire = JSON.parse(JSON.stringify(encodePlannerWire(plan)));
    wire.result.plan.inputs[0].key = 'spreadsheetId';
    expect(() => decodePlannerWire(wire)).toThrow();
    wire.result.plan.inputs[0].key = 'spreadsheet_id';
    expect(decodePlannerWire(wire).kind).toBe('plan');
  });
  it("round-trips every canonical planner branch", () => {
    const values: PlannerResult[] = [
      plan,
      { kind: "refusal", reason: "not allowed" },
      { kind: "clarification", question: "Which sheet?" },
    ];
    for (const value of values) {
      const parsed = PlannerResultSchema.parse(
        decodePlannerWire(encodePlannerWire(value)),
      );
      expect(parsed).toEqual(value);
    }
  });

  it("uses a closed object envelope for both providers", () => {
    expect(openAiPlannerWireJsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["result"],
    });
    expect(googlePlannerWireJsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(openAiPlannerWireJsonSchema).not.toHaveProperty("anyOf");
    expect(googlePlannerWireJsonSchema).not.toHaveProperty("anyOf");
  });

  it("rejects duplicate map entries and an invalid branch payload", () => {
    const wire = encodePlannerWire(plan) as Record<string, unknown>;
    const encodedPlan = (wire.result as Record<string, unknown>).plan as Record<
      string,
      unknown
    >;
    const inputs = encodedPlan.inputs as Array<Record<string, unknown>>;
    encodedPlan.inputs = [...inputs, inputs[0]];
    expect(() => decodePlannerWire(wire)).toThrow(/duplicate/i);

    expect(() =>
      decodePlannerWire({
        kind: "refusal",
        plan: null,
        refusal: null,
        clarification: null,
      }),
    ).toThrow(/refusal/i);
  });

  it("accepts omitted optional recursive null fields in Google's wire schema", () => {
    const wire = encodePlannerWire(plan) as Record<string, unknown>;
    const encodedPlan = (wire.result as Record<string, unknown>).plan as Record<string, unknown>;
    const firstStep = (encodedPlan.steps as Array<Record<string, unknown>>)[0]!;
    const args = (firstStep.tool as Record<string, unknown>).args as Record<string, unknown>;
    const entries = args.object_entries as Array<Record<string, unknown>>;
    const rows = entries.find((entry) => entry.key === "rows")!.value as Record<string, unknown>;
    const firstRow = (rows.array_value as Array<Record<string, unknown>>)[0]!;
    const nullValue = (firstRow.object_entries as Array<Record<string, unknown>>)[0]!.value as Record<string, unknown>;
    delete nullValue.array_value;
    delete nullValue.object_entries;
    expect(decodePlannerWire(wire)).toEqual(plan);
  });
});
