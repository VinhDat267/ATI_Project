export type StoreListener = () => void;

export interface Store<T> {
  getSnapshot(): T;
  subscribe(listener: StoreListener): () => void;
  set(value: T): void;
}

/**
 * A small external store with stable snapshots for React's
 * useSyncExternalStore. Listeners run only after the new snapshot is visible.
 */
export function createStore<T>(initial: T): Store<T> {
  let snapshot = initial;
  const listeners = new Set<StoreListener>();

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(value) {
      if (Object.is(snapshot, value)) {
        return;
      }
      snapshot = value;
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}
