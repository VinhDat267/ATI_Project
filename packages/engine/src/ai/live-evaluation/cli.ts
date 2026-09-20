/**
 * Unified Live Evaluation CLI.
 * Strictly enforces zero credentials in journals/reports, deterministic trial scheduling,
 * tamper-evident freeze verification, budget reservation, and offline invariance.
 */
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { G1_DATABASE_URL } from "@wap/db";
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
  type LiveExecutionFingerprint,
} from "./contracts.js";
import {
  validateProviderPriceCard,
  type ProviderPriceCard,
} from "./pricing.js";
import {
  createLiveFreeze,
  assertLiveFrozen,
  computeLiveFingerprints,
  hashLiveFreeze,
  buildLiveExecutionFingerprint,
} from "./freeze.js";
import { scheduleLiveTrials } from "./schedule.js";
import {
  runLiveEvaluation,
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
import { openLiveCampaign } from "./campaign.js";
import { createLiveEvaluationRuntimeComposition } from "./composition.js";
import {
  deriveLiveExecutionScope,
  hashLiveConfig,
  type LiveExecutionPhase,
} from "./authorization.js";
import type { LiveEvaluationRuntime } from "./runtime.js";
import {
  parseEvaluationDatabaseIdentity,
  sameEvaluationDatabase,
} from "./database-identity.js";

export interface LiveEvaluationCliEnvironment {
  readonly root?: string;
  readonly outputRoot?: string;
  readonly now?: () => Date;
  readonly runId?: () => string;
  readonly env?: Record<string, string | undefined>;
  readonly signal?: AbortSignal;
  readonly runtime?: LiveEvaluationRuntime;
  readonly getSession?: (
    context: LiveEvaluationSessionContext,
    variant?: LiveTrialScheduleItem["cell"]["variant"],
  ) => Promise<LiveEvaluationSession>;
}

async function createDefaultLiveRuntime(options: {
  readonly root: string;
  readonly env: Record<string, string | undefined>;
  readonly campaignId: string;
  readonly phase: "probe" | "index" | "smoke" | "dev" | "legacy-regression";
  readonly approvalExpiresAt: string;
  readonly now: () => Date;
  readonly profile: LiveProfileConfig;
  readonly ledger: import("../providers/registry.js").ProviderCallLedger;
  readonly priceCard?: ProviderPriceCard;
}): Promise<LiveEvaluationRuntime> {
  const needsOpenAi = [
    options.profile.planning.provider,
    options.profile.queryExpansion.provider,
    options.profile.embedding.provider,
  ].includes("openai");
  const needsGoogle = [
    options.profile.planning.provider,
    options.profile.queryExpansion.provider,
    options.profile.embedding.provider,
  ].includes("google");
  const credentials = {
    ...(needsOpenAi && options.env.OPENAI_API_KEY
      ? { OPENAI_API_KEY: options.env.OPENAI_API_KEY }
      : {}),
    ...(needsGoogle && options.env.GEMINI_API_KEY
      ? { GEMINI_API_KEY: options.env.GEMINI_API_KEY }
      : {}),
  };
  const userId = options.env.AI_EVAL_USER_ID?.trim();
  if (!userId && options.phase !== "probe") {
    throw new Error(
      "AI_EVAL_USER_ID is required for database-backed live evaluation",
    );
  }
  return createLiveEvaluationRuntimeComposition({
    root: options.root,
    campaignId: options.campaignId,
    profile: options.profile,
    userId: userId ?? "eval-probe-user",
    evalDatabaseUrl: options.env.AI_EVAL_DATABASE_URL ?? "",
    credentials,
    ledger: options.ledger,
    appDatabaseUrl: options.env.DATABASE_URL ?? G1_DATABASE_URL,
    ...(options.priceCard ? { priceCard: options.priceCard } : {}),
    authorizeCall: async (request) => {
      if (request.campaignId !== options.campaignId) {
        throw new Error("provider call campaign does not match approval");
      }
      const expiresAt = Date.parse(options.approvalExpiresAt);
      if (!Number.isFinite(expiresAt) || options.now().getTime() >= expiresAt) {
        throw new Error(
          "live evaluation approval expired before provider dispatch",
        );
      }
    },
  });
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
  const evaluation = parseEvaluationDatabaseIdentity(evalUrl.trim());
  const application = parseEvaluationDatabaseIdentity(
    appUrl?.trim() || G1_DATABASE_URL,
    "DATABASE_URL",
  );
  if (sameEvaluationDatabase(evaluation, application)) {
    throw new Error(
      "AI_EVAL_DATABASE_URL must not point to the normal application database (DATABASE_URL)",
    );
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
  const injectedEvidenceKind = environment.runtime?.evidenceKind;

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
    const allowedFlags = new Set([
      "profile",
      "campaign",
      "approval",
      "output",
      "price-card",
      "index",
    ]);
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
      const { parsed: parsedConfig } = await readLiveConfig(root);
      const profile = parsedConfig.profiles[flags.profile];
      if (!profile) {
        throw new Error(`Profile "${flags.profile}" not found in config`);
      }

      let priceCard: ProviderPriceCard | undefined;
      if (
        typeof flags["price-card"] === "string" &&
        flags["price-card"].trim()
      ) {
        priceCard = validateProviderPriceCard(
          JSON.parse(await readFile(resolve(flags["price-card"]), "utf8")),
        );
      }

      let execution: LiveExecutionFingerprint | undefined;
      if (priceCard) {
        const activeIndex = {
          id: typeof flags.index === "string" ? flags.index : "idx-freeze-pending",
          provenanceHash: "0".repeat(64),
          vectorHash: "0".repeat(64),
          policyHash: "0".repeat(64),
        };
        execution = await buildLiveExecutionFingerprint({
          root,
          profile,
          campaignId: flags.campaign,
          budgetCapMicros: 5_000_000,
          priceCard,
          activeIndex,
        });
      }

      const freeze = await createLiveFreeze({
        root,
        profileId: flags.profile,
        campaignId: flags.campaign,
        createdAt: now().toISOString(),
        ...(execution ? { execution } : {}),
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
      "price-card",
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

      let ownedCampaign:
        Awaited<ReturnType<typeof openLiveCampaign>> | undefined;
      let ownedRuntime: LiveEvaluationRuntime | undefined;
      try {
        if (environment.runtime) {
          ownedRuntime = environment.runtime;
        } else {
          ownedCampaign = await openLiveCampaign({
            outputRoot,
            campaignId: flags.campaign,
            phase: "probe",
            runId: runId(),
            profileId: flags.profile,
            budgetCapMicros: approval.budgetMicros,
            evidenceKind: injectedEvidenceKind ?? "LIVE_PROVIDER",
          });
          let priceCard: ProviderPriceCard | undefined;
          if (
            typeof flags["price-card"] === "string" &&
            flags["price-card"].trim()
          ) {
            priceCard = validateProviderPriceCard(
              JSON.parse(await readFile(resolve(flags["price-card"]), "utf8")),
            );
          }
          ownedRuntime = await createDefaultLiveRuntime({
            root,
            env: environment.env ?? process.env,
            campaignId: flags.campaign,
            phase: "probe",
            approvalExpiresAt: approval.expiresAt,
            now,
            profile,
            ledger: ownedCampaign.ledger,
            ...(priceCard ? { priceCard } : {}),
          });
        }
        const probe = await ownedRuntime.probe({
          campaignId: flags.campaign,
          profileId: flags.profile,
          phase: "probe",
          signal: environment.signal,
        });

        return {
          exitCode: 0,
          artifactPath: null,
          message: `Live probe passed for profile "${flags.profile}" (campaign: ${flags.campaign}, calls: ${probe.calls.length})`,
        };
      } finally {
        if (!environment.runtime) await ownedRuntime?.close();
        await ownedCampaign?.close();
      }
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
      "price-card",
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
      let ownedCampaign:
        Awaited<ReturnType<typeof openLiveCampaign>> | undefined;
      let ownedRuntime: LiveEvaluationRuntime | undefined;
      try {
        let priceCard: ProviderPriceCard | undefined;
        if (
          typeof flags["price-card"] === "string" &&
          flags["price-card"].trim()
        ) {
          priceCard = validateProviderPriceCard(
            JSON.parse(await readFile(resolve(flags["price-card"]), "utf8")),
          );
        }
        if (environment.runtime) {
          ownedRuntime = environment.runtime;
        } else {
          ownedCampaign = await openLiveCampaign({
            outputRoot,
            campaignId: flags.campaign,
            runId: runId(),
            profileId: flags.profile,
            phase: "index",
            budgetCapMicros: approval.budgetMicros,
            evidenceKind: injectedEvidenceKind ?? "LIVE_PROVIDER",
          });
          ownedRuntime = await createDefaultLiveRuntime({
            root,
            env,
            campaignId: flags.campaign,
            phase: "index",
            approvalExpiresAt: approval.expiresAt,
            now,
            profile,
            ledger: ownedCampaign.ledger,
            ...(priceCard ? { priceCard } : {}),
          });
        }
        const indexed = await ownedRuntime.index({
          campaignId: flags.campaign,
          profileId: flags.profile,
          phase: "index",
          signal: environment.signal,
        });

        return {
          exitCode: 0,
          artifactPath: null,
          message: `Tool index built and activated for profile "${flags.profile}" (index: ${indexed.index.id}, rows: ${indexed.rowCount})`,
        };
      } finally {
        if (!environment.runtime) await ownedRuntime?.close();
        await ownedCampaign?.close();
      }
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
      "price-card",
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

      let priceCard: ProviderPriceCard | undefined;
      if (
        typeof flags["price-card"] === "string" &&
        flags["price-card"].trim()
      ) {
        priceCard = validateProviderPriceCard(
          JSON.parse(await readFile(resolve(flags["price-card"]), "utf8")),
        );
      }

      let liveFreeze = await createLiveFreeze({
        root,
        profileId: flags.profile,
        campaignId,
        createdAt: now().toISOString(),
      });

      if (typeof flags.freeze === "string") {
        const savedFreeze = FrozenLiveEvaluationSchema.parse(
          JSON.parse(await readFile(resolve(flags.freeze), "utf8")),
        );
        if (savedFreeze.execution) {
          if (!priceCard) {
            throw new Error(
              "Saved freeze includes execution fingerprint; --price-card is required to verify execution environment",
            );
          }
          const currentExecution = await buildLiveExecutionFingerprint({
            root,
            profile,
            campaignId,
            budgetCapMicros: approval.budgetMicros,
            priceCard,
            activeIndex: savedFreeze.execution.activeIndex,
          });
          liveFreeze = await createLiveFreeze({
            root,
            profileId: flags.profile,
            campaignId,
            createdAt: now().toISOString(),
            execution: currentExecution,
          });
        }
        assertLiveFrozen(liveFreeze, savedFreeze);
      }

      let caseIds: readonly string[];
      let repetitions = 3;
      let smokeCells:
        | readonly {
            variant: "all_tools" | "semantic" | "semantic_qe";
            topK: 10;
          }[]
        | undefined;
      if (flags.phase === "smoke") {
        caseIds = ["b01", "b05", "b06"];
        repetitions = 1;
        smokeCells = [
          { variant: "all_tools", topK: 10 },
          { variant: "semantic", topK: 10 },
          { variant: "semantic_qe", topK: 10 },
        ];
      } else if (flags.phase === "dev") {
        caseIds = ["b01", "b02", "b03", "b04", "b05", "b06"];
      } else {
        caseIds = ["b07", "b08", "b09", "b10"];
      }

      const trials = scheduleLiveTrials([flags.profile], caseIds, {
        repetitions,
        ...(smokeCells ? { cells: smokeCells } : {}),
      });

      const currentRunId = runId();
      const campaign = await openLiveCampaign({
        outputRoot,
        campaignId,
        runId: currentRunId,
        profileId: flags.profile,
        phase: flags.phase,
        budgetCapMicros: approval.budgetMicros,
        evidenceKind:
          injectedEvidenceKind ??
          (environment.getSession ? "FAKE_TRANSPORT_TEST" : "LIVE_PROVIDER"),
        freezeHash: hashLiveFreeze(liveFreeze),
        fingerprints: liveFreeze.fingerprints,
        ...(liveFreeze.execution ? { execution: liveFreeze.execution } : {}),
      });
      const dir = campaign.runDirectory;
      const ledger = campaign.ledger;

      const casesMap = new Map<string, ParsedLiveCase>();
      for (const c of parsedDataset.cases) {
        casesMap.set(c.input.id, c);
      }

      const profilesMap = new Map<string, LiveProfileConfig>();
      for (const [id, prof] of Object.entries(parsedConfig.profiles)) {
        profilesMap.set(id, prof);
      }

      let ownedRuntime: LiveEvaluationRuntime | undefined = environment.runtime;
      let runResult: Awaited<ReturnType<typeof runLiveEvaluation>>;
      let runError: unknown;
      try {
        if (!ownedRuntime && !environment.getSession) {
          ownedRuntime = await createDefaultLiveRuntime({
            root,
            env,
            campaignId,
            phase: flags.phase as "smoke" | "dev" | "legacy-regression",
            approvalExpiresAt: approval.expiresAt,
            now,
            profile,
            ledger,
            ...(priceCard ? { priceCard } : {}),
          });
        }
        if (
          ownedRuntime?.evidenceKind === "LIVE_PROVIDER" &&
          !liveFreeze.execution
        ) {
          throw new Error(
            "Native live runs require a complete execution freeze with budget, price, index, runtime, and source evidence",
          );
        }
        const sessionRuntime = ownedRuntime;
        runResult = await runLiveEvaluation({
          trials,
          cases: casesMap,
          profiles: profilesMap,
          registry: catalog.tools,
          rubric: rawRubric,
          ledger,
          campaignId,
          runId: currentRunId,
          getSession: environment.getSession
            ? (context, variant) => environment.getSession!(context, variant)
            : sessionRuntime
              ? (context, variant) =>
                  sessionRuntime.createSession(context, ledger, variant)
              : async () => {
                  throw new Error(
                    "No live evaluation session provider available in CLI environment",
                  );
                },
          journalWriter: async (event) => {
            await campaign.journal.append(event);
          },
          signal: environment.signal,
        });
      } catch (error) {
        runError = error;
      } finally {
        let cleanupError: unknown;
        if (!environment.runtime && ownedRuntime) {
          try {
            await ownedRuntime.close();
          } catch (error) {
            cleanupError = error;
          }
        }
        try {
          await campaign.close();
        } catch (error) {
          cleanupError ??= error;
        }
        if (runError !== undefined) {
          if (cleanupError !== undefined) {
            throw new AggregateError(
              [runError, cleanupError],
              "live evaluation failed and cleanup also failed",
            );
          }
          throw runError;
        }
        if (cleanupError) throw cleanupError;
      }

      if (!runResult!) {
        throw new Error("live evaluation did not produce a run result");
      }

      const report = buildLiveEvaluationReport({
        runId: currentRunId,
        createdAt: now().toISOString(),
        campaignId,
        freezeHash: hashLiveFreeze(liveFreeze),
        fingerprints: liveFreeze.fingerprints,
        plannedTrials: trials,
        outcomes: runResult.outcomes,
        evidenceKind:
          ownedRuntime?.evidenceKind ??
          environment.runtime?.evidenceKind ??
          "FAKE_TRANSPORT_TEST",
        ledgerRecords: ledger
          .records()
          .filter((record) => record.runId === currentRunId),
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
          recovered.runMetadata?.runId ??
          previous.runId ??
          resolve(runDir).split(/[\\/]/).pop() ??
          "recovered-run",
        createdAt: now().toISOString(),
        campaignId:
          recovered.runMetadata?.campaignId ??
          previous.campaignId ??
          "recovered-campaign",
        freezeHash:
          recovered.runMetadata?.freezeHash ??
          previous.freezeHash ??
          "0".repeat(64),
        fingerprints:
          recovered.runMetadata?.fingerprints ??
          previous.fingerprints ??
          zeroFingerprints,
        plannedTrials: recovered.plannedTrials,
        outcomes: recovered.outcomes,
        ledgerRecords: recovered.ledgerRecords,
        evidenceKind:
          recovered.runMetadata?.evidenceKind ?? "FAKE_TRANSPORT_TEST",
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
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("SIGINT"));
  process.once("SIGINT", abort);
  runLiveEvaluationCli(process.argv.slice(2), { signal: controller.signal })
    .then((result) => {
      console.log(result.message);
      if (result.artifactPath) {
        console.log(`Artifact: ${result.artifactPath}`);
      }
      process.exitCode = result.exitCode;
    })
    .finally(() => process.removeListener("SIGINT", abort));
}
