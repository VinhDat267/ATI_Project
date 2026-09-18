import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Reconciliation, RunDetail } from "../core/contracts.js";
import { listQuery, reconciliationQuery } from "../core/queries.js";
import { useApp } from "./context";

/** Current time, re-rendered every `intervalMs` (for countdowns). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function useRuns() {
  const { transport, generation } = useApp();
  return useQuery(listQuery(transport, generation));
}

export interface AttentionState {
  /** Runs that still need the user: pending approval, or unconfirmed writes. */
  runs: RunDetail[];
  /** Reconciliation results keyed by run id, for reconcile runs. */
  reconciliation: Map<string, Reconciliation>;
  /** Reconcile runs whose writes were all confirmed later. */
  confirmed: Set<string>;
}

/**
 * Attention list shared by the nav badge and Tổng quan so both always agree.
 * A reconcile run stays here until every write is confirmed; if its receipt
 * cannot be loaded it stays too (spec V02).
 */
export function useAttention(): AttentionState {
  const { transport, generation } = useApp();
  const list = useRuns();
  const reconcileRuns = (list.data ?? []).filter(
    (run) => run.status === "reconciliation_required",
  );
  const results = useQueries({
    queries: reconcileRuns.map((run) =>
      reconciliationQuery(transport, generation, run.run_id),
    ),
  });
  const reconciliation = new Map<string, Reconciliation>();
  const confirmed = new Set<string>();
  reconcileRuns.forEach((run, index) => {
    const data = results[index]?.data;
    if (!data) return;
    reconciliation.set(run.run_id, data);
    if (
      data.operations.length > 0 &&
      data.operations.every((op) => op.receipt === "confirmed")
    ) {
      confirmed.add(run.run_id);
    }
  });
  const runs = (list.data ?? []).filter(
    (run) =>
      run.status === "awaiting_approval" ||
      (run.status === "reconciliation_required" && !confirmed.has(run.run_id)),
  );
  return { runs, reconciliation, confirmed };
}
