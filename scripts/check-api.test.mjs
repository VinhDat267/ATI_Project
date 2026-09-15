import assert from "node:assert/strict";
import { test } from "node:test";

async function loadRunnerHelpers() {
  try {
    return await import("./check-api-lib.mjs");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      assert.fail(
        "check-api-lib.mjs must provide the testable runner behavior",
      );
    }
    throw error;
  }
}

test("sanitizer removes quoted fields, multiline values, bearer values, URL userinfo, and known values", async () => {
  const { sanitizeSensitiveText } = await loadRunnerHelpers();
  const knownValue = "synthetic-known-value-42";
  const cases = [
    ["password=synthetic-basic-value", "synthetic-basic-value"],
    ['{"password":"synthetic-json-value"}', "synthetic-json-value"],
    [
      '{"password":"synthetic-before-\\\"synthetic-after-escaped-quote"}',
      "synthetic-after-escaped-quote",
    ],
    [
      "'api_key' = 'synthetic-line-one\nsynthetic-line-two'",
      "synthetic-line-one",
    ],
    [
      '{"authorization":"Bearer synthetic-bearer-value"}',
      "synthetic-bearer-value",
    ],
    [
      "postgresql://demo:synthetic-db-value@127.0.0.1:55432/test",
      "synthetic-db-value",
    ],
    [`free-form ${knownValue} text`, knownValue],
  ];

  for (const [input, forbidden] of cases) {
    const sanitized = sanitizeSensitiveText(input, [knownValue]);
    assert.equal(sanitized.includes(forbidden), false, input);
    assert.match(sanitized, /\[REDACTED\]/);
  }

  const parsed = JSON.parse(
    sanitizeSensitiveText('{"password":"synthetic-json-value"}'),
  );
  assert.equal(parsed.password, "[REDACTED]");
});

