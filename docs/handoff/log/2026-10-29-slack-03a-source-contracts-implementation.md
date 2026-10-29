# 29/10/2026 · Nghiệm Thu SLACK-03A: Hợp Đồng Nguồn, ACL, Vòng Đời & Siêu Dữ Liệu Công Cụ (@wap/tool-schemas)

**Tác giả:** Integration / Schema Owner (Antigravity gemini-3.8-flash-high).
**Ủy quyền điều phối:** Điều phối viên trưởng (Coordinator `term_c4dfa448-7670-4256-8dac-d0a1c9157a1d`) phân công thực thi Task `task_521736e60ea7`, Dispatch `ctx_3c64f98e0373`.
**Nhánh Git:** `VinhDat267/docs-slack-03a-source` (nền `b757ae0` từ `integration/slack-personal-20261029`).
**Pull Request:** [#194](https://github.com/VinhDat267/ATI_Project/pull/194).
**Task card bounded:** [`docs/handoff/tasks/SLACK-03A-source-contracts.md`](../tasks/SLACK-03A-source-contracts.md).
**Kế hoạch chi tiết:** [`docs/superpowers/plans/2026-10-29-slack-03a-source-contracts.md`](../../superpowers/plans/2026-10-29-slack-03a-source-contracts.md).
**Sổ cái kiểm kê 354 methods:** [`docs/superpowers/plans/slack-354-method-ledger.json`](../../superpowers/plans/slack-354-method-ledger.json) (sourceCommit `811f5dc9121d372f232efb63d9880d9574648e3a`, SHA256 `e55bc180eb43c71c1131dbded5968c1e240d3424fe1314bf604139055c074f09`).

---

## 1. Nội Dung Công Việc & Khắc Phục Đánh Giá Độc Lập (Independent Review Fixes)

Sau phiên review độc lập tại commit `6e02ca56`, nhóm đã giải quyết triệt để 10 trường hợp biên bị phát hiện thông qua bộ kiểm tra tái hiện `.superpowers/review194/review.mts`:

### 1.1. Ngữ Nghĩa Lưu Trữ Nguồn & Kiểm Thực Thời Gian Chuẩn Tắc (`myslack-source.ts`)
- **Ngữ nghĩa lưu trữ nguồn:** `validateSlackSourceEntity` bắt buộc `policyRef.purpose === 'storage'` và `policyRef.requestedRetentionDays > 0`.
- **Trần lưu trữ dữ liệu nguồn:** Giới hạn `retentionDays` không được vượt quá `policyRef.requestedRetentionDays` và trần tối đa của nguồn thô là 7 ngày (`RAW_SOURCE_MAX_RETENTION_DAYS = 7`).
- **Thời hạn TTL thực tế:** Khoảng thời gian từ `capturedAt` tới `expiresAt` phải là số dương và không vượt quá thời gian sống hữu hiệu được khai báo (`intervalMs <= retentionDays * 86_400_000`).
- **Xác thực thời gian ISO UTC nghiêm ngặt:** Hàm `isValidIsoUtcTimestamp` kiểm tra cấu trúc ISO 8601 UTC và tính hợp lệ của lịch (chặn đứng hiện tượng ép kiểu từ `Date.parse('0')` hoặc ngày lịch không tồn tại như 31/02). Áp dụng đồng bộ cho `capturedAt`, `expiresAt`, `tombstonedAt`, `purgedAt`, và `createdAt`.

### 1.2. Tính Toàn Vẹn Phả Hệ Nguồn & Nhận Diện Ủy Quyền Bất Biến (`myslack-source.ts`)
- **Đối chiếu nguồn gốc chính xác:** `validateSlackSourceLineage` bắt buộc mỗi bản sao phái sinh (`SlackDerivedCopyRef`) trong mảng `derivedCopies` phải chứa chính xác tham chiếu nguồn gốc (`cleanOrigin`) trong danh sách `sourceRefs` của nó (khớp cả `resourceType`, `resourceId`, `revision`, và `binding`).
- **Khớp kỷ nguyên ủy quyền bất biến:** Toàn bộ danh tính ủy quyền (`binding`, `providerProfileId`, `configFingerprint`, `policyVersion`, `consentRevision`, `providerRevision`) giữa `origin.policyRef` và `derivedCopy.policyRef` phải trùng khớp tuyệt đối, ngăn chặn việc âm thầm nhận bản sao từ một kỷ nguyên consent khác.
- **Ranh giới phân đoạn ủy quyền (Authorization Provenance Segment):** Mỗi `SlackDerivedCopyRef` đại diện cho một phân đoạn phái sinh thuộc một ủy quyền xác định. Các tác vụ hạ tầng đa workspace cần tổng hợp tất cả các phân đoạn liên quan để tạo thành bằng chứng hoàn chỉnh; hợp đồng này không tự tuyên bố là artifact hoàn chỉnh xuyên workspace.

### 1.3. Tách Rời Schema Metadata & Kiểm Thực Thực Thi Đệ Quy Fail-Closed (`myslack-tools.ts`)
- **Deep Detach Schema:** `validateSlackToolDefinition` thực hiện `structuredClone` cho cả `inputSchema` và `outputSchema`, bảo đảm việc chỉnh sửa schema trả về không làm thay đổi định nghĩa gốc của caller.
- **Khớp tên phương thức chuẩn xác:** `validateSlackToolExecutionArgs` kiểm tra tính nhất quán giữa `tool.name` (`myslack.${method.replace(/\./g, '_')}`) và `tool.method`, đồng thời kiểm tra họ phương thức (`family`) thuộc 36 snapshot families hợp lệ, ngăn chặn việc tái sử dụng schema mẫu cho các method lạ.
- **Kiểm thực đệ quy cấu trúc tham số:** Xây dựng hàm kiểm thực đệ quy hỗ trợ kiểm tra kiểu dữ liệu, giới hạn biên (minimum/maximum), mảng enum, và thực thi nghiêm ngặt cờ `additionalProperties: false` cho cả các đối tượng lồng nhau (loại bỏ hoàn toàn rủi ro lọt token bí mật như `access_token` trong object con).
- **Fail-closed với thuộc tính ngoài vỏ envelope:** Khi nhận tham số dạng envelope `{ binding, params: { ... } }`, từ chối ngay lập tức nếu xuất hiện bất kỳ thuộc tính lạ nào ở cấp ngoài cùng (outer fields).

---

## 2. Bằng Chứng Kiểm Thử Thực Tế (Real Evidence)

Tất cả các kiểm thử đều được chạy thực tế trong môi trường workspace:

| Lệnh Kiểm Thử | Mục Đích | Kết Quả Thực Tế | Exit Code |
|---|---|---|---|
| `npx tsx .superpowers/review194/review.mts` | Bộ tái hiện đánh giá độc lập | **11/11 tests PASS** (1 valid fixture + 10 boundary cases) | **0** |
| `npm test -w @wap/tool-schemas` | Chạy toàn bộ test suites của package | **15 test files PASS, 261 tests PASS** (tăng từ 183 ban đầu) | **0** |
| `npx vitest run packages/tool-schemas/tests/myslack-*.test.ts` | Kiểm thử tập trung 5 suites Slack | **5 test files PASS, 193 tests PASS** | **0** |
| `npm run typecheck:v3` | Kiểm tra static types toàn bộ workspace v3 | **PASS** (`apps/chat-api` và `apps/chat-web` typecheck sạch sẽ) | **0** |
| `git diff --check b757ae0..HEAD` | Kiểm tra cú pháp Whitespace từ base tới HEAD | Sạch sẽ, không có trailing whitespace | **0** |
| Mechanical Assertion Script | Kiểm tra đối soát 354 methods với inventory hash `e55bc180eb43c71c1131dbded5968c1e240d3424fe1314bf604139055c074f09` | **100% 354 methods PASS**, 101 excluded khớp chính xác lý do | **0** |

---

## 3. Ranh Giới Nghiêm Ngặt & Tình Trạng Các Thành Phần Khác

- **Explicit NOT_RUN:**
  - Không chạy bất kỳ lệnh gọi API Slack thực tế nào (toàn bộ hợp đồng là offline schema contracts).
  - Không thực hiện gọi mô hình LLM trên dữ liệu Slack.
  - Không thi công backend repository (03B) hay tool adapters (03C); các module này chờ 02B được nghiệm thu và sẽ được phân công dispatch riêng.
- **Bảo toàn Workspace:**
  - Không sửa đổi `apps/`, `db/`, `packages/tool-adapters/`, `packages/executor/`, `packages/planner/`.
  - Không sửa `docs/handoff/CURRENT-STATE.md` hay `docs/handoff/ROADMAP.md`.
  - Không có token hay bí mật nào xuất hiện trong code hoặc git log.
