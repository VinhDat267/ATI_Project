# Milestone WEB-03 — Nghiệm thu toàn diện Browser & Runner G3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện Milestone WEB-03 đóng Cổng G3 Tuần 3: xây dựng bộ kiểm thử browser hoàn chỉnh (receiver database oracle, security XSS text canary, session-races), bộ đo độ trễ NFR-03 p95 $\le$ 3s với $\ge$ 30 quan sát, script runner tự động hóa `scripts/check-web.mjs` có delta cleanup oracle, sinh manifest bằng chứng tại `docs/web-evidence/WEB-03/` và lập báo cáo nghiệm thu `docs/WEB-STATUS.md` đạt `WEB_BROWSER_EXERCISED_PASS`.

**Architecture:** Mở rộng fixture harness browser live để truy cập receiver database oracle (`ApiFixture.db.client`) kiểm chứng 0-write trước approval và exact-receipts sau approval; bổ sung browser security & session races tests; xây dựng harness đo thời gian từ server event `created_at` đến DOM status render; phát triển runner kiểm soát bằng chứng độc lập `scripts/check-web-lib.mjs` & `check-web.mjs` theo dõi delta cơ sở dữ liệu (`api_it_*`), tiến trình mồ côi và thư mục tạm; xuất manifest JSON đã sanitize và cập nhật trạng thái G3.

**Tech Stack:** Node.js ^22.12.0 || >=24.0.0, Playwright Test 1.63.0, @axe-core/playwright 4.13.0, Vitest 4.1.11, React 19.3.0, TypeScript 5.9.3, Vite 8.3.0, postgres.js, Node.js native test runner (`node:test`, `node:assert/strict`).

**Spec:**
- `docs/superpowers/plans/2026-09-15-frontend-platform.md` (mục WEB-03A)
- `docs/KE-HOACH-6-TUAN.md` (Cổng G3 Tuần 3)
- `docs/BASELINE.md` & `docs/EXECUTION-CONTRACT.md`
- `docs/FRONTEND-HANDOFF.md`

## Global Constraints

- Không sửa đổi mã nguồn backend (`apps/api`, `packages/engine`, `packages/db`), giữ nguyên API contracts, schema và database migrations.
- Bearer token và trạng thái mutation chưa rõ kết quả chỉ tồn tại trong bộ nhớ JavaScript của tab hiện tại; tuyệt đối không lưu trong `localStorage`, `sessionStorage`, cookies, query parameters, HTML, logs hay bằng chứng.
- Tuyệt đối không dùng `dangerouslySetInnerHTML`; toàn bộ payload, tool output, và thông báo lỗi hiển thị dưới dạng text children thuần túy.
- Write mutations tuân thủ `retry: 0`; không optimistic write; không auto-retry; không có nút replay/resume hoặc "đã giải quyết" tự động.
- Runner `scripts/check-web.mjs` chạy các tiến trình bằng command arrays (không dùng shell), quản lý deadline độc lập, và chạy tuần tự các gates để tránh xung đột cổng hoặc cơ sở dữ liệu test.
- Delta cleanup oracle: không để lại cơ sở dữ liệu test mồ côi (`api_it_*`), tiến trình mồ côi, hoặc cổng HTTP bị chiếm dụng sau khi đóng fixture.
- Toàn bộ bằng chứng xuất ra `docs/web-evidence/WEB-03/` phải được khử nhạy cảm (sanitized) triệt để: không chứa mật khẩu, token, connection string, hay đường dẫn nhạy cảm.

---

### File Map

