import http from "node:http";
import https from "node:https";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { migrate } from "@wap/db";

const root = fileURLToPath(new URL("..", import.meta.url));
const webRoot = path.join(root, "apps/web");
const requireWeb = createRequire(path.join(webRoot, "package.json"));
const { chromium } = requireWeb("@playwright/test");
const viteBin = path.resolve(
  path.dirname(requireWeb.resolve("vite")),
  "../..",
  "bin/vite.js",
);
const cache = path.join(root, ".cache/keycloak-local");
const pfxPath = path.join(tmpdir(), `ati-https-e2e-${randomUUID()}.pfx`);

const assert = (condition, code) => {
  if (!condition) throw new Error(code);
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evidence = {
  schema: "ati-keycloak-https-e2e-1",
  provider: "keycloak-local",
  status: "FAIL",
  production_acceptance: "NOT_RUN",
  secrets_in_manifest: false,
  execution_surface: {
    ati_web_and_callback: "https_localhost_self_signed_certificate",
    browser_certificate_handling: "chromium_ignore_https_errors_local_test_only",
    provider_issuer: "http_loopback_keycloak_local",
    session_expiry: "short_lived_durable_session",
  },
  acceptance: {},
  cleanup: {},
};

let phase = "configuration";
let config;
let admin;
let databaseName;
let browser;
let api;
let web;
let proxy;
let adminToken;
let clientUrl;
let previousRedirects;
let previousWebOrigins;
let apiOutput = "";
let webOutput = "";
const pfxPassphrase = "changeit";
const secrets = [];

async function request(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
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
  let response = await send();
  if (response.status !== 401) return response;
  await authenticateAdmin();
  response = await send();
  return response;
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

async function stopProcess(child, code) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
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
    `${code}_STOP_FAILED`,
  );
}

async function closeServer(server, code) {
  if (!server || !server.listening) return;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  assert(!server.listening, `${code}_STOP_FAILED`);
}

async function ready(url, child, code) {
  for (let i = 0; i < 120; i++) {
    assert(child.exitCode === null, `${code}_EXITED`);
    try {
      if ((await request(url)).status === 200) return;
    } catch {
      // The isolated service is still starting.
    }
    await pause(250);
  }
  throw new Error(`${code}_NOT_READY`);
}

function captureOutput(child, update) {
  child.on("error", () => update("SPAWN_ERROR"));
  child.stdout.on("data", (chunk) => update(chunk.toString()));
  child.stderr.on("data", (chunk) => update(chunk.toString()));
}

