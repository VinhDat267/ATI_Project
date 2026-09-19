import type {
  CreateInput,
  RunAccepted,
  Transport,
} from "../core/contracts.js";
import { ClientError, isClientError } from "../core/errors.js";
import { formatClock } from "../core/presentation.js";
import type { RequestScope, SessionController } from "../core/session.js";

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
  teardown(): void;
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
  let activeScope: RequestScope | null = null;
  let currentSubmissionEpoch = 0;

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
      if (state.status === "submitting" || state.status === "confirming") {
        return null;
      }

      const submissionEpoch = ++currentSubmissionEpoch;
      activeScope = session.beginRequest();
      const scope = activeScope;

      setState({
        status: "submitting",
        submittedPrompt: input.source_prompt,
        createdRunId: null,
        error: null,
        lostAt: null,
      });

      try {
        const accepted = await transport.create(input, scope.signal);
        if (!scope.isCurrent() || submissionEpoch !== currentSubmissionEpoch) {
          return null;
        }

        setState({
          status: "accepted",
          createdRunId: accepted.run_id,
          error: null,
          lostAt: null,
        });
        return accepted;
      } catch (err) {
        if (!scope.isCurrent() || submissionEpoch !== currentSubmissionEpoch) {
          return null;
        }

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
        if (activeScope === scope) {
          activeScope = null;
        }
      }
    },
    teardown(): void {
      currentSubmissionEpoch++;
      if (activeScope) {
        activeScope.abort();
        activeScope = null;
      }
      if (state.status === "submitting") {
        setState({
          status: "confirming",
          error: new ClientError({
            message:
              "Yêu cầu tạo lần chạy bị gián đoạn; chưa rõ kết quả trên máy chủ",
            kind: "network",
            uncertain: true,
          }),
          lostAt: formatClock(new Date().toISOString(), "Asia/Ho_Chi_Minh"),
        });
      }
    },
    reset(): void {
      if (state.status === "submitting" || state.status === "confirming") {
        return;
      }
      currentSubmissionEpoch++;
      if (activeScope) {
        activeScope.abort();
        activeScope = null;
      }
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