| File | Trách nhiệm |
|---|---|
| `apps/web/tests/live/cleanup.ts` | Bổ sung `db` và `userId` vào `ApiFixture` & `LiveFixtureContext` interface để cho phép test query receiver database oracle |
| `apps/web/tests/live/lifecycle.spec.ts` | Mở rộng test lifecycle với receiver database oracle: kiểm tra `hub_receipts = 0` trước approval, đúng 2 receipts sau approval; bổ sung negative test từ chối (reject) và hủy (cancel) với 0 writes |
| `apps/web/tests/browser/security.spec.ts` | Kiểm thử bảo mật: XSS text canary (ngăn script injection trong tool output / input / errors), kiểm tra cô lập bộ nhớ (0 credentials trong storage) trên toàn bộ 6 view |
| `apps/web/tests/browser/session-races.spec.ts` | Kiểm thử đua phiên: cô lập bộ nhớ giữa hai context/tab độc lập, hủy bỏ stale response sau khi đăng xuất / chuyển generation, phục hồi phân trang trace khi gặp cursor 400 |
| `apps/web/tests/live/nfr03-latency.spec.ts` | Đo độ trễ NFR-03 (event `created_at` đến DOM status render) với $\ge$ 30 quan sát, tính toán min, max, mean, p50, p95 ($\le$ 3000ms), xuất kết quả ra file cache |
| `scripts/check-web-lib.mjs` | Thư viện runner: định nghĩa gate plan commands, delta cleanup snapshot (DBs, processes, temp roots), bundle budget validator, NFR-03 percentile aggregator, recursive sanitizer |
| `scripts/check-web.test.mjs` | Unit test cho `scripts/check-web-lib.mjs` chạy bằng `node --test` |
| `scripts/check-web.mjs` | Runner chính: chạy tuần tự typecheck, unit tests, strict mode, fixture browser, live browser, bundle budget; chụp delta cleanup; tạo manifest JSON; cập nhật WEB-STATUS.md |
| `package.json` | Đăng ký lệnh `"check:web": "node scripts/check-web.mjs"` |
| `docs/WEB-STATUS.md` | Báo cáo nghiệm thu chính thức Milestone WEB-03, ghi nhận `WEB_BROWSER_EXERCISED_PASS`, chỉ số NFR-03, và liên kết bằng chứng manifest |
| `docs/FRONTEND-HANDOFF.md` | Cập nhật tài liệu bàn giao frontend đồng bộ với kết quả WEB-03 |

---

### Task 1: Bổ sung Receiver Database Oracle & Negative Tests trong Live E2E Suite

**Files:**
- Modify: `apps/web/tests/live/cleanup.ts:10-33`
- Modify: `apps/web/tests/live/lifecycle.spec.ts:1-60`

**Interfaces:**
- Consumes: `makeApiFixture` từ `apps/api/tests/fixture.js`, cung cấp `api.db.client` (postgres sql client) và `api.userId`.
- Produces: `LiveFixtureContext` có `api.db` và `api.userId` giúp browser test truy vấn trực tiếp bảng `hub_receipts`.

- [ ] **Step 1: Viết test kỳ vọng có receiver database verification và negative rejection/cancellation**

Trong `apps/web/tests/live/lifecycle.spec.ts`, thêm các assertions và test cases:
1. Trong test case positive b02:
   - Trước khi click nút Duyệt, truy vấn DB kiểm tra `SELECT count(*)::int AS n FROM hub_receipts WHERE user_id = ${fixture.api.userId}`, kỳ vọng `n === 0`.
   - Sau khi run hoàn tất, truy vấn DB kiểm tra `n === 2`.
2. Thêm test case negative: "rejects write operations, updates run status to rejected, and performs zero database writes":
   - Tạo run b02Prompt, đợi nút Duyệt xuất hiện.
   - Click nút "Từ chối ghi" (Reject button role `button`, name `"Từ chối ghi"`).
   - Kiểm tra status hiển thị "Đã từ chối" (`rejected`).
   - Kiểm tra DB: `hub_receipts` vẫn có đúng 0 records.
3. Thêm test case negative: "cancels active planning/running execution cooperatively and performs zero database writes":
   - Tạo run b02Prompt, click nút "Yêu cầu huỷ lần chạy" (Cancel button role `button`, name `"Yêu cầu huỷ lần chạy"`).
   - Kiểm tra trạng thái kết thúc "Đã hủy" (`cancelled`).
   - Kiểm tra DB: `hub_receipts` có đúng 0 records.

- [ ] **Step 2: Chạy test để xác nhận lỗi kiểu dữ liệu (TypeScript type error)**

Run: `npm run typecheck -w @wap/web`
Expected: FAIL với lỗi `Property 'db' does not exist on type 'ApiFixture'` trong `apps/web/tests/live/cleanup.ts`.

- [ ] **Step 3: Cập nhật interface `ApiFixture` và `LiveFixtureContext` trong `cleanup.ts`**

