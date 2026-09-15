import { describe, expect, it } from "vitest";
import { createSession } from "../../src/core/session.js";

describe("createSession", () => {
  it("increments generation when the token changes and keeps token in memory", () => {
    const session = createSession();
    const before = session.store.getSnapshot().generation;

    session.setToken("synthetic-token");
    session.clear();

    expect(session.store.getSnapshot()).toEqual({
      generation: before + 2,
      token: null,
    });
    expect(session.getToken()).toBeNull();
  });

  it("does not create a generation change for an identical token", () => {
    const session = createSession();
    session.setToken("synthetic-token");
    const generation = session.store.getSnapshot().generation;

    session.setToken("synthetic-token");

    expect(session.store.getSnapshot().generation).toBe(generation);
  });

  it("invalidates a request scope when the session changes", () => {
    const session = createSession();
    const scope = session.beginRequest();

    expect(scope.isCurrent()).toBe(true);
    session.setToken("new-session");

    expect(scope.isCurrent()).toBe(false);
    expect(scope.signal.aborted).toBe(true);
  });
});
