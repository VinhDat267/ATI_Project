import type { TracePage, Transport } from "../core/contracts.js";
import { ClientError, isClientError } from "../core/errors.js";
import type { SessionController } from "../core/session.js";

export type TraceAttempt = TracePage["attempts"][number];

export interface TraceState {
  attempts: TraceAttempt[];
  nextCursor: string | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: ClientError | null;
}

export interface TraceController {
  getSnapshot(): TraceState;
  subscribe(listener: () => void): () => void;
  loadInitial(): Promise<void>;
  loadMore(): Promise<void>;
  reset(): void;
}

export function createTraceController(
  transport: Transport,
  session: SessionController,
  runId: string,
): TraceController {
  let state: TraceState = {
    attempts: [],
    nextCursor: null,
    isLoading: false,
    isLoadingMore: false,
    hasMore: false,
    error: null,
  };

  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function setState(next: Partial<TraceState>): void {
    state = { ...state, ...next };
    notify();
  }

  return {
    getSnapshot() {
      return state;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async loadInitial(): Promise<void> {
      if (state.isLoading) return;

      const scope = session.beginRequest();
      setState({ isLoading: true, error: null });

      try {
        const page = await transport.trace(runId, null, scope.signal);
        if (!scope.isCurrent()) return;

        setState({
          attempts: page.attempts,
          nextCursor: page.next_cursor,
          hasMore: page.next_cursor !== null,
          isLoading: false,
          error: null,
        });
      } catch (err) {
        if (!scope.isCurrent()) return;

        const clientError = isClientError(err)
          ? err
          : new ClientError({
              message: (err as any)?.message ?? "Lỗi tải chứng cứ",
              kind: "network",
            });

        setState({
          isLoading: false,
          error: clientError,
        });
      } finally {
        scope.dispose();
      }
    },
    async loadMore(): Promise<void> {
      if (!state.nextCursor || state.isLoadingMore || !state.hasMore) {
        return;
      }

      const scope = session.beginRequest();
      setState({ isLoadingMore: true, error: null });

      try {
        const page = await transport.trace(runId, state.nextCursor, scope.signal);
        if (!scope.isCurrent()) return;

        setState({
          attempts: [...state.attempts, ...page.attempts],
          nextCursor: page.next_cursor,
          hasMore: page.next_cursor !== null,
          isLoadingMore: false,
          error: null,
        });
      } catch (err) {
        if (!scope.isCurrent()) return;

        const clientError = isClientError(err)
          ? err
          : new ClientError({
              message: (err as any)?.message ?? "Lỗi tải thêm chứng cứ",
              kind: "network",
            });

        // If invalid cursor (400), restart gracefully from beginning
        if (clientError.status === 400) {
          try {
            const restarted = await transport.trace(runId, null, scope.signal);
            if (!scope.isCurrent()) return;

            setState({
              attempts: restarted.attempts,
              nextCursor: restarted.next_cursor,
              hasMore: restarted.next_cursor !== null,
              isLoadingMore: false,
              error: null,
            });
            return;
          } catch (restartErr) {
            if (!scope.isCurrent()) return;
            setState({
              isLoadingMore: false,
              error: isClientError(restartErr) ? restartErr : clientError,
            });
            return;
          }
        }

        setState({
          isLoadingMore: false,
          error: clientError,
        });
      } finally {
        scope.dispose();
      }
    },
    reset(): void {
      setState({
        attempts: [],
        nextCursor: null,
        isLoading: false,
        isLoadingMore: false,
        hasMore: false,
        error: null,
      });
    },
  };
}