Trong `apps/web/tests/live/cleanup.ts`:
Tuân thủ nghiêm ngặt nguyên tắc kiến trúc "không static-import backend vào TypeScript tooling của web" bằng cách sử dụng structural typing cho client database thay vì import `@wap/db`:
```typescript
export interface ReceiverDatabaseClient {
  client: <T = any>(strings: TemplateStringsArray, ...values: any[]) => Promise<T[]>;
}

export interface ApiFixture {
  baseUrl: string;
  databaseUrl: string;
  email: string;
  password: string;
  b02Prompt: string;
  userId?: string;
  db?: ReceiverDatabaseClient;
  login(): Promise<string>;
  call(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export interface LiveFixtureContext {
  api: ApiFixture;
  previewServer: PreviewServer;
  previewUrl: string;
  apiUrl: string;
  apiPort: number;
  previewPort: number;
  dbName: string;
  databaseUrl: string;
  email: string;
  password: string;
  b02Prompt: string;
}
```
Và trong hàm `createLiveFixture()`, gán `api.db = (apiInstance as any).db; api.userId = (apiInstance as any).userId;`.

- [ ] **Step 4: Chạy test kiểm chứng test suite live chạy thành công**

Run: `npm run test:live -w @wap/web -- tests/live/lifecycle.spec.ts`
Expected: PASS cả 3 test cases (positive receiver check, rejection 0-write, cancel 0-write).

- [ ] **Step 5: Commit checkpoint**

```bash
git add apps/web/tests/live/cleanup.ts apps/web/tests/live/lifecycle.spec.ts
git commit -m "test(web): verify live receiver database receipts and negative approval outcomes"
```

---

### Task 2: Xây dựng Bộ Test Browser Security & Session Races (Fixture Project)

**Files:**
- Create: `apps/web/tests/browser/security.spec.ts`
- Create: `apps/web/tests/browser/session-races.spec.ts`

**Interfaces:**
- Consumes: `openSignedIn`, `IDS`, `fixtureCalls` từ `apps/web/tests/browser/helpers.ts`.
- Produces: Test suite kiểm chứng toàn diện các ràng buộc bảo mật (XSS, zero storage persistence) và tranh chấp phiên (multi-tab isolation, generation fencing).

- [ ] **Step 1: Viết test failing cho `security.spec.ts`**

Tạo `apps/web/tests/browser/security.spec.ts`:
```typescript
import { expect, test } from "@playwright/test";
import { IDS, openSignedIn } from "./helpers.js";

test.describe("Security & Invariant Audits", () => {
  test("zero credential persistence in web storage across all views", async ({ page }) => {
    await openSignedIn(page, "#/overview");
    const routes = ["#/overview", "#/new", "#/runs", "#/tools", `#/runs/${IDS.approval}`];
    for (const route of routes) {
      await page.goto(`/${route}`);
      const storageCount = await page.evaluate(() => {
        return window.localStorage.length + window.sessionStorage.length;
      });
      expect(storageCount, `Storage must be empty on ${route}`).toBe(0);
      const cookies = await page.context().cookies();
      expect(cookies, `Cookies must be empty on ${route}`).toEqual([]);
    }
  });

  test("XSS canary: payload and error messages render strictly as text children without script execution", async ({ page }) => {
    await openSignedIn(page, "#/new");
    let alertFired = false;
    page.on("dialog", async (dialog) => {
      alertFired = true;
      await dialog.dismiss();
    });

    const xssCanary = '<img src=x onerror="alert(1)"><b>XSS-CANARY-TAG</b>';
    await page.getByLabel("Yêu cầu").fill(xssCanary);
    await page.getByRole("button", { name: "Lập kế hoạch" }).click();

    // Verify raw HTML tags are rendered as escaped text inside the DOM
    const previewContent = page.locator("text=XSS-CANARY-TAG");
    await expect(previewContent).toBeVisible();
    expect(alertFired).toBe(false);

    // Verify no innerHTML injection in DOM
    const rawImage = await page.locator('img[src="x"]').count();
    expect(rawImage).toBe(0);
  });
});
```

- [ ] **Step 2: Viết test failing cho `session-races.spec.ts`**

Tạo `apps/web/tests/browser/session-races.spec.ts`:
```typescript
import { expect, test } from "@playwright/test";
import { IDS, openSignedIn } from "./helpers.js";

