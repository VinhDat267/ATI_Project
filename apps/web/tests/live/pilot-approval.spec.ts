import { test, expect } from "./pilot-fixtures.js";

type Preview = {
  approvalId: string;
  versionId: string;
  snapshotHash: string;
  expiresAt: string;
  actions: Array<{ tool: string; sideEffect: string; args: Record<string, unknown> }>;
};

async function signIn(page: import("@playwright/test").Page, context: {
  previewUrl: string; email: string; password: string;
}) {
  await page.goto(`${context.previewUrl}/#/login`);
  await page.getByLabel("Email").fill(context.email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(context.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();
}

async function createPilotRun(context: {
  email: string;
  password: string;
  apiUrl: string;
}): Promise<{ runId: string; token: string; pilotUrl: string }> {
  const login = await fetch(`${context.apiUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: context.email, password: context.password }),
  });
  expect(login.status).toBe(200);
  const { token } = await login.json() as { token: string };
  const pilotUrl = context.apiUrl.replace(/\/api\/v1$/, "/pilot/v2");
  const response = await fetch(`${pilotUrl}/runs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      spreadsheetId: "sheet-pilot-001",
      tabId: "tab-001",
      requestId: "REQ-2026-0922-01",
      userPrompt: "Review the prepared landing page task",
    }),
  });
  expect(response.status).toBe(202);
  const body = await response.json() as { runId: string };
  return { runId: body.runId, token, pilotUrl };
}

