import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  createLiveJournal,
  replayLiveJournal,
  type DurableLiveJournalEvent,
} from "../src/ai/live-evaluation/journal.js";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));

function event(trialId = "t1") {
  return {
    event: "trial_scheduled" as const,
    timestamp: "2026-09-19T00:00:00.000Z",
    trialId,
    payload: { caseId: "b01" },
  };
}

async function createTempJournalPath(name: string): Promise<string> {
  const dir = resolve(root, ".artifacts", `journal-${name}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return join(dir, "journal.jsonl");
}

describe("durable live-evaluation journal", () => {
  it("creates the run journal exclusively and rejects a second opener", async () => {
    const journalPath = await createTempJournalPath("exclusive");
    const first = await createLiveJournal(journalPath);
    try {
      await expect(createLiveJournal(journalPath)).rejects.toMatchObject({
        code: "EEXIST",
      });
    } finally {
      await first.close();
      await rm(resolve(journalPath, ".."), { recursive: true, force: true });
    }
  });

  it("writes versioned monotonic events and syncs every append", async () => {
    const journalPath = await createTempJournalPath("sequence");
    let syncCount = 0;
    const journal = await createLiveJournal(journalPath, {
      sync: async () => {
        syncCount++;
      },
    });
    try {
      await journal.append(event());
      await journal.append({
        ...event(),
        event: "trial_started",
        timestamp: "2026-09-19T00:00:01.000Z",
        payload: {},
      });
      const lines = (await readFile(journalPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as DurableLiveJournalEvent);
      expect(lines.map((line) => line.sequence)).toEqual([1, 2]);
      expect(lines.every((line) => line.version === 1)).toBe(true);
      expect(new Set(lines.map((line) => line.eventId)).size).toBe(2);
      expect(syncCount).toBe(2);
    } finally {
      await journal.close();
      await rm(resolve(journalPath, ".."), { recursive: true, force: true });
    }
  });

  it("poisons the journal after a sync failure and rejects later appends", async () => {
    const journalPath = await createTempJournalPath("poison");
    const failure = new Error("sync failed");
    const journal = await createLiveJournal(journalPath, {
      sync: async () => {
        throw failure;
      },
    });
    try {
      await expect(journal.append(event())).rejects.toBe(failure);
      await expect(journal.append(event("t2"))).rejects.toBe(failure);
    } finally {
      await journal.close();
      await rm(resolve(journalPath, ".."), { recursive: true, force: true });
    }
  });

  it("replays complete events and reports an incomplete final fragment", async () => {
    const journalPath = await createTempJournalPath("truncated");
    const journal = await createLiveJournal(journalPath);
    await journal.append(event());
    await journal.close();
    await writeFile(
      journalPath,
      `${await readFile(journalPath, "utf8")}{\"version\":1,\"sequence\":2`,
      "utf8",
    );

    try {
      const replay = await replayLiveJournal(journalPath);
      expect(replay.events).toHaveLength(1);
      expect(replay.truncatedFinalLine).toBe(true);
    } finally {
      await rm(resolve(journalPath, ".."), { recursive: true, force: true });
    }
  });

  it("rejects invalid schema, gaps, duplicate sequences, and conflicting event IDs", async () => {
    const journalPath = await createTempJournalPath("corrupt");
    const validJournal = await createLiveJournal(journalPath);
    await validJournal.append(event());
    await validJournal.close();
    const first = JSON.parse(
      await readFile(journalPath, "utf8"),
    ) as DurableLiveJournalEvent;

    try {
      await writeFile(
        journalPath,
        `${JSON.stringify({ ...first, sequence: 2 })}\n`,
        "utf8",
      );
      await expect(replayLiveJournal(journalPath)).rejects.toThrow(/sequence/i);

      await writeFile(
        journalPath,
        `${JSON.stringify(first)}\n${JSON.stringify({ ...first, sequence: 1 })}\n`,
        "utf8",
      );
      await expect(replayLiveJournal(journalPath)).rejects.toThrow(
        /sequence|duplicate/i,
      );

      await writeFile(
        journalPath,
        `${JSON.stringify(first)}\n${JSON.stringify({ ...first, sequence: 2, eventId: first.eventId })}\n`,
        "utf8",
      );
      await expect(replayLiveJournal(journalPath)).rejects.toThrow(
        /eventId|duplicate/i,
      );

      await writeFile(
        journalPath,
        `${JSON.stringify({ ...first, event: "unknown" })}\n`,
        "utf8",
      );
      await expect(replayLiveJournal(journalPath)).rejects.toThrow(
        /event|invalid/i,
      );
    } finally {
      await rm(resolve(journalPath, ".."), { recursive: true, force: true });
    }
  });
});