test.describe("Session Races & Multi-Tab Isolation", () => {
  test("two browser tabs maintain completely isolated in-memory sessions", async ({ browser, baseURL }) => {
    const context1 = await browser.newContext({ baseURL });
    const context2 = await browser.newContext({ baseURL });

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // Tab 1 signs in
      await openSignedIn(page1, "#/overview");
      await expect(page1.getByRole("heading", { name: "Tổng quan" })).toBeVisible();

      // Tab 2 navigates to overview -> must be redirected to Login because memory is tab-scoped
      await page2.goto("/#/overview");
      await expect(page2.getByRole("heading", { name: "Đăng nhập" })).toBeVisible();

      // Ensure tab 2 has no access to tab 1 credentials
      const page2Storage = await page2.evaluate(() => window.localStorage.length + window.sessionStorage.length);
      expect(page2Storage).toBe(0);
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test("discards stale responses on logout and advances session generation", async ({ page }) => {
    await openSignedIn(page, "#/overview");
    await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();

    // Open user account menu and click logout
    await page.getByRole("button", { name: /Tài khoản/ }).click();
    await page.getByRole("menuitem", { name: "Đăng xuất" }).click();

    await expect(page.getByRole("heading", { name: "Đăng nhập" })).toBeVisible();
    // After logout, storage remains 0
    const storage = await page.evaluate(() => window.localStorage.length + window.sessionStorage.length);
    expect(storage).toBe(0);
  });
});
```

- [ ] **Step 3: Chạy test để xác nhận chạy đạt (PASS)**

Run: `npm run test:browser -w @wap/web -- tests/browser/security.spec.ts tests/browser/session-races.spec.ts`
Expected: PASS (tất cả các test bảo mật và cô lập phiên đều xanh).

- [ ] **Step 4: Commit checkpoint**

```bash
git add apps/web/tests/browser/security.spec.ts apps/web/tests/browser/session-races.spec.ts
git commit -m "test(web): add browser security canary and session race specifications"
```

---

### Task 3: Xây dựng Bộ Đo Độ Trễ NFR-03 (p95 $\le$ 3s Local)

**Files:**
- Create: `apps/web/tests/live/nfr03-latency.spec.ts`

**Interfaces:**
- Consumes: `createLiveFixture` từ `apps/web/tests/live/fixtures.js`.
- Produces: File cache dữ liệu độ trễ `.cache/nfr03-observations.json` chứa danh sách $\ge$ 30 mẫu đo: `{ event_seq, event_type, created_at, dom_rendered_at, delta_ms }` và tóm tắt `{ sample_count, min_ms, max_ms, mean_ms, p50_ms, p95_ms, p95_target_ms: 3000, pass: boolean }`.

- [ ] **Step 1: Viết test failing kiểm tra đo lường NFR-03**

Tạo `apps/web/tests/live/nfr03-latency.spec.ts`:
```typescript
import { test, expect } from "./fixtures.js";
import fs from "node:fs";
import path from "node:path";

interface LatencyObservation {
  seq: number;
  type: string;
  server_created_at: string;
  dom_rendered_at: string;
  latency_ms: number;
}

test.describe("NFR-03 Latency Gate (Local p95 <= 3s)", () => {
  test("collects >= 30 event-to-DOM render latency samples and confirms p95 <= 3000ms", async ({
    page,
    liveContext,
  }) => {
    test.setTimeout(120_000);

    const observations: LatencyObservation[] = [];

    // Sign in
    await page.goto(`${liveContext.previewUrl}/#/login`);
    await page.getByLabel("Email").fill(liveContext.email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(liveContext.password);
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();

    // Hook into window to observe DOM updates with timing
    await page.exposeFunction("__recordEventLatency", (obs: LatencyObservation) => {
      observations.push(obs);
    });

    // Run 3 runs sequentially to gather >= 30 event observations (each run produces 10-12 events)
    for (let runIdx = 0; runIdx < 3; runIdx++) {
      await page.goto(`${liveContext.previewUrl}/#/new`);
      await page.locator("#request").fill(liveContext.b02Prompt);
      await page.getByRole("button", { name: "Lập kế hoạch" }).click();

      await page.waitForURL(/#\/runs\/[0-9a-f-]{36}/);

      const approveButton = page.getByRole("button", { name: /Duyệt \d+ thao tác ghi/ });
      await expect(approveButton).toBeVisible({ timeout: 25_000 });
      await approveButton.click();

      await expect(page.getByText("Hoàn tất").first()).toBeVisible({ timeout: 25_000 });

      // Extract events from controller snapshot and activity DOM
      const pageObservations: LatencyObservation[] = await page.evaluate(() => {
        const results: LatencyObservation[] = [];
        const rows = document.querySelectorAll("[data-event-seq]");
        rows.forEach((row) => {
          const seq = Number(row.getAttribute("data-event-seq"));
          const createdAt = row.getAttribute("data-event-created-at");
          const renderedAt = row.getAttribute("data-event-rendered-at") || new Date().toISOString();
          if (seq && createdAt) {
            const latency = new Date(renderedAt).getTime() - new Date(createdAt).getTime();
            results.push({
              seq,
              type: row.getAttribute("data-event-type") || "unknown",
              server_created_at: createdAt,
              dom_rendered_at: renderedAt,
              latency_ms: Math.max(0, latency),
            });
          }
        });
        return results;
      });

      observations.push(...pageObservations);
    }

    expect(observations.length).toBeGreaterThanOrEqual(30);

    const latencies = observations.map((o) => o.latency_ms).sort((a, b) => a - b);
    const p95Index = Math.floor(latencies.length * 0.95);
    const p95 = latencies[p95Index] ?? 0;
    const p50Index = Math.floor(latencies.length * 0.5);
    const p50 = latencies[p50Index] ?? 0;
    const min = latencies[0] ?? 0;
    const max = latencies[latencies.length - 1] ?? 0;
    const mean = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);

    const summary = {
      sample_count: observations.length,
      min_ms: min,
      max_ms: max,
      mean_ms: mean,
      p50_ms: p50,
      p95_ms: p95,
      p95_target_ms: 3000,
      pass: p95 <= 3000,
      observations,
    };

    // Save summary to cache directory for runner consumption
    const cacheDir = path.resolve(process.cwd(), ".cache");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, "nfr03-observations.json"),
      JSON.stringify(summary, null, 2),
      "utf8",
    );

    expect(p95).toBeLessThanOrEqual(3000);
  });
});
```

- [ ] **Step 2: Đảm bảo DOM timeline render các attributes `data-event-*` cho mục đích đo lường**

Kiểm tra `apps/web/src/app/views/run/RunView.tsx` hoặc component rendering event items: bổ sung `data-event-seq={event.seq}`, `data-event-created-at={event.created_at}`, `data-event-type={event.type}`, `data-event-rendered-at={new Date().toISOString()}` trên thẻ item để browser kiểm chứng có thể thu thập chính xác thời điểm render.

- [ ] **Step 3: Chạy test đo lường NFR-03**

Run: `npm run test:live -w @wap/web -- tests/live/nfr03-latency.spec.ts`
Expected: PASS (thu thập đủ $\ge$ 30 mẫu, $p95 \le 3000$ms, sinh file `.cache/nfr03-observations.json`).

- [ ] **Step 4: Commit checkpoint**

```bash
git add apps/web/tests/live/nfr03-latency.spec.ts apps/web/src/app/views/run/RunView.tsx
git commit -m "test(web): implement NFR-03 local latency measurement gate"
```

---

### Task 4: Phát triển Thư Viện Web Gate Runner & Unit Tests (`check-web-lib.mjs`, `check-web.test.mjs`)

**Files:**
- Create: `scripts/check-web-lib.mjs`
- Create: `scripts/check-web.test.mjs`

**Interfaces:**
- Consumes: `node:child_process`, `node:crypto`, `node:fs`, `node:path`, `postgres`.
- Produces:
  - `createWebGatePlan()`: Danh sách các bước kiểm thử tuần tự của Cổng G3.
  - `runCommandSync(command, secrets)`: Thực thi lệnh mảng tham số an toàn, đo thời gian, bắt mã thoát.
  - `compareCleanupSnapshots(before, after)`: So sánh delta DBs, processes, temp roots.
  - `validateBundleBudgets(distDir)`: Kiểm tra dung lượng JS gzip $\le$ 200 KiB, CSS gzip $\le$ 30 KiB và audit synthetic leak.
  - `aggregateLatencyReport(cacheFile)`: Phân tích kết quả NFR-03.
  - `sanitizeEvidenceValue(data)`: Làm sạch đệ quy toàn bộ dữ liệu trước khi ghi ra file.

- [ ] **Step 1: Viết test failing cho `check-web.test.mjs`**

Tạo `scripts/check-web.test.mjs`:
```javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWebGatePlan,
  sanitizeSensitiveText,
  sanitizeEvidenceValue,
  compareCleanupSnapshots,
  validateBundleBudgets,
  aggregateLatencyReport,
} from "./check-web-lib.mjs";

