import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => {
  const state = {
    stage: 0, failAt: 0, failPhase: "" as "" | "marker" | "migrate" | "schema" | "seed" | "grant",
    queries: [] as string[], marker: null as null | Record<string, string>,
    migrate: vi.fn(async () => undefined),
  };
  state.migrate.mockImplementation(async () => {
    if (state.failPhase === "migrate") throw new Error("Synthetic bootstrap failure");
  });
  return state;
});
vi.mock("@wap/db", () => ({ migrate: mock.migrate }));
vi.mock("postgres", () => ({ default: () => {
  const client = Object.assign(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    mock.queries.push(sql);
    if (sql.startsWith("INSERT INTO pilot_eval_bootstrap.marker"))
      mock.marker = { measurement_id: values[0] as string, schema_version: values[1] as string,
        nonce_hash: values[2] as string, database_name: values[3] as string,
        runtime_role: values[4] as string };
    if (sql.startsWith("SELECT measurement_id,schema_version,nonce_hash,database_name,runtime_role") &&
        mock.marker && mock.failPhase !== "marker")
      return [{ ...mock.marker, actual_database: mock.marker.database_name }];
    if (mock.failPhase === "seed" && sql.startsWith("INSERT INTO users"))
      throw new Error("Synthetic bootstrap failure");
    return [];
  }, {
    json: (value: unknown) => value,
    unsafe: async (sql: string) => {
      mock.queries.push(sql);
      if (sql.startsWith("CREATE DATABASE") || sql.startsWith("CREATE ROLE")) {
        mock.stage++;
        if (mock.stage === mock.failAt) throw new Error("Synthetic bootstrap failure");
      }
      if ((mock.failPhase === "schema" && sql.startsWith("\nCREATE SCHEMA pilot_eval;")) ||
          (mock.failPhase === "grant" && sql.startsWith("GRANT SELECT ON pilot_eval.campaigns")))
        throw new Error("Synthetic bootstrap failure");
      return [];
    },
    end: async () => undefined,
  });
  return client;
} }));

import { provisionOfflineCampaign } from "../src/pilot-evaluation/provision.js";
import { syntheticManifest } from "./helpers/pilot-evaluation-fixture.js";

const isolatedAdmin = "postgresql://fixture:fixture@127.0.0.1:55532/isolated-test-admin";

describe("bootstrap cleanup receipt stages (mocked SQL fault only, no real PG write)", () => {
  beforeEach(() => {
    mock.stage = 0; mock.failAt = 0; mock.failPhase = ""; mock.marker = null;
    mock.queries.length = 0; mock.migrate.mockClear();
  });

  it.each([1, 2, 3] as const)("never drops uncreated resources after create stage %i fails", async (stage) => {
    mock.failAt = stage;
    await expect(provisionOfflineCampaign(isolatedAdmin, syntheticManifest())).rejects.toThrow("Synthetic bootstrap failure");
    expect(mock.queries.filter((sql) => sql.startsWith("CREATE DATABASE"))).toHaveLength(1);
    expect(mock.queries.filter((sql) => sql.startsWith("DROP DATABASE"))).toHaveLength(stage === 1 ? 0 : 1);
    expect(mock.queries.filter((sql) => sql.startsWith("DROP ROLE"))).toHaveLength(stage === 3 ? 1 : 0);
    expect(mock.queries.some((sql) => sql.includes("wap_g1"))).toBe(false);
  });

  it.each(["marker", "migrate", "schema", "seed", "grant"] as const)(
    "cleans only acknowledged DB and roles when %s stage fails", async (phase) => {
      mock.failPhase = phase;
      await expect(provisionOfflineCampaign(isolatedAdmin, syntheticManifest())).rejects.toThrow(
        phase === "marker" ? "marker mismatch" : "Synthetic bootstrap failure");
      expect(mock.queries.filter((sql) => sql.startsWith("DROP DATABASE"))).toHaveLength(1);
      expect(mock.queries.filter((sql) => sql.startsWith("DROP ROLE"))).toHaveLength(2);
      expect(mock.migrate).toHaveBeenCalledTimes(phase === "marker" ? 0 : 1);
      expect(mock.queries.some((sql) => sql.includes("wap_g1"))).toBe(false);
    },
  );
});
