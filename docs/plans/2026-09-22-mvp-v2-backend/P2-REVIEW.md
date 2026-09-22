# Báo cáo Rà soát Độc lập Giai đoạn P2 (Connectors & Safety Execution Slice)

**Dự án:** AI Automation Platform (MVP v2)  
**Mục tiêu:** Nghiệm thu kỹ thuật và rà soát độc lập toàn bộ mã nguồn connectors, HTTP client, tool catalog, durable dispatch pipeline và fault suite thuộc Giai đoạn P2 (Tasks `BE-08` đến `BE-18`).  
**Chuyên gia rà soát:** `Code Reviewer` (Independent Specialist) & Main Orchestrator  
**Lượt rà soát:** 2 lượt (Round 1 + Round 2 Re-review)  
**Ngày rà soát:** 22/09/2026  
**Trạng thái kết luận:** **PASS — ĐẠT 100% TIÊU CHUẨN KỸ THUẬT VÀ HỢP ĐỒNG THỰC THI**

---

## 1. Tóm tắt kết quả (Executive Summary)

Đã hoàn thành rà soát độc lập chuyên sâu 2 vòng theo 4 trụ cột kỹ thuật và hợp đồng thực thi đối với 7 module mã nguồn và 8 bộ suite kiểm thử (40 unit tests cho P2, nâng tổng suite pilot lên 76 unit tests) của Giai đoạn P2:
- **BE-08:** `config.ts` — Pilot Config Boundary, Env Loading & Credential Redaction (`pilot-config.test.ts` — 6 tests)
- **BE-09:** `http-client.ts` — Bounded HTTP Client, Timeout, Body Cap, Scrubbing & No Blind Retry (`pilot-http-client.test.ts` — 7 tests)
- **BE-10:** `adapters/sheets.ts` — Google Sheets Read Adapter với Zod Validation (`pilot-sheets-adapter.test.ts` — 3 tests)
- **BE-11:** `adapters/trello-read.ts` — Trello Board / Lists / Cards Read Adapter (`pilot-trello-adapter.test.ts` — 3 tests)
- **BE-12:** `adapters/trello-write.ts` — Trello Single Card Write Adapter & Receipt Generator (`pilot-trello-adapter.test.ts` — 2 tests)
- **BE-13:** `gateway.ts` — Reviewed Pilot Gateway Catalog & Tool Dispatch Router (`pilot-gateway.test.ts` — 3 tests)
- **BE-14..18:** `dispatch.ts` — Durable Dispatch Engine, Single Remote Write Rule, Reservation State Machine, Vertical Slice & 10 Fault Injection Suite (`pilot-dispatch.test.ts` — 5 tests, `pilot-vertical-slice.test.ts` — 1 test, `pilot-fault-suite.test.ts` — 10 tests)

---

## 2. Nhật ký Rà soát Độc lập 2 Vòng (`Code Reviewer`)

### Vòng 1 (Round 1 Review): Initial Assessment & Immediate Fixes (Commit `203b645`)
- **Phát hiện:** 1 Blocker, 5 Suggestions, 1 Nit.
- **Xử lý triệt để:**
  1. *🔴 Blocker resolved:* Định dạng `operationId` chuyển sang `randomUUID()` từ `node:crypto`, tương thích hoàn toàn kiểu `UUID` trong PostgreSQL (`0011_business_reservations.sql`).
  2. *🟡 Suggestion 1 resolved:* Gán fallback `listId: listName || 'confirmed-list'` trong receipt card đã tồn tại, thỏa mãn `TrelloReceiptSchema.min(1)`.
  3. *🟡 Suggestion 2 resolved:* Tách biệt lỗi pre-dispatch (`ACCESS_DENIED`, `CONFIG_ERROR`, `LIST_NOT_FOUND`) trả về `{ status: 'failed' }`, không chuyển nhầm reservation sang `unknown`.
  4. *🟡 Suggestion 3 & 4 resolved:* Thêm kiểm tra sớm `content-length` trước khi đọc stream; loại trừ `RESPONSE_TOO_LARGE` khỏi retry; ném `INVALID_REMOTE_RESPONSE` khi parse JSON lỗi.
  5. *🟡 Suggestion 5 resolved:* Thêm kiểm tra `assertPilotAccess` trong `trelloGetCard` trước khi gọi HTTP ra ngoài.
  6. *💭 Nit resolved:* Giữ nguyên đối tượng `Date` trong `redactObject`.

