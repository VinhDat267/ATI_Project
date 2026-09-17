import { describe, expect, it } from "vitest";
import {
  CatalogValidationError,
  createReviewedCatalogSnapshot,
  toolContentHash,
} from "../src/ai/catalog.js";
import { makeTool } from "./ai-fixtures.js";

describe("reviewed AI catalog snapshot", () => {
  it("clones and deeply freezes reviewed tools while keeping a stable hash", () => {
    const inputSchema = {
      type: "object",
      properties: { board: { type: "string" } },
    };
    const input = makeTool({ inputSchema });
    const snapshot = createReviewedCatalogSnapshot([input]);

    input.description = "mutated after construction";
    inputSchema.properties = { board: { type: "number" } };

    expect(snapshot.tools[0]?.description).toBe(
      "List cards from the local board.",
    );
    expect(snapshot.tools[0]?.inputSchema.properties).toEqual({
      board: { type: "string" },
    });
    expect(Object.isFrozen(snapshot.tools)).toBe(true);
    expect(Object.isFrozen(snapshot.tools[0])).toBe(true);
    expect(Object.isFrozen(snapshot.tools[0]?.inputSchema)).toBe(true);
    expect(snapshot.catalogHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hashes the same catalog regardless of tool or object-key order", () => {
    const first = createReviewedCatalogSnapshot([
      makeTool({ name: "z_tool", inputSchema: { b: 2, a: 1 } }),
      makeTool({ name: "a_tool", inputSchema: { a: 1, b: 2 } }),
    ]);
    const second = createReviewedCatalogSnapshot([
      makeTool({ name: "a_tool", inputSchema: { b: 2, a: 1 } }),
      makeTool({ name: "z_tool", inputSchema: { a: 1, b: 2 } }),
    ]);

    expect(first.catalogHash).toBe(second.catalogHash);
  });

  it("changes the hash when description, schema, policy, or artifact changes", () => {
    const baseline = createReviewedCatalogSnapshot([makeTool()]).catalogHash;
    const changes = [
      { description: "A different description" },
      {
        inputSchema: { type: "object", properties: { q: { type: "string" } } },
      },
      { policyVersion: "b-local-2" },
      { artifactHash: "b".repeat(64) },
    ];

    for (const change of changes) {
      expect(
        createReviewedCatalogSnapshot([makeTool(change)]).catalogHash,
      ).not.toBe(baseline);
    }
  });

  it("rejects malformed tools, missing policy, duplicate identities, and more than ten tools", () => {
    expect(() =>
      createReviewedCatalogSnapshot([makeTool({ name: "" })]),
    ).toThrow(CatalogValidationError);
    expect(() =>
      createReviewedCatalogSnapshot([makeTool({ policyVersion: "" })]),
    ).toThrow(CatalogValidationError);
    expect(() =>
      createReviewedCatalogSnapshot([makeTool(), makeTool()]),
    ).toThrow(/duplicate/i);
    expect(() =>
      createReviewedCatalogSnapshot(
        Array.from({ length: 11 }, (_, i) => makeTool({ name: `tool_${i}` })),
      ),
    ).toThrow(/10/);
    const { policyVersion: _policyVersion, ...withoutPolicy } = makeTool();
    expect(() =>
      createReviewedCatalogSnapshot([withoutPolicy as never]),
    ).toThrow(CatalogValidationError);
    const { description: _description, ...withoutDescription } = makeTool();
    expect(() =>
      createReviewedCatalogSnapshot([withoutDescription as never]),
    ).toThrow(CatalogValidationError);
  });

  it("exposes content hashes derived from the complete reviewed tool", () => {
    const tool = makeTool();
    expect(toolContentHash(tool)).toMatch(/^[a-f0-9]{64}$/);
    expect(toolContentHash({ ...tool, description: "changed" })).not.toBe(
      toolContentHash(tool),
    );
  });
});
