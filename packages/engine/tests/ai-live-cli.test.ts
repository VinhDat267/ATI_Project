import { describe, it, expect, afterEach } from "vitest";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import {
  runLiveEvaluationCli,
  validateEvalDatabaseUrl,
} from "../src/ai/live-evaluation/cli.js";
import { createOfflineReviewedCatalog } from "../src/ai/local-catalog.js";
import { createLiveEvaluationRuntime } from "../src/ai/live-evaluation/runtime.js";
import type { LiveEvaluationSession } from "../src/ai/live-evaluation/runner.js";
import type { AiLiveApprovalRecord } from "../src/ai/providers/approval.js";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function createTempDir(prefix = "ai-live-cli-"): Promise<string> {
  const dir = resolve(
    root,
    ".artifacts",
    `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

async function writeValidApproval(
  dir: string,
  overrides?: Partial<AiLiveApprovalRecord>,
): Promise<string> {
  const configContent = await readFile(
    join(root, "testdata/ai-live-eval-config.json"),
    "utf8",
  );
  const config = JSON.parse(configContent) as {
    profiles: Record<
      string,
      {
        planning: { provider: "openai" | "google"; model: string };
        queryExpansion: { provider: "openai" | "google"; model: string };
        embedding: { provider: "openai" | "google"; model: string };
      }
    >;
  };
  const profileId = overrides?.profileId ?? "openai-only";
  const phase = overrides?.phase ?? "smoke";
  const profile = config.profiles[profileId]!;
  const roleProfiles = {
    planning: profile.planning,
    repair: profile.planning,
    replan: profile.planning,
    query_expansion: profile.queryExpansion,
    embedding: profile.embedding,
  } as const;
  const roles =
    phase === "index" ? (["embedding"] as const) : Object.keys(roleProfiles);
  const providers = [
    ...new Set(
      roles.map(
        (role) => roleProfiles[role as keyof typeof roleProfiles].provider,
      ),
    ),
  ];
  const models = Object.fromEntries(
    roles.map((role) => [
      role,
      roleProfiles[role as keyof typeof roleProfiles].model,
    ]),
  );
  const crypto = await import("node:crypto");
  const configHash = crypto
    .createHash("sha256")
    .update(configContent)
    .digest("hex");

  const approval: AiLiveApprovalRecord = {
    kind: "ai-live-approval",
    campaignId: "camp-cli-test",
    phase,
    profileId,
    configHash,
    providers,
    models,
    budgetMicros: 5_000_000,
    approvedAt: new Date(Date.now() - 10_000).toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    ...overrides,
  };

  const filePath = join(dir, "approval.json");
  await writeFile(filePath, `${JSON.stringify(approval, null, 2)}\n`, "utf8");
  return filePath;
}

function createTestRuntime() {
  return createLiveEvaluationRuntime({
    probe: async () => ({
      calls: [
        {
          role: "planning",
          provider: "openai",
          model: "gpt-5.6-terra",
          requestId: "probe-test",
        },
      ],
    }),
    index: async () => ({
      index: {
        id: "index-test",
        provenanceHash: "a".repeat(64),
        vectorHash: "b".repeat(64),
        policyHash: "c".repeat(64),
      },
      rowCount: 10,
    }),
  });
}

function createMockSession(
  catalogTools: readonly any[],
  expectedResult: any,
): LiveEvaluationSession {
  return {
    model: {
      async complete() {
        return {
          output: expectedResult,
          provider: "openai",
          model: "gpt-5.6-terra",
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        };
      },
    },
    retriever: {
      async retrieve(req) {
        const tool = catalogTools.find(
          (t) => t.server === "task_hub" && t.name === "list_cards",
        );
        const others = catalogTools.filter(
          (t) => !(t.server === "task_hub" && t.name === "list_cards"),
        );
        const tools = [tool, ...others].filter(Boolean).slice(0, req.topK);
        return {
          tools,
          scores: tools.map((t) => ({ tool: t, score: 0.95 })),
          variant: req.variant,
          topK: req.topK,
          queryHash: "hash",
          latencyMs: 1,
        };
      },
    },
  };
}

describe("ai-live-cli", () => {
  it("executes preflight --offline cleanly without network", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("NETWORK_FORBIDDEN");
    };

    try {
      const result = await runLiveEvaluationCli(["preflight", "--offline"], {
        root,
      });
      expect(result.exitCode).toBe(0);
      expect(result.message).toBe("Preflight check passed (offline)");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects preflight without --offline flag or with unknown flags", async () => {
    const res1 = await runLiveEvaluationCli(["preflight"], { root });
    expect(res1.exitCode).toBe(2);
    expect(res1.message).toContain("preflight requires --offline flag");

    const res2 = await runLiveEvaluationCli(
      ["preflight", "--offline", "--bogus"],
      { root },
    );
    expect(res2.exitCode).toBe(2);
    expect(res2.message).toContain('preflight rejects unknown flag "--bogus"');
  });

  it("executes freeze command and writes freeze.json", async () => {
    const tempDir = await createTempDir("freeze-test");
    const result = await runLiveEvaluationCli(
      ["freeze", "--profile", "openai-only", "--campaign", "camp-cli-test"],
      {
        root,
        outputRoot: tempDir,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.artifactPath).toBeTruthy();
    expect(result.message).toContain(
      'Live evaluation freeze created for profile "openai-only"',
    );

    const content = JSON.parse(await readFile(result.artifactPath!, "utf8"));
    expect(content.format).toBe("ati-ai-live-freeze-v1");
    expect(content.profileId).toBe("openai-only");
  });

  it("validates database URL isolation", () => {
    expect(() =>
      validateEvalDatabaseUrl(undefined, "postgres://prod/app"),
    ).toThrow(/AI_EVAL_DATABASE_URL environment variable is required/);

    expect(() =>
      validateEvalDatabaseUrl("postgres://prod/app", "postgres://prod/app"),
    ).toThrow(
      /AI_EVAL_DATABASE_URL must not point to the normal application database/,
    );

    // URL normalization check: different query params or case but same host and path
    expect(() =>
      validateEvalDatabaseUrl(
        "postgres://prod:5432/app?sslmode=disable",
        "postgres://PROD:5432/app",
      ),
    ).toThrow(
      /AI_EVAL_DATABASE_URL must not point to the normal application database/,
    );

    expect(() =>
      validateEvalDatabaseUrl("postgres://test/eval", "postgres://prod/app"),
    ).not.toThrow();

    expect(() =>
      validateEvalDatabaseUrl(
        "postgresql://127.0.0.1:5432/app",
        "postgres://localhost/app",
      ),
    ).toThrow(
      /AI_EVAL_DATABASE_URL must not point to the normal application database/,
    );
    expect(() =>
      validateEvalDatabaseUrl(
        "postgresql://localhost:5433/app",
        "postgres://127.0.0.1:5432/app",
      ),
    ).not.toThrow();
    expect(() =>
      validateEvalDatabaseUrl("postgresql://127.0.0.1:55532/wap_g1", undefined),
    ).toThrow(
      /AI_EVAL_DATABASE_URL must not point to the normal application database/,
    );
    expect(() =>
      validateEvalDatabaseUrl("https://example.test/eval", "postgres://prod/app"),
    ).toThrow(/must use PostgreSQL/);
  });

  it("rejects probe/index/run when --execute flag is omitted", async () => {
    const tempDir = await createTempDir("safety-test");
    const approvalPath = await writeValidApproval(tempDir);

    const probeRes = await runLiveEvaluationCli(
      [
        "probe",
        "--profile",
        "openai-only",
        "--campaign",
        "camp-cli-test",
        "--approval",
        approvalPath,
      ],
      { root },
    );
    expect(probeRes.exitCode).toBe(2);
    expect(probeRes.message).toContain(
      "Safety guard: --execute flag required for probe",
    );

    const indexRes = await runLiveEvaluationCli(
      [
        "index",
        "--profile",
        "openai-only",
        "--campaign",
        "camp-cli-test",
        "--approval",
        approvalPath,
      ],
      { root },
    );
    expect(indexRes.exitCode).toBe(2);
    expect(indexRes.message).toContain(
      "Safety guard: --execute flag required for index",
    );

    const runRes = await runLiveEvaluationCli(
      [
        "run",
        "--phase",
        "smoke",
        "--profile",
        "openai-only",
        "--campaign",
        "camp-cli-test",
        "--approval",
        approvalPath,
      ],
      { root },
    );
    expect(runRes.exitCode).toBe(2);
    expect(runRes.message).toContain(
      "Safety guard: --execute flag required for run",
    );
  });

  it("executes probe successfully with valid approval and --execute", async () => {
    const tempDir = await createTempDir("probe-test");
    const approvalPath = await writeValidApproval(tempDir, { phase: "probe" });

    const result = await runLiveEvaluationCli(
      [
        "probe",
        "--profile",
        "openai-only",
        "--campaign",
        "camp-cli-test",
        "--approval",
        approvalPath,
        "--execute",
      ],
      { root, runtime: createTestRuntime() },
    );

    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("Live probe passed for profile");
  });

  it("rejects a probe when the approval hash is not the raw config hash", async () => {
    const tempDir = await createTempDir("probe-config-hash-test");
    const approvalPath = await writeValidApproval(tempDir, {
      phase: "probe",
      configHash: "b".repeat(64),
    });
    let sessionTouched = false;

    const result = await runLiveEvaluationCli(
      [
        "probe",
        "--profile",
        "openai-only",
        "--campaign",
        "camp-cli-test",
        "--approval",
        approvalPath,
        "--execute",
      ],
      {
        root,
        getSession: async () => {
          sessionTouched = true;
          throw new Error("SESSION_MUST_NOT_BE_CREATED");
        },
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/configHash|scope/i);
    expect(sessionTouched).toBe(false);
  });

  it("executes index successfully with valid approval, eval DB and --execute", async () => {
    const tempDir = await createTempDir("index-test");
    const approvalPath = await writeValidApproval(tempDir, { phase: "index" });

    const result = await runLiveEvaluationCli(
      [
        "index",
        "--profile",
        "openai-only",
        "--campaign",
        "camp-cli-test",
        "--approval",
        approvalPath,
        "--execute",
      ],
      {
        root,
        env: {
          AI_EVAL_DATABASE_URL: "postgresql://user:pass@localhost:5432/eval_db",
          DATABASE_URL: "postgresql://user:pass@localhost:5432/app_db",
        },
        runtime: createTestRuntime(),
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("Tool index built and activated");
  });

  it("executes run --phase smoke and generates journal, summary.json, and summary.md", async () => {
    const tempDir = await createTempDir("run-smoke-test");
    const approvalPath = await writeValidApproval(tempDir, { phase: "smoke" });
    const catalogJson = JSON.parse(
      await readFile(join(root, "testdata/tools.json"), "utf8"),
    );
    const casesJson = JSON.parse(
      await readFile(join(root, "testdata/test-cases.json"), "utf8"),
    );
    const b01Case = casesJson.cases.find((c: any) => c.id === "b01");
    const catalog = createOfflineReviewedCatalog(catalogJson);
    const mockSession = createMockSession(
      catalog.tools,
      b01Case.expected_result,
    );

    const result = await runLiveEvaluationCli(
      [
        "run",
        "--phase",
        "smoke",
        "--profile",
        "openai-only",
        "--campaign",
        "camp-cli-test",
        "--approval",
        approvalPath,
        "--execute",
      ],
      {
        root,
        outputRoot: tempDir,
        getSession: async () => mockSession,
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.artifactPath).toBeTruthy();
    expect(result.message).toContain("Live evaluation finished");

    const summaryJson = JSON.parse(
      await readFile(result.artifactPath!, "utf8"),
    );
    expect(summaryJson.format).toBe("ati-ai-live-report-v1");
    expect(summaryJson.trialAccounting.totalPlanned).toBe(9);

    // Verify journal.jsonl was written
    const runDir = resolve(result.artifactPath!, "..");
    const journalContent = await readFile(
      join(runDir, "journal.jsonl"),
      "utf8",
    );
    expect(journalContent).toContain("trial_scheduled");
    expect(journalContent).toContain("trial_completed");

    // Verify summary.md was written
    const summaryMd = await readFile(join(runDir, "summary.md"), "utf8");
    expect(summaryMd).toContain("# AI Live Evaluation Report");

    // Test report command on this run directory
    const reportRes = await runLiveEvaluationCli(["report", "--run", runDir], {
      root,
    });
    expect(reportRes.exitCode).toBe(1);
    expect(reportRes.message).toContain("Report replayed and rendered");
  });

  it("rejects legacy-regression phase without --freeze flag", async () => {
    const tempDir = await createTempDir("legacy-fail-test");
    const approvalPath = await writeValidApproval(tempDir, {
      phase: "legacy-regression",
    });

    const result = await runLiveEvaluationCli(
      [
        "run",
        "--phase",
        "legacy-regression",
        "--profile",
        "openai-only",
        "--campaign",
        "camp-cli-test",
        "--approval",
        approvalPath,
        "--execute",
      ],
      { root },
    );

    expect(result.exitCode).toBe(2);
    expect(result.message).toContain(
      "Phase 'legacy-regression' requires --freeze <freeze-json>",
    );
  });

  it("extracts campaign ID from approval when --campaign is omitted in run command", async () => {
    const tempDir = await createTempDir("run-omit-campaign-test");
    const approvalPath = await writeValidApproval(tempDir, {
      phase: "smoke",
      campaignId: "camp-auto-extracted",
    });
    const catalogJson = JSON.parse(
      await readFile(join(root, "testdata/tools.json"), "utf8"),
    );
    const casesJson = JSON.parse(
      await readFile(join(root, "testdata/test-cases.json"), "utf8"),
    );
    const b01Case = casesJson.cases.find((c: any) => c.id === "b01");
    const catalog = createOfflineReviewedCatalog(catalogJson);
    const mockSession = createMockSession(
      catalog.tools,
      b01Case.expected_result,
    );

    // Omit --campaign flag from CLI call
    const result = await runLiveEvaluationCli(
      [
        "run",
        "--phase",
        "smoke",
        "--profile",
        "openai-only",
        "--approval",
        approvalPath,
        "--execute",
      ],
      {
        root,
        outputRoot: tempDir,
        getSession: async () => mockSession,
      },
    );

    expect(result.exitCode).toBe(1);
    const summaryJson = JSON.parse(
      await readFile(result.artifactPath!, "utf8"),
    );
    expect(summaryJson.campaignId).toBe("camp-auto-extracted");
  });
});
