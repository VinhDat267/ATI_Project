import type {
  Reconciliation,
  RunDetail,
  Servers,
  TracePage,
  Transport,
} from "./contracts.js";
import { isTerminal } from "./presentation.js";

/**
 * Plain query definitions for TanStack Query. This module does not import
 * React: views pass these objects to useQuery. Every key starts with the
 * session generation so a new session never reads the previous one's cache.
 */

export const POLL_MS = 2000;

type Key = readonly unknown[];
interface QueryFnContext {
  signal: AbortSignal;
}

export function runKeys(generation: number) {
  const root = ["session", generation] as const;
  return {
    list: [...root, "runs"] as Key,
    servers: [...root, "servers"] as Key,
    detail: (id: string): Key => [...root, "run", id],
    trace: (id: string): Key => [...root, "run", id, "trace"],
    events: (id: string): Key => [...root, "run", id, "events"],
    reconciliation: (id: string): Key => [...root, "run", id, "reconciliation"],
  };
}

export function listQuery(transport: Transport, generation: number) {
  return {
    queryKey: runKeys(generation).list,
    queryFn: ({ signal }: QueryFnContext): Promise<RunDetail[]> =>
      transport.list(signal),
  };
}

export function serversQuery(transport: Transport, generation: number) {
  return {
    queryKey: runKeys(generation).servers,
    queryFn: ({ signal }: QueryFnContext): Promise<Servers> =>
      transport.servers(signal),
  };
}

export function detailQuery(
  transport: Transport,
  generation: number,
  id: string,
) {
  return {
    queryKey: runKeys(generation).detail(id),
    queryFn: ({ signal }: QueryFnContext): Promise<RunDetail> =>
      transport.detail(id, signal),
    /** Poll every 2 s until the run is terminal. */
    refetchInterval: (data: RunDetail | undefined): number | false =>
      data && isTerminal(data.status) ? false : POLL_MS,
  };
}

export function traceQuery(
  transport: Transport,
  generation: number,
  id: string,
) {
  return {
    queryKey: runKeys(generation).trace(id),
    queryFn: ({ signal }: QueryFnContext): Promise<TracePage> =>
      transport.trace(id, null, signal),
  };
}

export function eventsQuery(
  transport: Transport,
  generation: number,
  id: string,
) {
  return {
    queryKey: runKeys(generation).events(id),
    queryFn: async ({ signal }: QueryFnContext) =>
      (await transport.events(id, 0, signal)).events,
  };
}

export function reconciliationQuery(
  transport: Transport,
  generation: number,
  id: string,
) {
  return {
    queryKey: runKeys(generation).reconciliation(id),
    queryFn: ({ signal }: QueryFnContext): Promise<Reconciliation> =>
      transport.reconciliation(id, signal),
  };
}

const NO_RETRY_STATUS = new Set([400, 401, 403, 404]);

/** GETs retry at most twice; client errors and aborts never retry. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (error instanceof Error && error.name === "AbortError") return false;
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number" && NO_RETRY_STATUS.has(status)) return false;
  return true;
}
