import { expect, it } from "vitest";
import {
  POLL_MS,
  detailQuery,
  listQuery,
  runKeys,
  shouldRetry,
} from "../../src/core/queries.js";
import {
  createFixtureScenario,
  createFixtureTransport,
} from "../../src/core/fixtures.js";

it("scopes keys by session generation", () => {
  expect(runKeys(1).detail("a")).not.toEqual(runKeys(2).detail("a"));
  expect(runKeys(1).list).toEqual(["session", 1, "runs"]);
});

it("polls only while the run is not terminal", () => {
  const q = detailQuery(createFixtureTransport(), 1, "x");
  expect(q.refetchInterval(undefined)).toBe(POLL_MS);
  expect(q.refetchInterval(createFixtureScenario("running"))).toBe(POLL_MS);
  expect(q.refetchInterval(createFixtureScenario("succeeded"))).toBe(false);
  expect(q.refetchInterval(createFixtureScenario("reconciliation_required"))).toBe(false);
});

it("passes the query signal to the transport", async () => {
  const transport = createFixtureTransport();
  const controller = new AbortController();
  controller.abort();
  await expect(
    listQuery(transport, 1).queryFn({ signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
});

it("retries GETs at most twice and never client errors", () => {
  expect(shouldRetry(0, new Error("net"))).toBe(true);
  expect(shouldRetry(1, new Error("net"))).toBe(true);
  expect(shouldRetry(2, new Error("net"))).toBe(false);
  expect(shouldRetry(0, Object.assign(new Error("x"), { status: 404 }))).toBe(false);
  expect(shouldRetry(0, Object.assign(new Error("x"), { name: "AbortError" }))).toBe(false);
});
