import { describe, expect, it } from "vitest";
import type {
  SessionAuthority,
  SessionCredential,
  SessionMetadata,
} from "../src/auth.js";

describe("session authority contract", () => {
  it("accepts a cookie or compatibility bearer credential and issues typed sessions", async () => {
    const credential: SessionCredential = {
      cookie: "wap_session=opaque-session",
    };
    const metadata: SessionMetadata = {
      createdFrom: "oidc",
      issuer: "http://127.0.0.1:8080/realms/wap",
      subject: "subject-1",
    };
    const authority: SessionAuthority = {
      async login() {
        return "legacy-token";
      },
      async issue(userId, sessionMetadata) {
        expect(userId).toMatch(/^[0-9a-f-]{36}$/);
        expect(sessionMetadata).toEqual(metadata);
        return "opaque-session";
      },
      async authenticate(input) {
        expect(input).toEqual(credential);
        return "00000000-0000-4000-8000-000000000001";
      },
      async revoke(input) {
        expect(input).toEqual(credential);
      },
    };
    const session = await authority.issue(
      "00000000-0000-4000-8000-000000000001",
      metadata,
    );
    expect(session).toBe("opaque-session");
    expect(await authority.authenticate(credential)).toMatch(/^[0-9a-f-]{36}$/);
    await authority.revoke(credential);
  });
});
