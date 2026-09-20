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
    expect(config.allowNewRuns).toBe(true);
    expect(config.allowProviderCalls).toBe(true);
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
    expect(
      loadConfig({ ...env, API_PLANNER_MODE: "disabled" }).plannerMode,
    ).toBe("disabled");
    expect(
      loadConfig({ ...env, API_PLANNER_MODE: "dev_fixture" }).plannerMode,
    ).toBe("dev_fixture");
    expect(loadConfig({ ...env, API_PLANNER_MODE: "ai" }).plannerMode).toBe(
      "ai",
    );
    expect(loadConfig({ ...env, WAP_PLANNER_MODE: "ai" }).plannerMode).toBe(
      "ai",
    );
    expect(loadConfig(env).plannerMode).toBe("disabled");
    expect(() =>
      loadConfig({ ...env, API_PLANNER_MODE: "invalid_mode" }),
    ).toThrow(/Invalid configuration API_PLANNER_MODE/);
  });

  it("accepts an explicit AI retrieval variant and rejects unsupported values", async () => {
    const env = await baseEnv();
    expect(
      loadConfig({ ...env, AI_RETRIEVAL_VARIANT: "semantic" })
        .aiRetrievalVariant,
    ).toBe("semantic");
    expect(
      loadConfig({ ...env, AI_RETRIEVAL_VARIANT: "semantic_qe" })
        .aiRetrievalVariant,
    ).toBe("semantic_qe");
    expect(loadConfig(env).aiRetrievalVariant).toBe("all_tools");
    expect(() =>
      loadConfig({ ...env, AI_RETRIEVAL_VARIANT: "unsupported" }),
    ).toThrow(/Invalid configuration AI_RETRIEVAL_VARIANT/);
  });

  it("parses the production new-run kill switch without changing the default", async () => {
    const env = await baseEnv();
    expect(loadConfig({ ...env, API_NEW_RUNS_ENABLED: "0" }).allowNewRuns).toBe(
      false,
    );
    expect(
      loadConfig({ ...env, API_NEW_RUNS_ENABLED: "off" }).allowNewRuns,
    ).toBe(false);
    expect(
      loadConfig({ ...env, API_NEW_RUNS_ENABLED: "yes" }).allowNewRuns,
    ).toBe(true);
    expect(() => loadConfig({ ...env, API_NEW_RUNS_ENABLED: "maybe" })).toThrow(
      /Invalid boolean configuration API_NEW_RUNS_ENABLED/,
    );
  });

  it("parses the provider-call kill switch independently", async () => {
    const env = await baseEnv();
    expect(
      loadConfig({ ...env, AI_PROVIDER_CALLS_ENABLED: "0" }).allowProviderCalls,
    ).toBe(false);
    expect(
      loadConfig({ ...env, AI_PROVIDER_CALLS_ENABLED: "on" })
        .allowProviderCalls,
    ).toBe(true);
    expect(() =>
      loadConfig({ ...env, AI_PROVIDER_CALLS_ENABLED: "unknown" }),
    ).toThrow(/Invalid boolean configuration AI_PROVIDER_CALLS_ENABLED/);
  });

  it("parses the worker shutdown deadline with a bounded default", async () => {
    const env = await baseEnv();
    expect(loadConfig(env).workerShutdownTimeoutMs).toBe(30_000);
    expect(
      loadConfig({ ...env, API_WORKER_SHUTDOWN_TIMEOUT_MS: "1500" })
        .workerShutdownTimeoutMs,
    ).toBe(1500);
    expect(() =>
      loadConfig({ ...env, API_WORKER_SHUTDOWN_TIMEOUT_MS: "-1" }),
    ).toThrow(/Invalid integer configuration API_WORKER_SHUTDOWN_TIMEOUT_MS/);
  });

  it("keeps oidc disabled by default and parses the bounded provider configuration", async () => {
    const env = await baseEnv();
    expect(loadConfig(env).oidc!.enabled).toBe(false);
    expect(loadConfig(env).legacyPasswordAuthEnabled).toBe(true);
    const config = loadConfig({
      ...env,
      OIDC_ENABLED: "1",
      OIDC_ISSUER_URL: "http://127.0.0.1:8080/realms/wap",
      OIDC_CLIENT_ID: "wap-web",
      OIDC_CLIENT_SECRET: "client-secret",
      OIDC_REDIRECT_URI: "http://127.0.0.1:3001/api/v1/auth/oidc/callback",
      OIDC_AUDIENCE: "wap-api",
      OIDC_SCOPES: "openid,profile,email",
      OIDC_WEB_ORIGIN: "http://127.0.0.1:5173",
    });
    expect(config.oidc!).toMatchObject({
      enabled: true,
      issuerUrl: "http://127.0.0.1:8080/realms/wap",
      clientId: "wap-web",
      audience: "wap-api",
      scopes: ["openid", "profile", "email"],
    });
    expect(config.oidc!.clientSecret).toBe("client-secret");
    expect(config.legacyPasswordAuthEnabled).toBe(false);
  });

  it("rejects unsafe oidc scopes and production http issuers", async () => {
    const env = await baseEnv();
    const oidc = {
      OIDC_ENABLED: "1",
      OIDC_ISSUER_URL: "http://issuer.example.invalid",
      OIDC_CLIENT_ID: "wap-web",
      OIDC_CLIENT_SECRET: "client-secret",
      OIDC_REDIRECT_URI: "https://app.example.invalid/auth/callback",
      OIDC_AUDIENCE: "wap-api",
      OIDC_SCOPES: "openid,,email",
      OIDC_WEB_ORIGIN: "https://app.example.invalid",
    };
    expect(() => loadConfig({ ...env, ...oidc })).toThrow(/OIDC_SCOPES/);
    expect(() =>
      loadConfig({ ...env, ...oidc, OIDC_SCOPES: "openid,email" }),
    ).toThrow(/OIDC_ISSUER_URL/);
  });
});