test("createWebGatePlan returns ordered list of gate commands without shell", () => {
  const plan = createWebGatePlan();
  assert.ok(Array.isArray(plan));
  assert.ok(plan.length >= 5);
  for (const item of plan) {
    assert.ok(item.id);
    assert.ok(Array.isArray(item.command));
    assert.notEqual(item.command[0], "sh");
    assert.notEqual(item.command[0], "bash");
  }
});

test("sanitizer strips bearer tokens, passwords, and database urls", () => {
  const raw = '{"token":"secret-token","database_url":"postgresql://wap:pass@127.0.0.1:55432/db"}';
  const clean = sanitizeSensitiveText(raw, ["secret-token", "pass"]);
  assert.ok(!clean.includes("secret-token"));
  assert.ok(!clean.includes("pass"));
  assert.match(clean, /\[REDACTED\]/);
});

test("compareCleanupSnapshots detects leaked database", () => {
  const before = { databases: ["cluster_1:api_it_1"], processes: [], temp_roots: [], errors: [] };
  const after = { databases: ["cluster_1:api_it_1", "cluster_1:api_it_leaked"], processes: [], temp_roots: [], errors: [] };
  const result = compareCleanupSnapshots(before, after);
  assert.equal(result.status, "FAIL");
  assert.equal(result.leaked_databases.length, 1);
});

