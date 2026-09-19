import { describe, it, expect, vi } from "vitest";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, rm, mkdir } from "node:fs/promises";
import {
  runLiveEvaluation,
  createFileJournalWriter,
  type LiveEvaluationSession,
} from "../src/ai/live-evaluation/runner.js";
import { scheduleLiveTrials } from "../src/ai/live-evaluation/schedule.js";
import {
  parseLiveDataset,
  parseLiveEvalConfigFile,
  type ParsedLiveCase,
} from "../src/ai/live-evaluation/dataset.js";
import { createOfflineReviewedCatalog } from "../src/ai/local-catalog.js";
import {
  InMemoryProviderCallLedger,
  ProviderAccountingError,
} from "../src/ai/providers/accounting.js";
import type {
  LiveJournalEvent,
  LiveProfileConfig,
  LiveRubric,
} from "../src/ai/live-evaluation/contracts.js";
import type { StructuredModelClient } from "../src/ai/ports.js";
import type { ToolRetriever } from "../src/ai/retrieval.js";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));

async function setupTestFixtures() {
  const rawCases = JSON.parse(
    await readFile(join(root, "testdata/test-cases.json"), "utf8"),
  );
  const rawManifest = JSON.parse(
    await readFile(join(root, "testdata/experiment-manifest.json"), "utf8"),
  );
  const rawRubric: LiveRubric = JSON.parse(
    await readFile(join(root, "testdata/ai-live-rubric.json"), "utf8"),
  );
  const rawConfig = JSON.parse(
    await readFile(join(root, "testdata/ai-live-eval-config.json"), "utf8"),
  );
  const catalogJson = JSON.parse(
    await readFile(join(root, "testdata/tools.json"), "utf8"),
  );

  const parsedDataset = parseLiveDataset(rawCases, rawManifest, rawRubric);
  const parsedConfig = parseLiveEvalConfigFile(rawConfig);
  const catalog = createOfflineReviewedCatalog(catalogJson);

  const casesMap = new Map<string, ParsedLiveCase>();
  for (const c of parsedDataset.cases) {
    casesMap.set(c.input.id, c);
  }

  const profilesMap = new Map<string, LiveProfileConfig>();
  for (const [id, prof] of Object.entries(parsedConfig.profiles)) {
    profilesMap.set(id, prof);
  }

  return {
    casesMap,
    profilesMap,
    catalog,
    rubric: rawRubric,
  };
}

function createMockSession(
  casesMap: Map<string, ParsedLiveCase>,
  catalogTools: readonly any[],
  opts?: {
    onProduce?: (input: any) => void;
  },
): LiveEvaluationSession {
  const model: StructuredModelClient = {
    async complete(request) {
      opts?.onProduce?.(request);
      // Determine which case this is from request userPrompt
      const matchedCase = [...casesMap.values()].find((c) =>
        request.userPrompt.includes(c.input.prompt),
      );
      if (matchedCase) {
        return {
          output: matchedCase.oracle.expected_result,
          provider: "mock-provider",
          model: "mock-model",
          usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
        };
      }
      return {
        output: { kind: "refusal", reason: "no match" },
        provider: "mock-provider",
        model: "mock-model",
      };
    },
  };

  const retriever: ToolRetriever = {
    async retrieve(req) {
      const matchedCase = [...casesMap.values()].find(
        (c) =>
          req.query.includes(c.input.prompt) ||
          c.input.prompt.includes(req.query),
      );
      const expectedToolNames = new Set(
        matchedCase?.oracle.expected_result.kind === "plan"
          ? matchedCase.oracle.expected_result.plan.steps.map(
              (s) => `${s.tool.server}.${s.tool.name}`,
            )
          : [],
      );
      const relevant = catalogTools.filter((t) =>
        expectedToolNames.has(`${t.server}.${t.name}`),
      );
      const others = catalogTools.filter(
        (t) => !expectedToolNames.has(`${t.server}.${t.name}`),
      );
      const selected = [...relevant, ...others].slice(0, req.topK);

      return {
        tools: selected,
        scores: selected.map((t) => ({ tool: t, score: 0.9 })),
        variant: req.variant,
        topK: req.topK,
        queryHash: "mock-hash",
        latencyMs: 5,
      };
    },
  };

  return { model, retriever };
}

