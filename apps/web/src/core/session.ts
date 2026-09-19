import { createStore, type Store } from "./store.js";

export interface Session {
  generation: number;
  token: string | null;
}

export interface RequestScope {
  generation: number;
  signal: AbortSignal;
  isCurrent(): boolean;
  abort(): void;
  dispose(): void;
}

export interface SessionController {
  store: Store<Session>;
  setToken(token: string): void;
  clear(): void;
  getToken(): string | null;
  beginRequest(): RequestScope;
}

/**
 * Session state intentionally lives only in this tab's JavaScript memory.
 * Changing the token invalidates and aborts all work owned by the old session.
 */
export function createSession(): SessionController {
  const store = createStore<Session>({ generation: 0, token: null });
  const activeControllers = new Set<AbortController>();

  const invalidateRequests = (): number => {
    const count = activeControllers.size;
    for (const controller of activeControllers) {
      controller.abort();
    }
    activeControllers.clear();
    return count;
  };

  const changeToken = (token: string | null): void => {
    const current = store.getSnapshot();
    if (current.token === token) {
      return;
    }
    invalidateRequests();
    store.set({ generation: current.generation + 1, token });
  };

  return {
    store,
    setToken(token) {
      if (!token) {
        throw new Error("Session token must not be empty");
      }
      changeToken(token);
    },
    clear() {
      const current = store.getSnapshot();
      const invalidatedCount = invalidateRequests();
      if (current.token !== null || invalidatedCount > 0) {
        store.set({ generation: current.generation + 1, token: null });
      }
    },
    getToken: () => store.getSnapshot().token,
    beginRequest() {
      const controller = new AbortController();
      const generation = store.getSnapshot().generation;
      activeControllers.add(controller);
      const onAbort = () => activeControllers.delete(controller);
      controller.signal.addEventListener("abort", onAbort, { once: true });
      return {
        generation,
        signal: controller.signal,
        isCurrent: () =>
          !controller.signal.aborted &&
          store.getSnapshot().generation === generation,
        abort: () => controller.abort(),
        dispose: () => {
          controller.signal.removeEventListener("abort", onAbort);
          activeControllers.delete(controller);
        },
      };
    },
  };
}