function generateLocalCertificate() {
  mkdirSync(cache, { recursive: true });
  const result = spawnSync(
    "keytool",
    [
      "-genkeypair",
      "-alias",
      "ati-https-e2e",
      "-keyalg",
      "RSA",
      "-keysize",
      "2048",
      "-validity",
      "1",
      "-dname",
      "CN=localhost",
      "-ext",
      "SAN=dns:localhost",
      "-storetype",
      "PKCS12",
      "-keystore",
      pfxPath,
      "-storepass",
      pfxPassphrase,
      "-keypass",
      pfxPassphrase,
      "-noprompt",
    ],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  assert(result.status === 0, "TLS_CERTIFICATE_GENERATION_FAILED");
}

async function startHttpsProxy({ pfx, passphrase, apiOrigin, webOrigin, port }) {
  const apiTarget = new URL(apiOrigin);
  const webTarget = new URL(webOrigin);
  const server = https.createServer({ pfx, passphrase }, (incoming, outgoing) => {
    const target = (incoming.url ?? "/").startsWith("/api/v1/")
      ? apiTarget
      : webTarget;
    const headers = { ...incoming.headers, host: target.host };
    delete headers["x-wap-frontend-origin"];
    headers["x-forwarded-proto"] = "https";
    headers["x-forwarded-host"] = incoming.headers.host ?? "localhost";
    const forwarded = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: incoming.url,
        method: incoming.method,
        headers,
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    forwarded.on("error", () => {
      if (!outgoing.headersSent) {
        outgoing.statusCode = 502;
        outgoing.setHeader("content-type", "application/json");
        outgoing.end('{"error":{"code":"BAD_GATEWAY"}}');
      }
    });
    incoming.pipe(forwarded);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

async function completeProviderLogin(page, user, identityResponse) {
  await page.locator('input[name="username"]').waitFor();
  await page.locator('input[name="username"]').fill(user.username);
  await page.locator('input[name="password"]').fill(user.password);
  await page
    .locator('input[type="submit"], button[type="submit"]')
    .first()
    .click();
  await identityResponse;
}

async function reauthenticate(page, user, identityResponse) {
  const prompt = page
    .locator('input[name="username"]')
    .waitFor({ timeout: 5000 })
    .then(() => "credentials")
    .catch(() => "not_prompted");
  const identity = identityResponse.then(() => "session_restored");
  const outcome = await Promise.race([prompt, identity]);
  if (outcome === "credentials") {
    await page.locator('input[name="username"]').fill(user.username);
    await page.locator('input[name="password"]').fill(user.password);
    await page
      .locator('input[type="submit"], button[type="submit"]')
      .first()
      .click();
    await identityResponse;
    return "credentials_reentered";
  }
  return "provider_sso_session_reused";
}

try {
  config = JSON.parse(readFileSync(path.join(cache, "runtime.json"), "utf8"));
  assert(
    config.issuer === "http://127.0.0.1:18080/realms/ati-local" &&
      config.clientId === "ati-web" &&
      config.users?.length === 2,
    "LOCAL_CONFIG_REQUIRED",
  );
  const user = config.users[0];
  assert(user?.username && user.password && user.email, "LOCAL_USER_REQUIRED");
  secrets.push(
    config.clientSecret,
    config.adminPassword,
    ...config.users.map((item) => item.password),
  );

  const apiPort = await freePort();
  const webPort = await freePort();
  const httpsPort = await freePort();
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const apiBase = `${apiOrigin}/api/v1`;
  const viteOrigin = `http://127.0.0.1:${webPort}`;
  const webOrigin = `https://localhost:${httpsPort}`;
  const callbackUri = `${webOrigin}/api/v1/auth/oidc/callback`;

  phase = "provider_client_configuration";
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
  previousWebOrigins = matches[0].webOrigins ?? [];
  const configured = await adminRequest(clientUrl, {
    method: "PUT",
    body: JSON.stringify({
      redirectUris: [...new Set([...previousRedirects, callbackUri])],
      webOrigins: [...new Set([...previousWebOrigins, webOrigin])],
    }),
  });
  assert(configured.ok, "HTTPS_CALLBACK_REGISTRATION_FAILED");

  phase = "isolated_database";
  const adminUrl =
    process.env.OIDC_E2E_ADMIN_URL ??
    "postgresql://wap:wap@127.0.0.1:55532/wap_g1";
  admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  databaseName = `oidc_https_${randomUUID().replaceAll("-", "")}`;
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${databaseName}`;
  await migrate(databaseUrl.href);

  const passwordHash =
    "scrypt$16384$8$1$00000000000000000000000000000000$" + "0".repeat(128);
  const apiEnv = {
    ...process.env,
    G1_DATABASE_URL: databaseUrl.href,
    API_PORT: String(apiPort),
    API_DEMO_EMAIL: "demo@local.invalid",
    API_DEMO_PASSWORD_HASH: passwordHash,
    API_CURSOR_KEY: randomBytes(32).toString("base64"),
    WAP_PLANNER_MODE: "dev_fixture",
    API_NEW_RUNS_ENABLED: "0",
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
    OIDC_SESSION_TTL_MS: "2000",
    OIDC_CLOCK_SKEW_SECONDS: "60",
  };
  secrets.push(passwordHash, apiEnv.API_CURSOR_KEY);

  phase = "api_startup";
  api = spawn(process.execPath, [path.join(root, "apps/api/dist/main.js")], {
    cwd: root,
    env: apiEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  captureOutput(api, (value) => {
    apiOutput += value;
  });
  await ready(`${apiBase}/health/ready`, api, "API");

  phase = "web_startup";
  web = spawn(
    process.execPath,
    [
      viteBin,
      "--host",
      "127.0.0.1",
      "--port",
      String(webPort),
      "--strictPort",
      "--mode",
      "live",
    ],
    {
      cwd: webRoot,
      env: {
        ...process.env,
        WAP_API_TARGET: apiOrigin,
        WAP_FRONTEND_ORIGIN: viteOrigin,
        OIDC_SESSION_COOKIE_NAME: "wap_session",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  captureOutput(web, (value) => {
    webOutput += value;
  });
  await ready(viteOrigin, web, "WEB");

  phase = "local_certificate";
  generateLocalCertificate();
  phase = "https_proxy_startup";
  proxy = await startHttpsProxy({
    pfx: readFileSync(pfxPath),
    passphrase: pfxPassphrase,
    apiOrigin,
    webOrigin: viteOrigin,
    port: httpsPort,
  });

  phase = "browser_launch";
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 960 },
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(20000);

    phase = "callback_error";
    const invalidCallback = await page.goto(
      `${webOrigin}/api/v1/auth/oidc/callback?code=missing&state=missing`,
    );
    assert(invalidCallback?.status() === 400, "INVALID_CALLBACK_NOT_REJECTED");
    evidence.acceptance.invalid_callback_rejected = "PASS";

    phase = "ati_https_login_view";
    await page.goto(webOrigin, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "SSO qua tổ chức (OIDC)" }).waitFor();
    const identityResponse = page.waitForResponse(
      (response) =>
        response.url() === `${webOrigin}/api/v1/auth/me` &&
        response.status() === 200,
    );
    const startResponse = page.waitForResponse(
      (response) =>
        response.url().startsWith(`${webOrigin}/api/v1/auth/oidc/start`) &&
        response.status() === 302,
    );
    phase = "browser_oidc_https_redirect";
    await page.getByRole("button", { name: "SSO qua tổ chức (OIDC)" }).click();
    const startCookies = await (await startResponse).headerValues("set-cookie");
    assert(
      startCookies.some(
        (value) => /(?:^|,)\s*wap_oidc_tx=.*;.*\bSecure\b/i.test(value),
      ) &&
        startCookies.some(
          (value) => /(?:^|,)\s*wap_csrf=.*;.*\bSecure\b/i.test(value),
        ),
        "HTTPS_TRANSACTION_COOKIES_NOT_SECURE",
    );
    phase = "provider_credentials_form";
    await completeProviderLogin(page, user, identityResponse);
    phase = "ati_https_app_shell";
    await page.getByRole("button", { name: `Tài khoản ${user.email}` }).waitFor();
    assert(page.url().startsWith(webOrigin), "HTTPS_RETURN_TO_WEB_FAILED");
    const cookies = await context.cookies(webOrigin);
    const session = cookies.find((cookie) => cookie.name === "wap_session");
    const csrf = cookies.find((cookie) => cookie.name === "wap_csrf");
    assert(
      session?.httpOnly === true &&
        session.sameSite === "Lax" &&
        session.secure === true &&
        csrf?.httpOnly === false &&
        csrf.secure === true,
      "HTTPS_BROWSER_COOKIE_FLAGS_INVALID",
    );
    assert(session?.value, "HTTPS_SESSION_COOKIE_MISSING");
    secrets.push(session.value);
    evidence.acceptance.https_secure_cookie_attributes = "PASS";

    phase = "session_expiry";
    await pause(3000);
    // Chromium correctly drops its Max-Age=2 cookie. Re-add the exact expired
    // credential with a future browser expiry so the reload proves that the
    // durable API expiry guard, not only client-side expiry, rejects it.
    await context.addCookies([
      {
        name: "wap_session",
        value: session.value,
        url: webOrigin,
        expires: Math.floor(Date.now() / 1000) + 60,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
    const expiredIdentity = page.waitForResponse(
      (response) =>
        response.url() === `${webOrigin}/api/v1/auth/me` &&
        response.status() === 401,
    );
    await page.reload({ waitUntil: "networkidle" });
    await expiredIdentity;
    await page.getByRole("heading", { name: "Đăng nhập" }).waitFor();
    evidence.acceptance.expired_session_server_rejected = "PASS";
    evidence.acceptance.expired_session_returns_to_login = "PASS";

    phase = "reauthentication";
    const reauthIdentity = page.waitForResponse(
      (response) =>
        response.url() === `${webOrigin}/api/v1/auth/me` &&
        response.status() === 200,
    );
    await page.getByRole("button", { name: "SSO qua tổ chức (OIDC)" }).click();
    const reauthMode = await reauthenticate(page, user, reauthIdentity);
    await page.getByRole("button", { name: `Tài khoản ${user.email}` }).waitFor();
    evidence.acceptance.reauthentication_after_expiry = "PASS";
    evidence.provider_reauthentication = reauthMode;

    phase = "ati_https_logout";
    const logoutResponse = page.waitForResponse(
      (response) =>
        response.url() === `${webOrigin}/api/v1/auth/logout` &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: `Tài khoản ${user.email}` }).click();
    await page.getByText("Đăng xuất", { exact: true }).click();
    assert((await logoutResponse).status() === 204, "HTTPS_UI_LOGOUT_FAILED");
    await page.getByRole("heading", { name: "Đăng nhập" }).waitFor();
    assert(
      !(await context.cookies(webOrigin)).some(
        (cookie) => cookie.name === "wap_session",
      ),
      "HTTPS_BROWSER_SESSION_NOT_CLEARED",
    );
    evidence.acceptance.https_ui_logout_revocation = "PASS";
    evidence.status = "PASS";
  } finally {
    await context.close();
  }
} catch (error) {
  evidence.failure_phase = phase;
  evidence.failure_code = /^[A-Z][A-Z_]{2,70}$/.test(error?.message ?? "")
    ? error.message
    : error?.name === "TimeoutError"
      ? "OPERATION_TIMEOUT"
      : "OPERATION_FAILED";
} finally {
  for (const [name, cleanup] of [
    ["https_proxy", () => closeServer(proxy, "HTTPS_PROXY")],
    ["web", () => stopProcess(web, "WEB")],
    ["api", () => stopProcess(api, "API")],
    [
      "browser",
      async () => {
        if (browser) await browser.close();
      },
    ],
    [
      "certificate_file",
      async () => {
        try {
          unlinkSync(pfxPath);
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      },
    ],
    [
      "database",
      async () => {
        if (admin && databaseName) {
          await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
          const rows = await admin`SELECT datname FROM pg_database WHERE datname = ${databaseName}`;
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
      "client_configuration",
      async () => {
        if (clientUrl) {
          const restored = await adminRequest(clientUrl, {
            method: "PUT",
            body: JSON.stringify({
              redirectUris: previousRedirects,
              webOrigins: previousWebOrigins,
            }),
          });
          assert(restored.ok, "CLIENT_CONFIG_RESTORE_FAILED");
          const readback = await adminRequest(clientUrl);
          assert(readback.ok, "CLIENT_CONFIG_VERIFY_FAILED");
          const client = await readback.json();
          assert(
            JSON.stringify(client.redirectUris) === JSON.stringify(previousRedirects) &&
              JSON.stringify(client.webOrigins) === JSON.stringify(previousWebOrigins),
            "CLIENT_CONFIG_RESTORE_MISMATCH",
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
        (apiOutput.includes(secret) || webOutput.includes(secret)),
    )
  ) {
    evidence.status = "FAIL";
    evidence.failure_phase = "runtime_secret_leak";
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
    ["scripts/oidc-keycloak-https-e2e.mjs", "apps/api/dist/main.js"].map((file) => {
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
    path.join(cache, "https-evidence.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.status !== "PASS") process.exitCode = 1;
}