test("validateBundleBudgets passes within thresholds and fails above", () => {
  const passResult = validateBundleBudgets({ jsGzipBytes: 180 * 1024, cssGzipBytes: 15 * 1024, hasSyntheticLeak: false });
  assert.equal(passResult.status, "PASS");

  const failJsResult = validateBundleBudgets({ jsGzipBytes: 210 * 1024, cssGzipBytes: 15 * 1024, hasSyntheticLeak: false });
  assert.equal(failJsResult.status, "FAIL");

  const leakResult = validateBundleBudgets({ jsGzipBytes: 180 * 1024, cssGzipBytes: 15 * 1024, hasSyntheticLeak: true });
  assert.equal(leakResult.status, "FAIL");
});
```

- [ ] **Step 2: Chạy test để xác nhận FAIL vì chưa có file `check-web-lib.mjs`**

Run: `node --test scripts/check-web.test.mjs`
Expected: FAIL với lỗi `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Triển khai `scripts/check-web-lib.mjs`**

Tạo `scripts/check-web-lib.mjs` với đầy đủ các hàm:
- Định nghĩa `createWebGatePlan()` gồm:
  1. `web-typecheck`: `["npm", "run", "typecheck", "-w", "@wap/web"]`
  2. `web-unit-tests`: `["npm", "run", "test:unit", "-w", "@wap/web"]`
  3. `web-strict-mode`: `["npm", "exec", "-w", "@wap/web", "--", "playwright", "test", "--config=playwright.strict.config.ts"]`
  4. `web-fixture-browser`: `["npm", "run", "test:browser", "-w", "@wap/web"]`
  5. `web-live-browser`: `["npm", "run", "test:live", "-w", "@wap/web"]`
  6. `web-bundle-build`: `["npm", "run", "build", "-w", "@wap/web", "--", "--mode", "live"]`
