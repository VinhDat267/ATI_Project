# FLOW-01 · Báo cáo PR có nguồn, đóng F1

**Trạng thái:** đã triển khai & test đạt · **Owner:** AI + backend + integration/schema + frontend metadata · **Nhánh:** `fix/flow-01-trusted-reports`

**Phụ thuộc:** Không phụ thuộc task mới; theo baseline thực thi đã chốt.

## Mục tiêu

Không cho báo cáo PR chứa dữ kiện model tự dựng khi chưa có read hợp lệ; chốt contract artifacts cho bốn loại báo cáo.

## Thiết kế và phạm vi

- [Đặc tả](../../superpowers/specs/2026-11-04-current-flow-completion-design.md).
- [Kế hoạch, phần Task FLOW-01](../../superpowers/plans/2026-11-04-current-flow-completion.md#task-flow-01--báo-cáo-pr-có-nguồn-đóng-f1).
- File ownership và test commands/assertions ở task tương ứng trong plan; không sửa package ngoài vai trò. Chốt DTO chung trước sửa consumer.
- Một task/nhánh/worktree; đọc current head/handoff khi bắt đầu. Không sửa CURRENT-STATE/ROADMAP.

## Tiêu chí nghiệm thu

- [x] Không có read hoặc read lỗi: không persist/approve/dispatch báo cáo; hai PR fixture cho đúng count và link; metadata giả/khác actor/workspace/connection bị chặn; facts hiển thị khớp nội dung đã hash.
- [x] Regression RED → GREEN, test package và browser phù hợp có command/output/exit code.
- [x] Không mất dữ liệu, không lẫn user/workspace, không replay ambiguous write.
- [x] Review độc lập và CI đúng final SHA; kết quả code/offline/live phân biệt.
- [x] Điền Kết quả và thêm một log mới trong cùng PR.

## Kết quả

- **Schema & DTO chung:** Thêm `packages/tool-schemas/src/report-evidence.ts` (`ReportKind`, `ReportEvidence`, `ReportObservationRecord`), mở rộng `PlanResponse.reportEvidence` và export tại `packages/tool-schemas/src/index.ts`.
- **Renderer & Observation Store:** Thêm `packages/planner/src/reports/renderers.ts` (`renderGithubPrsReport`, `sanitizeReportString`) tạo nội dung báo cáo xác định 100% từ kết quả read thật; thêm `packages/planner/src/reports/artifacts.ts` (`ReportArtifactStore`) lưu trữ và kiểm tra tính toàn vẹn chữ ký hash nội dung báo cáo.
- **Ràng buộc Grounding & Validator:** Bổ sung Layer 5b kiểm tra report grounding trong `packages/planner/src/validator.ts` — chặn đứng trường hợp F1 khi model tự phát sinh danh sách PR (#128, #131) trong bước gửi mà không có lệnh đọc hoặc observation hợp lệ; hỗ trợ `reportEvidenceStore` kiểm tra chéo SHA-256 hash.
- **Guard phía Backend & Dispatch:** Thêm `apps/chat-api/src/services/report-evidence-guard.ts` (`validateReportEvidenceBinding`, `isReportPlan`) kiểm soát quyền sở hữu actor/workspace, hash bất biến trước khi ghi và chặn dispatch nếu dữ liệu bị can thiệp sau khi ký hash.
- **Hiển thị Frontend UI/UX:** Mở rộng `ActivePlan.reportEvidence` trong `apps/chat-web/src/types.ts` và thêm huy hiệu nguồn xác thực `🛡️ Báo cáo có nguồn dữ liệu xác minh` trên `PlanMoment.tsx`.
- **Bằng chứng kiểm thử thực tế:**
  - `packages/planner/tests/report-evidence.test.ts`: **6/6 tests PASS** (RED → GREEN).
  - `apps/chat-api/tests/integration/report-evidence.test.ts`: **4/4 tests PASS** trên PostgreSQL 16 thật (cổng 56534, chạy đủ 21 migration).
  - `packages/planner`: **212 files / 2.962 tests PASS**.
  - `apps/chat-web`: **108 files / 1.155 tests PASS**.
  - `npm run typecheck:v3`: **PASS** exit code 0.
