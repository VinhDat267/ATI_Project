import { describe, expect, it } from "vitest";
import { ServerCatalogSchema } from "@wap/dsl";
import { makeApiFixture } from "./fixture.js";

describe("API-CATALOG live reviewed catalog", () => {
  it("publishes exactly 8 task_hub and 2 filesystem reviewed tools", async () => {
    const fixture = await makeApiFixture({
      workerEnabled: true,
      filesystemEnabled: true,
    });
    try {
      const token = await fixture.login();
      const response = await fixture.call("/servers/check", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          slug: "filesystem",
          executable: "must-not-be-used",
          args: ["--arbitrary-launch"],
        }),
      });
      expect(response.status).toBe(200);
      const catalog = ServerCatalogSchema.parse(await response.json());
      expect(catalog.map((entry) => entry.slug)).toEqual([
        "task_hub",
        "filesystem",
      ]);
      expect(catalog[0]?.status).toBe("connected");
      expect(catalog[1]?.status).toBe("connected");
      expect(catalog[0]?.tools).toHaveLength(8);
      expect(catalog[1]?.tools).toHaveLength(2);
      expect(catalog[0]?.tools.map((tool) => tool.policy_version)).toEqual([
        "b-local-1",
        "b-local-1",
        "b-local-1",
        "b-local-1",
        "b-local-1",
        "b-local-1",
        "b-local-1",
        "b-local-1",
      ]);
      expect(catalog[1]?.tools.map((tool) => tool.policy_version)).toEqual([
        "b-local-fs-1",
        "b-local-fs-1",
      ]);
      const raw = JSON.stringify(catalog);
      expect(raw).not.toContain(fixture.config.passwordHash);
      expect(raw).not.toContain(fixture.databaseUrl);
      expect(raw).not.toContain("must-not-be-used");
      expect(raw).not.toContain("private");
      for (const entry of catalog)
        for (const tool of entry.tools) {
          expect(tool.server).toBe(entry.slug);
          expect(tool.artifact_hash).toMatch(/^[a-f0-9]{64}$/);
          expect(tool.input_schema).toBeTypeOf("object");
          expect(tool.output_schema).toBeTypeOf("object");
        }
    } finally {
      await fixture.close();
    }
  }, 60_000);
});
