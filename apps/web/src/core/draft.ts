export type OriginReason =
  | "reconcile_seen"
  | "reconcile_not_seen"
  | "reconcile_confirmed"
  | "expired"
  | "failed"
  | "needs_input";

export interface RequestDraft {
  prompt: string;
  origin: { runId: string; reason: OriginReason } | null;
}

export interface DraftStore {
  get(): RequestDraft | null;
  set(draft: RequestDraft): void;
  /** Returns the pending draft once and clears it. */
  take(): RequestDraft | null;
  clear(): void;
}

/**
 * A prefilled request handed from a finished run to the composer. It lives only
 * in this tab's memory: prompts never go into the URL or browser storage.
 */
export function createDraftStore(): DraftStore {
  let pending: RequestDraft | null = null;
  return {
    get: () => pending,
    set(draft) {
      pending = draft;
    },
    take() {
      const draft = pending;
      pending = null;
      return draft;
    },
    clear() {
      pending = null;
    },
  };
}
