import { test, expect } from "./fixtures.js";
import {
  createLiveFixture,
  safeTeardown,
  assertDatabaseDropped,
  assertPortReleased,
} from "./cleanup.js";

test.describe("Live Fixture & Cleanup Harness", () => {
  test("liveContext fixture provisions isolated API and preview server with proxy", async ({
    liveContext,
  }) => {
    expect(liveContext.apiUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+(\/api\/v1)?$/);
    expect(liveContext.previewUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(liveContext.email).toBeTruthy();
    expect(liveContext.password).toBeTruthy();

    // Verify proxy connects to backend authentication and servers endpoints
    const loginRes = await fetch(`${liveContext.previewUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: new URL(liveContext.previewUrl).host,
      },
      body: JSON.stringify({
        email: liveContext.email,
        password: liveContext.password,
      }),
    });
    expect(loginRes.status).toBe(200);
    const loginData = await loginRes.json();
    expect(loginData.token).toBeTruthy();

    const serversRes = await fetch(`${liveContext.previewUrl}/api/v1/servers`, {
      headers: {
        authorization: `Bearer ${loginData.token}`,
        host: new URL(liveContext.previewUrl).host,
      },
    });
    expect(serversRes.status).toBe(200);
    const serversData = await serversRes.json();
    expect(Array.isArray(serversData)).toBe(true);
  });

  test("verified DB drop and port release upon teardown", async () => {
    const fixture = await createLiveFixture();
    const dbName = fixture.dbName;
    const apiPort = fixture.apiPort;
    const previewPort = fixture.previewPort;

    // Both ports should be actively listening
    expect(apiPort).toBeGreaterThan(0);
    expect(previewPort).toBeGreaterThan(0);

    // Teardown with guaranteed DB drop and port closure
    await safeTeardown(fixture);

    // Verify database is completely dropped
    const isDropped = await assertDatabaseDropped(dbName);
    expect(isDropped).toBe(true);

    // Verify ports are released
    const apiPortReleased = await assertPortReleased(apiPort);
    expect(apiPortReleased).toBe(true);

    const previewPortReleased = await assertPortReleased(previewPort);
    expect(previewPortReleased).toBe(true);
  });

  test("verified DB drop and API port release when preview setup fails", async () => {
    const fixtureModule = "../../../api/tests/fixture.js";
    const { makeApiFixture } = (await import(fixtureModule)) as {
      makeApiFixture: (options?: {
        workerEnabled?: boolean;
        plannerMode?: "disabled" | "dev_fixture" | "ai";
        filesystemEnabled?: boolean;
      }) => Promise<any>;
    };

    let capturedApi: any = null;
    let dbName = "";
    let apiPort = 0;

    try {
      await expect(
        createLiveFixture({
          makeApiFixture: async (opts) => {
            capturedApi = await makeApiFixture(opts);
            dbName = new URL(capturedApi.databaseUrl).pathname.slice(1);
            apiPort = Number(new URL(capturedApi.baseUrl).port);
            return capturedApi;
          },
          startPreview: async () => {
            throw new Error("Simulated Vite preview startup failure");
          },
        }),
      ).rejects.toThrow("Simulated Vite preview startup failure");

      expect(dbName).toBeTruthy();
      expect(apiPort).toBeGreaterThan(0);

      const isDropped = await assertDatabaseDropped(dbName);
      expect(isDropped).toBe(true);

      const isPortReleased = await assertPortReleased(apiPort);
      expect(isPortReleased).toBe(true);
    } finally {
      if (capturedApi) {
        try {
          await capturedApi.close();
        } catch {
          // ignore defensive cleanup errors
        }
      }
    }
  });
});
