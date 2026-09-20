import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, type FileHandle } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  JournaledProviderCallLedger,
  restoreProviderCallRecords,
} from "./ledger.js";
import {
  createLiveJournal,
  replayLiveJournal,
  type LiveJournal,
} from "./journal.js";
import type { LiveEvaluationFingerprints } from "./contracts.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface OpenLiveCampaignOptions {
  readonly outputRoot: string;
  readonly campaignId: string;
  readonly runId: string;
  readonly profileId: string;
  readonly phase: string;
  readonly evidenceKind?: "LIVE_PROVIDER" | "FAKE_TRANSPORT_TEST";
  readonly budgetCapMicros: number;
  readonly freezeHash?: string;
  readonly fingerprints?: LiveEvaluationFingerprints;
}

interface CampaignManifest {
  readonly format: "ati-ai-live-campaign-v1";
  readonly campaignId: string;
  readonly budgetCapMicros: number;
}

export interface LiveCampaign {
  readonly campaignId: string;
  readonly runId: string;
  readonly runDirectory: string;
  readonly journal: LiveJournal;
  readonly ledger: JournaledProviderCallLedger;
  close(): Promise<void>;
}

function assertId(name: string, value: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`${name} contains an invalid identifier`);
}

function assertBudget(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("budgetCapMicros must be a positive safe integer");
  }
}

async function writeExclusiveJson(
  path: string,
  value: unknown,
): Promise<void> {
  const handle = await open(path, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Opens one exclusive campaign coordinator and a durable run journal.
 * A lock is intentionally not recovered by age: operators must first prove
 * the original process is gone before removing a stale lock.
 */
export async function openLiveCampaign(
  options: OpenLiveCampaignOptions,
): Promise<LiveCampaign> {
  assertId("campaignId", options.campaignId);
  assertId("runId", options.runId);
  assertId("profileId", options.profileId);
  assertId("phase", options.phase);
  assertBudget(options.budgetCapMicros);

  const campaignsRoot = resolve(options.outputRoot, "campaigns");
  const campaignDirectory = join(campaignsRoot, options.campaignId);
  const runDirectory = join(campaignDirectory, "runs", options.runId);
  await mkdir(join(campaignDirectory, "runs"), { recursive: true });

  const manifestPath = join(campaignDirectory, "campaign.json");
  let manifest: CampaignManifest;
  let journal: LiveJournal | undefined;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as CampaignManifest;
    if (
      manifest.format !== "ati-ai-live-campaign-v1" ||
      manifest.campaignId !== options.campaignId ||
      manifest.budgetCapMicros !== options.budgetCapMicros
    ) {
      throw new Error("campaign manifest scope or budget does not match approval");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    manifest = {
      format: "ati-ai-live-campaign-v1",
      campaignId: options.campaignId,
      budgetCapMicros: options.budgetCapMicros,
    };
    await writeExclusiveJson(manifestPath, manifest);
  }

  let lock: FileHandle;
  const lockPath = join(campaignDirectory, "campaign.lock");
  const ownerToken = randomUUID();
  let runDirectoryCreated = false;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`campaign "${options.campaignId}" is already owned`);
    }
    throw error;
  }

  try {
    await lock.writeFile(
      `${JSON.stringify({
        format: "ati-ai-live-campaign-lock-v1",
        owner: ownerToken,
        campaignId: options.campaignId,
        runId: options.runId,
        profileId: options.profileId,
        phase: options.phase,
        ...(options.evidenceKind ? { evidenceKind: options.evidenceKind } : {}),
        startedAt: new Date().toISOString(),
        pid: process.pid,
      })}\n`,
      "utf8",
    );
    await lock.sync();
    await mkdir(runDirectory, { recursive: false });
    runDirectoryCreated = true;
    const previousRecords = [];
    const runsDirectory = join(campaignDirectory, "runs");
    const { readdir } = await import("node:fs/promises");
    for (const priorRunId of await readdir(runsDirectory)) {
      if (priorRunId === options.runId) continue;
      const priorJournalPath = join(runsDirectory, priorRunId, "journal.jsonl");
      try {
        const replay = await replayLiveJournal(priorJournalPath);
        previousRecords.push(...restoreProviderCallRecords(replay.events));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error(`cannot verify prior campaign run "${priorRunId}": journal is missing`, {
            cause: error,
          });
        }
        throw new Error(`cannot verify prior campaign run "${priorRunId}"`, {
          cause: error,
        });
      }
    }
    const runJournal = await createLiveJournal(join(runDirectory, "journal.jsonl"));
    journal = runJournal;
    await runJournal.append({
      event: "run_started",
      timestamp: new Date().toISOString(),
      trialId: options.runId,
      payload: {
        campaignId: options.campaignId,
        runId: options.runId,
        profileId: options.profileId,
        phase: options.phase,
        budgetCapMicros: options.budgetCapMicros,
        ...(options.freezeHash ? { freezeHash: options.freezeHash } : {}),
        ...(options.fingerprints ? { fingerprints: options.fingerprints } : {}),
      },
    });
    const ledger = new JournaledProviderCallLedger({
      campaignLimitMicros: manifest.budgetCapMicros,
      journal: runJournal,
      initialRecords: previousRecords,
    });
    let closed = false;
    return {
      campaignId: options.campaignId,
      runId: options.runId,
      runDirectory,
      journal: runJournal,
      ledger,
      close: async () => {
        if (closed) return;
        closed = true;
        await runJournal.close();
        await lock.close();
        // The lock file is removed only after the owning handle is closed.
        const { unlink, readFile } = await import("node:fs/promises");
        try {
          const lockMetadata = JSON.parse(await readFile(lockPath, "utf8")) as {
            readonly owner?: string;
          };
          if (lockMetadata.owner === ownerToken) await unlink(lockPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      },
    };
  } catch (error) {
    await journal?.close().catch(() => undefined);
    await lock.close();
    const { unlink, readFile, rm } = await import("node:fs/promises");
    try {
      const lockMetadata = JSON.parse(await readFile(lockPath, "utf8")) as {
        readonly owner?: string;
      };
      if (lockMetadata.owner === ownerToken) await unlink(lockPath);
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
        // Preserve the original open error while leaving diagnostics on disk.
      }
    }
    if (runDirectoryCreated) {
      await rm(runDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
    throw error;
  }
}