test.describe("Pilot approval with real API and isolated PostgreSQL", () => {
  test("keeps the run preview private to its owner in Chromium", async ({
    browser, page, pilotContext,
  }) => {
    test.setTimeout(60_000);
    const { runId } = await createPilotRun(pilotContext);
    const snapshot = async () => {
      const rows = await pilotContext.api.db!.client<{
        status: string;
        next_event_seq: number;
        decision: string;
        decided_at: Date | null;
        snapshot_hash: string;
        reservations: number;
      }>`SELECT r.status, r.next_event_seq, a.decision, a.decided_at, a.snapshot_hash,
                (SELECT count(*)::int FROM business_reservations WHERE run_id = r.id) AS reservations
         FROM runs r JOIN pilot_approvals a ON a.run_id = r.id WHERE r.id = ${runId}`;
      expect(rows).toHaveLength(1);
      return rows[0];
    };
    const before = await snapshot();
    expect(before?.status).toBe("awaiting_approval");
    expect(before?.decision).toBe("pending");

    await signIn(page, pilotContext);
    const ownerAResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/pilot/v2/runs/${runId}`) &&
      response.request().method() === "GET",
    );
    await page.goto(`${pilotContext.previewUrl}/#/pilot/runs/${runId}`);
    expect((await ownerAResponse).status()).toBe(200);
    const ownerAGate = page.getByRole("region", { name: "Cổng phê duyệt kế hoạch" });
    await expect(ownerAGate).toBeVisible();
    await expect(ownerAGate).toContainText("Update /landing page");
    await expect(ownerAGate.getByRole("button", { name: "Phê duyệt & Tạo thẻ ngay" })).toBeVisible();

    const ownerBPage = await browser.newPage();
    try {
      await signIn(ownerBPage, {
        previewUrl: pilotContext.previewUrl,
        email: pilotContext.ownerB.email,
        password: pilotContext.ownerB.password,
      });
      const ownerBResponse = ownerBPage.waitForResponse((response) =>
        response.url().endsWith(`/pilot/v2/runs/${runId}`) &&
        response.request().method() === "GET",
      );
      await ownerBPage.goto(`${pilotContext.previewUrl}/#/pilot/runs/${runId}`);
      expect((await ownerBResponse).status()).toBe(404);
      await expect(ownerBPage.getByText("Không tải được dữ liệu")).toBeVisible();
      await expect(ownerBPage.getByRole("region", { name: "Cổng phê duyệt kế hoạch" })).toHaveCount(0);
      await expect(ownerBPage.getByRole("button", { name: "Phê duyệt & Tạo thẻ ngay" })).toHaveCount(0);
      await expect(ownerBPage.getByRole("button", { name: "Từ chối thực hiện" })).toHaveCount(0);

      const ownerBLogin = await fetch(`${pilotContext.api.baseUrl}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: pilotContext.ownerB.email,
          password: pilotContext.ownerB.password,
        }),
      });
      expect(ownerBLogin.status).toBe(200);
      const { token: ownerBToken } = await ownerBLogin.json() as { token: string };
      const directApproval = await fetch(
        `${pilotContext.api.baseUrl.replace(/\/api\/v1$/, "/pilot/v2")}/runs/${runId}/approve`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${ownerBToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            approvalId: "00000000-0000-4000-8000-000000000099",
            versionId: "00000000-0000-4000-8000-000000000098",
            snapshotHash: "0".repeat(64),
            decision: "approved",
          }),
        },
      );
      expect(directApproval.status).toBe(404);
    } finally {
      await ownerBPage.context().close();
    }

    expect(await snapshot()).toEqual(before);
    expect(pilotContext.externalRequests).toEqual([]);
    expect(pilotContext.trelloPosts).toEqual([]);
  });

  test("creates a run in the UI, displays durable preview, and rejects once", async ({
    page, pilotContext,
  }) => {
    test.setTimeout(60_000);
    await signIn(page, pilotContext);
    await page.goto(`${pilotContext.previewUrl}/#/pilot/new`);
    await expect(page.getByRole("heading", { name: "Điều phối công việc theo mẫu" })).toBeVisible();

    const createResponse = page.waitForResponse((response) =>
      response.url().endsWith("/pilot/v2/runs") &&
      response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Lập kế hoạch thực hiện" }).click();
    const created = await createResponse;
    expect(created.status()).toBe(202);
    const { runId } = await created.json() as { runId: string };
    await page.waitForURL(new RegExp(`#/pilot/runs/${runId}$`));

    const approvalGate = page.getByRole("region", { name: "Cổng phê duyệt kế hoạch" });
    await expect(approvalGate).toBeVisible();
    await expect(approvalGate).toContainText("Update /landing page");
    await expect(approvalGate).toContainText("Thời gian duyệt còn lại:");
    const approval = await pilotContext.api.db!.client<{
      id: string; version_id: string; snapshot_hash: string; decision: string; expires_at: Date;
      owner_id: string;
    }>`SELECT id, version_id, snapshot_hash, decision, expires_at, owner_id
       FROM pilot_approvals WHERE run_id = ${runId}`;
    expect(approval).toHaveLength(1);
    expect(approval[0]?.snapshot_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(approval[0]?.decision).toBe("pending");
    expect(approval[0]?.owner_id).toBe(pilotContext.api.userId);
    expect(approval[0]!.expires_at.getTime()).toBeGreaterThan(Date.now());

    const rejectResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/pilot/v2/runs/${runId}/approve`) &&
      response.request().method() === "POST",
    );
    await approvalGate.getByRole("button", { name: "Từ chối thực hiện" }).click();
    const rejected = await rejectResponse;
    expect(rejected.status()).toBe(200);
    const decision = rejected.request().postDataJSON() as {
      approvalId: string; versionId: string; snapshotHash: string; decision: string;
    };
    expect(decision.approvalId).toBe(approval[0]?.id);
    expect(decision.versionId).toBe(approval[0]?.version_id);
    expect(decision.snapshotHash).toBe(approval[0]?.snapshot_hash);
    expect(decision.decision).toBe("rejected");
    await expect(page.getByText("Đã từ chối thực hiện").first()).toBeVisible();
    await expect(approvalGate).toHaveCount(0);

    const persisted = await pilotContext.api.db!.client<{ status: string; decision: string }>`
      SELECT r.status, a.decision FROM runs r JOIN pilot_approvals a ON a.run_id = r.id
      WHERE r.id = ${runId}`;
    expect(persisted[0]).toEqual({ status: "rejected", decision: "rejected" });
    expect(pilotContext.externalRequests).toEqual([]);
  });

  test("blocks approved write in the UI, preserves pending approval, and shows no receipt", async ({
    page, pilotContext,
  }) => {
    test.setTimeout(60_000);
    const { runId, token, pilotUrl } = await createPilotRun(pilotContext);
    const detailResponse = await fetch(`${pilotUrl}/runs/${runId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json() as { preview: Preview };
    expect(detail.preview.approvalId).toMatch(/^[0-9a-f-]{36}$/);
    expect(detail.preview.versionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(detail.preview.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(detail.preview.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(detail.preview.actions).toHaveLength(1);
    expect(detail.preview.actions[0]?.sideEffect).toBe("write");

    await signIn(page, pilotContext);
    await page.goto(`${pilotContext.previewUrl}/#/pilot/runs/${runId}`);
    const approvalGate = page.getByRole("region", { name: "Cổng phê duyệt kế hoạch" });
    await expect(approvalGate).toBeVisible();
    const approveResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/pilot/v2/runs/${runId}/approve`) &&
      response.request().method() === "POST",
    );
    await approvalGate.getByRole("button", { name: "Phê duyệt & Tạo thẻ ngay" }).click();
    const blocked = await approveResponse;
    expect(blocked.status()).toBe(503);
    const payload = await blocked.json() as { error: { code: string } };
    expect(payload.error.code).toBe("LIVE_WRITE_BLOCKED");
    await expect(page.getByText("Pilot live writes are disabled")).toBeVisible();
    await expect(approvalGate).toBeVisible();
    await expect(page.getByRole("region", { name: "Xác nhận hoàn thành" })).toHaveCount(0);

    const persisted = await pilotContext.api.db!.client<{ status: string; decision: string }>`
      SELECT r.status, a.decision FROM runs r JOIN pilot_approvals a ON a.run_id = r.id
      WHERE r.id = ${runId}`;
    expect(persisted[0]).toEqual({ status: "awaiting_approval", decision: "pending" });
    const reservations = await pilotContext.api.db!.client<{ count: number }>`
      SELECT count(*)::int AS count FROM business_reservations WHERE run_id = ${runId}`;
    expect(reservations[0]?.count).toBe(0);
    expect(pilotContext.externalRequests).toEqual([]);
  });

  test("expires a pending approval on read and blocks the stale decision", async ({
    page, pilotContext,
  }) => {
    test.setTimeout(60_000);
    const { runId, token, pilotUrl } = await createPilotRun(pilotContext);
    const before = await fetch(`${pilotUrl}/runs/${runId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(before.status).toBe(200);
    const { preview } = await before.json() as { preview: Preview };
    await pilotContext.api.db!.client`
      UPDATE pilot_approvals SET expires_at = clock_timestamp() - interval '1 minute'
      WHERE run_id = ${runId}`;

    await signIn(page, pilotContext);
    await page.goto(`${pilotContext.previewUrl}/#/pilot/runs/${runId}`);
    await expect(page.getByText("Kế hoạch đã hết thời hạn duyệt")).toBeVisible();
    await expect(page.getByRole("region", { name: "Cổng phê duyệt kế hoạch" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Phê duyệt & Tạo thẻ ngay" })).toHaveCount(0);

    const after = await fetch(`${pilotUrl}/runs/${runId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(200);
    const state = await after.json() as { status: string; preview: unknown };
    expect(state.status).toBe("expired");
    expect(state.preview).toBeNull();
    const staleDecision = await fetch(`${pilotUrl}/runs/${runId}/approve`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        approvalId: preview.approvalId,
        versionId: preview.versionId,
        snapshotHash: preview.snapshotHash,
        decision: "approved",
      }),
    });
    expect(staleDecision.status).toBe(409);
    const persisted = await pilotContext.api.db!.client<{ status: string; decision: string }>`
      SELECT r.status, a.decision FROM runs r JOIN pilot_approvals a ON a.run_id = r.id
      WHERE r.id = ${runId}`;
    expect(persisted[0]).toEqual({ status: "expired", decision: "expired" });
    expect(pilotContext.externalRequests).toEqual([]);
  });

  test("shows a receipt only after an approved write through mocked Trello", async ({
    page, pilotWriteContext,
  }) => {
    test.setTimeout(60_000);
    const { runId, token, pilotUrl } = await createPilotRun(pilotWriteContext);
    const initialResponse = await fetch(`${pilotUrl}/runs/${runId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(initialResponse.status).toBe(200);
    const initial = await initialResponse.json() as { preview: Preview };
    await signIn(page, pilotWriteContext);
    await page.goto(`${pilotWriteContext.previewUrl}/#/pilot/runs/${runId}`);
    const approvalGate = page.getByRole("region", { name: "Cổng phê duyệt kế hoạch" });
    await expect(approvalGate).toBeVisible();
    await expect(page.getByRole("region", { name: "Xác nhận hoàn thành" })).toHaveCount(0);

    const approvalResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/pilot/v2/runs/${runId}/approve`) &&
      response.request().method() === "POST",
    );
    await approvalGate.getByRole("button", { name: "Phê duyệt & Tạo thẻ ngay" }).click();
    const approved = await approvalResponse;
    expect(approved.status()).toBe(200);
    await expect(page.getByRole("region", { name: "Xác nhận hoàn thành" }))
      .toContainText("browser-fixture-card");
    expect(pilotWriteContext.trelloPosts).toHaveLength(1);
    expect(pilotWriteContext.externalRequests).toEqual([
      "GET https://api.trello.com/1/boards/board-pilot/lists",
      "POST https://api.trello.com/1/cards",
    ]);
    const persisted = await pilotWriteContext.api.db!.client<{
      status: string; decision: string;
    }>`SELECT r.status, a.decision FROM runs r
       JOIN pilot_approvals a ON a.run_id = r.id WHERE r.id = ${runId}`;
    expect(persisted[0]).toEqual({ status: "succeeded", decision: "approved" });

    // The browser keeps credentials only in memory, so a reload requires sign-in again.
    await page.reload();
    await signIn(page, pilotWriteContext);
    await page.goto(`${pilotWriteContext.previewUrl}/#/pilot/runs/${runId}`);
    await expect(page.getByRole("region", { name: "Xác nhận hoàn thành" }))
      .toContainText("browser-fixture-card");
    await expect(page.getByRole("region", { name: "Cổng phê duyệt kế hoạch" })).toHaveCount(0);
    const replay = await fetch(`${pilotUrl}/runs/${runId}/approve`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        approvalId: initial.preview.approvalId,
        versionId: initial.preview.versionId,
        snapshotHash: initial.preview.snapshotHash,
        decision: "approved",
      }),
    });
    expect(replay.status).toBe(409);
    expect(pilotWriteContext.trelloPosts).toHaveLength(1);
  });
});
