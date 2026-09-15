import { describe, expect, it } from "vitest";
import { safeProject } from "../src/redaction.js";

describe("safeProject schema context", () => {
  it("redacts sensitive keys below arbitrary properties and definitions maps", () => {
    const projected = safeProject({
      result: {
        properties: {
          password: "SYNTHETIC_PAYLOAD_VALUE",
          visible: "kept",
        },
        definitions: {
          secret: "SYNTHETIC_DEFINITION_VALUE",
        },
        input_schema: {
          properties: {
            token: "SYNTHETIC_IMPERSONATED_SCHEMA_VALUE",
          },
        },
      },
    });

    expect(projected).toEqual({
      result: {
        properties: {
          password: "[REDACTED]",
          visible: "kept",
        },
        definitions: {
          secret: "[REDACTED]",
        },
        input_schema: {
          properties: {
            token: "[REDACTED]",
          },
        },
      },
    });
  });

  it("preserves nested definitions and required names only at known schema projection paths", () => {
    const schema = {
      type: "object",
      required: ["password"],
      properties: {
        password: { type: "string" },
        nested: { $ref: "#/$defs/secret" },
      },
      $defs: {
        secret: {
          type: "object",
          properties: {
            authorization: { type: "string" },
          },
        },
      },
      definitions: {
        password: {
          type: "object",
          properties: {
            token: { type: "string" },
          },
        },
      },
    };
    const source = {
      tools: [{ inputSchema: schema, outputSchema: schema }],
      attempts: [
        {
          tool_snapshot: {
            input_schema: schema,
            output_schema: schema,
          },
        },
      ],
    };

    expect(safeProject(source)).toEqual(source);
  });

  it("preserves trace schema context when the projected attempts array is the root", () => {
    const source = [
      {
        tool_snapshot: {
          input_schema: {
            type: "object",
            required: ["password"],
            properties: { password: { type: "string" } },
          },
        },
      },
    ];

    expect(safeProject(source)).toEqual(source);
  });
});
