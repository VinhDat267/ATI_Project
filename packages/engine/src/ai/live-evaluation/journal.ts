import { randomUUID } from "node:crypto";
import { open, readFile, type FileHandle } from "node:fs/promises";
import { z } from "zod";
import type { LiveJournalEvent } from "./contracts.js";

const JOURNAL_EVENTS = [
  "trial_scheduled",
  "trial_started",
  "provider_call_reserved",
  "provider_call_settled",
  "trial_completed",
  "trial_failed",
  "trial_cancelled",
  "trial_not_started",
] as const;

export const DurableLiveJournalEventSchema = z
  .object({
    version: z.literal(1),
    sequence: z.number().int().positive(),
    eventId: z.string().uuid(),
    event: z.enum(JOURNAL_EVENTS),
    timestamp: z.string().datetime({ offset: true }),
    trialId: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export type DurableLiveJournalEvent = z.infer<
  typeof DurableLiveJournalEventSchema
>;

export interface LiveJournalReplay {
  readonly events: readonly DurableLiveJournalEvent[];
  readonly truncatedFinalLine: boolean;
}

export interface LiveJournalOptions {
  readonly sync?: (handle: FileHandle) => Promise<void>;
}

export interface LiveJournal {
  readonly append: (
    event: LiveJournalEvent,
  ) => Promise<DurableLiveJournalEvent>;
  readonly close: () => Promise<void>;
  readonly replay: () => Promise<LiveJournalReplay>;
}

function parseJournalLine(
  line: string,
  lineNumber: number,
): DurableLiveJournalEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new Error(
      `Invalid live journal JSON at line ${lineNumber}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const parsed = DurableLiveJournalEventSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid live journal event at line ${lineNumber}: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

export async function replayLiveJournal(
  filePath: string,
): Promise<LiveJournalReplay> {
  const raw = await readFile(filePath, "utf8");
  if (!raw) return { events: [], truncatedFinalLine: false };

  const lines = raw.split("\n");
  let truncatedFinalLine = false;
  if (lines.at(-1) === "") {
    lines.pop();
  } else {
    const lastLine = lines.at(-1)!;
    try {
      JSON.parse(lastLine);
    } catch {
      lines.pop();
      truncatedFinalLine = true;
    }
  }

  const events: DurableLiveJournalEvent[] = [];
  const eventIds = new Set<string>();
  for (let index = 0; index < lines.length; index++) {
    const parsed = parseJournalLine(lines[index]!, index + 1);
    const expectedSequence = index + 1;
    if (parsed.sequence !== expectedSequence) {
      throw new Error(
        `Live journal sequence gap or duplicate at line ${index + 1}: expected ${expectedSequence}, received ${parsed.sequence}`,
      );
    }
    if (eventIds.has(parsed.eventId)) {
      throw new Error(`Duplicate live journal eventId: ${parsed.eventId}`);
    }
    eventIds.add(parsed.eventId);
    events.push(parsed);
  }

  return { events, truncatedFinalLine };
}

export async function createLiveJournal(
  filePath: string,
  options: LiveJournalOptions = {},
): Promise<LiveJournal> {
  const handle = await open(filePath, "wx");
  const sync = options.sync ?? ((file: FileHandle) => file.sync());
  let sequence = 0;
  let closed = false;

  const append = async (
    event: LiveJournalEvent,
  ): Promise<DurableLiveJournalEvent> => {
    if (closed) throw new Error("Live journal is already closed");
    const durable = DurableLiveJournalEventSchema.parse({
      version: 1,
      sequence: ++sequence,
      eventId: randomUUID(),
      ...event,
    });
    await handle.write(`${JSON.stringify(durable)}\n`, undefined, "utf8");
    await sync(handle);
    return durable;
  };

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await handle.close();
  };

  return {
    append,
    close,
    replay: () => replayLiveJournal(filePath),
  };
}
