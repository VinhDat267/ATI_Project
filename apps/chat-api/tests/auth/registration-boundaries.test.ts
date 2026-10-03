import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { RateLimit } from "../../src/auth/rate-limit.js";
import { createSmtpSender } from "../../src/services/email/sender.js";

describe("registration runtime boundaries", () => {
  it("does not offer registration in a memory-only sandbox", async () => {
    const app = createApp({
      jwtSecret: "isolated-unit-test-secret-at-least-32-chars",
    });
    expect(
      (await request(app).get("/api/auth/config")).body.signupEnabled,
    ).toBe(false);
    expect((await request(app).post("/api/auth/signup").send({})).status).toBe(
      503,
    );
  });
  it("expires rate-limit windows and keeps keys independent", () => {
    let now = 0;
    const limit = new RateLimit(3, 60_000, () => now);
    for (let i = 0; i < 3; i++) limit.record("member");
    expect(limit.blocked("member")).toBe(60);
    expect(limit.blocked("other")).toBe(0);
    now = 60_000;
    expect(limit.blocked("member")).toBe(0);
    limit.record("member");
    expect(limit.blocked("member")).toBe(0);
  });
  it("fails closed for live email without complete SMTP or HTTPS configuration", () => {
    expect(() => createSmtpSender({})).toThrow("SMTP_HOST");
    const config = {
      SMTP_HOST: "smtp.gmail.com",
      SMTP_PORT: "587",
      SMTP_USER: "fixture@example.test",
      SMTP_PASSWORD: "fixture-only",
      MAIL_FROM: "fixture@example.test",
      APP_BASE_URL: "http://example.test",
    };
    expect(() => createSmtpSender(config)).toThrow("HTTPS");
    expect(() =>
      createSmtpSender({
        ...config,
        APP_BASE_URL: "https://example.test",
        SMTP_PORT: "oops",
      }),
    ).toThrow("SMTP_PORT");
    // Construction only: never opens a connection or sends an email.
    expect(() =>
      createSmtpSender({ ...config, APP_BASE_URL: "https://example.test" }),
    ).not.toThrow();
  });
});
