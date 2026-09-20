/**
 * Unified Live Evaluation CLI.
 * Strictly enforces zero credentials in journals/reports, deterministic trial scheduling,
 * tamper-evident freeze verification, budget reservation, and offline invariance.
 */
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOfflineReviewedCatalog } from "../local-catalog.js";
import {
  parseLiveDataset,
  parseLiveEvalConfigFile,
  type ParsedLiveCase,
} from "./dataset.js";
import {
  FrozenLiveEvaluationSchema,
  type FrozenLiveEvaluation,
  type LiveEvaluationReport,
  type LiveProfileConfig,
  type LiveRubric,
  type LiveTrialOutcome,
  type LiveTrialScheduleItem,
} from "./contracts.js";
import {
  createLiveFreeze,
  assertLiveFrozen,
  computeLiveFingerprints,
} from "./freeze.js";
import { scheduleLiveTrials } from "./schedule.js";
import {
  runLiveEvaluation,
  createFileJournalWriter,
  type LiveEvaluationSession,
  type LiveEvaluationSessionContext,
} from "./runner.js";
import {
  buildLiveEvaluationReport,
  renderLiveEvaluationMarkdown,
} from "./report.js";
import { replayLiveJournal } from "./journal.js";
import { recoverLiveEvaluationState } from "./recovery.js";
import {
  parseAiLiveApprovalRecord,
  assertAiLiveApproval,
  type AiLiveApprovalRecord,
} from "../providers/approval.js";
import { InMemoryProviderCallLedger } from "../providers/accounting.js";
import {
  deriveLiveExecutionScope,
  hashLiveConfig,
  type LiveExecutionPhase,
} from "./authorization.js";
import type { LiveEvaluationRuntime } from "./runtime.js";

export interface LiveEvaluationCliEnvironment {
  readonly root?: string;
  readonly outputRoot?: string;
  readonly now?: () => Date;
  readonly runId?: () => string;
  readonly env?: Record<string, string | undefined>;
  readonly runtime?: LiveEvaluationRuntime;
  readonly getSession?: (
    context: LiveEvaluationSessionContext,
  ) => Promise<LiveEvaluationSession>;
}

export interface LiveEvaluationCliResult {
  readonly exitCode: 0 | 1 | 2;
  readonly artifactPath: string | null;
  readonly message: string;
  readonly report?: LiveEvaluationReport;
}

const defaultRoot = resolve(
  fileURLToPath(new URL("../../../../../", import.meta.url)),
);

export function validateEvalDatabaseUrl(
  evalUrl: string | undefined,
  appUrl: string | undefined,
): void {
  if (!evalUrl || !evalUrl.trim()) {
    throw new Error(
      "AI_EVAL_DATABASE_URL environment variable is required for database operations but was not provided",
    );
  }
  const trimmedEval = evalUrl.trim();
  if (appUrl) {
    const trimmedApp = appUrl.trim();
    if (trimmedEval === trimmedApp) {
      throw new Error(
        "AI_EVAL_DATABASE_URL must not point to the normal application database (DATABASE_URL)",
      );
    }
    try {
      const evalParsed = new URL(trimmedEval);
      const appParsed = new URL(trimmedApp);
      if (
        evalParsed.host.toLowerCase() === appParsed.host.toLowerCase() &&
        evalParsed.pathname.toLowerCase() === appParsed.pathname.toLowerCase()
      ) {
        throw new Error(
          "AI_EVAL_DATABASE_URL must not point to the normal application database (DATABASE_URL)",
        );
      }
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes("AI_EVAL_DATABASE_URL must not point")
      ) {
        throw err;
      }
      // If URL parsing fails for non-standard connection strings, exact check above already ran
    }
  }
}