describe("ai-live-runner", () => {
  it("executes scheduled trials and records complete journal events", async () => {
    const { casesMap, profilesMap, catalog, rubric } =
      await setupTestFixtures();

    // Schedule 1 repetition of 1 case (b01) on 7 cells = 7 trials
    const trials = scheduleLiveTrials(["openai-only"], ["b01"], {
      repetitions: 1,
    });
    expect(trials).toHaveLength(7);

    const journal: LiveJournalEvent[] = [];
    const ledger = new InMemoryProviderCallLedger({
      campaignLimitMicros: 10_000_000,
    });
    const session = createMockSession(casesMap, catalog.tools);

    const result = await runLiveEvaluation({
      trials,
      cases: casesMap,
      profiles: profilesMap,
      registry: catalog.tools,
      rubric,
      ledger,
      getSession: async () => session,
      journalWriter: async (e) => {
        journal.push(e);
      },
    });

    expect(result.plannedCount).toBe(7);
    expect(result.completedCount).toBe(7);
    expect(result.failedCount).toBe(0);
    expect(result.cancelledCount).toBe(0);
    expect(result.notStartedCount).toBe(0);
    expect(result.verdict).toBe("LIVE_EVALUATION_PASS");

    // Every scheduled trial must transition: scheduled -> started -> completed
    const scheduledEvents = journal.filter(
      (e) => e.event === "trial_scheduled",
    );
    const startedEvents = journal.filter((e) => e.event === "trial_started");
    const completedEvents = journal.filter(
      (e) => e.event === "trial_completed",
    );

    expect(scheduledEvents).toHaveLength(7);
    expect(startedEvents).toHaveLength(7);
    expect(completedEvents).toHaveLength(7);

    // Assert exact terminal accounting: planned === completed + failed + cancelled + notStarted
    expect(result.plannedCount).toBe(
      result.completedCount +
        result.failedCount +
        result.cancelledCount +
        result.notStartedCount,
    );
  });

  it("handles budget cap breach by cancelling active and marking subsequent as not_started", async () => {
    const { casesMap, profilesMap, catalog, rubric } =
      await setupTestFixtures();

    const trials = scheduleLiveTrials(["openai-only"], ["b01", "b02"], {
      repetitions: 1,
    });
    expect(trials).toHaveLength(14); // 2 cases × 7 cells

    let callCount = 0;
    const baseSession = createMockSession(casesMap, catalog.tools);
    const session: LiveEvaluationSession = {
      ...baseSession,
      model: {
        async complete(req) {
          callCount++;
          if (callCount >= 3) {
            throw new ProviderAccountingError(
              "BUDGET_EXCEEDED",
              "simulated budget cap breach after 2 trials",
            );
          }
          return baseSession.model.complete(req);
        },
      },
    };

    const journal: LiveJournalEvent[] = [];
    const ledger = new InMemoryProviderCallLedger({
      campaignLimitMicros: 1000,
    });

    const result = await runLiveEvaluation({
      trials,
      cases: casesMap,
      profiles: profilesMap,
      registry: catalog.tools,
      rubric,
      ledger,
      getSession: async () => session,
      journalWriter: async (e) => {
        journal.push(e);
      },
    });

    expect(result.verdict).toBe("LIVE_EVALUATION_PARTIAL");
    expect(result.completedCount).toBe(2);
    expect(result.cancelledCount).toBe(1); // the one that breached
    expect(result.notStartedCount).toBe(11); // remaining unstarted
    expect(result.plannedCount).toBe(14);

    // Exact terminal accounting preserved
    expect(result.plannedCount).toBe(
      result.completedCount +
        result.failedCount +
        result.cancelledCount +
        result.notStartedCount,
    );
    expect(result.haltReason).toContain("Budget exceeded");

    // Check not_started events in journal
    const notStartedEvents = journal.filter(
      (e) => e.event === "trial_not_started",
    );
    expect(notStartedEvents).toHaveLength(11);
  });

  it("handles abort signal by cancelling and preserving previous completions", async () => {
    const { casesMap, profilesMap, catalog, rubric } =
      await setupTestFixtures();

    const trials = scheduleLiveTrials(["openai-only"], ["b01", "b02"], {
      repetitions: 1,
    });
    expect(trials).toHaveLength(14);

    const controller = new AbortController();
    let completedSoFar = 0;

    const session = createMockSession(casesMap, catalog.tools);

    const ledger = new InMemoryProviderCallLedger({
      campaignLimitMicros: 10_000_000,
    });

    const result = await runLiveEvaluation({
      trials,
      cases: casesMap,
      profiles: profilesMap,
      registry: catalog.tools,
      rubric,
      ledger,
      getSession: async () => session,
      signal: controller.signal,
      journalWriter: async (event) => {
        if (event.event === "trial_completed") {
          completedSoFar++;
          if (completedSoFar === 2) {
            controller.abort(
              new Error("user interrupted evaluation with Ctrl+C"),
            );
          }
        }
      },
    });

    expect(result.verdict).toBe("LIVE_EVALUATION_PARTIAL");
    expect(result.completedCount).toBe(2);
    expect(result.notStartedCount).toBe(12);
    expect(result.plannedCount).toBe(14);
    expect(result.plannedCount).toBe(
      result.completedCount +
        result.failedCount +
        result.cancelledCount +
        result.notStartedCount,
    );
  });

  it("prevents gold canary leakage into prompt payload", async () => {
    const { casesMap, profilesMap, catalog, rubric } =
      await setupTestFixtures();

    const trials = scheduleLiveTrials(["openai-only"], ["b01"], {
      repetitions: 1,
    });

    // Artificially inject canary into case prompt
    const corruptedCases = new Map(casesMap);
    const b01 = corruptedCases.get("b01")!;
    corruptedCases.set("b01", {
      ...b01,
      input: {
        ...b01.input,
        prompt: `${b01.input.prompt} SECRET_GOLD_CANARY_TOKEN_999`,
      },
    });

    const session = createMockSession(corruptedCases, catalog.tools);
    const ledger = new InMemoryProviderCallLedger({
      campaignLimitMicros: 10_000_000,
    });

    const result = await runLiveEvaluation({
      trials: [trials[0]!],
      cases: corruptedCases,
      profiles: profilesMap,
      registry: catalog.tools,
      rubric,
      ledger,
      getSession: async () => session,
      canary: "SECRET_GOLD_CANARY_TOKEN_999",
    });

    expect(result.failedCount).toBe(1);
    expect(result.outcomes[0]?.error).toContain(
      "Gold canary leaked in payload string:",
    );
  });

  it("writes valid JSONL append-only events via createFileJournalWriter", async () => {
    const tempDir = resolve(root, ".artifacts", "test-runner-journal");
    await mkdir(tempDir, { recursive: true });
    const journalPath = join(tempDir, "test-journal.jsonl");

    try {
      const writer = createFileJournalWriter(journalPath);
      await writer({
        event: "trial_scheduled",
        timestamp: "2026-09-19T00:00:00.000Z",
        trialId: "t1",
        payload: { caseId: "b01" },
      });
      await writer({
        event: "trial_started",
        timestamp: "2026-09-19T00:00:01.000Z",
        trialId: "t1",
        payload: {},
      });
      await writer({
        event: "trial_completed",
        timestamp: "2026-09-19T00:00:02.000Z",
        trialId: "t1",
        payload: { durationMs: 1000 },
      });

      const lines = (await readFile(journalPath, "utf8"))
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));

      expect(lines).toHaveLength(3);
      expect(lines[0].event).toBe("trial_scheduled");
      expect(lines[1].event).toBe("trial_started");
      expect(lines[2].event).toBe("trial_completed");
      await writer.close();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
