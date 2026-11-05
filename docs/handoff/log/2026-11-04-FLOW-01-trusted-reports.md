# 2026-11-04 · FLOW-01 — Báo cáo PR có nguồn, đóng khiếm khuyết F1

## 1. Bối cảnh & Mục tiêu
- **Khiếm khuyết F1 (P1):** Trong đợt kiểm toán giá trị sử dụng `2026-11-04-user-value` (DEV-02), planner ở 1/3 số lượt đã tự bịa ra danh sách Pull Request (#128, #131, #134) trong nội dung gửi Slack (`slack.send_message`) mà không hề thực hiện bước đọc (`github.list_pull_requests`) hay có observation đọc thực tế.
- **Mục tiêu của FLOW-01:** Triệt tiêu hoàn toàn khả năng model tự bịa dữ liệu báo cáo:
  1. Mọi dữ liệu thực tế (item, title, url, count, coverage) trong báo cáo phải do mã nguồn deterministic renderer tạo ra từ kết quả đọc hợp lệ.
  2. Bổ sung `ReportEvidence` contract trong `tool-schemas` và đính kèm vào `PlanResponse.reportEvidence`.
  3. Bổ sung Layer 5b grounding validation trong `packages/planner/src/validator.ts` — từ chối kế hoạch báo cáo nếu không có bằng chứng đọc hoặc bước đọc.
  4. Bổ sung `validateReportEvidenceBinding` phía backend để kiểm tra tính toàn vẹn của chữ ký hash, đối chiếu actor/workspace sở hữu artifact và ngăn chặn dispatch nếu kế hoạch bị can thiệp sau khi ký hash.
  5. Hiển thị huy hiệu xác thực nguồn dữ liệu trên giao diện duyệt kế hoạch `PlanMoment.tsx`.

## 2. Các file đã thay đổi
- `packages/tool-schemas/src/report-evidence.ts`: Khai báo `ReportKind`, `ReportEvidence`, `ReportObservationRecord`.
- `packages/tool-schemas/src/types.ts`: Bổ sung `reportEvidence?: ReportEvidence` vào `PlanResponse`.
- `packages/tool-schemas/src/index.ts`: Re-export `report-evidence.js`.
- `packages/planner/src/reports/renderers.ts`: Hàm `renderGithubPrsReport` và `sanitizeReportString`.
- `packages/planner/src/reports/artifacts.ts`: `ReportArtifactStore` quản lý observation artifacts và kiểm tra hash SHA-256.
- `packages/planner/src/validator.ts`: Bổ sung Layer 5b report grounding validation, kiểm tra khớp `contentHash` và artifact store.
- `packages/planner/src/index.ts`: Re-export các modules trong `reports/`.
- `apps/chat-api/src/services/report-evidence-guard.ts`: `validateReportEvidenceBinding` và `isReportPlan` bảo vệ persistence và dispatch.
- `apps/chat-web/src/types.ts`: Bổ sung `reportEvidence?: ReportEvidence` vào `ActivePlan`.
- `apps/chat-web/src/pages/Cockpit/PlanMoment.tsx`: Hiển thị huy hiệu `🛡️ Báo cáo có nguồn dữ liệu xác minh`.
- `packages/planner/tests/report-evidence.test.ts`: Bộ 6 bài test unit & grounding cho FLOW-01.
- `apps/chat-api/tests/integration/report-evidence.test.ts`: Bộ 4 bài test tích hợp PostgreSQL 16 thật.
- `docs/handoff/tasks/FLOW-01-trusted-reports.md`: Cập nhật trạng thái và kết quả.

## 3. Bằng chứng kiểm thử thực tế
- **Unit & Grounding (`packages/planner/tests/report-evidence.test.ts`):**
  - Chạy `npx vitest run packages/planner/tests/report-evidence.test.ts`: **6/6 passed** (12ms).
  - Tái hiện ca F1 PR #128/#131/#134 không có read: Bị Layer grounding từ chối chính xác với lỗi `Report content must be grounded in verified read observations via reportEvidence`.
  - Kiểm chứng lỗi đọc / null: Ném ngoại lệ, không biến thành báo cáo "0 PR".
  - Fixture 2 PRs: Render chính xác count=2, đúng 2 links, không có số bịa.
  - Prompt injection trong title: Được sanitize sạch sẽ, không thể thực thi lệnh độc hại.
  - Tin nhắn thông thường của người dùng: Vẫn được gửi bình thường mà không đòi hỏi `reportEvidence`.
  - Kế hoạch có `reportEvidence` hợp lệ từ observation store: Được thông qua hợp lệ.
- **PostgreSQL Integration (`apps/chat-api/tests/integration/report-evidence.test.ts`):**
  - Chạy trên PostgreSQL 16 test riêng biệt cổng 56534: **4/4 passed** (2.91s).
  - Bằng chứng giả do client tự khai: Bị chặn với lỗi `unverified observation artifact`.
  - Dùng artifact của user/workspace khác: Bị chặn với lỗi `ownership mismatch`.
  - Kế hoạch bị sửa đổi sau khi tính planHash: Bị chặn với lỗi `plan hash mismatch` và `step argument hash mismatch`.
  - Kế hoạch báo cáo legacy thiếu binding: Bị chặn phê duyệt/dispatch.
- **Toàn bộ Package Suites:**
  - `packages/planner`: **212 files / 2.962 tests passed** (28.09s).
  - `apps/chat-web`: **108 files / 1.155 tests passed** (67.16s).
  - `npm run typecheck:v3`: **exit code 0**.