function parseCliArgs(args: readonly string[]): {
  readonly command: string;
  readonly flags: Record<string, string | boolean>;
} {
  if (args.length === 0) {
    throw new Error(
      "No command provided. Valid commands: preflight, probe, index, run, freeze, report",
    );
  }
  const command = args[0]!;
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: "${arg}"`);
    }
    const flagName = arg.slice(2);
    if (!flagName) {
      throw new Error("Invalid empty flag '--'");
    }
    const nextArg = args[i + 1];
    if (nextArg !== undefined && !nextArg.startsWith("--")) {
      flags[flagName] = nextArg;
      i++;
    } else {
      flags[flagName] = true;
    }
  }

  return { command, flags };
}

function cliError(
  error: unknown,
  exitCode: 0 | 1 | 2 = 2,
): LiveEvaluationCliResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    exitCode,
    artifactPath: null,
    message: message.replace(/\s+/g, " ").slice(0, 500),
  };
}

async function writeExclusive(path: string, content: string): Promise<void> {
  await writeFile(path, content, { encoding: "utf8", flag: "wx" });
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function readLiveConfig(root: string): Promise<{
  readonly raw: Buffer;
  readonly parsed: ReturnType<typeof parseLiveEvalConfigFile>;
  readonly hash: string;
}> {
  const raw = await readFile(join(root, "testdata/ai-live-eval-config.json"));
  return {
    raw,
    parsed: parseLiveEvalConfigFile(JSON.parse(raw.toString("utf8"))),
    hash: hashLiveConfig(raw),
  };
}

export async function runLiveEvaluationCli(
  args: readonly string[],
  environment: LiveEvaluationCliEnvironment = {},
): Promise<LiveEvaluationCliResult> {
  const root = resolve(environment.root ?? defaultRoot);
  const outputRoot = resolve(
    environment.outputRoot ?? join(root, ".artifacts", "ai-live"),
  );
  const now = environment.now ?? (() => new Date());
  const runId =
    environment.runId ??
    (() => `run-${now().toISOString().replace(/[:.]/g, "-")}`);
  const env = environment.env ?? process.env;

  let parsed: {
    readonly command: string;
    readonly flags: Record<string, string | boolean>;
  };

  try {
    parsed = parseCliArgs(args);
  } catch (error) {
    return cliError(error, 2);
  }

  const { command, flags } = parsed;

  // 1. PREFLIGHT
  if (command === "preflight") {
    const allowedFlags = new Set(["offline"]);
    for (const f of Object.keys(flags)) {
      if (!allowedFlags.has(f)) {
        return cliError(
          new Error(`preflight rejects unknown flag "--${f}"`),
          2,
        );
      }
    }
    if (flags.offline !== true) {
      return cliError(
        new Error(
          "preflight requires --offline flag and does zero network calls",
        ),
        2,
      );
    }

    try {
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

      parseLiveDataset(rawCases, rawManifest, rawRubric);
      const parsedConfig = parseLiveEvalConfigFile(rawConfig);
      createOfflineReviewedCatalog(catalogJson);

      await computeLiveFingerprints(root);

      return {
        exitCode: 0,
        artifactPath: null,
        message: "Preflight check passed (offline)",
      };
    } catch (error) {
      return cliError(error, 2);
    }
  }

  // 2. FREEZE
  if (command === "freeze") {
    const allowedFlags = new Set(["profile", "campaign", "approval", "output"]);
    for (const f of Object.keys(flags)) {
      if (!allowedFlags.has(f)) {
        return cliError(new Error(`freeze rejects unknown flag "--${f}"`), 2);
      }
    }
    if (typeof flags.profile !== "string" || !flags.profile.trim()) {
      return cliError(new Error("freeze requires --profile <profile-id>"), 2);
    }
    if (typeof flags.campaign !== "string" || !flags.campaign.trim()) {
      return cliError(new Error("freeze requires --campaign <id>"), 2);
    }

    try {
      const freeze = await createLiveFreeze({
        root,
        profileId: flags.profile,
        campaignId: flags.campaign,
        createdAt: now().toISOString(),
      });

      const dir = join(outputRoot, runId());
      await mkdir(dir, { recursive: true });
      const artifactPath =
        typeof flags.output === "string" && flags.output.trim()
          ? resolve(flags.output)
          : join(dir, "freeze.json");

      await writeExclusive(
        artifactPath,
        `${JSON.stringify(freeze, null, 2)}\n`,
      );
      return {
        exitCode: 0,
        artifactPath,
        message: `Live evaluation freeze created for profile "${flags.profile}"`,
      };
    } catch (error) {
      return cliError(error, 1);
    }
  }

  // 3. PROBE
  if (command === "probe") {
    const allowedFlags = new Set([
      "profile",
      "campaign",
      "approval",
      "execute",
    ]);
    for (const f of Object.keys(flags)) {
      if (!allowedFlags.has(f)) {
        return cliError(new Error(`probe rejects unknown flag "--${f}"`), 2);
      }
    }
    if (typeof flags.profile !== "string" || !flags.profile.trim()) {
      return cliError(new Error("probe requires --profile <profile-id>"), 2);
    }
    if (typeof flags.campaign !== "string" || !flags.campaign.trim()) {
      return cliError(new Error("probe requires --campaign <id>"), 2);
    }
    if (typeof flags.approval !== "string" || !flags.approval.trim()) {
      return cliError(
        new Error("probe requires --approval <approved-json>"),
        2,
      );
    }
    if (flags.execute !== true) {
      return cliError(
        new Error("Safety guard: --execute flag required for probe"),
        2,
      );
    }

    try {
      const rawApproval = JSON.parse(
        await readFile(resolve(flags.approval), "utf8"),
      );
      const approval = parseAiLiveApprovalRecord(rawApproval);
      const { parsed: parsedConfig, hash: configHash } =
        await readLiveConfig(root);
      const profile = parsedConfig.profiles[flags.profile];
      if (!profile) {
        throw new Error(`Profile "${flags.profile}" not found in config`);
      }
      const scope = deriveLiveExecutionScope(profile, "probe", configHash);

      assertAiLiveApproval(
        approval,
        {
          campaignId: flags.campaign,
          phase: "probe",
          profileId: flags.profile,
          ...scope,
        },
        now(),
      );

      if (!environment.runtime) {
        throw new Error(
          "No live evaluation runtime configured for probe execution",
        );
      }
      const probe = await environment.runtime.probe({
        campaignId: flags.campaign,
        profileId: flags.profile,
        phase: "probe",
      });

      return {
        exitCode: 0,
        artifactPath: null,
        message: `Live probe passed for profile "${flags.profile}" (campaign: ${flags.campaign}, calls: ${probe.calls.length})`,
      };
    } catch (error) {
      return cliError(error, 1);
    }
  }

  // 4. INDEX
  if (command === "index") {
    const allowedFlags = new Set([
      "profile",
      "campaign",
      "approval",
      "execute",
    ]);
    for (const f of Object.keys(flags)) {
      if (!allowedFlags.has(f)) {
        return cliError(new Error(`index rejects unknown flag "--${f}"`), 2);
      }
    }
    if (typeof flags.profile !== "string" || !flags.profile.trim()) {
      return cliError(new Error("index requires --profile <profile-id>"), 2);
    }
    if (typeof flags.campaign !== "string" || !flags.campaign.trim()) {
      return cliError(new Error("index requires --campaign <id>"), 2);
    }
    if (typeof flags.approval !== "string" || !flags.approval.trim()) {
      return cliError(
        new Error("index requires --approval <approved-json>"),
        2,
      );
    }
    if (flags.execute !== true) {
      return cliError(
        new Error("Safety guard: --execute flag required for index"),
        2,
      );
    }

    try {
      const rawApproval = JSON.parse(
        await readFile(resolve(flags.approval), "utf8"),
      );
      const approval = parseAiLiveApprovalRecord(rawApproval);
      const { parsed: parsedConfig, hash: configHash } =
        await readLiveConfig(root);
      const profile = parsedConfig.profiles[flags.profile];
      if (!profile) {
        throw new Error(`Profile "${flags.profile}" not found in config`);
      }
      const scope = deriveLiveExecutionScope(profile, "index", configHash);

      assertAiLiveApproval(
        approval,
        {
          campaignId: flags.campaign,
          phase: "index",
          profileId: flags.profile,
          ...scope,
        },
        now(),
      );

      validateEvalDatabaseUrl(env.AI_EVAL_DATABASE_URL, env.DATABASE_URL);
      if (!environment.runtime) {
        throw new Error(
          "No live evaluation runtime configured for index execution",
        );
      }
      const indexed = await environment.runtime.index({
        campaignId: flags.campaign,
        profileId: flags.profile,
        phase: "index",
      });

      return {
        exitCode: 0,
        artifactPath: null,
        message: `Tool index built and activated for profile "${flags.profile}" (index: ${indexed.index.id}, rows: ${indexed.rowCount})`,
      };
    } catch (error) {
      return cliError(error, 1);
    }
  }

  // 5. RUN
  if (command === "run") {
    const allowedFlags = new Set([
      "phase",
      "profile",
      "campaign",
      "approval",
      "execute",
      "freeze",
    ]);
    for (const f of Object.keys(flags)) {
      if (!allowedFlags.has(f)) {
        return cliError(new Error(`run rejects unknown flag "--${f}"`), 2);
      }
    }
    if (typeof flags.phase !== "string" || !flags.phase.trim()) {
      return cliError(
        new Error("run requires --phase <smoke|dev|legacy-regression>"),
        2,
      );
    }
    if (
      flags.phase !== "smoke" &&
      flags.phase !== "dev" &&
      flags.phase !== "legacy-regression"
    ) {
      return cliError(
        new Error(
          `Invalid phase "${flags.phase}". Must be smoke, dev, or legacy-regression`,
        ),
        2,
      );
    }
    if (typeof flags.profile !== "string" || !flags.profile.trim()) {
      return cliError(new Error("run requires --profile <profile-id>"), 2);
    }
    if (typeof flags.approval !== "string" || !flags.approval.trim()) {
      return cliError(new Error("run requires --approval <approved-json>"), 2);
    }
    if (flags.execute !== true) {
      return cliError(
        new Error("Safety guard: --execute flag required for run"),
        2,
      );
    }
    if (
      flags.phase === "legacy-regression" &&
      typeof flags.freeze !== "string"
    ) {
      return cliError(
        new Error("Phase 'legacy-regression' requires --freeze <freeze-json>"),
        2,
      );
    }

    try {
      const rawApproval = JSON.parse(
        await readFile(resolve(flags.approval), "utf8"),
      );
      const approval = parseAiLiveApprovalRecord(rawApproval);

      const campaignId =
        typeof flags.campaign === "string" && flags.campaign.trim()
          ? flags.campaign.trim()
          : approval.campaignId;

      if (
        typeof flags.campaign === "string" &&
        flags.campaign.trim() !== approval.campaignId
      ) {
        throw new Error(
          `Campaign mismatch: flag "${flags.campaign}" does not match approval campaign "${approval.campaignId}"`,
        );
      }

      const rawCases = JSON.parse(
        await readFile(join(root, "testdata/test-cases.json"), "utf8"),
      );
      const rawManifest = JSON.parse(
        await readFile(join(root, "testdata/experiment-manifest.json"), "utf8"),
      );
      const rawRubric: LiveRubric = JSON.parse(
        await readFile(join(root, "testdata/ai-live-rubric.json"), "utf8"),
      );
      const { parsed: parsedConfig, hash: configHash } =
        await readLiveConfig(root);
      const catalogJson = JSON.parse(
        await readFile(join(root, "testdata/tools.json"), "utf8"),
      );

      const parsedDataset = parseLiveDataset(rawCases, rawManifest, rawRubric);
      const catalog = createOfflineReviewedCatalog(catalogJson);

      const profile = parsedConfig.profiles[flags.profile];
      if (!profile) {
        throw new Error(`Profile "${flags.profile}" not found in config`);
      }
      const scope = deriveLiveExecutionScope(
        profile,
        flags.phase as LiveExecutionPhase,
        configHash,
      );

      assertAiLiveApproval(
        approval,
        {
          campaignId,
          phase: flags.phase,
          profileId: flags.profile,
          ...scope,
        },
        now(),
      );

      const liveFreeze = await createLiveFreeze({
        root,
        profileId: flags.profile,
        campaignId,
        createdAt: now().toISOString(),
      });

      if (typeof flags.freeze === "string") {
        const savedFreeze = FrozenLiveEvaluationSchema.parse(
          JSON.parse(await readFile(resolve(flags.freeze), "utf8")),
        );
        assertLiveFrozen(liveFreeze, savedFreeze);
      }

      let caseIds: readonly string[];
      let repetitions = 3;
      if (flags.phase === "smoke") {
        caseIds = ["b01"];
        repetitions = 1;
      } else if (flags.phase === "dev") {
        caseIds = ["b01", "b02", "b03", "b04", "b05", "b06"];
      } else {
        caseIds = ["b07", "b08", "b09", "b10"];
      }

      const trials = scheduleLiveTrials([flags.profile], caseIds, {
        repetitions,
      });

      const currentRunId = runId();
      const dir = join(outputRoot, currentRunId);
      await mkdir(dir, { recursive: true });

      const journalPath = join(dir, "journal.jsonl");
      const journalWriter = createFileJournalWriter(journalPath);
      const ledger = new InMemoryProviderCallLedger({
        campaignLimitMicros: approval.budgetMicros,
      });

      const casesMap = new Map<string, ParsedLiveCase>();
      for (const c of parsedDataset.cases) {
        casesMap.set(c.input.id, c);
      }

      const profilesMap = new Map<string, LiveProfileConfig>();
      for (const [id, prof] of Object.entries(parsedConfig.profiles)) {
        profilesMap.set(id, prof);
      }

      const runResult = await runLiveEvaluation({
        trials,
        cases: casesMap,
        profiles: profilesMap,
        registry: catalog.tools,
        rubric: rawRubric,
        ledger,
        campaignId,
        runId: currentRunId,
        getSession:
          environment.getSession ??
          environment.runtime?.createSession.bind(environment.runtime) ??
          (async () => {
            throw new Error(
              "No live evaluation session provider available in CLI environment",
            );
          }),
        journalWriter,
      });
      await journalWriter.close();

      const report = buildLiveEvaluationReport({
        runId: currentRunId,
        createdAt: now().toISOString(),
        campaignId,
        freezeHash: liveFreeze.fingerprints.dataset,
        fingerprints: liveFreeze.fingerprints,
        plannedTrials: trials,
        outcomes: runResult.outcomes,
        ledgerRecords: ledger.records(),
        haltReason: runResult.haltReason,
      });

      const summaryJsonPath = join(dir, "summary.json");
      const summaryMdPath = join(dir, "summary.md");

      await writeExclusive(
        summaryJsonPath,
        `${JSON.stringify(report, null, 2)}\n`,
      );
      await writeExclusive(summaryMdPath, renderLiveEvaluationMarkdown(report));

      const exitCode = report.verdict === "LIVE_EVALUATION_PASS" ? 0 : 1;
      return {
        exitCode,
        artifactPath: summaryJsonPath,
        message: `Live evaluation finished with verdict: ${report.verdict}`,
        report,
      };
    } catch (error) {
      return cliError(error, 1);
    }
  }

  // 6. REPORT
  if (command === "report") {
    const allowedFlags = new Set(["run"]);
    for (const f of Object.keys(flags)) {
      if (!allowedFlags.has(f)) {
        return cliError(new Error(`report rejects unknown flag "--${f}"`), 2);
      }
    }
    if (typeof flags.run !== "string" || !flags.run.trim()) {
      return cliError(new Error("report requires --run <run-directory>"), 2);
    }

    try {
      const runDir = resolve(flags.run);
      const journal = await replayLiveJournal(join(runDir, "journal.jsonl"));
      const recovered = recoverLiveEvaluationState(journal.events);
      const summaryJsonPath = join(runDir, "summary.json");
      let previous: Partial<LiveEvaluationReport> = {};
      try {
        previous = JSON.parse(
          await readFile(summaryJsonPath, "utf8"),
        ) as Partial<LiveEvaluationReport>;
      } catch {
        // Missing/partial summary is expected during crash recovery. Journal is
        // the canonical source and no provider/database capability is created.
      }
      const zeroFingerprints = {
        dataset: "0".repeat(64),
        experimentManifest: "0".repeat(64),
        rubric: "0".repeat(64),
        catalog: "0".repeat(64),
        prompts: "0".repeat(64),
        evaluator: "0".repeat(64),
        config: "0".repeat(64),
        policiesAndArtifacts: "0".repeat(64),
        lockfile: "0".repeat(64),
      } as const;
      const report = buildLiveEvaluationReport({
        runId:
          previous.runId ??
          resolve(runDir).split(/[\\/]/).pop() ??
          "recovered-run",
        createdAt: now().toISOString(),
        campaignId: previous.campaignId ?? "recovered-campaign",
        freezeHash: previous.freezeHash ?? "0".repeat(64),
        fingerprints: previous.fingerprints ?? zeroFingerprints,
        plannedTrials: recovered.plannedTrials,
        outcomes: recovered.outcomes,
        ledgerRecords: recovered.ledgerRecords,
        evidenceKind: "FAKE_TRANSPORT_TEST",
        rubricStatus: "PROPOSED_EXPLORATORY",
        freezeMatches: false,
        indexCurrent: false,
        accountingReconciled: false,
        haltReason:
          journal.truncatedFinalLine || recovered.retryTrialIds.length > 0
            ? "Recovered from an interrupted journal; retry requires a new authorized run"
            : undefined,
      });
      const summaryMdPath = join(runDir, "summary.md");
      await writeAtomic(
        summaryJsonPath,
        `${JSON.stringify(report, null, 2)}\n`,
      );
      await writeAtomic(summaryMdPath, renderLiveEvaluationMarkdown(report));

      return {
        exitCode: report.verdict === "LIVE_EVALUATION_PASS" ? 0 : 1,
        artifactPath: summaryJsonPath,
        message: `Report replayed and rendered for run: ${report.runId}`,
        report,
      };
    } catch (error) {
      return cliError(error, 1);
    }
  }

  return cliError(
    new Error(
      `Unknown command: "${command}". Valid commands: preflight, probe, index, run, freeze, report`,
    ),
    2,
  );
}

// Standalone CLI invocation
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  runLiveEvaluationCli(process.argv.slice(2)).then((result) => {
    console.log(result.message);
    if (result.artifactPath) {
      console.log(`Artifact: ${result.artifactPath}`);
    }
    process.exit(result.exitCode);
  });
}
