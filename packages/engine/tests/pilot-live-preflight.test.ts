import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { runPilotLivePreflight } from "../src/pilot/live-preflight.js";
import { runPreflightCli } from "../src/pilot/live-preflight-cli.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("BE-26: SaaS Setup & Live Read Preflight", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fails-closed as BLOCKED_EXTERNAL when credentials are not configured", async () => {
    const result = await runPilotLivePreflight({
      config: { enabled: false },
    });

    expect(result.status).toBe("blocked_external");
    expect(result.evidenceLabel).toBe("BLOCKED_EXTERNAL");
    expect(result.checks.config.enabled).toBe(false);
    expect(result.checks.sheetsRead.status).toBe("skipped");
    expect(result.checks.trelloRead.status).toBe("skipped");
    expect(result.checks.writeVerification.writesAttempted).toBe(0);
  });

  it("fails-closed when target IDs are missing", async () => {
    const result = await runPilotLivePreflight({
      config: {
        enabled: true,
        principals: ["operator"],
        spreadsheetId: "",
        tabId: "",
        boardId: "",
      },
    });

    expect(result.status).toBe("blocked_external");
    expect(result.evidenceLabel).toBe("BLOCKED_EXTERNAL");
    expect(result.checks.config.status).toBe("fail");
  });

  it("successfully completes preflight read checks and verifies 0 writes when valid", async () => {
    // Mock global fetch for both Google Sheets and Trello read endpoints
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes("sheets.googleapis.com")) {
        return new Response(
          JSON.stringify({
            values: [
              [
                "request_id",
                "client_ref",
                "request_type",
                "raw_request",
                "deliverable",
                "due_date",
                "decision_status",
                "source_note",
              ],
              [
                "REQ-001",
                "CLIENT-A",
                "design_asset",
                "Design home banner",
                "Hero Banner Figma 1920x1080",
                "2026-10-01",
                "confirmed",
                "Priority client",
              ],
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (urlStr.includes("api.trello.com") && urlStr.includes("/lists")) {
        return new Response(
          JSON.stringify([
            { id: "list-1", name: "To Do", closed: false },
            { id: "list-2", name: "In Progress", closed: false },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (urlStr.includes("api.trello.com") && urlStr.includes("/members")) {
        return new Response(
          JSON.stringify([
            { id: "member-1", fullName: "Alice Designer", username: "alice" },
            { id: "member-2", fullName: "Bob Reviewer", username: "bob" },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("Not Found", { status: 404 });
    });

    const result = await runPilotLivePreflight({
      config: {
        enabled: true,
        principals: ["operator-1"],
        spreadsheetId: "sheet-abc-123",
        tabId: "Requests",
        boardId: "board-xyz-789",
        google: { apiKey: "mock-google-key-secret-999" },
        trello: {
          apiKey: "mock-trello-key-888",
          apiToken: "mock-trello-token-777",
          listId: "list-1",
        },
      },
      principalId: "operator-1",
      testRequestId: "REQ-001",
    });

    expect(result.status).toBe("passed");
    expect(result.evidenceLabel).toBe("CONFIRMED");
    expect(result.checks.sheetsRead.status).toBe("pass");
    expect(result.checks.sheetsRead.sampleResult?.requestId).toBe("REQ-001");
    expect(result.checks.sheetsRead.sampleResult?.checklistStatus).toBe("pass");

    expect(result.checks.trelloRead.status).toBe("pass");
    expect(result.checks.trelloRead.listsCount).toBe(2);
    expect(result.checks.trelloRead.membersCount).toBe(2);

    expect(result.checks.writeVerification.writesAttempted).toBe(0);
  });

  it("redacts secrets from errors and logs when upstream HTTP fails", async () => {
    const sensitiveApiKey = "super-secret-trello-key-12345";
    const sensitiveToken = "super-secret-trello-token-67890";

    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes("sheets.googleapis.com")) {
        return new Response(
          JSON.stringify({
            values: [
              [
                "request_id",
                "client_ref",
                "request_type",
                "raw_request",
                "deliverable",
                "due_date",
                "decision_status",
                "source_note",
              ],
              [
                "REQ-001",
                "CLIENT-A",
                "design_asset",
                "Design home banner",
                "Hero Banner Figma 1920x1080",
                "2026-10-01",
                "confirmed",
                "Priority client",
              ],
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      // Trello returns 401 with sensitive token in error URL
      return new Response(
        `Unauthorized access with key=${sensitiveApiKey}&token=${sensitiveToken}`,
        { status: 401, statusText: "Unauthorized" },
      );
    });

    const result = await runPilotLivePreflight({
      config: {
        enabled: true,
        principals: ["operator-1"],
        spreadsheetId: "sheet-abc-123",
        tabId: "Requests",
        boardId: "board-xyz-789",
        google: { apiKey: "mock-google-key-secret-999" },
        trello: {
          apiKey: sensitiveApiKey,
          apiToken: sensitiveToken,
          listId: "list-1",
        },
      },
      principalId: "operator-1",
      testRequestId: "REQ-001",
    });

    expect(result.status).toBe("failed");
    expect(result.checks.trelloRead.status).toBe("fail");
    const jsonStr = JSON.stringify(result);
    expect(jsonStr).not.toContain(sensitiveApiKey);
    expect(jsonStr).not.toContain(sensitiveToken);
    expect(result.checks.writeVerification.writesAttempted).toBe(0);
  });

  it("blocks omitted or unauthorized identity before network activity", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        throw new Error("UNEXPECTED_NETWORK");
      });
    const config = {
      enabled: true,
      principals: ["operator-1"],
      spreadsheetId: "sheet-1",
      tabId: "Requests",
      boardId: "board-1",
      google: { apiKey: "google-key-secret" },
      trello: {
        apiKey: "trello-key-secret",
        apiToken: "trello-token-secret",
        listId: "list-1",
      },
    };
    for (const options of [
      { config, testRequestId: "REQ-1" },
      { config, principalId: "operator-1" },
      { config, principalId: "intruder", testRequestId: "REQ-1" },
      {
        config,
        principalId: "operator-1",
        testRequestId: "REQ-1",
        allowSimulatedFallback: true,
      },
      {
        config,
        principalId: "operator-1",
        testRequestId: "REQ-1",
        policy: {
          enabled: true,
          principals: ["operator-1"],
          spreadsheetId: "wrong",
          tabId: "Requests",
          boardId: "board-1",
        },
      },
    ]) {
      const result = await runPilotLivePreflight(options);
      expect(result.status).not.toBe("passed");
      expect(result.checks.writeVerification.writesAttempted).toBe(0);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks service-account-only credentials before any remote request", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        throw new Error("UNEXPECTED_NETWORK");
      });
    const result = await runPilotLivePreflight({
      config: {
        enabled: true,
        principals: ["operator-1"],
        spreadsheetId: "sheet-1",
        tabId: "Requests",
        boardId: "board-1",
        google: {
          clientEmail: "robot@example.com",
          privateKey: "private-key-secret",
          apiKey: "",
        },
        trello: {
          apiKey: "trello-key-secret",
          apiToken: "trello-token-secret",
          listId: "list-1",
        },
      },
      principalId: "operator-1",
      testRequestId: "REQ-1",
    });
    expect(result.status).toBe("blocked_external");
    expect(JSON.stringify(result)).not.toContain("private-key-secret");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails when the configured target list is not on the allowlisted board", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi
      .fn()
      .mockImplementation(async (url: string | URL, init?: RequestInit) => {
        calls.push(init?.method ?? "GET");
        const address = url.toString();
        const body = address.includes("sheets.googleapis.com")
          ? {
              values: [
                [
                  "request_id",
                  "client_ref",
                  "request_type",
                  "raw_request",
                  "deliverable",
                  "due_date",
                  "decision_status",
                  "source_note",
                ],
                [
                  "REQ-1",
                  "CLIENT-A",
                  "design_asset",
                  "private row body",
                  "Banner",
                  "2026-10-01",
                  "confirmed",
                  "",
                ],
              ],
            }
          : address.includes("/lists")
            ? [{ id: "other-list", name: "Other", closed: false }]
            : [];
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });
    const result = await runPilotLivePreflight({
      config: {
        enabled: true,
        principals: ["operator-1"],
        spreadsheetId: "sheet-1",
        tabId: "Requests",
        boardId: "board-1",
        google: { apiKey: "google-key-secret" },
        trello: {
          apiKey: "trello-key-secret",
          apiToken: "trello-token-secret",
          listId: "target-list",
        },
      },
      principalId: "operator-1",
      testRequestId: "REQ-1",
    });
    expect(result.status).toBe("failed");
    expect(result.checks.trelloRead.status).toBe("fail");
    expect(result.checks.writeVerification.writesAttempted).toBe(0);
    expect(calls).not.toContain("POST");
    expect(JSON.stringify(result)).not.toContain("private row body");
  });

  it("CLI emits one redacted blocked result and nonzero code without required flags", async () => {
    const lines: string[] = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        throw new Error("UNEXPECTED_NETWORK");
      });
    const code = await runPreflightCli([], (line) => lines.push(line));
    expect(code).not.toBe(0);
    expect(lines).toHaveLength(1);
    const result = JSON.parse(lines[0]!);
    expect(result.checks.writeVerification.writesAttempted).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("CLI writes a redacted failure artifact and exits nonzero for disabled pilot", async () => {
    vi.stubEnv("PILOT_V2_ENABLED", "false");
    const dir = await mkdtemp(join(tmpdir(), "pilot-preflight-"));
    const file = join(dir, "result.json");
    const lines: string[] = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        throw new Error("UNEXPECTED_NETWORK");
      });
    try {
      const code = await runPreflightCli(
        [
          "--principal",
          "operator-1",
          "--request-id",
          "REQ-1",
          "--output",
          file,
        ],
        (line) => lines.push(line),
      );
      expect(code).not.toBe(0);
      expect(lines).toHaveLength(1);
      expect(
        JSON.parse(await readFile(file, "utf8")).checks.writeVerification
          .writesAttempted,
      ).toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("CLI writes one redacted artifact and exits zero only after both GET reads pass", async () => {
    const env = {
      PILOT_V2_ENABLED: "true",
      PILOT_PRINCIPALS: "operator-1",
      PILOT_SPREADSHEET_ID: "sheet-1",
      PILOT_TAB_ID: "Requests",
      PILOT_BOARD_ID: "board-1",
      PILOT_TRELLO_LIST_ID: "list-1",
      GOOGLE_SHEETS_API_KEY: "google-key-secret",
      TRELLO_API_KEY: "trello-key-secret",
      TRELLO_API_TOKEN: "trello-token-secret",
    };
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    const dir = await mkdtemp(join(tmpdir(), "pilot-preflight-"));
    const file = join(dir, "result.json");
    const lines: string[] = [];
    const methods: string[] = [];
    globalThis.fetch = vi
      .fn()
      .mockImplementation(async (url: string | URL, init?: RequestInit) => {
        methods.push(init?.method ?? "GET");
        const address = url.toString();
        const body = address.includes("sheets.googleapis.com")
          ? {
              values: [
                [
                  "request_id",
                  "client_ref",
                  "request_type",
                  "raw_request",
                  "deliverable",
                  "due_date",
                  "decision_status",
                  "source_note",
                ],
                [
                  "REQ-1",
                  "CLIENT-A",
                  "design_asset",
                  "private row body",
                  "Banner",
                  "2026-10-01",
                  "confirmed",
                  "",
                ],
              ],
            }
          : address.includes("/lists")
        ? [{ id: "list-1", name: "https://example.test/?custom_secret=list-query-secret", closed: false }]
            : [];
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });
    try {
      expect(
        await runPreflightCli(
          [
            "--principal",
            "operator-1",
            "--request-id",
            "REQ-1",
            "--output",
            file,
          ],
          (line) => lines.push(line),
        ),
      ).toBe(0);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!).status).toBe("passed");
      const artifact = await readFile(file, "utf8");
      expect(
        JSON.parse(artifact).checks.writeVerification.writesAttempted,
      ).toBe(0);
      for (const secret of [
        "google-key-secret",
        "trello-key-secret",
        "trello-token-secret",
        "private row body",
        "list-query-secret",
      ]) {
        expect(artifact).not.toContain(secret);
        expect(lines[0]).not.toContain(secret);
      }
      expect(methods).toEqual(["GET", "GET", "GET"]);
    } finally {
      vi.unstubAllEnvs();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("CLI does not contact SaaS when the evidence file cannot be created", async () => {
    const env = {
      PILOT_V2_ENABLED: "true",
      PILOT_PRINCIPALS: "operator-1",
      PILOT_SPREADSHEET_ID: "sheet-1",
      PILOT_TAB_ID: "Requests",
      PILOT_BOARD_ID: "board-1",
      PILOT_TRELLO_LIST_ID: "list-1",
      GOOGLE_SHEETS_API_KEY: "google-key-secret",
      TRELLO_API_KEY: "trello-key-secret",
      TRELLO_API_TOKEN: "trello-token-secret",
    };
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    const dir = await mkdtemp(join(tmpdir(), "pilot-preflight-"));
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        throw new Error("UNEXPECTED_NETWORK");
      });
    try {
      const code = await runPreflightCli(
        [
          "--principal",
          "operator-1",
          "--request-id",
          "REQ-1",
          "--output",
          join(dir, "absent", "result.json"),
        ],
        () => {},
      );
      expect(code).not.toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
