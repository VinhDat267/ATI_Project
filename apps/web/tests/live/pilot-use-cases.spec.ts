import {
  expect,
  test,
  UC1_REQUEST_ID,
  UC3_CARD_ID,
  UC3_CARD_TITLE,
  UC3_CARD_URL,
  UC3_REQUEST_ID,
} from "./pilot-use-cases.fixture.js";

async function signIn(page: import("@playwright/test").Page, context: {
  previewUrl: string;
  email: string;
  password: string;
}) {
  await page.goto(`${context.previewUrl}/#/login`);
  await page.getByLabel("Email").fill(context.email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(context.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();
}

async function dbCounts(context: {
  api: { db?: { client: <T>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T[]> } };
}) {
  const rows = await context.api.db!.client<{
    runs: number;
    approvals: number;
    reservations: number;
    outbox: number;
  }>`SELECT
      (SELECT count(*)::int FROM runs) AS runs,
      (SELECT count(*)::int FROM pilot_approvals) AS approvals,
      (SELECT count(*)::int FROM business_reservations) AS reservations,
      (SELECT count(*)::int FROM run_outbox) AS outbox`;
  return rows[0];
}

test.describe("Pilot UC1 and UC3 browser acceptance", () => {
  test("checks incomplete intake and asks for clarification without creating a run or write", async ({
    page,
    pilotUseCaseContext,
  }) => {
    test.setTimeout(60_000);
    const before = await dbCounts(pilotUseCaseContext);
    await signIn(page, pilotUseCaseContext);
    await page.goto(`${pilotUseCaseContext.previewUrl}/#/pilot/new`);
    await page.getByRole("tab", { name: "Cần bổ sung thông tin" }).click();
    await page.getByRole("button", { name: /Banner thiếu hạn hoàn thành/ }).click();

    const checkResponse = page.waitForResponse((response) =>
      response.url().endsWith("/pilot/v2/check") &&
      response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Kiểm tra yêu cầu" }).click();
    const checked = await checkResponse;
    expect(checked.status()).toBe(200);
    const body = await checked.json() as {
      status: string;
      sourceKey: string;
      sourceRevision: string;
      checklistResult: {
        missingFields: string[];
        summary: string;
      };
      clarificationQuestion: string | null;
      refusalReason: string | null;
    };
    expect(body.status).toBe("needs_input");
    expect(body.sourceKey).toMatch(/^[a-f0-9]{64}$/);
    expect(body.sourceRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(body.checklistResult.missingFields).toContain("due_date");
    expect(body.checklistResult.summary).toContain(UC1_REQUEST_ID);
    expect(body.clarificationQuestion).toBeTruthy();
    expect(body.refusalReason).toBeNull();
    const result = page.getByRole("region", { name: "Kết quả kiểm tra yêu cầu" });
    await expect(result).toBeVisible();
    await expect(result).toContainText(body.clarificationQuestion!);

    expect(await dbCounts(pilotUseCaseContext)).toEqual(before);
    expect(pilotUseCaseContext.externalRequests).toEqual([]);
    expect(pilotUseCaseContext.trelloPosts).toEqual([]);

    await page.getByLabel(/Mô tả yêu cầu cho Trợ lý AI/).fill("Send an email notification through SMTP");
    const refusalResponse = page.waitForResponse((response) =>
      response.url().endsWith("/pilot/v2/check") &&
      response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Kiểm tra yêu cầu" }).click();
    const refused = await refusalResponse;
    expect(refused.status()).toBe(200);
    const refusalBody = await refused.json() as { status: string; refusalReason: string | null };
    expect(refusalBody.status).toBe("refused");
    expect(refusalBody.refusalReason).toBeTruthy();
    await expect(page.getByRole("region", { name: "Kết quả kiểm tra yêu cầu" }))
      .toContainText(refusalBody.refusalReason!);
    expect(await dbCounts(pilotUseCaseContext)).toEqual(before);
    expect(pilotUseCaseContext.externalRequests).toEqual([]);
    expect(pilotUseCaseContext.trelloPosts).toEqual([]);
  });

  test("looks up the current linked Trello card with one read and no write", async ({
    page,
    pilotUseCaseContext,
  }) => {
    test.setTimeout(60_000);
    await pilotUseCaseContext.seedConfirmedLookupReservation();
    const before = await dbCounts(pilotUseCaseContext);

    await signIn(page, pilotUseCaseContext);
    await page.goto(`${pilotUseCaseContext.previewUrl}/#/pilot/new`);
    await page.getByRole("tab", { name: "Tra cứu thẻ" }).click();
    await page.getByRole("button", { name: /Tra cứu thẻ Thiết kế Logo/ }).click();

    const lookupResponse = page.waitForResponse((response) =>
      response.url().endsWith("/pilot/v2/lookup") &&
      response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Tra cứu card đã tạo" }).click();
    const lookup = await lookupResponse;
    expect(lookup.status()).toBe(200);
    const requestBody = lookup.request().postDataJSON() as Record<string, unknown>;
    expect(requestBody).toMatchObject({
      spreadsheetId: "sheet-pilot-001",
      tabId: "tab-001",
      requestId: UC3_REQUEST_ID,
    });
    expect(requestBody).not.toHaveProperty("cardId");
    const body = await lookup.json() as {
      status: string;
      sourceKey: string;
      card: {
        id: string;
        name: string;
        description: string;
        listId: string;
        due: string | null;
        members: string[];
        url: string;
      } | null;
    };
    expect(body.status).toBe("found");
    expect(body.sourceKey).toMatch(/^[a-f0-9]{64}$/);
    expect(body.card).toMatchObject({
      id: UC3_CARD_ID,
      name: UC3_CARD_TITLE,
      description: "Current card description from Trello",
      listId: "list-current",
      members: ["member-fixture"],
      url: UC3_CARD_URL,
    });
    const result = page.getByRole("region", { name: "Kết quả tra cứu card" });
    await expect(result).toBeVisible();
    await expect(result).toContainText(UC3_CARD_TITLE);
    await expect(result.getByRole("link", { name: "Mở card Trello" }))
      .toHaveAttribute("href", UC3_CARD_URL);

    expect(pilotUseCaseContext.externalRequests).toEqual([
      `GET https://api.trello.com/1/cards/${UC3_CARD_ID}`,
    ]);
    expect(pilotUseCaseContext.trelloPosts).toEqual([]);
    expect(await dbCounts(pilotUseCaseContext)).toEqual(before);
  });
});
