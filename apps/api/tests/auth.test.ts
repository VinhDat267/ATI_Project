import { describe, expect, it } from "vitest";
import {
  SessionStore,
  hashPassword,
  parsePasswordHash,
  verifyPassword,
} from "../src/auth.js";

describe("local password and session boundary", () => {
  it("hashes and verifies the exact scrypt format", async () => {
    const encoded = await hashPassword("correct horse battery staple");
    expect(encoded).toMatch(
      /^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/,
    );
    expect(parsePasswordHash(encoded).salt).toHaveLength(16);
    await expect(
      verifyPassword("correct horse battery staple", encoded),
    ).resolves.toBe(true);
    await expect(verifyPassword("wrong", encoded)).resolves.toBe(false);
  });

  it("issues and authenticates an opaque bearer token", async () => {
    const passwordHash = await hashPassword("demo-secret");
    const store = new SessionStore({
      userId: "00000000-0000-4000-8000-000000000001",
      email: "demo@example.local",
      passwordHash,
      ttlMs: 60_000,
      principalExists: async () => true,
    });
    const token = await store.login("demo@example.local", "demo-secret");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.authenticate(`Bearer ${token}`)).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
    expect(() => store.authenticate(`Bearer ${token}.tampered`)).toThrowError(
      expect.objectContaining({ code: "UNAUTHENTICATED" }),
    );
  });
});
