import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/auth.js";

const baseEnv = async () => ({
  API_DEMO_EMAIL: "demo@local",
  API_DEMO_PASSWORD_HASH: await hashPassword("correct horse battery staple"),
  API_CURSOR_KEY: Buffer.alloc(32, 7).toString("base64"),
});

describe("API configuration", () => {
  it("accepts the required local demo configuration", async () => {
    const config = loadConfig(await baseEnv());
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3001);
    expect(config.cursorKey).toHaveLength(32);
  });

  it("rejects missing secrets and non-canonical cursor keys", async () => {
    const env = await baseEnv();
    const { API_DEMO_EMAIL: _email, ...missing } = env;
    expect(() => loadConfig(missing)).toThrow(/API_DEMO_EMAIL/);
    expect(() => loadConfig({ ...env, API_CURSOR_KEY: "not-a-key" })).toThrow(
      /API_CURSOR_KEY/,
    );
  });

  it("accepts explicit planner modes and rejects invalid ones", async () => {
    const env = await baseEnv();
    expect(loadConfig({ ...env, API_PLANNER_MODE: "disabled" }).plannerMode).toBe("disabled");
    expect(loadConfig({ ...env, API_PLANNER_MODE: "dev_fixture" }).plannerMode).toBe("dev_fixture");
    expect(loadConfig({ ...env, API_PLANNER_MODE: "ai" }).plannerMode).toBe("ai");
    expect(loadConfig({ ...env, WAP_PLANNER_MODE: "ai" }).plannerMode).toBe("ai");
    expect(loadConfig(env).plannerMode).toBe("disabled");
    expect(() => loadConfig({ ...env, API_PLANNER_MODE: "invalid_mode" })).toThrow(
      /Invalid configuration API_PLANNER_MODE/,
    );
  });
});
