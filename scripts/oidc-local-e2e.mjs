import http from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { migrate } from "@wap/db";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const adminUrl =
  process.env.OIDC_E2E_ADMIN_URL ??
  "postgresql://wap:wap@127.0.0.1:55532/wap_g1";
const clientId = "wap-web-local-e2e";
const clientSecret = "local-e2e-client-secret";
const webOrigin = "http://127.0.0.1:5173";
const demoPasswordHash =
  "scrypt$16384$8$1$00000000000000000000000000000000$" + "0".repeat(128);

const users = {
  alice: {
    sub: "local-e2e-alice",
    email: "alice@local.invalid",
    name: "Alice OIDC",
  },
  bob: {
    sub: "local-e2e-bob",
    email: "bob@local.invalid",
    name: "Bob OIDC",
  },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function json(response, status, body) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

async function startIssuer() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: "local-e2e-key", alg: "RS256", use: "sig" });
  const codes = new Map();
  let selectedUser = users.alice;
  const server = http.createServer(async (request, response) => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const issuer = `http://127.0.0.1:${port}`;
    const url = new URL(request.url ?? "/", issuer);
    try {
      if (url.pathname === "/.well-known/openid-configuration") {
        json(response, 200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        });
        return;
      }
      if (url.pathname === "/jwks") {
        json(response, 200, { keys: [jwk] });
        return;
      }
      if (url.pathname === "/authorize") {
        const code = `local-e2e-code-${randomUUID()}`;
        codes.set(code, {
          clientId: url.searchParams.get("client_id"),
          redirectUri: url.searchParams.get("redirect_uri"),
          state: url.searchParams.get("state"),
          nonce: url.searchParams.get("nonce"),
          codeChallenge: url.searchParams.get("code_challenge"),
          user: selectedUser,
        });
        const redirect = new URL(url.searchParams.get("redirect_uri"));
        redirect.searchParams.set("code", code);
        redirect.searchParams.set("state", url.searchParams.get("state"));
        response.statusCode = 302;
        response.setHeader("location", redirect.toString());
        response.end();
        return;
      }
      if (url.pathname === "/token" && request.method === "POST") {
        const form = new URLSearchParams(await readBody(request));
        const code = codes.get(form.get("code"));
        assert(code, "OIDC_E2E_CODE_UNKNOWN");
        assert(form.get("client_id") === code.clientId, "OIDC_E2E_CLIENT");
        assert(form.get("client_secret") === clientSecret, "OIDC_E2E_SECRET");
        assert(
          form.get("redirect_uri") === code.redirectUri,
          "OIDC_E2E_REDIRECT",
        );
        const challenge = createHash("sha256")
          .update(form.get("code_verifier") ?? "", "utf8")
          .digest("base64url");
        assert(challenge === code.codeChallenge, "OIDC_E2E_PKCE");
        codes.delete(form.get("code"));
        const token = await new SignJWT({
          sub: code.user.sub,
          email: code.user.email,
          email_verified: true,
          name: code.user.name,
          nonce: code.nonce,
          roles: ["user"],
        })
          .setProtectedHeader({ alg: "RS256", kid: jwk.kid, typ: "JWT" })
          .setIssuer(issuer)
          .setAudience(clientId)
          .setIssuedAt()
          .setExpirationTime("5 minutes")
          .sign(privateKey);
        json(response, 200, { id_token: token, token_type: "Bearer" });
        return;
      }
      json(response, 404, { error: "not_found" });
    } catch (error) {
      json(response, 400, {
        error: error instanceof Error ? error.message : "error",
      });
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  assert(port > 0, "OIDC_E2E_ISSUER_PORT");
  return {
    issuer: `http://127.0.0.1:${port}`,
    setUser(user) {
      selectedUser = user;
    },
    async close() {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

function setCookieValues(response) {
  const values =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") ?? ""];
  const cookies = {};
  for (const value of values) {
    const [pair] = value.split(";");
    const separator = pair.indexOf("=");
    if (separator > 0)
      cookies[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
  return cookies;
}

async function createDatabase() {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  const name = `oidc_e2e_${randomUUID().replaceAll("-", "")}`;
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${name}`;
  await migrate(databaseUrl.href);
  return {
    url: databaseUrl.href,
    async close() {
      await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.end();
    },
  };
}

async function waitReady(base) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${base}/health/ready`);
      if (response.status === 200) return;
    } catch {
      // The process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("OIDC_E2E_API_NOT_READY");
}

async function login(apiBase, issuer, user) {
  issuer.setUser(user);
  const start = await fetch(`${apiBase}/auth/oidc/start?return_to=%2F`, {
    redirect: "manual",
    headers: { origin: webOrigin },
  });
  assert(start.status === 302, `OIDC_E2E_START_${start.status}`);
  const startCookies = setCookieValues(start);
  const transaction = startCookies.wap_oidc_tx;
  const csrf = startCookies.wap_csrf;
  assert(transaction && csrf, "OIDC_E2E_TRANSACTION_COOKIES");
  const authorization = await fetch(start.headers.get("location"), {
    redirect: "manual",
  });
  assert(
    authorization.status === 302,
    `OIDC_E2E_AUTHORIZE_${authorization.status}`,
  );
  const callback = await fetch(authorization.headers.get("location"), {
    redirect: "manual",
    headers: {
      origin: webOrigin,
      cookie: `wap_oidc_tx=${transaction}; wap_csrf=${csrf}`,
    },
  });
  assert(callback.status === 302, `OIDC_E2E_CALLBACK_${callback.status}`);
  const callbackCookies = setCookieValues(callback);
  const session = callbackCookies.wap_session;
  assert(session, "OIDC_E2E_SESSION_COOKIE");
  const me = await fetch(`${apiBase}/auth/me`, {
    headers: { origin: webOrigin, cookie: `wap_session=${session}` },
  });
  assert(me.status === 200, `OIDC_E2E_ME_${me.status}`);
  const identity = await me.json();
  assert(identity.email === user.email, "OIDC_E2E_IDENTITY_MISMATCH");
  return { session, csrf, identity };
}

const database = await createDatabase();
const issuer = await startIssuer();
const apiPort = await freePort();
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const apiBase = `${apiOrigin}/api/v1`;
let apiOutput = "";
const apiEnv = {
  ...process.env,
  G1_DATABASE_URL: database.url,
  API_PORT: String(apiPort),
  API_DEMO_EMAIL: "demo@local.invalid",
  API_DEMO_PASSWORD_HASH: demoPasswordHash,
  API_CURSOR_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAP_PLANNER_MODE: "dev_fixture",
  API_NEW_RUNS_ENABLED: "1",
  AI_PROVIDER_CALLS_ENABLED: "0",
  G1_FILESYSTEM_ENABLED: "0",
  API_LEGACY_PASSWORD_AUTH_ENABLED: "0",
  OIDC_ENABLED: "1",
  OIDC_ISSUER_URL: issuer.issuer,
  OIDC_CLIENT_ID: clientId,
  OIDC_CLIENT_SECRET: clientSecret,
  OIDC_REDIRECT_URI: `${apiBase}/auth/oidc/callback`,
  OIDC_AUDIENCE: "wap-api",
  OIDC_SCOPES: "openid,profile,email",
  OIDC_WEB_ORIGIN: webOrigin,
  OIDC_SESSION_COOKIE_NAME: "wap_session",
  OIDC_TRANSACTION_TTL_MS: "600000",
  OIDC_SESSION_TTL_MS: "3600000",
  OIDC_CLOCK_SKEW_SECONDS: "60",
};
function startApi() {
  const child = spawn(
    process.execPath,
    [path.join(root, "apps/api/dist/main.js")],
    {
      cwd: root,
      env: apiEnv,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk) => (apiOutput += chunk.toString()));
  child.stderr.on("data", (chunk) => (apiOutput += chunk.toString()));
  return child;
}
async function stopApi(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}
let api = startApi();

try {
  await waitReady(apiBase);
  const alice = await login(apiBase, issuer, users.alice);
  const bob = await login(apiBase, issuer, users.bob);

  await stopApi(api);
  api = startApi();
  await waitReady(apiBase);
  const afterRestart = await fetch(`${apiBase}/auth/me`, {
    headers: { origin: webOrigin, cookie: `wap_session=${bob.session}` },
  });
  assert(
    afterRestart.status === 200,
    `OIDC_E2E_RESTART_${afterRestart.status}`,
  );

  const createRun = await fetch(`${apiBase}/runs`, {
    method: "POST",
    headers: {
      origin: webOrigin,
      cookie: `wap_session=${alice.session}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      source_prompt: "Chép nguyên các dòng Progress!A1:B2",
      inputs: {},
      time_zone: "Asia/Ho_Chi_Minh",
    }),
  });
  assert(createRun.status === 202, `OIDC_E2E_CREATE_${createRun.status}`);
  const accepted = await createRun.json();
  const crossOwner = await fetch(`${apiBase}/runs/${accepted.run_id}`, {
    headers: { origin: webOrigin, cookie: `wap_session=${bob.session}` },
  });
  assert(
    crossOwner.status === 404,
    `OIDC_E2E_CROSS_OWNER_${crossOwner.status}`,
  );

  const logout = await fetch(`${apiBase}/auth/logout`, {
    method: "POST",
    headers: {
      origin: webOrigin,
      "x-csrf-token": alice.csrf,
      cookie: `wap_session=${alice.session}; wap_csrf=${alice.csrf}`,
    },
  });
  assert(logout.status === 204, `OIDC_E2E_LOGOUT_${logout.status}`);
  const revoked = await fetch(`${apiBase}/auth/me`, {
    headers: { origin: webOrigin, cookie: `wap_session=${alice.session}` },
  });
  assert(revoked.status === 401, `OIDC_E2E_REVOKE_${revoked.status}`);

  const evidenceDir = path.join(
    root,
    "docs",
    "auth-evidence",
    "OIDC-01",
    `local-${new Date().toISOString().replaceAll(/[-:.TZ]/g, "")}-${randomUUID()}`,
  );
  mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = path.join(evidenceDir, "manifest.json");
  writeFileSync(
    evidencePath,
    `${JSON.stringify(
      {
        schema: "ati-oidc-local-e2e-1",
        task: "OIDC-01",
        created_at: new Date().toISOString(),
        status: "PASS",
        technical: "PASS",
        commit:
          spawnSync("git", ["rev-parse", "HEAD"], {
            cwd: root,
            encoding: "utf8",
            windowsHide: true,
          }).stdout?.trim() ?? "unknown",
        provider: "local-fake-oidc",
        acceptance: {
          callback_state_nonce_pkce: "PASS",
          jwks_id_token_validation: "PASS",
          durable_identity_session: "PASS",
          restart_session: "PASS",
          two_user_owner_matrix: "PASS",
          csrf_logout_and_revoke: "PASS",
        },
        cross_owner_status: crossOwner.status,
        restart_session_status: afterRestart.status,
        revoked_session_status: revoked.status,
        secrets_in_manifest: false,
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  );

  console.log(
    JSON.stringify(
      {
        status: "PASS",
        technical: "PASS",
        provider: "local-fake-oidc",
        identities: [alice.identity.email, bob.identity.email],
        cross_owner_status: crossOwner.status,
        restart_session_status: afterRestart.status,
        revoked_session_status: revoked.status,
        manifest: path.relative(root, evidencePath).replaceAll("\\", "/"),
        secrets_in_output: false,
      },
      null,
      2,
    ),
  );
} finally {
  await stopApi(api);
  await issuer.close();
  await database.close();
  if (apiOutput.includes(clientSecret) || apiOutput.includes(demoPasswordHash))
    throw new Error("OIDC_E2E_SECRET_LEAK");
}
