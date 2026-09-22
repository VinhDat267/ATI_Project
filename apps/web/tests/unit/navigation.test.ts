import { describe, expect, it } from "vitest";
import {
  parseRoute,
  routeToHash,
  type Route,
} from "../../src/core/navigation.js";

describe("hash navigation", () => {
  it("parses the supported routes and rejects arbitrary paths", () => {
    expect(parseRoute("#/login")).toEqual({ page: "login" });
    expect(parseRoute("#/overview")).toEqual({ page: "overview" });
    expect(parseRoute("#/new")).toEqual({ page: "new" });
    expect(parseRoute("#/runs")).toEqual({ page: "history" });
    expect(parseRoute("#/runs/11111111-1111-4111-8111-111111111111")).toEqual({
      page: "run",
      id: "11111111-1111-4111-8111-111111111111",
    });
    expect(parseRoute("#/runs/11111111-1111-7111-8111-111111111111")).toEqual({
      page: "run",
      id: "11111111-1111-7111-8111-111111111111",
    });
    expect(parseRoute("#/tools")).toEqual({ page: "tools" });
    expect(parseRoute("#/pilot")).toEqual({ page: "pilot-new" });
    expect(parseRoute("#/pilot/new")).toEqual({ page: "pilot-new" });
    expect(
      parseRoute("#/pilot/runs/11111111-1111-4111-8111-111111111111"),
    ).toEqual({
      page: "pilot-run",
      id: "11111111-1111-4111-8111-111111111111",
    });
    expect(parseRoute("#/https://foreign.invalid")).toEqual({
      page: "overview",
    });
    expect(parseRoute("/runs/11111111-1111-4111-8111-111111111111")).toEqual({
      page: "overview",
    });
  });

  it("serializes only the known route variants", () => {
    const routes: Route[] = [
      { page: "login" },
      { page: "overview" },
      { page: "new" },
      { page: "pilot-new" },
      { page: "history" },
      { page: "tools" },
      { page: "run", id: "11111111-1111-4111-8111-111111111111" },
      { page: "pilot-run", id: "11111111-1111-4111-8111-111111111111" },
    ];

    expect(routes.map(routeToHash)).toEqual([
      "#/login",
      "#/overview",
      "#/new",
      "#/pilot/new",
      "#/runs",
      "#/tools",
      "#/runs/11111111-1111-4111-8111-111111111111",
      "#/pilot/runs/11111111-1111-4111-8111-111111111111",
    ]);
    expect(() => routeToHash({ page: "run", id: "not-a-uuid" })).toThrow();
    expect(() => routeToHash({ page: "pilot-run", id: "not-a-uuid" })).toThrow();
  });
});
