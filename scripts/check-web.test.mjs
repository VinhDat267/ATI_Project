import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import fs from "node:fs";
import {
  createWebGatePlan,
  sanitizeSensitiveText,
  sanitizeEvidenceValue,
  compareCleanupSnapshots,
  validateBundleBudgets,
  aggregateLatencyReport,
  runCommandSync,
  resolveWebGateAdminUrls,
} from "./check-web-lib.mjs";

test("resolveWebGateAdminUrls uses the current 55532 G1 endpoint and de-duplicates overrides", () => {
  assert.deepEqual(
    resolveWebGateAdminUrls({
      API_TEST_ADMIN_URL: "postgresql://wap:wap@127.0.0.1:55532/wap_g1",
      G1_TEST_ADMIN_URL: "postgresql://wap:wap@127.0.0.1:55532/wap_g1",
    }),
    ["postgresql://wap:wap@127.0.0.1:55532/wap_g1"],
  );
  assert.deepEqual(resolveWebGateAdminUrls({}), [
    "postgresql://wap:wap@127.0.0.1:55532/wap_g1",
  ]);
});

test("createWebGatePlan returns ordered list of gate commands without shell", () => {
  const plan = createWebGatePlan();
  assert.ok(Array.isArray(plan));
  assert.ok(plan.length >= 5);
  for (const item of plan) {
    assert.ok(item.id);
    assert.ok(Array.isArray(item.command));
    assert.notEqual(item.command[0], "sh");
    assert.notEqual(item.command[0], "bash");
  }
});

test("createWebGatePlan defines all 6 gate commands in expected order", () => {
  const plan = createWebGatePlan();
  assert.equal(plan.length, 6);
  assert.deepEqual(
    plan.map((item) => item.id),
    [
      "web-typecheck",
      "web-unit-tests",
      "web-strict-mode",
      "web-fixture-browser",
      "web-live-browser",
      "web-bundle-build",
    ],
  );

  assert.deepEqual(plan[0].command, ["npm", "run", "typecheck", "-w", "@wap/web"]);
  assert.deepEqual(plan[1].command, ["npm", "run", "test:unit", "-w", "@wap/web"]);
  assert.deepEqual(plan[2].command, [
    "npm",
    "exec",
    "-w",
    "@wap/web",
    "--",
    "playwright",
    "test",
    "--config=playwright.strict.config.ts",
  ]);
  assert.deepEqual(plan[3].command, ["npm", "run", "test:browser", "-w", "@wap/web"]);
  assert.deepEqual(plan[4].command, ["npm", "run", "test:live", "-w", "@wap/web"]);
  assert.deepEqual(plan[5].command, ["npm", "run", "build", "-w", "@wap/web", "--", "--mode", "live"]);

  for (const item of plan) {
    assert.ok(typeof item.description === "string" && item.description.length > 0);
  }
});

test("sanitizer strips bearer tokens, passwords, and database urls", () => {
  const raw = '{"token":"secret-token","database_url":"postgresql://wap:pass@127.0.0.1:55432/db"}';
  const clean = sanitizeSensitiveText(raw, ["secret-token", "pass"]);
  assert.ok(!clean.includes("secret-token"));
  assert.ok(!clean.includes("pass"));
  assert.match(clean, /\[REDACTED\]/);
});

test("recursive sanitizer scrubs nested objects and arrays", () => {
  const data = {
    token: "top-secret-token",
    nested: {
      password: "secret-password",
      url: "postgresql://user:secret-pass@localhost:5432/test",
      list: ["Bearer sensitive-bearer-value", { api_key: "api-secret-key" }],
    },
    count: 42,
    active: true,
  };

  const sanitized = sanitizeEvidenceValue(data, ["top-secret-token", "secret-password"]);
  assert.equal(sanitized.token, "[REDACTED]");
  assert.equal(sanitized.nested.password, "[REDACTED]");
  assert.ok(!sanitized.nested.url.includes("secret-pass"));
  assert.ok(sanitized.nested.url.includes("[REDACTED]"));
  assert.equal(sanitized.nested.list[0], "Bearer [REDACTED]");
  assert.equal(sanitized.nested.list[1].api_key, "[REDACTED]");
  assert.equal(sanitized.count, 42);
  assert.equal(sanitized.active, true);
});

test("compareCleanupSnapshots detects leaked database", () => {
  const before = { databases: ["cluster_1:api_it_1"], processes: [], temp_roots: [], errors: [] };
  const after = { databases: ["cluster_1:api_it_1", "cluster_1:api_it_leaked"], processes: [], temp_roots: [], errors: [] };
  const result = compareCleanupSnapshots(before, after);
  assert.equal(result.status, "FAIL");
  assert.equal(result.leaked_databases.length, 1);
  assert.equal(result.added.databases.length, 1);
  assert.deepEqual(result.leaked_databases, ["cluster_1:api_it_leaked"]);
});

