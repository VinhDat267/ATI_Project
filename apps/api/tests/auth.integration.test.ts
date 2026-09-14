import { describe, expect, it } from "vitest";
import { makeApiFixture } from "./fixture.js";

describe("API-01 database-backed authentication", () => {
  it("authenticates the seeded demo principal over a real HTTP socket", async () => {
    const fixture = await makeApiFixture();
    try {
      const bad = await fixture.call("/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: fixture.email, password: "wrong" }),
      });
      expect(bad.status).toBe(401);

      const login = await fixture.call("/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: fixture.email,
          password: fixture.password,
        }),
      });
      expect(login.status).toBe(200);
      const { token } = (await login.json()) as { token: string };
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const servers = await fixture.call("/servers", {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(servers.status).toBe(200);
      expect(await servers.json()).toEqual([
        {
          slug: "task_hub",
          status: "disconnected",
          policy_version: "b-local-1",
        },
        {
          slug: "filesystem",
          status: "disconnected",
          policy_version: "b-local-fs-1",
        },
      ]);
    } finally {
      await fixture.close();
    }
  });
});