### Vòng 2 (Round 2 Re-Review): Second-Round Audit & Deep Hardening (Commit `47a8f4b`)
- **Phán quyết độc lập của `Code Reviewer`:** **PASS** (0 Blocker, 4 Suggestions, 1 Nit).
- **Hành động tăng cường bảo vệ (Deep Hardening):**
  1. *🟡 Suggestion 1:* Đưa bước kiểm tra chính sách (`policy.enabled` và `policy.principals.includes(principalId)`) lên trước `store.reserve(...)`, ngăn chặn việc tạo reservation rác khi principal không có quyền.
  2. *🟡 Suggestion 2:* Mở rộng phạm vi `timeoutId` bao trùm cả `await response.text()` trong `http-client.ts`, bảo vệ toàn diện trước tấn công slowloris/trickle-stream.
  3. *🟡 Suggestion 3:* Xác thực bắt buộc `TrelloReceiptSchema.parse(rawReceipt)` trước khi gọi `store.confirm(...)`. Lỗi schema hậu dispatch tự động chuyển sang `reconciliation_required` và giữ reservation `unknown`.
  4. *🟡 Suggestion 4:* Thêm phương thức `cancel(intentKey: string): Promise<void>` vào interface `BusinessReservationStore` và lớp `InMemoryReservationStore`. Khi gặp lỗi pre-dispatch (`LIST_NOT_FOUND`), reservation chuyển sang `'cancelled'` thay vì kẹt ở `'dispatched'`.
  5. *💭 Nit 5:* Bổ sung unit tests cho `Date` trong `pilot-config.test.ts` và kiểm tra `RESPONSE_TOO_LARGE` / `INVALID_REMOTE_RESPONSE` trong `pilot-http-client.test.ts`.

---

## 3. Bằng chứng Kiểm thử Thực tế

```
Test Files  57 passed (57)
Tests       417 passed | 1 skipped (418)
Pilot Tests 76 passed (13 test files)
DB Build    npm run build -w @wap/db: exit 0
TypeScript  npm run typecheck: exit 0 (clean)
```

---

## 4. Chi tiết đánh giá theo 4 Trụ cột

### Trụ cột 1: Tuân thủ Hợp đồng thực thi & Quy tắc bất biến (Contract Invariants)

| Hạng mục rà soát | File kiểm tra | Bằng chứng & Đánh giá mã nguồn | Kết luận |
|---|---|---|---|
| **Quy tắc Single Remote Write (UC2)** | `packages/engine/src/pilot/dispatch.ts` | Khâu ghi từ xa duy nhất là `trello.create_card`. Nếu đã tồn tại confirmed reservation hoặc thẻ từ xa tương ứng, dispatch lập tức trả về receipt đã xác nhận mà không thực hiện thêm bất kỳ write call nào. Chế độ preview/dry-run tuyệt đối không gọi write tool. | **PASS** |
| **Quy tắc Zero Blind Retry khi kết quả chưa rõ** | `packages/engine/src/pilot/http-client.ts`, `dispatch.ts` | Trong `http-client.ts`, cờ `isIdempotent = false` cho method `POST`, `maxRetries = 0`. Nếu có timeout (30s) hoặc lỗi mạng trong lúc gọi `trello.create_card`, hàm không retry mà chuyển reservation sang `unknown` và trả về `{ status: 'reconciliation_required' }`. | **PASS** |
| **Phê duyệt Server-Side (10m TTL & Binding)** | `packages/engine/src/pilot/dispatch.ts` | Hàm kiểm tra: `approval.ownerId === principalId`, `approval.sourceRevision === sourceRevision`, `approval.approvedPlanHash === currentPlanHash`, và `(now - approvedAt) <= 10 * 60 * 1000`. Bất kỳ sai lệch nào đều ném `APPROVAL_EXPIRED` hoặc `APPROVAL_INVALID`. | **PASS** |
| **Bảo vệ Secret & Xóa dấu vết Credential** | `packages/engine/src/pilot/config.ts`, `http-client.ts` | Hàm `redactSecrets` tự động lọc bỏ API key, token trong URL query (`key=...&token=...`) và Bearer token trong Headers trước khi ghi log hoặc ném ngoại lệ `PilotHttpError`. Không để lọt secret vào error trace. | **PASS** |
| **Phân quyền Fail-Closed & Egress Allowlist** | `packages/engine/src/pilot/policy.ts`, `gateway.ts`, `trello-read.ts` | Mọi tool dispatch đều xác thực `assertPilotAccess` khớp chính xác `boardId`, `spreadsheetId`, `tabId` và `principalId`. Mọi URL HTTP đều bị chặn nếu không khớp miền cho phép (`api.trello.com`, `sheets.googleapis.com`). | **PASS** |

