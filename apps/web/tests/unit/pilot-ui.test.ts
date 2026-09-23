import { describe, expect, it, vi } from "vitest";
import {
  PilotCreateRunInputSchema,
  PilotCreateRunResponseSchema,
  PilotRunDetailResponseSchema,
  PilotApproveInputSchema,
  PilotApproveResponseSchema,
  PilotCatalogResponseSchema,
} from "../../src/core/pilot-contracts.js";
import { createHttpTransport } from "../../src/core/api.js";

describe("Pilot v2 Frontend Contracts & Transport (Web UI)", () => {
  it("validates PilotCreateRunInputSchema correctly", () => {
    const valid = {
      requestId: "REQ-2026-0922-01",
      spreadsheetId: "sheet-001",
      tabId: "tab-001",
      userPrompt: "Create marketing banner card",
      timeZone: "Asia/Ho_Chi_Minh",
    };
    expect(PilotCreateRunInputSchema.safeParse(valid).success).toBe(true);

    // Test with default fields
    const minimal = {
      requestId: "REQ-2026-0922-01",
      userPrompt: "Create banner card",
    };
    const parsedMinimal = PilotCreateRunInputSchema.safeParse(minimal);
    expect(parsedMinimal.success).toBe(true);
    if (parsedMinimal.success) {
      expect(parsedMinimal.data.spreadsheetId).toBe("sheet-pilot-001");
      expect(parsedMinimal.data.tabId).toBe("tab-001");
    }

    const empty = { requestId: "", userPrompt: "" };
    expect(PilotCreateRunInputSchema.safeParse(empty).success).toBe(false);
  });

  it("validates PilotApproveInputSchema correctly", () => {
    const valid = {
      approvalId: "11111111-1111-4111-8111-111111111112",
      versionId: "11111111-1111-4111-8111-111111111113",
      snapshotHash: "a".repeat(64),
      decision: "approved",
    };
    expect(PilotApproveInputSchema.safeParse(valid).success).toBe(true);

    const invalid = {
      snapshotHash: "",
      decision: "maybe",
    };
    expect(PilotApproveInputSchema.safeParse(invalid).success).toBe(false);
  });

  it("validates PilotCreateRunResponseSchema matching backend 202 Accepted response", () => {
    const backendAccepted = {
      runId: "11111111-1111-4111-8111-111111111111",
      status: "planning",
      profile: "pilot-v2",
      sourceKey: "sheet-001:tab-001:REQ-01",
      sourceRevision: "a".repeat(64),
    };
    expect(PilotCreateRunResponseSchema.safeParse(backendAccepted).success).toBe(true);
  });

  it("validates PilotRunDetailResponseSchema including preview with nested snapshotHash and TTL", () => {
    // 1. Awaiting Approval (UC2) with nested preview
    const awaitingApproval = {
      id: "11111111-1111-4111-8111-111111111111",
      profile: "pilot-v2",
      status: "awaiting_approval",
      sourceKey: "sheet-001:tab-001:REQ-01",
      sourceRevision: "b".repeat(64),
      checklistResult: {
        valid: true,
        unconfirmedBusiness: false,
        missingFields: [],
      },
      preview: {
        snapshotHash: "b".repeat(64),
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        actions: [
          {
            tool: "trello.create_card",
            args: {
              boardId: "board-001",
              listName: "To Do",
              title: "Banner Marketing Q4",
              desc: "Chi tiết yêu cầu thiết kế",
              due: "2026-10-01",
            },
            sideEffect: "write",
          },
        ],
        unconfirmedBusiness: false,
        missingFields: [],
      },
      createdAt: new Date().toISOString(),
    };
    expect(PilotRunDetailResponseSchema.safeParse(awaitingApproval).success).toBe(true);

    // 2. Needs Input (UC1 Clarification) with clarificationQuestion
    const needsInput = {
      id: "22222222-2222-4222-8222-222222222222",
      status: "needs_input",
      checklistResult: {
        valid: false,
        unconfirmedBusiness: false,
        missingFields: ["due_date", "dimensions"],
        summary: "Missing required fields",
      },
      clarificationQuestion: "Vui lòng cung cấp thêm kích thước và hạn chót cho banner.",
      createdAt: new Date().toISOString(),
    };
    expect(PilotRunDetailResponseSchema.safeParse(needsInput).success).toBe(true);

    // 3. Refused (UC1 Refusal) with refusalReason
    const refused = {
      id: "33333333-3333-4333-8333-333333333333",
      status: "refused",
      refusalReason: "Không tìm thấy mã định danh yêu cầu hợp lệ trong hàng dữ liệu.",
      createdAt: new Date().toISOString(),
    };
    expect(PilotRunDetailResponseSchema.safeParse(refused).success).toBe(true);
  });

  it("validates PilotRunDetailResponseSchema including confirmed Trello receipt", () => {
    const detail = {
      id: "11111111-1111-4111-8111-111111111111",
      status: "succeeded",
      receipt: {
        cardId: "card-999",
        url: "https://trello.com/c/card-999",
        listId: "list-001",
        boardId: "board-001",
        title: "Thiết kế Banner Q4",
        intentKey: "sheet-001:tab-001:REQ-01",
      },
      createdAt: new Date().toISOString(),
    };
    expect(PilotRunDetailResponseSchema.safeParse(detail).success).toBe(true);
  });

  it("invokes transport.createPilotRun, getPilotRun, approvePilotRun, and getPilotCatalog", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/pilot/v2/runs") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            runId: "11111111-1111-4111-8111-111111111111",
            status: "planning",
            profile: "pilot-v2",
            sourceKey: "sheet-pilot-001:tab-001:REQ-01",
            sourceRevision: "a".repeat(64),
          }),
          { status: 202, headers: { "content-type": "application/json" } },
        );
      }
      if (u.includes("/pilot/v2/runs/11111111-1111-4111-8111-111111111111") && init?.method === "GET") {
        return new Response(
          JSON.stringify({
            id: "11111111-1111-4111-8111-111111111111",
            status: "awaiting_approval",
            sourceKey: "sheet-pilot-001:tab-001:REQ-01",
            sourceRevision: "a".repeat(64),
            preview: {
              snapshotHash: "a".repeat(64),
              expiresAt: new Date(Date.now() + 600000).toISOString(),
              actions: [
                {
                  tool: "trello.create_card",
                  args: {
                    boardId: "board-01",
                    listName: "To Do",
                    title: "Thiết kế banner Q4",
                    desc: "Yêu cầu",
                  },
                  sideEffect: "write",
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.includes("/approve") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            status: "succeeded",
            receipt: {
              cardId: "c1",
              url: "https://trello.com/c/c1",
              listId: "l1",
              boardId: "b1",
              title: "Thiết kế banner Q4",
              intentKey: "sheet-pilot-001:tab-001:REQ-01",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.endsWith("/pilot/v2/catalog")) {
        return new Response(
          JSON.stringify({
            tools: [
              {
                name: "trello.create_card",
                description: "Create card",
                sideEffect: "write",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("Not found", { status: 404 });
    });

    vi.stubGlobal("fetch", mockFetch);

    const transport = createHttpTransport({ baseUrl: "http://127.0.0.1:3000" });
    const ac = new AbortController();

    // 1. Create Pilot Run
    const created = await transport.createPilotRun!(
      {
        requestId: "REQ-01",
        spreadsheetId: "sheet-pilot-001",
        tabId: "tab-001",
        userPrompt: "Lập kế hoạch tạo thẻ",
      },
      ac.signal,
    );
    expect(created.runId).toBe("11111111-1111-4111-8111-111111111111");
    expect(created.status).toBe("planning");

    // 2. Get Pilot Run Detail
    const detail = await transport.getPilotRun!(
      "11111111-1111-4111-8111-111111111111",
      ac.signal,
    );
    expect(detail.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(detail.preview?.snapshotHash).toBe("a".repeat(64));

    // 3. Approve Pilot Run
    const approved = await transport.approvePilotRun!(
      "11111111-1111-4111-8111-111111111111",
      {
        approvalId: "11111111-1111-4111-8111-111111111112",
        versionId: "11111111-1111-4111-8111-111111111113",
        snapshotHash: "a".repeat(64), decision: "approved",
      },
      ac.signal,
    );
    expect(approved.status).toBe("succeeded");
    expect(approved.receipt?.cardId).toBe("c1");
    expect(approved.receipt?.url).toBe("https://trello.com/c/c1");

    // 4. Get Pilot Catalog
    const catalog = await transport.getPilotCatalog!(ac.signal);
    expect(catalog.tools).toHaveLength(1);
    expect(catalog.tools[0]?.name).toBe("trello.create_card");

    vi.unstubAllGlobals();
  });
});
