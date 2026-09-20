import {
  PlannerResultSchema,
  type ArgValue,
  type InputDecl,
  type LlmPlanDraft,
  type PlannerResult,
} from "@wap/dsl";

type WireValue = {
  readonly kind: "null" | "string" | "number" | "boolean" | "array" | "object";
  readonly string_value: string | null;
  readonly number_value: number | null;
  readonly boolean_value: boolean | null;
  readonly array_value: readonly WireValue[] | null;
  readonly object_entries: readonly { key: string; value: WireValue }[] | null;
};

type WireInput = {
  readonly key: string;
  readonly type: InputDecl["type"];
  readonly description: string | null;
  readonly description_present: boolean;
  readonly required: boolean;
  readonly default_value: WireValue | null;
  readonly default_present: boolean;
};

type WireStep = {
  readonly id: string;
  readonly description: string;
  readonly tool: { server: string; name: string; args: WireValue };
  readonly depends_on: readonly string[] | null;
  readonly depends_on_present: boolean;
  readonly condition: string | null;
  readonly condition_present: boolean;
  readonly idempotency_key: string | null;
  readonly idempotency_key_present: boolean;
  readonly side_effect: "read" | "write";
  readonly on_error: "fail" | "continue" | "replan" | null;
  readonly on_error_present: boolean;
};

type WirePlan = {
  readonly version: "1.0";
  readonly name: string;
  readonly source_prompt: string;
  readonly inputs: readonly WireInput[] | null;
  readonly inputs_present: boolean;
  readonly steps: readonly WireStep[];
  readonly outputs: readonly { key: string; value: string }[] | null;
  readonly outputs_present: boolean;
};

type PlannerWireResult = {
  readonly kind: PlannerResult["kind"];
  readonly plan: WirePlan | null;
  readonly refusal: { reason: string } | null;
  readonly clarification: { question: string } | null;
};

export type PlannerWire = { readonly result: PlannerWireResult };

export class PlannerWireSchemaError extends Error {
  readonly code = "PLANNER_WIRE_INVALID" as const;

