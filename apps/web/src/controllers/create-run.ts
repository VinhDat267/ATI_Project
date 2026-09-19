import type {
  CreateInput,
  RunAccepted,
  RunDetail,
  Transport,
} from "../core/contracts.js";
import { ClientError, isClientError } from "../core/errors.js";
import { formatClock } from "../core/presentation.js";
import type { SessionController } from "../core/session.js";

export type CreateRunStatus =
  | "idle"
  | "submitting"
  | "confirming"
  | "accepted"
  | "error";

export interface CreateRunState {
  status: CreateRunStatus;
  submittedPrompt: string | null;
  createdRunId: string | null;
  error: ClientError | null;
  lostAt: string | null;
}

export interface CreateRunController {
  getSnapshot(): CreateRunState;
  subscribe(listener: () => void): () => void;
  submit(input: CreateInput): Promise<RunAccepted | null>;
  reconcile(runs: RunDetail[]): RunDetail | null;
  checkReconciliation(): Promise<RunDetail | null>;
  reset(): void;
}

export function createCreateRunController(
  transport: Transport,
  session: SessionController,
): CreateRunController {
  let state: CreateRunState = {
    status: "idle",
    submittedPrompt: null,
    createdRunId: null,
    error: null,
    lostAt: null,
  };

  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function setState(next: Partial<CreateRunState>): void {
    state = { ...state, ...next };
    notify();
  }

  const controller: CreateRunController = {
    getSnapshot() {
      return state;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async submit(input: CreateInput): Promise<RunAccepted | null> {
      if (state.status === "submitting") return null;

      const scope = session.beginRequest();
      setState({
        status: "submitting",
        submittedPrompt: input.source_prompt,
        createdRunId: null,
        error: null,
        lostAt: null,
      });

      try {
        const accepted = await transport.create(input, scope.signal);
        if (!scope.isCurrent()) return null;

        setState({
          status: "accepted",
          createdRunId: accepted.run_id,
          error: null,
          lostAt: null,
        });
        return accepted;
      } catch (err) {
        if (!scope.isCurrent()) return null;

        const clientError = isClientError(err)
          ? err
          : new ClientError({
              message: (err as any)?.message ?? "Lỗi khi tạo lần chạy",
              kind: "network",
              uncertain: true,
            });

        if (clientError.uncertain || clientError.kind === "network") {
          setState({
            status: "confirming",
            error: clientError,
            lostAt: formatClock(
              new Date().toISOString(),
              input.time_zone ?? "Asia/Ho_Chi_Minh",
            ),
          });
        } else {
          setState({
            status: "error",
            error: clientError,
            lostAt: null,
          });
        }
        return null;
      } finally {
        scope.dispose();
      }
    },
    reconcile(runs: RunDetail[]): RunDetail | null {
      if (state.status !== "confirming" || !state.submittedPrompt) {
        return null;
      }

      const match = runs.find(
        (r) =>
          r.source_prompt === state.submittedPrompt ||
          (state.createdRunId && r.run_id === state.createdRunId),
      );

      if (match) {
        setState({
          status: "accepted",
          createdRunId: match.run_id,
          error: null,
          lostAt: null,
        });
        return match;
      }
      return null;
    },
    async checkReconciliation(): Promise<RunDetail | null> {
      if (state.status !== "confirming") return null;
      const scope = session.beginRequest();
      try {
        const runs = await transport.list(scope.signal);
        if (!scope.isCurrent()) return null;
        return controller.reconcile(runs);
      } catch {
        return null;
      } finally {
        scope.dispose();
      }
    },
    reset(): void {
      setState({
        status: "idle",
        submittedPrompt: null,
        createdRunId: null,
        error: null,
        lostAt: null,
      });
    },
  };

  return controller;
}