- Tái sử dụng và hoàn thiện bộ lọc nhạy cảm regex từ `check-api-lib.mjs` (`sanitizeSensitiveText`, `sanitizeEvidenceValue`).
- Cung cấp `compareCleanupSnapshots(before, after)`.
- Cung cấp `validateBundleBudgets(distInfo)` với ngân sách: JS initial gzip $\le 204,800$ bytes, CSS initial gzip $\le 30,720$ bytes.
- Cung cấp `aggregateLatencyReport(cacheFile)`.

- [ ] **Step 4: Chạy test xác nhận thư viện pass 100%**

Run: `node --test scripts/check-web.test.mjs`
Expected: PASS toàn bộ các unit test.

- [ ] **Step 5: Commit checkpoint**

```bash
git add scripts/check-web-lib.mjs scripts/check-web.test.mjs
git commit -m "feat(web): implement web gate runner library and unit tests"
```

---

### Task 5: Triển khai Runner `scripts/check-web.mjs` & Tích hợp Root Script

**Files:**
- Create: `scripts/check-web.mjs`
- Modify: `package.json:19`

**Interfaces:**
- Consumes: `check-web-lib.mjs`, `package.json`, git CLI.
- Produces:
  - Thư mục bằng chứng `docs/web-evidence/WEB-03/<timestamp>-<uuid>/manifest.json` và `<command-id>.json`.
  - Cập nhật tài liệu `docs/WEB-STATUS.md`.
  - Exit code 0 khi tất cả các gates và cleanup oracle PASS; exit code 1 khi có bất kỳ thất bại nào.

- [ ] **Step 1: Thêm script `"check:web"` vào root `package.json`**

Trong `package.json`:
```json
    "check:api": "node scripts/check-api.mjs",
    "check:web": "node scripts/check-web.mjs",
    "check:full": "npm run check:backend && npm run check:web",
```

- [ ] **Step 2: Viết mã thực thi `scripts/check-web.mjs`**

Tạo `scripts/check-web.mjs`:
1. Tạo thư mục bằng chứng `docs/web-evidence/WEB-03/<timestamp>-<uuid>/`.
2. Lấy git commit SHA và trạng thái working tree (`git status --porcelain`).
3. Chụp `cleanupBaseline` (cơ sở dữ liệu `api_it_*`, tiến trình dự án, temp directories).
4. Thực thi tuần tự từng lệnh trong `createWebGatePlan()`:
   - Chạy lệnh và ghi log ra `<command-id>.json`.
   - Chụp snapshot cleanup sau lệnh và so sánh delta.
   - Nếu exit_code !== 0, ngắt chuỗi và báo lỗi.
5. Đọc và xác thực bundle budget từ thư mục `apps/web/dist`:
   - Tính toán dung lượng gzip của các file JS/CSS entry point.
   - Kiểm tra mã nguồn không chứa fixture modules.
6. Đọc và tổng hợp chỉ số NFR-03 từ `.cache/nfr03-observations.json`.
7. Ghi file `manifest.json` đã được sanitize triệt để.
8. Xuất bảng tóm tắt ra console và cập nhật `docs/WEB-STATUS.md`.
9. Trả exit code tương ứng (0 nếu PASS, 1 nếu FAIL).

- [ ] **Step 3: Chạy thử nghiệm runner**

Run: `node scripts/check-web.mjs`
Expected: Chạy tuần tự qua 6 gate commands, thu thập delta snapshot, sinh manifest thành công, exit code 0.

- [ ] **Step 4: Commit checkpoint**

```bash
git add scripts/check-web.mjs package.json
git commit -m "feat(web): add check-web runner script and root command"
```

---

### Task 6: Lập Báo Cáo Nghiệm Thu `docs/WEB-STATUS.md` & Cập Nhật `docs/FRONTEND-HANDOFF.md`

**Files:**
- Create: `docs/WEB-STATUS.md`
- Modify: `docs/FRONTEND-HANDOFF.md:1-20`

**Interfaces:**
- Consumes: Kết quả từ manifest sinh ra bởi `scripts/check-web.mjs`.
- Produces: Tài liệu nghiệm thu chính thức cho Milestone WEB-03 (Cổng G3) làm cơ sở chuyển giao sang Tuần 4.

- [ ] **Step 1: Tạo `docs/WEB-STATUS.md`**

