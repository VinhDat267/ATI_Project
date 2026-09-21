import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const read = (relativePath: string): string =>
  readFileSync(path.join(root, relativePath), "utf8");

describe("OIDC-01 release evidence contract", () => {
  it("keeps the additive durable identity/session migration explicit", () => {
    const migration = read("db/migrations/0009_oidc_identity.sql");
    expect(migration).toContain("CREATE TABLE auth_identities");
    expect(migration).toContain("CREATE TABLE auth_sessions");
    expect(migration).toContain("CREATE TABLE oidc_transactions");
    expect(migration).toContain("UNIQUE (issuer, subject)");
    expect(migration).toContain("session_hash");
  });

  it("keeps the generated HTTP surface and evidence status honest", () => {
    const openapi = read("docs/openapi.yaml");
    expect(openapi).toContain("/auth/oidc/start");
    expect(openapi).toContain("/auth/oidc/callback");
    expect(openapi).toContain("/auth/me");
    const evidence = read("docs/auth-evidence/OIDC-01/README.md");
    expect(evidence).toContain("OPEN");
    expect(evidence).toContain("node scripts/check-oidc.mjs");
  });

  it("does not place provider credentials in the browser transport source", () => {
    const transport = read("apps/web/src/core/api.ts");
    expect(transport).toContain('credentials: "include"');
    expect(transport).not.toContain("clientSecret");
    expect(transport).not.toContain("sessionStorage");
    expect(transport).not.toContain("localStorage");
  });
});
