import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadDevPlanner } from "../src/dev-planner.js";

const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));

describe("dev fixture planner", () => {
  it("loads the three server-owned entries and only exact prompt matches", async () => {
    const planner = loadDevPlanner(root);
    expect(planner.mode).toBe("dev_fixture");
    expect(planner.entries.map((entry) => entry.id)).toEqual([
      "b02",
      "fs-copy-notify",
      "fs-card-export",
    ]);
    expect(
      (
        await planner.produce({
          runId: "00000000-0000-4000-8000-000000000001",
          userId: "00000000-0000-4000-8000-000000000001",
          request: {
            source_prompt: planner.b02Prompt,
            inputs: {},
            time_zone: "Asia/Ho_Chi_Minh",
          },
          runtime: {},
        })
      ).kind,
    ).toBe("plan");
    expect(
      (
        await planner.produce({
          runId: "00000000-0000-4000-8000-000000000001",
          userId: "00000000-0000-4000-8000-000000000001",
          request: {
            source_prompt: "gần giống b02",
            inputs: {},
            time_zone: "Asia/Ho_Chi_Minh",
          },
          runtime: {},
        })
      ).kind,
    ).toBe("clarification");
  });
});
