import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  stage: 0, failAt: 0, queries: [] as string[],
  migrate: vi.fn(),
}));
vi.mock("@wap/db", () => ({ migrate: mock.migrate }));
vi.mock("postgres", () => ({ default: () => {
  const client = Object.assign(async (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    mock.queries.push(sql);
    return [];
  }, {
    unsafe: async (sql: string) => {
      mock.queries.push(sql);
      if (sql.startsWith("CREATE DATABASE") || sql.startsWith("CREATE ROLE")) {
        mock.stage++;
        if (mock.stage === mock.failAt) throw new Error("Synthetic bootstrap failure");
      }
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
  beforeEach(() => { mock.stage = 0; mock.failAt = 0; mock.queries.length = 0; mock.migrate.mockClear(); });

  it.each([1, 2, 3] as const)("never drops uncreated resources after create stage %i fails", async (stage) => {
    mock.failAt = stage;
    await expect(provisionOfflineCampaign(isolatedAdmin, syntheticManifest())).rejects.toThrow("Synthetic bootstrap failure");
    expect(mock.queries.filter((sql) => sql.startsWith("CREATE DATABASE"))).toHaveLength(1);
    expect(mock.queries.filter((sql) => sql.startsWith("DROP DATABASE"))).toHaveLength(stage === 1 ? 0 : 1);
    expect(mock.queries.filter((sql) => sql.startsWith("DROP ROLE"))).toHaveLength(stage === 3 ? 1 : 0);
    expect(mock.queries.some((sql) => sql.includes("wap_g1"))).toBe(false);
  });

  it("cleans only its acknowledged DB and roles if bootstrap marker verification fails", async () => {
    await expect(provisionOfflineCampaign(isolatedAdmin, syntheticManifest())).rejects.toThrow("marker mismatch");
    expect(mock.queries.filter((sql) => sql.startsWith("DROP DATABASE"))).toHaveLength(1);
    expect(mock.queries.filter((sql) => sql.startsWith("DROP ROLE"))).toHaveLength(2);
    expect(mock.migrate).not.toHaveBeenCalled();
  });
});