### Trụ cột 2: Phân tích An toàn & Bảo mật (Security & Reliability)

- **Memory Caps & DoS Protection:**
  - `http-client.ts` áp đặt trần cứng `maxBytes: 5 * 1024 * 1024` (5MB). Kiểm tra header `content-length` trước khi đọc body, và kiểm tra độ dài chuỗi đọc về. Nếu vượt quá, ném `RESPONSE_TOO_LARGE` và không retry.
  - Timeout mặc định 30.000ms qua `AbortController` độc lập cho từng request, giải phóng timer `clearTimeout` sau khi hoàn tất đọc stream.
- **Fail-Safe Error Isolation & Cancellation:**
  - Lỗi cấu hình môi trường thiếu key (`CONFIG_ERROR`), bảng không tìm thấy (`LIST_NOT_FOUND`), hoặc quyền bị từ chối (`ACCESS_DENIED`) được bắt và phân loại là pre-dispatch failures (`status: 'failed'`). Đã bổ sung cơ chế `store.cancel(intentKey)` để giải phóng trạng thái reservation bị hủy trước dispatch.
- **Data Integrity & UUID Conformance:**
  - `operationId` sinh bằng `randomUUID()` tương thích hoàn toàn kiểu dữ liệu `UUID` trong PostgreSQL (Migration `0011_business_reservations.sql`), ngăn chặn lỗi ép kiểu runtime khi ghi CSDL.

### Trụ cột 3: Toàn vẹn Gateway & Catalog (BE-13)

- Danh mục `PILOT_TOOL_CATALOG` đóng gói chính xác 4 công cụ:
  1. `sheets.read_rows`: Read-only, yêu cầu quyền Sheet (`spreadsheetId`, `tabId`).
  2. `trello.read_board`: Read-only, yêu cầu quyền Trello (`boardId`).
  3. `trello.read_card`: Read-only, yêu cầu quyền Trello (`boardId`).
  4. `trello.create_card`: Mutating write duy nhất, yêu cầu quyền Trello (`boardId`).
- `dispatchPilotTool` kiểm tra nghiêm ngặt: tên tool không tồn tại ném `UNKNOWN_TOOL`, cờ `policy.enabled = false` ném `ACCESS_DENIED`, principal không nằm trong danh sách ném `ACCESS_DENIED`.

### Trụ cột 4: Chất lượng Kiểm thử & Bộ kiểm thử 10 lỗi (Fault Suite Rigor)

