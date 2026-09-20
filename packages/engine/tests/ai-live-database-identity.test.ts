import { describe, expect, it, vi } from "vitest";
import {
  parseEvaluationDatabaseIdentity,
  sameEvaluationDatabase,
  assertEvaluationDatabaseIsolation,
  verifyConnectedEvaluationDatabaseIdentity,
} from "../src/ai/live-evaluation/database-identity.js";
import type { Database } from "@wap/db";

describe("ai-live database identity and isolation", () => {
  it("parses valid postgres URLs and normalizes loopback addresses including IPv6", () => {
    const id1 = parseEvaluationDatabaseIdentity("postgresql://user:pass@localhost:5432/eval_db");
    const id2 = parseEvaluationDatabaseIdentity("postgres://user:pass@127.0.0.1:5432/eval_db");
    const id3 = parseEvaluationDatabaseIdentity("postgresql://user:pass@[::1]:5432/eval_db");

    expect(id1.host).toBe("loopback");
    expect(id2.host).toBe("loopback");
    expect(id3.host).toBe("loopback");
    expect(id1.database).toBe("eval_db");
    expect(id1.port).toBe("5432");

    expect(sameEvaluationDatabase(id1, id2)).toBe(true);
    expect(sameEvaluationDatabase(id1, id3)).toBe(true);
  });

  it("rejects non-postgres protocols or missing database names", () => {
    expect(() => parseEvaluationDatabaseIdentity("mysql://localhost:3306/db")).toThrow(/must use PostgreSQL/);
    expect(() => parseEvaluationDatabaseIdentity("postgresql://localhost:5432/")).toThrow(/must include a database name/);
    expect(() => parseEvaluationDatabaseIdentity("   ")).toThrow(/is required/);
  });

  it("enforces isolation between evaluation and application database URLs", () => {
    expect(() =>
      assertEvaluationDatabaseIsolation(
        "postgresql://localhost:5432/wap_g1",
        "postgresql://127.0.0.1:5432/wap_g1",
      ),
    ).toThrow(/must target a different database/);

    expect(() =>
      assertEvaluationDatabaseIsolation(
        "postgresql://localhost:5432/wap_eval",
        "postgresql://localhost:5432/wap_g1",
      ),
    ).not.toThrow();
  });

  it("verifies connected database identity from client query", async () => {
    const mockDb = {
      client: (async () => [{ current_database: "wap_eval", current_user: "wap" }]) as any,
    } as Database;

    const evalIdentity = parseEvaluationDatabaseIdentity("postgresql://localhost:5432/wap_eval");
    const appIdentity = parseEvaluationDatabaseIdentity("postgresql://localhost:5432/wap_g1", "DATABASE_URL");

    const result = await verifyConnectedEvaluationDatabaseIdentity(mockDb, evalIdentity, appIdentity);
    expect(result.currentDatabase).toBe("wap_eval");
    expect(result.currentUser).toBe("wap");
  });

  it("rejects connected database when query returns unexpected database name", async () => {
    const mockDb = {
      client: (async () => [{ current_database: "wap_g1", current_user: "wap" }]) as any,
    } as Database;

    const evalIdentity = parseEvaluationDatabaseIdentity("postgresql://localhost:5432/wap_eval");
    const appIdentity = parseEvaluationDatabaseIdentity("postgresql://localhost:5432/wap_g1", "DATABASE_URL");

    await expect(
      verifyConnectedEvaluationDatabaseIdentity(mockDb, evalIdentity, appIdentity),
    ).rejects.toThrow(/Connected database mismatch/);
  });
});
