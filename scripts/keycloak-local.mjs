// Local development only. Generated credentials never enter tracked config.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = path.join(root, ".cache/keycloak-local");
const runtimePath = path.join(dir, "runtime.json");
const action = process.argv[2] ?? "up";
if (!["up", "prepare", "stop"].includes(action))
  throw new Error("Use up, prepare or stop");
const secret = () => randomBytes(32).toString("hex");
mkdirSync(path.join(dir, "import"), { recursive: true });
if (!existsSync(runtimePath)) {
  if (action === "stop") throw new Error("Local configuration absent");
  const runtime = {
    issuer: "http://127.0.0.1:18080/realms/ati-local",
    clientId: "ati-web",
    clientSecret: secret(),
    adminUsername: "ati-admin",
    adminPassword: secret(),
    users: ["alice", "bob"].map((username) => ({
      username,
      email: `${username}@ati.local`,
      password: secret(),
    })),
  };
  writeFileSync(runtimePath, JSON.stringify(runtime, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
}
const runtime = JSON.parse(readFileSync(runtimePath, "utf8"));
const realm = {
  realm: "ati-local",
  enabled: true,
  registrationAllowed: false,
  resetPasswordAllowed: false,
  sslRequired: "none",
  clients: [
    {
      clientId: runtime.clientId,
      protocol: "openid-connect",
      enabled: true,
      publicClient: false,
      secret: runtime.clientSecret,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: false,
      redirectUris: ["http://127.0.0.1:3001/api/v1/auth/oidc/callback"],
      webOrigins: ["http://127.0.0.1:5173"],
      attributes: { "pkce.code.challenge.method": "S256" },
      defaultClientScopes: ["profile", "email"],
      protocolMappers: [
        {
          name: "ati-api-audience",
          protocol: "openid-connect",
          protocolMapper: "oidc-audience-mapper",
          config: {
            "included.custom.audience": "wap-api",
            "access.token.claim": "true",
            "id.token.claim": "false",
          },
        },
      ],
    },
  ],
  users: runtime.users.map((user) => ({
    username: user.username,
    email: user.email,
    enabled: true,
    emailVerified: true,
    firstName: user.username,
    lastName: "ATI Test",
    requiredActions: [],
    credentials: [{ type: "password", value: user.password, temporary: false }],
  })),
};
writeFileSync(
  path.join(dir, "import/ati-local-realm.json"),
  JSON.stringify(realm),
  { mode: 0o600 },
);
if (action === "prepare") process.exit(0);
const result = spawnSync(
  "docker",
  [
    "compose",
    "-f",
    "compose.keycloak.yaml",
    ...(action === "up" ? ["up", "-d"] : ["stop"]),
  ],
  {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      KC_BOOTSTRAP_ADMIN_USERNAME: runtime.adminUsername,
      KC_BOOTSTRAP_ADMIN_PASSWORD: runtime.adminPassword,
    },
  },
);
if (result.status !== 0) process.exit(result.status ?? 1);
if (action === "up") {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      const response = await fetch(
        `${runtime.issuer}/.well-known/openid-configuration`,
        { signal: AbortSignal.timeout(2000) },
      );
      if (response.ok && (await response.json()).issuer === runtime.issuer) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error("KEYCLOAK_NOT_READY");
  console.log(
    "Keycloak ready at http://127.0.0.1:18080; realm ati-local; client ati-web; users alice and bob. Credentials are in ignored .cache/keycloak-local/runtime.json.",
  );
}
