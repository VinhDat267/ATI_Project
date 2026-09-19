import type {
  DecisionInput,
  RunDetail,
  Transport,
} from "../core/contracts.js";
import { ClientError, isClientError } from "../core/errors.js";
import { formatClock } from "../core/presentation.js";
import type { SessionController } from "../core/session.js";

export type CommandAction = "approve" | "reject" | "cancel";
export type CommandStatus =
  | "idle"
  | "submitting"
  | "confirming"
  | "success"
  | "error";

export interface RunCommandState {
  action: CommandAction | null;
  status: CommandStatus;
  error: ClientError | null;
  lostAt: string | null;
}

export interface RunCommandController {
  getSnapshot(): RunCommandState;
  subscribe(listener: () => void): () => void;
  decide(input: DecisionInput, timeZone?: string): Promise<RunDetail | null>;
  cancel(timeZone?: string): Promise<boolean>;
  reconcileWithDetail(detail: RunDetail): void;
  reset(): void;
}

export function createRunCommandController(
  transport: Transport,
  session: SessionController,
  runId: string,
): RunCommandController {
  let state: RunCommandState = {
    action: null,
    status: "idle",
    error: null,
    lostAt: null,
  };

  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function setState(next: Partial<RunCommandState>): void {
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
    async decide(
      input: DecisionInput,
      timeZone = "Asia/Ho_Chi_Minh",
    ): Promise<RunDetail | null> {
      if (state.status === "submitting" || state.status === "confirming") {
        return null;
      }

      const scope = session.beginRequest();
      const actionName: CommandAction =
        input.decision === "approved" ? "approve" : "reject";

      setState({
        action: actionName,
        status: "submitting",
        error: null,
        lostAt: null,
      });

      try {
        const detail = await transport.decide(runId, input, scope.signal);
        if (!scope.isCurrent()) return null;

        setState({
          status: "success",
          error: null,
          lostAt: null,
        });
        return detail;
      } catch (err) {
        if (!scope.isCurrent()) return null;

        const clientError = isClientError(err)
          ? err
          : new ClientError({
              message: (err as any)?.message ?? "Lỗi gửi quyết định",
              kind: "network",
              uncertain: true,
            });

        if (clientError.uncertain || clientError.kind === "network") {
          setState({
            status: "confirming",
            error: clientError,
            lostAt: formatClock(new Date().toISOString(), timeZone),
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
    async cancel(timeZone = "Asia/Ho_Chi_Minh"): Promise<boolean> {
      if (state.status === "submitting" || state.status === "confirming") {
        return false;
      }

      const scope = session.beginRequest();
      setState({
        action: "cancel",
        status: "submitting",
        error: null,
        lostAt: null,
      });

      try {
        await transport.cancel(runId, scope.signal);
        if (!scope.isCurrent()) return false;

        setState({
          status: "success",
          error: null,
          lostAt: null,
        });
        return true;
      } catch (err) {
        if (!scope.isCurrent()) return false;

        const clientError = isClientError(err)
          ? err
          : new ClientError({
              message: (err as any)?.message ?? "Lỗi huỷ lần chạy",
              kind: "network",
              uncertain: true,
            });

        if (clientError.uncertain || clientError.kind === "network") {
          setState({
            status: "confirming",
            error: clientError,
            lostAt: formatClock(new Date().toISOString(), timeZone),
          });
        } else {
          setState({
            status: "error",
            error: clientError,
            lostAt: null,
          });
        }
        return false;
      } finally {
        scope.dispose();
      }
    },
    reconcileWithDetail(detail: RunDetail): void {
      if (state.status === "confirming") {
        if (state.action === "approve" || state.action === "reject") {
          if (
            detail.status !== "awaiting_approval" ||
            detail.approval === null
          ) {
            setState({
              action: null,
              status: "idle",
              error: null,
              lostAt: null,
            });
          }
        } else if (state.action === "cancel") {
          if (detail.status === "cancelled") {
            setState({
              action: null,
              status: "idle",
              error: null,
              lostAt: null,
            });
          }
        }
      }
    },
    reset(): void {
      setState({
        action: null,
        status: "idle",
        error: null,
        lostAt: null,
      });
    },
  };
}
