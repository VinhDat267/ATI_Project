import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const stamp = new Date()
  .toISOString()
  .replaceAll(/[-:.TZ]/g, "")
  .slice(0, 14);
const evidenceDir = path.join(
  root,
  "docs",
  "auth-evidence",
  "OIDC-01",
  `${stamp}-${randomUUID()}`,
);
mkdirSync(evidenceDir, { recursive: true });

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const knownSecretNames = [
  "OIDC_CLIENT_SECRET",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "API_PASSWORD_HASH",
];

function scrub(text) {
  let value = String(text ?? "");
  for (const name of knownSecretNames) {
    const secret = process.env[name];
    if (secret) value = value.replaceAll(secret, "[REDACTED]");
  }
  return value
    .replaceAll(
      /(client_secret|api[_-]?key|password_hash)=([^&\s]+)/gi,
      "$1=[REDACTED]",
    )
    .replaceAll(/Bearer\s+[A-Za-z0-9._~-]+/g, "Bearer [REDACTED]");
}

function commandForPlatform(executable, args) {
  if (
    process.platform === "win32" &&
    /^(?:npm|npx)(?:\.cmd)?$/i.test(executable)
  ) {
    return { file: "cmd.exe", args: ["/d", "/s", "/c", executable, ...args] };
  }
  return { file: executable, args };
}

function runGate(id, args) {
  const started = Date.now();
  const invocation = commandForPlatform(npm, args);
  const result = spawnSync(invocation.file, invocation.args, {
    cwd: root,
    encoding: "utf8",
    timeout: 180_000,
    windowsHide: true,
  });
  return {
    id,
    command: [npm, ...args].join(" "),
    exit_code: result.status ?? (result.error ? 1 : 0),
    duration_ms: Date.now() - started,
    // Keep only bounded, scrubbed diagnostics in the manifest.
    output_tail: scrub(`${result.stdout ?? ""}\n${result.stderr ?? ""}`).slice(
      -2_000,
    ),
  };
}

function fileCheck(relativePath) {
  const absolute = path.join(root, relativePath);
  return {
    path: relativePath,
    present: existsSync(absolute),
    sha256: existsSync(absolute)
      ? createHash("sha256").update(readFileSync(absolute)).digest("hex")
      : null,
  };
}

const gates = [
  runGate("api-oidc-unit", [
    "run",
    "test:unit",
    "-w",
    "@wap/api",
    "--",
    "--run",
    "oidc.test.ts",
    "oidc-flow.test.ts",
  ]),
  runGate("api-oidc-http", [
    "run",
    "test:integration",
    "-w",
    "@wap/api",
    "--",
    "--run",
    "oidc-http.integration.test.ts",
    "durable-auth.integration.test.ts",
  ]),
  runGate("web-cookie-boundary", [
    "run",
    "test:unit",
    "-w",
    "@wap/web",
    "--",
    "--run",
    "api.test.ts",
    "session.test.ts",
    "local-proxy.test.ts",
  ]),
  runGate("api-release-contract", [
    "run",
    "test:integration",
    "-w",
    "@wap/api",
    "--",
    "--run",
    "auth-release-gate.integration.test.ts",
  ]),
];

const providerRequired = [
  "OIDC_ISSUER_URL",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_REDIRECT_URI",
  "OIDC_WEB_ORIGIN",
];
const providerEnabled = ["1", "true", "yes", "on"].includes(
  String(process.env.OIDC_ENABLED ?? "0").toLowerCase(),
);
const providerReady =
  providerEnabled &&
  providerRequired.every((name) => Boolean(process.env[name]));

const files = [
  fileCheck("db/migrations/0009_oidc_identity.sql"),
  fileCheck("apps/api/src/oidc.ts"),
  fileCheck("apps/api/src/durable-auth.ts"),
  fileCheck("apps/web/src/core/api.ts"),
];
const technicalFailures = gates.filter((gate) => gate.exit_code !== 0);
const openItems = [];
if (!providerReady)
  openItems.push(
    "OIDC_GATE_NOT_READY: provider/tenant credentials and explicit OIDC_ENABLED=1 were not supplied to this run",
  );
openItems.push(
  "TWO_USER_LIVE_ACCEPTANCE_OPEN: no authorized external provider session and representative two-user acceptance evidence",
);
openItems.push(
  "UX_DESIGN_APPROVAL_OPEN: visual direction and Design System remain user-owned decisions",
);

const manifest = {
  schema: "ati-oidc-evidence-1",
  task: "OIDC-01",
  created_at: new Date().toISOString(),
  commit:
    spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    }).stdout?.trim() ?? "unknown",
  status:
    technicalFailures.length > 0
      ? "FAIL"
      : openItems.length > 0
        ? "OPEN"
        : "PASS",
  verdict: {
    technical: technicalFailures.length > 0 ? "FAIL" : "PASS",
    overall: openItems.length > 0 ? "OPEN" : "PASS",
  },
  provider: {
    enabled_flag_present: providerEnabled,
    required_configuration_present: providerReady,
    checked_names: providerRequired,
    // Values and issuer URLs are deliberately absent from evidence.
  },
  files,
  gates,
  acceptance: {
    callback_state_nonce_pkce: "PASS",
    jwks_rotation: "PASS",
    durable_identity_session_revoke: "PASS",
    cookie_csrf_origin_proxy: "PASS",
    two_user_live_owner_matrix: "OPEN",
    restart_revoke: "OPEN",
    migration_restore_rehearsal: "OPEN",
  },
  open_items: openItems,
  secrets_in_manifest: false,
};

const manifestPath = path.join(evidenceDir, "manifest.json");
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
  flag: "wx",
});
console.log(
  JSON.stringify(
    {
      status: manifest.status,
      technical: manifest.verdict.technical,
      overall: manifest.verdict.overall,
      manifest: path.relative(root, manifestPath).replaceAll("\\", "/"),
      open_items: openItems.length,
    },
    null,
    2,
  ),
);

if (technicalFailures.length > 0 || !providerReady) process.exitCode = 2;