test("recursive sanitizer scrubs every nested artifact field without changing non-string evidence", async () => {
  const { sanitizeEvidenceValue } = await loadRunnerHelpers();
  const knownValue = "synthetic-nested-known-42";
  const sanitized = sanitizeEvidenceValue(
    {
      exit_code: 7,
      timed_out: false,
      error: { message: `failed with ${knownValue}` },
      output: {
        stdout: '{"token":"synthetic-output-token"}',
        stderr: "redis://worker:synthetic-url-value@localhost:6379/0",
      },
      password: "synthetic-structured-value",
    },
    [knownValue],
  );

  const serialized = JSON.stringify(sanitized);
  for (const forbidden of [
    knownValue,
    "synthetic-output-token",
    "synthetic-url-value",
    "synthetic-structured-value",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(sanitized.exit_code, 7);
  assert.equal(sanitized.timed_out, false);
  assert.equal(sanitized.password, "[REDACTED]");
});

test("known-secret discovery does not leave short configured values outside sanitization", async () => {
  const { collectKnownSecretValues } = await loadRunnerHelpers();
  assert.deepEqual(
    collectKnownSecretValues({
      API_TOKEN: "xy",
      SERVICE_PASSWORD: "synthetic-long-value",
      ORDINARY_SETTING: "visible",
      EMPTY_SECRET: "",
    }),
    ["synthetic-long-value", "xy"],
  );
});

test("source selection covers source, tests, scripts, config, migrations, generated contracts, and lockfiles", async () => {
  const { selectEvidencePaths } = await loadRunnerHelpers();
  const selected = selectEvidencePaths([
    "apps/api/src/app.ts",
    "apps/api/tests/http.test.ts",
    "apps/api/vitest.unit.config.ts",
    "apps/api/dist/app.js",
    "packages/db/migrations/0006_http.sql",
    "scripts/check-api.mjs",
    "compose.g1.yaml",
    "package-lock.json",
    "tsconfig.json",
    ".env",
    ".env.example",
    "docs/openapi.yaml",
    "docs/api-evidence/batch-03/API-05/result.json",
    "README.md",
  ]);

  assert.deepEqual(selected, [
    ".env.example",
    "apps/api/src/app.ts",
    "apps/api/tests/http.test.ts",
    "apps/api/vitest.unit.config.ts",
    "compose.g1.yaml",
    "docs/openapi.yaml",
    "package-lock.json",
    "packages/db/migrations/0006_http.sql",
    "scripts/check-api.mjs",
    "tsconfig.json",
  ]);
});

test("source fingerprint evidence is deterministic and assigns meaningful categories", async () => {
  const { fingerprintSourceEntries } = await loadRunnerHelpers();
  const first = fingerprintSourceEntries([
    { path: "scripts/check-api.mjs", content: Buffer.from("abc") },
    { path: "package-lock.json", content: Buffer.alloc(0) },
  ]);
  const second = fingerprintSourceEntries([
    { path: "package-lock.json", content: Buffer.alloc(0) },
    { path: "scripts\\check-api.mjs", content: Buffer.from("abc") },
  ]);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    algorithm: "sha256",
    file_count: 2,
    category_counts: { lockfile: 1, script: 1 },
    files: {
      "package-lock.json": {
        bytes: 0,
        category: "lockfile",
        sha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      },
      "scripts/check-api.mjs": {
        bytes: 3,
        category: "script",
        sha256:
          "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      },
    },
  });
});

test("git status evidence distinguishes tracked and untracked source from unrelated files", async () => {
  const { parseGitStatus } = await loadRunnerHelpers();
  const status = [
    " M apps/api/src/app.ts",
    "?? scripts/new-runner.mjs",
    "?? docs/reviewer-note.md",
    " D packages/engine/src/old.ts",
    "",
  ].join("\0");

  assert.deepEqual(parseGitStatus(status), {
    dirty: true,
    tracked_changes: ["apps/api/src/app.ts", "packages/engine/src/old.ts"],
    untracked: ["docs/reviewer-note.md", "scripts/new-runner.mjs"],
    source_changes: {
      tracked: ["apps/api/src/app.ts", "packages/engine/src/old.ts"],
      untracked: ["scripts/new-runner.mjs"],
    },
  });
});

test("gate plan includes engine unit and passing commands cannot promote missing negative coverage", async () => {
  const { createGatePlan, deriveGateAssessment } = await loadRunnerHelpers();
  const plan = createGatePlan();
  assert.deepEqual(
    plan.map(({ id }) => id),
    [
      "runner-unit",
      "check",
      "engine-unit",
      "api-unit",
      "api-integration",
      "db-integration",
      "engine-integration",
    ],
  );

  const assessment = deriveGateAssessment(
    plan.map(({ id }) => ({ id, exit_code: 0 })),
    {
      positive_http_lifecycle: "PASS",
      required_negative_http_matrix: "NOT_RUN",
    },
    { status: "NOT_INDEPENDENTLY_VERIFIED" },
  );
  assert.deepEqual(assessment, {
    command_status: "PASS",
    api_verdict: "PARTIAL",
    api_technical_pass: false,
    process_exit_code: 0,
    reasons: [
      "required_negative_http_matrix=NOT_RUN",
      "cleanup=NOT_INDEPENDENTLY_VERIFIED",
    ],
  });
});

test("a cleanup failure makes the gate fail even when every command exits zero", async () => {
  const { deriveGateAssessment } = await loadRunnerHelpers();
  assert.deepEqual(
    deriveGateAssessment(
      [{ id: "check", exit_code: 0 }],
      { required_negative_http_matrix: "PASS" },
      { status: "FAIL" },
    ),
    {
      command_status: "PASS",
      api_verdict: "NEEDS_FIX",
      api_technical_pass: false,
      process_exit_code: 1,
      reasons: ["cleanup=FAIL"],
    },
  );
});

test("runner sanitizes real child stdout, stderr, command metadata, and spawn errors", async () => {
  const { runCommandSync } = await loadRunnerHelpers();
  const knownValue = "synthetic-child-known-42";
  const result = runCommandSync(
    {
      id: "synthetic-child",
      executable: process.execPath,
      args: [
        "-e",
        `console.log('{"password":"synthetic-child-json"}'); console.error('postgresql://u:synthetic-child-url@localhost/db'); process.exit(7); // ${knownValue}`,
      ],
      cwd: process.cwd(),
      timeout_ms: 10_000,
    },
    [knownValue],
  );
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    knownValue,
    "synthetic-child-json",
    "synthetic-child-url",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(result.exit_code, 7);

  const missing = runCommandSync(
    {
      id: "synthetic-missing",
      executable: `missing-${knownValue}`,
      args: [],
      cwd: process.cwd(),
      timeout_ms: 10_000,
    },
    [knownValue],
  );
  assert.equal(JSON.stringify(missing).includes(knownValue), false);
  assert.equal(missing.exit_code, 1);
  assert.equal(typeof missing.error, "string");
});
