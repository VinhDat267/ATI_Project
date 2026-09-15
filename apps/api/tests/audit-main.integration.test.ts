import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { expect, it } from "vitest";
import { makeApiFixture } from "./fixture.js";

it("boots the production HTTP entry point with unavailable MCP and settles an accepted job without losing reads", async () => {
  const f = await makeApiFixture({ plannerMode: "dev_fixture" });
  await f.api.close();
  const root = path.resolve(
    fileURLToPath(new URL("../../../", import.meta.url)),
  );
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "apps/api/src/main.ts"],
    {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "test",
        G1_DATABASE_URL: f.databaseUrl,
        G1_USER_ID: f.userId,
        API_DEMO_EMAIL: f.email,
        API_DEMO_PASSWORD_HASH: f.config.passwordHash,
        API_CURSOR_KEY: f.config.cursorKey.toString("base64"),
        API_PORT: "0",
        API_PLANNER_MODE: "dev_fixture",
        G1_FILESYSTEM_ENABLED: "invalid-test-setting",
      },
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  try {
    let base = "";
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !base) {
      for (const line of stdout.split("\n")) {
        try {
          const event = JSON.parse(line);
          if (event.event === "api_listening") base = event.url;
        } catch {}
      }
      if (child.exitCode !== null)
        throw new Error("Production entry point exited before listening");
      if (!base) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(base).toMatch(/^http:\/\/127\.0\.0\.1:/);
    const login = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: f.email, password: f.password }),
    });
    expect(login.status).toBe(200);
    const { token } = (await login.json()) as { token: string };
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    const created = await fetch(`${base}/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ source_prompt: f.b02Prompt }),
    });
    expect(created.status).toBe(202);
    const { run_id } = (await created.json()) as { run_id: string };
    let status = "";
    while (Date.now() < deadline && status !== "failed") {
      const detail = await fetch(`${base}/runs/${run_id}`, { headers });
      expect(detail.status).toBe(200);
      status = ((await detail.json()) as { status: string }).status;
      if (status !== "failed")
        await new Promise((resolve) => setTimeout(resolve, 30));
    }
    expect(status).toBe("failed");
    expect((await fetch(`${base}/runs`, { headers })).status).toBe(200);
    const events = await fetch(`${base}/runs/${run_id}/events`, { headers });
    expect(
      ((await events.json()) as { events: Array<{ type: string }> }).events.at(
        -1,
      )?.type,
    ).toBe("run.finished");
    expect(
      await f.db.client`SELECT count(*)::int AS n FROM hub_receipts`,
    ).toEqual([{ n: 0 }]);
    expect(stdout + stderr).not.toContain(f.config.passwordHash);
    expect(stdout + stderr).not.toContain(f.databaseUrl);
  } finally {
    if (child.exitCode === null) child.kill();
    await closed;
    await f.close();
  }
}, 30000);
