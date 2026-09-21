import http from "node:http";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { migrate } from "@wap/db";

const root = fileURLToPath(new URL("..", import.meta.url));
const requireWeb = createRequire(path.join(root, "apps/web/package.json"));
const { chromium } = requireWeb("@playwright/test");
const cache = path.join(root, ".cache/keycloak-local");
const webOrigin = "http://127.0.0.1:5173";
const assert = (condition, code) => {
  if (!condition) throw new Error(code);
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evidence = {
  schema: "ati-keycloak-local-e2e-1",
  provider: "keycloak-local",
  status: "FAIL",
  production_acceptance: "NOT_RUN",
  secrets_in_manifest: false,
  execution_surface: {
    provider_login: "headless_chromium_authorization_code_pkce",
    api_callback: "browser_navigation_with_injected_transaction_cookies",
    full_browser_cookie_policy: "PARTIAL_TRANSACTION_COOKIES_INJECTED",
    provider_sso_logout: "NOT_VERIFIED",
  },
  acceptance: {},
  cleanup: {},
};
let phase = "configuration",
  config,
  admin,
  databaseName,
  browser,
  api;
let clientUrl,
  previousRedirects,
  callbackUri,
  apiOutput = "",
  adminToken;
let redirectsChanged = false;
const secrets = [];

async function request(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
}
async function adminRequest(url, options = {}) {
  const send = () =>
    request(url, {
      ...options,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminToken}`,
        ...options.headers,
      },
    });
  const response = await send();
  if (response.status !== 401) return response;
  await authenticateAdmin();
  return send();
}
async function authenticateAdmin() {
  const response = await request(
    "http://127.0.0.1:18080/realms/master/protocol/openid-connect/token",
    {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "admin-cli",
        username: config.adminUsername,
        password: config.adminPassword,
      }),
    },
  );
  assert(response.ok, "ADMIN_AUTH_FAILED");
  adminToken = (await response.json()).access_token;
  assert(adminToken, "ADMIN_TOKEN_MISSING");
  secrets.push(adminToken);
}
async function freePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
function cookies(response) {
  return Object.fromEntries(
    response.headers.getSetCookie().map((value) => {
      const pair = value.split(";")[0],
        separator = pair.indexOf("=");
      return [pair.slice(0, separator), pair.slice(separator + 1)];
    }),
  );
}
async function stopApi() {
  if (!api || api.exitCode !== null || api.signalCode !== null) return;
  const child = api;
  child.kill("SIGTERM");
  for (
    let i = 0;
    i < 40 && child.exitCode === null && child.signalCode === null;
    i++
  )
    await pause(250);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    for (
      let i = 0;
      i < 20 && child.exitCode === null && child.signalCode === null;
      i++
    )
      await pause(250);
  }
  assert(
    child.exitCode !== null || child.signalCode !== null,
    "API_STOP_FAILED",
  );
}
async function ready(apiBase) {
  for (let i = 0; i < 120; i++) {
    assert(api.exitCode === null, "API_EXITED");
    try {
      if ((await request(`${apiBase}/health/ready`)).status === 200) return;
    } catch {
      /* starting */
    }
    await pause(250);
  }
  throw new Error("API_NOT_READY");
}
async function login(apiBase, user) {
  phase = "login_start";
  const start = await request(`${apiBase}/auth/oidc/start?return_to=%2F`, {
    redirect: "manual",
    headers: { origin: webOrigin },
  });
  assert(start.status === 302, "START_FAILED");
  const tx = cookies(start);
  assert(tx.wap_oidc_tx && tx.wap_csrf, "TRANSACTION_COOKIES_MISSING");
  const authorization = new URL(start.headers.get("location"));
  assert(
    authorization.origin === new URL(config.issuer).origin,
    "UNEXPECTED_AUTHORIZATION_ORIGIN",
  );
  assert(
    authorization.searchParams.get("code_challenge_method") === "S256" &&
      authorization.searchParams.get("code_challenge"),
    "PKCE_MISSING",
  );
  const context = await browser.newContext();
  try {
    await context.addCookies(
      Object.entries(tx).map(([name, value]) => ({
        name,
        value,
        url: apiBase,
        sameSite: "Lax",
        httpOnly: name === "wap_oidc_tx",
      })),
    );
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    phase = "provider_page_navigation";
    await page.goto(authorization.href);
    phase = "provider_credentials_form";
    await page.locator('input[name="username"]').fill(user.username);
    await page.locator('input[name="password"]').fill(user.password);
    phase = "provider_submit_callback";
    const [callback] = await Promise.all([
      page.waitForResponse((response) =>
        response.url().startsWith(callbackUri),
      ),
      page
        .locator('input[type="submit"], button[type="submit"]')
        .first()
        .click(),
    ]);
    phase = "api_callback_exchange";
    assert(callback.status() === 302, "CALLBACK_FAILED");
    const session = (await context.cookies(apiBase)).find(
      (cookie) => cookie.name === "wap_session",
    )?.value;
    assert(session, "SESSION_MISSING");
    secrets.push(session, tx.wap_oidc_tx, tx.wap_csrf);
    const headers = { origin: webOrigin, cookie: `wap_session=${session}` };
    phase = "identity_response";
    const me = await request(`${apiBase}/auth/me`, { headers });
    assert(me.status === 200, "IDENTITY_FAILED");
    const identity = await me.json();
    assert(identity.email === user.email, "IDENTITY_MISMATCH");
    return { headers, session, csrf: tx.wap_csrf, identity };
  } finally {
    await context.close();
  }
}

try {
  config = JSON.parse(readFileSync(path.join(cache, "runtime.json"), "utf8"));
  assert(
    config.issuer === "http://127.0.0.1:18080/realms/ati-local" &&
      config.clientId === "ati-web",
    "LOCAL_CONFIG_REQUIRED",
  );
  assert(
    config.users?.length === 2 &&
      config.users.every((u) => u.username && u.password && u.email),
    "TWO_USERS_REQUIRED",
  );
  secrets.push(
    config.clientSecret,
    config.adminPassword,
    ...config.users.map((u) => u.password),
  );
  phase = "admin_client_configuration";
  // The admin-cli management token is separate from application sign-in. ATI's
  // confidential client never uses or enables direct access grants.
  await authenticateAdmin();
  const clients = await adminRequest(
    `http://127.0.0.1:18080/admin/realms/ati-local/clients?clientId=${encodeURIComponent(config.clientId)}`,
  );
  assert(clients.ok, "CLIENT_LOOKUP_FAILED");
  const matches = await clients.json();
  assert(
    matches.length === 1 && matches[0].directAccessGrantsEnabled === false,
    "CLIENT_AUTH_FLOW_INVALID",
  );
  clientUrl = `http://127.0.0.1:18080/admin/realms/ati-local/clients/${matches[0].id}`;
  previousRedirects = matches[0].redirectUris ?? [];
  const port = await freePort(),
    apiBase = `http://127.0.0.1:${port}/api/v1`;
  callbackUri = `${apiBase}/auth/oidc/callback`;
  redirectsChanged = true;
  assert(
    (
      await adminRequest(clientUrl, {
        method: "PUT",
        body: JSON.stringify({
          redirectUris: [...new Set([...previousRedirects, callbackUri])],
        }),
      })
    ).ok,
    "CALLBACK_REGISTRATION_FAILED",
  );
  phase = "isolated_database";
  const adminUrl =
    process.env.OIDC_E2E_ADMIN_URL ??
    "postgresql://wap:wap@127.0.0.1:55532/wap_g1";
  admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  databaseName = `oidc_kc_${randomUUID().replaceAll("-", "")}`;
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${databaseName}`;
  await migrate(databaseUrl.href);
  const passwordHash =
    "scrypt$16384$8$1$00000000000000000000000000000000$" + "0".repeat(128);
  const env = {
    ...process.env,
    G1_DATABASE_URL: databaseUrl.href,
    API_PORT: String(port),
    API_DEMO_EMAIL: "demo@local.invalid",
    API_DEMO_PASSWORD_HASH: passwordHash,
    API_CURSOR_KEY: randomBytes(32).toString("base64"),
    WAP_PLANNER_MODE: "dev_fixture",
    API_NEW_RUNS_ENABLED: "1",
    AI_PROVIDER_CALLS_ENABLED: "0",
    G1_FILESYSTEM_ENABLED: "0",
    API_LEGACY_PASSWORD_AUTH_ENABLED: "0",
    OIDC_ENABLED: "1",
    OIDC_ISSUER_URL: config.issuer,
    OIDC_CLIENT_ID: config.clientId,
    OIDC_CLIENT_SECRET: config.clientSecret,
    OIDC_REDIRECT_URI: callbackUri,
    OIDC_AUDIENCE: "wap-api",
    OIDC_SCOPES: "openid,profile,email",
    OIDC_WEB_ORIGIN: webOrigin,
    OIDC_SESSION_COOKIE_NAME: "wap_session",
    OIDC_TRANSACTION_TTL_MS: "600000",
    OIDC_SESSION_TTL_MS: "3600000",
    OIDC_CLOCK_SKEW_SECONDS: "60",
  };
  secrets.push(passwordHash, env.API_CURSOR_KEY);
  const startApi = () => {
    api = spawn(process.execPath, [path.join(root, "apps/api/dist/main.js")], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    api.on("error", () => {
      apiOutput += "API_SPAWN_ERROR";
    });
    api.stdout.on("data", (chunk) => {
      apiOutput += chunk;
    });
    api.stderr.on("data", (chunk) => {
      apiOutput += chunk;
    });
  };
  phase = "browser_launch";
  browser = await chromium.launch({ headless: true });
  phase = "api_startup";
  startApi();
  await ready(apiBase);
  const alice = await login(apiBase, config.users[0]),
    bob = await login(apiBase, config.users[1]);
  assert(
    alice.identity.id !== bob.identity.id ||
      alice.identity.email !== bob.identity.email,
    "IDENTITIES_NOT_DISTINCT",
  );
  evidence.acceptance.browser_authorization_code_pkce = "PASS";
  evidence.acceptance.two_distinct_identities = "PASS";
  phase = "restart_session";
  await stopApi();
  startApi();
  await ready(apiBase);
  const restart = await request(`${apiBase}/auth/me`, { headers: bob.headers });
  assert(restart.status === 200, "RESTART_SESSION_FAILED");
  evidence.acceptance.restart_session = "PASS";
  phase = "owner_isolation";
  const created = await request(`${apiBase}/runs`, {
    method: "POST",
    headers: { ...alice.headers, "content-type": "application/json" },
    body: JSON.stringify({
      source_prompt: "Chép nguyên các dòng Progress!A1:B2",
      inputs: {},
      time_zone: "Asia/Ho_Chi_Minh",
    }),
  });
  assert(created.status === 202, "CREATE_RUN_FAILED");
  const run = await created.json();
  assert(run.run_id, "RUN_ID_MISSING");
  const own = await request(`${apiBase}/runs/${run.run_id}`, {
    headers: alice.headers,
  });
  const cross = await request(`${apiBase}/runs/${run.run_id}`, {
    headers: bob.headers,
  });
  assert(own.status === 200 && cross.status === 404, "OWNER_ISOLATION_FAILED");
  evidence.acceptance.owner_isolation = "PASS";
  phase = "logout_revocation";
  const logout = await request(`${apiBase}/auth/logout`, {
    method: "POST",
    headers: {
      ...alice.headers,
      cookie: `wap_session=${alice.session}; wap_csrf=${alice.csrf}`,
      "x-csrf-token": alice.csrf,
    },
  });
  const revoked = await request(`${apiBase}/auth/me`, {
    headers: alice.headers,
  });
  assert(
    logout.status === 204 && revoked.status === 401,
    "LOGOUT_REVOCATION_FAILED",
  );
  evidence.acceptance.application_logout_revocation = "PASS";
  evidence.status = "PASS";
} catch (error) {
  evidence.failure_phase = phase;
  evidence.failure_code = /^[A-Z][A-Z_]{2,70}$/.test(error?.message ?? "")
    ? error.message
    : error?.name === "TimeoutError"
      ? "OPERATION_TIMEOUT"
      : "OPERATION_FAILED";
  // Never serialize provider, database, browser, token, or child-process errors.
} finally {
  for (const [name, cleanup] of [
    ["api", stopApi],
    [
      "browser",
      async () => {
        if (browser) await browser.close();
      },
    ],
    [
      "database",
      async () => {
        if (admin && databaseName) {
          await admin.unsafe(
            `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
          );
          const rows =
            await admin`SELECT datname FROM pg_database WHERE datname = ${databaseName}`;
          assert(rows.length === 0, "DATABASE_REMAINS");
        }
      },
    ],
    [
      "admin_connection",
      async () => {
        if (admin) await admin.end({ timeout: 5 });
      },
    ],
    [
      "client_redirects",
      async () => {
        if (redirectsChanged) {
          assert(
            (
              await adminRequest(clientUrl, {
                method: "PUT",
                body: JSON.stringify({ redirectUris: previousRedirects }),
              })
            ).ok,
            "REDIRECT_RESTORE_FAILED",
          );
          const readback = await adminRequest(clientUrl);
          assert(readback.ok, "REDIRECT_VERIFY_FAILED");
          assert(
            JSON.stringify((await readback.json()).redirectUris) ===
              JSON.stringify(previousRedirects),
            "REDIRECT_RESTORE_MISMATCH",
          );
        }
      },
    ],
  ]) {
    try {
      await cleanup();
      evidence.cleanup[name] = "PASS";
    } catch {
      evidence.cleanup[name] = "FAIL";
      evidence.status = "FAIL";
    }
  }
  if (
    secrets.some(
      (secret) =>
        typeof secret === "string" &&
        secret.length > 0 &&
        apiOutput.includes(secret),
    )
  ) {
    evidence.status = "FAIL";
    evidence.failure_phase = "api_secret_leak";
  }
  evidence.created_at = new Date().toISOString();
  evidence.commit =
    spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    }).stdout?.trim() || "unknown";
  evidence.worktree_dirty = Boolean(
    spawnSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    }).stdout?.trim(),
  );
  evidence.source_sha256 = Object.fromEntries(
    ["scripts/oidc-keycloak-e2e.mjs", "apps/api/dist/main.js"].map((file) => {
      try {
        return [
          file,
          createHash("sha256")
            .update(readFileSync(path.join(root, file)))
            .digest("hex"),
        ];
      } catch {
        return [file, "UNAVAILABLE"];
      }
    }),
  );
  mkdirSync(cache, { recursive: true });
  writeFileSync(
    path.join(cache, "evidence.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.status !== "PASS") process.exitCode = 1;
}
