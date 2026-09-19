import type { EventPage } from "./contracts.js";
import type { RunEvent } from "@wap/dsl/browser";

export interface EventState {
  seq: number;
  events: RunEvent[];
  finished: boolean;
  error: string | null;
}

export function createInitialEventState(): EventState {
  return {
    seq: 0,
    events: [],
    finished: false,
    error: null,
  };
}

/**
 * Atomic reducer for ingesting sequentially ordered workflow run events.
 * Guarantees:
 * 1. Monotonically contiguous increasing sequence numbers without gaps.
 * 2. Idempotent deduplication of identical payloads at existing sequence numbers.
 * 3. Immediate protocol error on conflicting payloads or out-of-order/gapped sequences.
 * 4. Completion latch on `run.finished` event (no further events accepted).
 * 5. All-or-nothing rollback: any error on a page commits zero partial events from that page.
 */
export function ingestEvents(
  prev: EventState,
  page: EventPage,
  _runId?: string,
): EventState {
  if (prev.error) {
    return prev;
  }

  if (!page.events || page.events.length === 0) {
    return prev;
  }

  const candidateEvents = [...prev.events];
  let currentSeq = prev.seq;
  let isFinished = prev.finished;

  for (const event of page.events) {
    if (isFinished) {
      return {
        ...prev,
        error: `Nhận được sự kiện seq ${event.seq} sau khi run đã kết thúc`,
      };
    }

    if (event.seq <= currentSeq) {
      const existing = candidateEvents.find((e) => e.seq === event.seq);
      if (!existing) {
        return {
          ...prev,
          error: `Sự kiện seq ${event.seq} không khớp với lịch sử sự kiện hiện tại`,
        };
      }
      if (JSON.stringify(existing) !== JSON.stringify(event)) {
        return {
          ...prev,
          error: `Xung đột dữ liệu tại sự kiện seq ${event.seq}`,
        };
      }
      // Idempotent duplicate: skip duplicate appending
      continue;
    }

    if (event.seq !== currentSeq + 1) {
      return {
        ...prev,
        error: `Phát hiện gián đoạn chuỗi sự kiện: mong đợi seq ${currentSeq + 1}, nhận được seq ${event.seq}`,
      };
    }

    candidateEvents.push(event);
    currentSeq = event.seq;

    if (event.type === "run.finished") {
      isFinished = true;
    }
  }

  return {
    seq: currentSeq,
    events: candidateEvents,
    finished: isFinished,
    error: null,
  };
}
