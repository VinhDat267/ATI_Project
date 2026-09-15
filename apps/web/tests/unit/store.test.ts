import { describe, expect, it } from "vitest";
import { createStore } from "../../src/core/store.js";

describe("createStore", () => {
  it("keeps snapshot identity until a new value is set", () => {
    const initial = { count: 0 };
    const store = createStore(initial);

    expect(store.getSnapshot()).toBe(initial);
    store.set(initial);
    expect(store.getSnapshot()).toBe(initial);

    const next = { count: 1 };
    store.set(next);
    expect(store.getSnapshot()).toBe(next);
  });

  it("notifies subscribers after the complete snapshot is assigned", () => {
    const store = createStore({ status: "idle", value: 0 });
    const observations: Array<{ status: string; value: number }> = [];
    const unsubscribe = store.subscribe(() => {
      observations.push(store.getSnapshot());
    });

    store.set({ status: "ready", value: 42 });

    expect(observations).toEqual([{ status: "ready", value: 42 }]);
    unsubscribe();
    store.set({ status: "done", value: 43 });
    expect(observations).toHaveLength(1);
  });
});