  constructor(message: string) {
    super(message);
    this.name = "PlannerWireSchemaError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeValue(value: ArgValue | string | number | boolean): WireValue {
  if (value === null) {
    return {
      kind: "null",
      string_value: null,
      number_value: null,
      boolean_value: null,
      array_value: null,
      object_entries: null,
    };
  }
  if (typeof value === "string") {
    return {
      kind: "string",
      string_value: value,
      number_value: null,
      boolean_value: null,
      array_value: null,
      object_entries: null,
    };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new PlannerWireSchemaError("number must be finite");
    return {
      kind: "number",
      string_value: null,
      number_value: value,
      boolean_value: null,
      array_value: null,
      object_entries: null,
    };
  }
  if (typeof value === "boolean") {
    return {
      kind: "boolean",
      string_value: null,
      number_value: null,
      boolean_value: value,
      array_value: null,
      object_entries: null,
    };
  }
  if (Array.isArray(value)) {
    return {
      kind: "array",
      string_value: null,
      number_value: null,
      boolean_value: null,
      array_value: value.map((item) => encodeValue(item)),
      object_entries: null,
    };
  }
  return {
    kind: "object",
    string_value: null,
    number_value: null,
    boolean_value: null,
    array_value: null,
    object_entries: Object.keys(value)
      .sort()
      .map((key) => ({ key, value: encodeValue(value[key]!) })),
  };
}

function decodeValue(value: unknown, path: string): ArgValue {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new PlannerWireSchemaError(`${path} must be a wire value`);
  }
  const kind = value.kind;
  switch (kind) {
    case "null":
      if (
        value.string_value !== null ||
        value.number_value !== null ||
        value.boolean_value !== null ||
        value.array_value !== null ||
        value.object_entries !== null
      ) {
        throw new PlannerWireSchemaError(`${path} null payload must be empty`);
      }
      return null;
    case "string":
      if (typeof value.string_value !== "string")
        throw new PlannerWireSchemaError(`${path}.string_value required`);
      return value.string_value;
    case "number":
      if (
        typeof value.number_value !== "number" ||
        !Number.isFinite(value.number_value)
      )
        throw new PlannerWireSchemaError(`${path}.number_value required`);
      return value.number_value;
    case "boolean":
      if (typeof value.boolean_value !== "boolean")
        throw new PlannerWireSchemaError(`${path}.boolean_value required`);
      return value.boolean_value;
    case "array":
      if (!Array.isArray(value.array_value))
        throw new PlannerWireSchemaError(`${path}.array_value required`);
      return value.array_value.map((entry, index) =>
        decodeValue(entry, `${path}.array_value[${index}]`),
      );
    case "object": {
      if (!Array.isArray(value.object_entries))
        throw new PlannerWireSchemaError(`${path}.object_entries required`);
      const output: Record<string, ArgValue> = {};
      const seen = new Set<string>();
      for (const [index, entry] of value.object_entries.entries()) {
        if (!isRecord(entry) || typeof entry.key !== "string")
          throw new PlannerWireSchemaError(
            `${path}.object_entries[${index}] invalid`,
          );
        if (seen.has(entry.key))
          throw new PlannerWireSchemaError(
            `duplicate map entry ${entry.key} at ${path}`,
          );
        seen.add(entry.key);
        Object.defineProperty(output, entry.key, {
          value: decodeValue(entry.value, `${path}.${entry.key}`),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return output;
    }
    default:
      throw new PlannerWireSchemaError(`${path}.kind ${kind} is unsupported`);
  }
}

function encodeMap(
  value: Record<string, string>,
): readonly { key: string; value: string }[] {
  return Object.keys(value)
    .sort()
    .map((key) => ({ key, value: value[key]! }));
}

function decodeStringMap(value: unknown, path: string): Record<string, string> {
  if (!Array.isArray(value))
    throw new PlannerWireSchemaError(`${path} must be an array`);
  const output: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (
      !isRecord(entry) ||
      typeof entry.key !== "string" ||
      typeof entry.value !== "string"
    ) {
      throw new PlannerWireSchemaError(
        `${path}[${index}] must contain string key/value`,
      );
    }
    if (seen.has(entry.key))
      throw new PlannerWireSchemaError(
        `duplicate map entry ${entry.key} at ${path}`,
      );
    seen.add(entry.key);
    Object.defineProperty(output, entry.key, {
      value: entry.value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return output;
}

function encodeInput(key: string, input: InputDecl): WireInput {
  const descriptionPresent = input.description !== undefined;
  const defaultPresent = input.default !== undefined;
  return {
    key,
    type: input.type,
    description: input.description ?? null,
    description_present: descriptionPresent,
    required: input.required,
    default_value: defaultPresent
      ? encodeValue(input.default as string | number | boolean)
      : null,
    default_present: defaultPresent,
  };
}

function decodeInputs(value: unknown, path: string): Record<string, InputDecl> {
  if (!Array.isArray(value))
    throw new PlannerWireSchemaError(`${path} must be an array`);
  const output: Record<string, InputDecl> = {};
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (
      !isRecord(entry) ||
      typeof entry.key !== "string" ||
      typeof entry.type !== "string"
    ) {
      throw new PlannerWireSchemaError(`${path}[${index}] invalid`);
    }
    if (seen.has(entry.key))
      throw new PlannerWireSchemaError(
        `duplicate map entry ${entry.key} at ${path}`,
      );
    seen.add(entry.key);
    const input: Record<string, unknown> = {
      type: entry.type,
      required: entry.required,
    };
    if (entry.description_present) {
      if (typeof entry.description !== "string")
        throw new PlannerWireSchemaError(
          `${path}[${index}].description required`,
        );
      input.description = entry.description;
    }
    if (entry.default_present)
      input.default = decodeValue(
        entry.default_value,
        `${path}[${index}].default_value`,
      );
    Object.defineProperty(output, entry.key, {
      value: input as InputDecl,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return output;
}

export function encodePlannerWire(value: PlannerResult): PlannerWire {
  const parsed = PlannerResultSchema.parse(value);
  if (parsed.kind === "refusal") {
    return {
      result: {
        kind: "refusal",
        plan: null,
        refusal: { reason: parsed.reason },
        clarification: null,
      },
    };
  }
  if (parsed.kind === "clarification") {
    return {
      result: {
        kind: "clarification",
        plan: null,
        refusal: null,
        clarification: { question: parsed.question },
      },
    };
  }
  const plan = parsed.plan;
  return {
    result: {
      kind: "plan",
      plan: {
        version: plan.version,
        name: plan.name,
        source_prompt: plan.source_prompt,
        inputs: plan.inputs
          ? Object.keys(plan.inputs)
              .sort()
              .map((key) => encodeInput(key, plan.inputs![key]!))
          : null,
        inputs_present: plan.inputs !== undefined,
        steps: plan.steps.map((step) => ({
          id: step.id,
          description: step.description,
          tool: {
            server: step.tool.server,
            name: step.tool.name,
            args: encodeValue(step.tool.args),
          },
          depends_on: step.depends_on === undefined ? null : step.depends_on,
          depends_on_present: step.depends_on !== undefined,
          condition: step.condition ?? null,
          condition_present: step.condition !== undefined,
          idempotency_key: step.idempotency_key ?? null,
          idempotency_key_present: step.idempotency_key !== undefined,
          side_effect: step.side_effect,
          on_error: step.on_error ?? null,
          on_error_present: step.on_error !== undefined,
        })),
        outputs: plan.outputs ? encodeMap(plan.outputs) : null,
        outputs_present: plan.outputs !== undefined,
      },
      refusal: null,
      clarification: null,
    },
  };
}

export function decodePlannerWire(value: unknown): PlannerResult {
  const envelope =
    isRecord(value) && isRecord(value.result) ? value.result : value;
  if (
    !isRecord(envelope) ||
    !["plan", "refusal", "clarification"].includes(String(envelope.kind))
  ) {
    throw new PlannerWireSchemaError("wire result kind is invalid");
  }
  const kind = envelope.kind;
  if (kind === "refusal") {
    // Leniently accept a non-null plan field: some providers (e.g. Google Gemini) return a
    // dummy plan object alongside the refusal payload despite `kind === "refusal"`. The refusal
    // semantics are determined solely by `refusal.reason`, so coerce plan/clarification to null.
    if (
      !isRecord(envelope.refusal) ||
      typeof envelope.refusal.reason !== "string" ||
      envelope.refusal.reason.trim().length === 0
    ) {
      throw new PlannerWireSchemaError(
        "refusal branch must contain refusal and null other branches",
      );
    }
    return PlannerResultSchema.parse({ kind, reason: envelope.refusal.reason });
  }
  if (kind === "clarification") {
    // Leniently accept a non-null plan/refusal field alongside clarification
    // (same provider tolerance as the refusal branch above).
    if (
      !isRecord(envelope.clarification) ||
      typeof envelope.clarification.question !== "string" ||
      envelope.clarification.question.trim().length === 0
    ) {
      throw new PlannerWireSchemaError(
        "clarification branch must contain clarification and null other branches",
      );
    }
    return PlannerResultSchema.parse({
      kind,
      question: envelope.clarification.question,
    });
  }
  if (
    envelope.refusal !== null ||
    envelope.clarification !== null ||
    !isRecord(envelope.plan)
  ) {
    throw new PlannerWireSchemaError(
      "plan branch must contain plan and null other branches",
    );
  }
  const wirePlan = envelope.plan;
  if (
    wirePlan.version !== "1.0" ||
    typeof wirePlan.name !== "string" ||
    typeof wirePlan.source_prompt !== "string" ||
    !Array.isArray(wirePlan.steps)
  ) {
    throw new PlannerWireSchemaError("plan fields are invalid");
  }
  const inputs = wirePlan.inputs_present
    ? decodeInputs(wirePlan.inputs, "plan.inputs")
    : undefined;
  const steps = wirePlan.steps.map((entry, index) => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.description !== "string" ||
      !isRecord(entry.tool)
    ) {
      throw new PlannerWireSchemaError(`plan.steps[${index}] invalid`);
    }
    if (
      typeof entry.tool.server !== "string" ||
      typeof entry.tool.name !== "string"
    )
      throw new PlannerWireSchemaError(`plan.steps[${index}].tool invalid`);
    const step: Record<string, unknown> = {
      id: entry.id,
      description: entry.description,
      tool: {
        server: entry.tool.server,
        name: entry.tool.name,
        args: decodeValue(entry.tool.args, `plan.steps[${index}].tool.args`),
      },
      side_effect: entry.side_effect,
    };
    if (entry.depends_on_present) step.depends_on = entry.depends_on;
    if (entry.condition_present) step.condition = entry.condition;
    if (entry.idempotency_key_present)
      step.idempotency_key = entry.idempotency_key;
    if (entry.on_error_present) step.on_error = entry.on_error;
    return step;
  });
  return PlannerResultSchema.parse({
    kind: "plan",
    plan: {
      version: wirePlan.version,
      name: wirePlan.name,
      source_prompt: wirePlan.source_prompt,
      ...(inputs === undefined ? {} : { inputs }),
      steps,
      ...(wirePlan.outputs_present
        ? { outputs: decodeStringMap(wirePlan.outputs, "plan.outputs") }
        : {}),
    },
  });
}

const wireValueSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "string_value",
    "number_value",
    "boolean_value",
    "array_value",
    "object_entries",
  ],
  properties: {
    kind: {
      type: "string",
      enum: ["null", "string", "number", "boolean", "array", "object"],
    },
    string_value: { type: ["string", "null"] },
    number_value: { type: ["number", "null"] },
    boolean_value: { type: ["boolean", "null"] },
    array_value: {
      type: ["array", "null"],
      items: { $ref: "#/$defs/wireValue" },
    },
    object_entries: {
      type: ["array", "null"],
      items: { $ref: "#/$defs/wireEntry" },
    },
  },
};

const wireEntrySchema = {
  type: "object",
  additionalProperties: false,
  required: ["key", "value"],
  properties: { key: { type: "string" }, value: { $ref: "#/$defs/wireValue" } },
};

const wireInputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "key",
    "type",
    "description",
    "description_present",
    "required",
    "default_value",
    "default_present",
  ],
  properties: {
    key: { type: "string" },
    type: { type: "string", enum: ["string", "number", "boolean"] },
    description: { type: ["string", "null"] },
    description_present: { type: "boolean" },
    required: { type: "boolean" },
    default_value: { type: ["object", "null"], $ref: "#/$defs/wireValue" },
    default_present: { type: "boolean" },
  },
};

const wireStepSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "description",
    "tool",
    "depends_on",
    "depends_on_present",
    "condition",
    "condition_present",
    "idempotency_key",
    "idempotency_key_present",
    "side_effect",
    "on_error",
    "on_error_present",
  ],
  properties: {
    id: { type: "string" },
    description: { type: "string" },
    tool: {
      type: "object",
      additionalProperties: false,
      required: ["server", "name", "args"],
      properties: {
        server: { type: "string" },
        name: { type: "string" },
        args: { $ref: "#/$defs/wireValue" },
      },
    },
    depends_on: { type: ["array", "null"], items: { type: "string" } },
    depends_on_present: { type: "boolean" },
    condition: { type: ["string", "null"] },
    condition_present: { type: "boolean" },
    idempotency_key: { type: ["string", "null"] },
    idempotency_key_present: { type: "boolean" },
    side_effect: { type: "string", enum: ["read", "write"] },
    on_error: {
      type: ["string", "null"],
      enum: ["fail", "continue", "replan", null],
    },
    on_error_present: { type: "boolean" },
  },
};

const wirePlanSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "version",
    "name",
    "source_prompt",
    "inputs",
    "inputs_present",
    "steps",
    "outputs",
    "outputs_present",
  ],
  properties: {
    version: { type: "string", enum: ["1.0"] },
    name: { type: "string" },
    source_prompt: { type: "string" },
    inputs: { type: ["array", "null"], items: { $ref: "#/$defs/wireInput" } },
    inputs_present: { type: "boolean" },
    steps: { type: "array", items: { $ref: "#/$defs/wireStep" } },
    outputs: {
      type: ["array", "null"],
      items: { $ref: "#/$defs/wireEntryString" },
    },
    outputs_present: { type: "boolean" },
  },
};

const plannerResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "plan", "refusal", "clarification"],
  properties: {
    kind: { type: "string", enum: ["plan", "refusal", "clarification"] },
    plan: { type: ["object", "null"], $ref: "#/$defs/wirePlan" },
    refusal: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["reason"],
      properties: { reason: { type: "string" } },
    },
    clarification: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["question"],
      properties: { question: { type: "string" } },
    },
  },
} as const;

const plannerWireSchema = {
  type: "object",
  additionalProperties: false,
  required: ["result"],
  properties: {
    result: { $ref: "#/$defs/plannerResult" },
  },
  $defs: {
    plannerResult: plannerResultSchema,
    wireValue: wireValueSchema,
    wireEntry: wireEntrySchema,
    wireEntryString: {
      type: "object",
      additionalProperties: false,
      required: ["key", "value"],
      properties: { key: { type: "string" }, value: { type: "string" } },
    },
    wireInput: wireInputSchema,
    wireStep: wireStepSchema,
    wirePlan: wirePlanSchema,
  },
} as const;

export const openAiPlannerWireJsonSchema = plannerWireSchema;

function createGooglePlannerWireJsonSchema(): typeof plannerWireSchema {
  const schema = JSON.parse(
    JSON.stringify(plannerWireSchema),
  ) as typeof plannerWireSchema & {
    $defs: {
      wireValue: {
        required: string[];
      };
    };
  };
  // Google's interactions schema validator rejects self-referential / recursive fields in
  // "required" arrays because it treats them as non-terminating grammar recursion.
  schema.$defs.wireValue.required = schema.$defs.wireValue.required.filter(
    (field) => field !== "array_value" && field !== "object_entries",
  );
  return schema;
}

export const googlePlannerWireJsonSchema = createGooglePlannerWireJsonSchema();