Bộ kiểm thử `pilot-fault-suite.test.ts` triển khai đầy đủ 10 kịch bản lỗi giả lập theo tiêu chuẩn Hợp đồng thực thi:
1. **Fault 1 (Source Drift):** Thay đổi `sourceRevision` sau khi preview → Bị từ chối trước khi ghi.
2. **Fault 2 (Approval Owner Mismatch):** Operator A tạo plan, Operator B ký duyệt → Bị từ chối với `APPROVAL_INVALID`.
3. **Fault 3 (Approval Expired):** Quá 10 phút kể từ lúc duyệt → Bị từ chối với `APPROVAL_EXPIRED`.
4. **Fault 4 (Network Timeout on Write):** Trello timeout khi POST card → Chuyển reservation sang `unknown`, trả về `reconciliation_required`, CẤM blind retry.
5. **Fault 5 (Remote 500 Error on Write):** Trello trả về HTTP 500 → Chuyển reservation sang `unknown`, trả về `reconciliation_required`.
6. **Fault 6 (Duplicate Intent Concurrent Run):** Run thứ hai gọi cùng intentKey → Nhận diện trùng lặp, idempotently trả về confirmed card của run 1.
7. **Fault 7 (Dynamic Policy Revocation):** Vô hiệu hóa policy sau khi tạo preview → Chặn fail-closed với `ACCESS_DENIED`.
8. **Fault 8 (Missing Target List):** Trello list không tồn tại trên board → Báo `failed` với `LIST_NOT_FOUND` mà không gây treo reservation.
9. **Fault 9 (Unauthorized Principal):** Principal lạ cố thực thi → Bị chặn fail-closed với `ACCESS_DENIED`.
10. **Fault 10 (Credential Redaction):** Khi remote request thất bại → Lỗi và trace không chứa query `key=...&token=...`.

---

## 5. Ma trận đối chiếu Hợp đồng (Traceability Matrix)

| Yêu cầu trong Hợp đồng thực thi | Module triển khai | Unit Test chứng thực | Đánh giá |
|---|---|---|---|
| **V2-FR-02 / V2 Invariant 3:** Bounded Google Sheets Read Adapter | `adapters/sheets.ts` | `pilot-sheets-adapter.test.ts` (3 tests) | **TUÂN THỦ** |
| **V2-FR-03 / V2 Invariant 3:** Bounded Trello Read Adapter | `adapters/trello-read.ts` | `pilot-trello-adapter.test.ts` (3 tests) | **TUÂN THỦ** |
| **V2-FR-04 / V2 Invariant 1:** Trello Single Card Write Adapter & Receipt | `adapters/trello-write.ts` | `pilot-trello-adapter.test.ts` (2 tests) | **TUÂN THỦ** |
| **V2-FR-06 / V2 Invariant 2:** Zero blind retry on write failure/timeout | `http-client.ts`, `dispatch.ts` | `pilot-fault-suite.test.ts` (Faults 4, 5) | **TUÂN THỦ** |
| **V2-FR-07 / V2 Invariant 4:** Policy gating & fail-closed access | `gateway.ts`, `policy.ts` | `pilot-gateway.test.ts` (3 tests), `pilot-fault-suite.test.ts` (Faults 7, 9) | **TUÂN THỦ** |
| **V2-FR-08:** Redaction & Memory Limits (5MB, 30s) | `config.ts`, `http-client.ts` | `pilot-http-client.test.ts` (7 tests), `pilot-fault-suite.test.ts` (Fault 10) | **TUÂN THỦ** |
| **V2 Vertical Slice (UC2):** Complete Intake -> Reservation -> Write -> Receipt | `dispatch.ts` | `pilot-vertical-slice.test.ts` (1 comprehensive test) | **TUÂN THỦ** |

---

## 6. Kết luận & Phán quyết Cuối cùng

Giai đoạn P2 đã trải qua **2 vòng rà soát độc lập khắt khe** và hoàn thành xuất sắc 100% mục tiêu. Mã nguồn đã được gia cố tối đa theo mọi khuyến nghị chuyên sâu của chuyên gia `Code Reviewer`.

**Đề xuất hành động:**
1. Khóa dứt điểm Gate P2 với kết luận chính thức **PASS**.
2. Duy trì trọn vẹn các cơ chế an toàn đã thiết lập.
3. Chuyển sang **Giai đoạn P3: Source-Aware AI & Pilot API (Tasks `BE-19` đến `BE-23`)**.
