import { TERMINAL_STATUSES } from "@wap/dsl/browser";
import type { Transport, RunDetail } from "../core/contracts.js";
import {
  createInitialEventState,
  ingestEvents,
  type EventState,
} from "../core/events.js";
import { createStore, type Store } from "../core/store.js";
import type { RequestScope, SessionController } from "../core/session.js";

export interface RunSyncSnapshot {
  runId: string;
  detail: RunDetail | null;
  eventState: EventState;
  isPolling: boolean;
  error: Error | null;
}

export interface RunSyncController {
  getSnapshot(): RunSyncSnapshot;
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
  refresh(): Promise<void>;
}

export interface RunSyncOptions {
  pollIntervalMs?: number;
}

export function createRunSyncController(
  transport: Transport,
  session: SessionController,
  runId: string,
  options: RunSyncOptions = {},
): RunSyncController {
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const store: Store<RunSyncSnapshot> = createStore<RunSyncSnapshot>({
    runId,
    detail: null,
    eventState: createInitialEventState(),
    isPolling: false,
    error: null,
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  let activeScope: RequestScope | null = null;
  let isTickInProgress = false;
  let emptyTerminalPolls = 0;
  let stopped = true;

  const scheduleNext = (delayMs: number): void => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void pollTick();
    }, delayMs);
  };

  const pollTick = async (): Promise<void> => {
    if (stopped || isTickInProgress) return;
    isTickInProgress = true;

    activeScope = session.beginRequest();
    const scope = activeScope;

    try {
      const current = store.getSnapshot();
      const sinceSeq = current.eventState.seq;

      const [detailResult, eventPage] = await Promise.all([
        transport.detail(runId, scope.signal),
        transport.events(runId, sinceSeq, scope.signal),
      ]);

      if (!scope.isCurrent()) {
        return;
      }

      // Ingest events
      const nextEventState = ingestEvents(current.eventState, eventPage, runId);

      // Monotonic detail check
      let nextDetail = detailResult;
      if (current.detail && detailResult.last_seq < current.detail.last_seq) {
        nextDetail = current.detail;
      }

      const hasError = Boolean(nextEventState.error);
      const isFinished = nextEventState.finished;
      const isTerminalDetail = TERMINAL_STATUSES.includes(nextDetail.status);

      if (isTerminalDetail && eventPage.events.length === 0) {
        emptyTerminalPolls++;
      } else if (eventPage.events.length > 0) {
        emptyTerminalPolls = 0;
      }

      const shouldStopPolling =
        hasError ||
        isFinished ||
        (isTerminalDetail && emptyTerminalPolls >= 3);

      store.set({
        runId,
        detail: nextDetail,
        eventState: nextEventState,
        isPolling: !shouldStopPolling && !stopped,
        error: nextEventState.error ? new Error(nextEventState.error) : null,
      });

      if (shouldStopPolling) {
        stopped = true;
        if (timer) clearTimeout(timer);
        return;
      }

      // If page was full (200 events), drain immediately
      if (eventPage.events.length >= 200) {
        scheduleNext(0);
      } else {
        scheduleNext(pollIntervalMs);
      }
    } catch (err: unknown) {
      if (!scope.isCurrent()) return;

      const error = err instanceof Error ? err : new Error(String(err));
      const current = store.getSnapshot();
      store.set({
        ...current,
        error,
      });

      // On network failure or transient error, retry after interval
      scheduleNext(pollIntervalMs);
    } finally {
      scope.dispose();
      if (activeScope === scope) {
        activeScope = null;
      }
      isTickInProgress = false;
    }
  };

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    start() {
      if (!stopped) return;
      stopped = false;
      emptyTerminalPolls = 0;
      const current = store.getSnapshot();
      store.set({ ...current, isPolling: true, error: null });
      void pollTick();
    },
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (activeScope) {
        activeScope.abort();
        activeScope = null;
      }
      const current = store.getSnapshot();
      store.set({ ...current, isPolling: false });
    },
    async refresh() {
      if (stopped) {
        stopped = false;
        const current = store.getSnapshot();
        store.set({ ...current, isPolling: true, error: null });
      }
      await pollTick();
    },
  };
}