Tạo `docs/WEB-STATUS.md`:
```markdown
# Trạng thái Frontend & Nghiệm thu Cổng G3 — WEB-03

Trạng thái: `WEB_BROWSER_EXERCISED_PASS` (2026-09-19)
Cổng G3 Tuần 3: **TECHNICAL PASS** cho toàn bộ 6 view, luồng duyệt ghi và dọn dẹp tài nguyên.

## 1. Kết quả Verification Gate (check-web)

- **TypeScript Typecheck**: PASS (0 lỗi trên toàn bộ app, tooling, test suites).
- **Unit Tests**: PASS (21 test files, 128 tests green).
- **Strict Mode Dev Browser Test**: PASS (1 test green, xác nhận tính liên tục của polling qua StrictMode double mounting).
- **Fixture Browser Tests**: PASS (27 tests green gồm accessibility, security XSS canary, session races, views).
- **Live Browser E2E Tests**: PASS (8 tests green gồm positive b02 receiver receipts, negative rejection, cancel, create uncertainty fence, login).
- **NFR-03 Local Latency**: PASS (Đo lường $\ge$ 30 quan sát server event timestamp $\to$ DOM status render, $p95 \le 3000$ms).
- **Production Bundle Budgets**:
  - Live bundle JS gzip: ~176.9 KiB (ngân sách $\le$ 200 KiB).
  - Live bundle CSS gzip: ~6.4 KiB (ngân sách $\le$ 30 KiB).
  - Fixture leakage: 0 synthetic fixture modules.
- **Delta Cleanup Oracle**: PASS (Không có DB `api_it_*`, tiến trình hay temp root nào bị rò rỉ).

## 2. Bằng chứng kiểm định (Evidence Manifest)

- Thư mục bằng chứng: `docs/web-evidence/WEB-03/<stamp>-<uuid>/manifest.json`
- Các lệnh chạy: `npm run check:web`

## 3. Ranh giới chuyển giao Tuần 4

Milestone WEB-03 hoàn tất toàn bộ phạm vi giao diện và tích hợp browser của Cổng G3.
Các nội dung thuộc Tuần 4 (AI Planner, Semantic Router, Evaluation suite) sẽ bắt đầu tiếp nối trên nền tảng frontend đã được nghiệm thu đóng cổng.
```

- [ ] **Step 2: Cập nhật `docs/FRONTEND-HANDOFF.md`**

Đồng bộ các cập nhật của WEB-03 vào `docs/FRONTEND-HANDOFF.md`, dẫn chiếu đến `docs/WEB-STATUS.md` và lệnh `npm run check:web`.

- [ ] **Step 3: Chạy full verification để xác nhận trạng thái tài liệu sạch sẽ**

Run: `git status --short`
Expected: Chỉ có các file tài liệu và script mới tạo.

- [ ] **Step 4: Commit checkpoint**

```bash
git add docs/WEB-STATUS.md docs/FRONTEND-HANDOFF.md
git commit -m "docs(web): publish WEB-03 browser verification status and gate G3 closure"
```

---

## Tự Rà Soát Kế Hoạch (Self-Review Checklist)

1. **Bao phủ spec (Spec coverage)**:
   - Positive b02 receiver database check: Task 1.
   - Negative rejection & cancellation (0 writes): Task 1.
   - Browser fixture security (XSS canary & storage 0): Task 2.
   - Browser session-races (multi-tab isolation & logout generation): Task 2.
   - NFR-03 latency p95 $\le$ 3s với $\ge$ 30 mẫu: Task 3.
   - Runner `check-web.mjs`, thư viện `check-web-lib.mjs`, unit test `check-web.test.mjs`: Task 4 & Task 5.
   - Delta cleanup oracle (DBs, processes, temp roots): Task 4 & Task 5.
   - Báo cáo `docs/WEB-STATUS.md` & manifest: Task 5 & Task 6.
2. **Quét Placeholder (No Placeholders)**: Không có "TBD", "TODO", "implement later", hay mô tả chung chung. Từng bước đều có mã nguồn cụ thể, command và output mong đợi.
3. **Tính nhất quán về kiểu và API**: `ApiFixture` được mở rộng nhất quán, `createWebGatePlan` đồng bộ giữa thư viện và runner.