test("compareCleanupSnapshots passes on empty delta and returns leaked collections", () => {
  const before = {
    status: "PASS",
    databases: ["cluster_1:api_it_1"],
    processes: [{ pid: 100, kind: "node" }],
    temp_roots: ["ati-fs-1"],
    errors: [],
  };
  const after = structuredClone(before);
  const result = compareCleanupSnapshots(before, after);
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.leaked_databases, []);
  assert.deepEqual(result.leaked_temp_roots, []);
  assert.deepEqual(result.leaked_processes, []);
  assert.deepEqual(result.added, { databases: [], temp_roots: [], processes: [] });
  assert.deepEqual(result.errors, []);
});

test("compareCleanupSnapshots detects leaked temp roots and processes", () => {
  const before = { databases: [], processes: [], temp_roots: [], errors: [] };
  const after = {
    databases: [],
    processes: [{ pid: 200, kind: "vite", started_at: "2026-09-19T00:00:00Z" }],
    temp_roots: ["ati-fs-leaked"],
    errors: [],
  };
  const result = compareCleanupSnapshots(before, after);
  assert.equal(result.status, "FAIL");
  assert.equal(result.leaked_temp_roots.length, 1);
  assert.equal(result.leaked_processes.length, 1);
  assert.equal(result.added.temp_roots[0], "ati-fs-leaked");
});

test("validateBundleBudgets passes within thresholds and fails above", () => {
  const passResult = validateBundleBudgets({ jsGzipBytes: 180 * 1024, cssGzipBytes: 15 * 1024, hasSyntheticLeak: false });
  assert.equal(passResult.status, "PASS");

  const failJsResult = validateBundleBudgets({ jsGzipBytes: 210 * 1024, cssGzipBytes: 15 * 1024, hasSyntheticLeak: false });
  assert.equal(failJsResult.status, "FAIL");

  const leakResult = validateBundleBudgets({ jsGzipBytes: 180 * 1024, cssGzipBytes: 15 * 1024, hasSyntheticLeak: true });
  assert.equal(leakResult.status, "FAIL");
});

test("validateBundleBudgets rejects oversized CSS bundle", () => {
  const failCssResult = validateBundleBudgets({
    jsGzipBytes: 100 * 1024,
    cssGzipBytes: 31 * 1024,
    hasSyntheticLeak: false,
  });
  assert.equal(failCssResult.status, "FAIL");
  assert.ok(failCssResult.reasons.some((r) => r.includes("CSS")));
});

test("validateBundleBudgets evaluates actual dist directory", () => {
  const distDir = path.resolve("apps/web/dist");
  if (fs.existsSync(distDir)) {
    const result = validateBundleBudgets(distDir);
    assert.equal(result.status, "PASS");
    assert.ok(result.js_gzip_bytes > 0);
    assert.ok(result.js_gzip_bytes <= 204_800);
    assert.ok(result.css_gzip_bytes > 0);
    assert.ok(result.css_gzip_bytes <= 30_720);
    assert.equal(result.has_synthetic_leak, false);
  }
});

test("aggregateLatencyReport calculates p95, p50, min, max, mean and pass status", () => {
  const observations = Array.from({ length: 30 }, (_, index) => ({
    seq: index + 1,
    latency_ms: 100 + index * 10,
  }));

  const report = aggregateLatencyReport({ observations });
  assert.equal(report.sample_count, 30);
  assert.equal(report.min_ms, 100);
  assert.equal(report.max_ms, 390);
  assert.equal(report.p50_ms, 250);
  assert.equal(report.p95_ms, 380);
  assert.equal(report.pass, true);
});

test("aggregateLatencyReport rejects when sample count < 30 or p95 > 3000", () => {
  const tooFew = aggregateLatencyReport({
    observations: Array.from({ length: 29 }, (_, index) => ({ latency_ms: 50 + index })),
  });
  assert.equal(tooFew.sample_count, 29);
  assert.equal(tooFew.pass, false);

  const tooSlow = aggregateLatencyReport({
    observations: Array.from({ length: 35 }, () => ({ latency_ms: 3200 })),
  });
  assert.equal(tooSlow.sample_count, 35);
  assert.equal(tooSlow.p95_ms, 3200);
  assert.equal(tooSlow.pass, false);
});

test("aggregateLatencyReport reads from cache file path", () => {
  const cachePath = path.resolve(".cache/nfr03-observations.json");
  if (fs.existsSync(cachePath)) {
    const report = aggregateLatencyReport(cachePath);
    assert.ok(report.sample_count >= 30);
    assert.ok(report.p95_ms <= 3000);
    assert.equal(report.pass, true);
  }
});

test("runCommandSync executes command array safely and returns sanitized evidence", () => {
  const command = {
    id: "echo-test",
    command: ["node", "-e", "console.log(JSON.stringify({ secret: 'my-pass' }))"],
    timeout_ms: 10_000,
  };
  const result = runCommandSync(command, ["my-pass"]);
  assert.equal(result.id, "echo-test");
  assert.equal(result.exit_code, 0);
  assert.ok(!result.stdout.includes("my-pass"));
  assert.ok(result.stdout.includes("[REDACTED]"));
});
