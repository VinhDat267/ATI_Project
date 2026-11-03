# PL-06 · Kế hoạch, thực thi, preview và biên nhận (Plan, Preview, Execution & Receipt Cards)

**Trạng thái:** sẵn sàng nhận · **Nhánh gợi ý:** `longnguyen005/feat-planora-pl-06` · **Phụ thuộc:** PL-05 đã hoàn tất và được Codex duyệt Đạt.  
**Base SHA:** `e97d71862cee773be9e37f9ef9e456ea36975932` (trên integration branch `codex/planora-ui`).  
**Target branch:** `codex/planora-ui`.  
**Đặc tả:** [Planora migration design](../../superpowers/specs/2026-11-02-planora-migration-design.md) mục 4.3, 8.3 · **Kế hoạch:** [Planora migration plan](../../superpowers/plans/2026-11-02-planora-migration.md) mục PL-06.  
**Prompt thi công:** [PL-06.md](../planora-prompts/PL-06.md).  
**Quy ước chung:** [COMMON.md](../planora-prompts/COMMON.md).

---

## 1. Mục tiêu

Chuyển đổi giao diện hiển thị kế hoạch (Plan), thực thi (Execution), xem trước (Preview) và biên nhận (Receipt) sang hệ thống thẻ Planora (Planora Workflow Step Cards), thay thế giao diện orbital canvas cũ nhưng bảo toàn nguyên vẹn toàn bộ contract, data-flow, state machine và các chốt an toàn:
1. **Planora Workflow Steps:** Chuyển đổi orbital canvas thành chuỗi step cards Planora có cấu trúc rõ ràng (desktop hiển thị grid/cột khi đủ chỗ; mobile hiển thị dọc), thể hiện đầy đủ:
   - Thứ tự bước, `dependsOn` giữa các bước.
   - Nhãn Read/Write, nhãn dịch vụ/tài nguyên đích.
   - Trạng thái từng bước (pending, running, completed, failed, skipped).
   - Data-flow chuyển tiếp giữa các bước.
2. **Action Bar & Safety Controls:**
   - Bảo toàn cơ chế phê duyệt (`approvePlan`), từ chối (`rejectPlan`), sửa kế hoạch (`editPlan`).
   - Giữ nguyên busy locking chống click đúp (double approve guard), xác thực `plan_hash` không đổi.
   - Giữ nguyên các liên kết kết quả an toàn (`safe result links`).
3. **Rich Previews:**
   - Giữ nguyên preview chi tiết cho Gmail (người gửi, người nhận, tiêu đề, nội dung HTML/plain text an toàn).
   - Giữ nguyên Sheets grid preview (dữ liệu từng ô, range chỉ định, thanh cuộn nội bộ trong card, không tràn ngang trang).
   - Giữ nguyên preview modal / drawer cho các payload dịch vụ (Trello, GitHub, Slack, Jira, Calendar, Telegram).
4. **Execution & Receipt Moments:**
   - Hiển thị tiến trình thực thi thời gian thực gắn đúng plan/run hiện hành (không hiển thị lẫn lộn snapshot của plan trước).
   - Biên nhận thực thi (Receipt Moment) hiển thị đầy đủ tóm tắt kết quả, liên kết đích đến và nút thao tác tiếp theo.

---

## 2. Ranh giới sở hữu & Phạm vi file

- **Tạo mới:**
  - `apps/chat-web/src/planora/workspace/PlanoraWorkflowSteps.tsx`
  - Các tests workflow/preview/receipt tương ứng nếu cần.
- **Sửa đổi cho phép:**
  - `apps/chat-web/src/components/WorkflowFlowCanvas.tsx`
  - `apps/chat-web/src/pages/Cockpit/PlanMoment.tsx`
  - `apps/chat-web/src/pages/Cockpit/ExecutionMoment.tsx`
  - `apps/chat-web/src/pages/Cockpit/ReceiptMoment.tsx`
  - `apps/chat-web/src/pages/Cockpit/PreviewContents.tsx`
  - `apps/chat-web/src/pages/Cockpit/GmailPreview.tsx`
  - `apps/chat-web/src/pages/Cockpit/PreviewModal.tsx`
  - Các unit/browser test liên quan trong `apps/chat-web/tests/`.
- **Ngoài phạm vi:**
  - Không sửa `apps/chat-api` hay backend protocol.
  - Không thay đổi chính sách máy chủ để làm test UI pass.
  - Không thay đổi cấu trúc dữ liệu của `Plan`, `ExecutionSnapshot`, `ReceiptSnapshot`.

---

## 3. Interfaces & Yêu cầu kỹ thuật

1. **`PlanoraWorkflowSteps`:**
   - Tiếp nhận `WorkflowFlowCanvasProps` hiện tại để bảo toàn toàn bộ prop passing và callbacks (`onStepPreview`, `onSelectService`, etc.).
   - Hỗ trợ đầy đủ các mode: `preview`, `executing`, `receipt`, `schedule`, `blueprint`.
   - Sử dụng helpers từ `presentation.tsx`, `toolDefinition` và `resourceDestination` để phân giải metadata dịch vụ và tài nguyên.
2. **Data-Flow & Dependency Visualization:**
   - Thể hiện rõ ràng các liên kết phụ thuộc giữa các bước kế hoạch.
   - Bảng biểu preview có thuộc tính `overflow-x: auto` cục bộ, không làm bung layout shell của trang.

---

## 4. Tiêu chí nghiệm thu (Acceptance Criteria)

- [ ] Component `PlanoraWorkflowSteps` được triển khai tại `apps/chat-web/src/planora/workspace/PlanoraWorkflowSteps.tsx`.
- [ ] Giao diện step cards hiển thị chuẩn nhận diện Planora, responsive trên cả 5 viewports (1440, 1024, 768, 375, 320) và cả hai theme (light/dark).
- [ ] Giữ đầy đủ các nút bấm hành động với busy locking: Duyệt kế hoạch, Sửa qua Chat, Chi tiết kỹ thuật.
- [ ] Preview Gmail và Sheets hiển thị chuẩn xác dữ liệu mẫu, không gây tràn ngang giao diện.
- [ ] Các kịch bản chống hồi quy (double approve, stale hash, cancel pending) hoạt động đúng như thiết kế.
- [ ] `npm run typecheck:v3` đạt exit code 0.
- [ ] `npm test -w @wap/chat-web` đạt exit code 0.
- [ ] `node scripts/test-v3-web-build-security.mjs` đạt exit code 0.
- [ ] Các browser specs liên quan (`fe-05-cockpit.spec.ts`, `planora-chat.spec.ts`, v.v.) đều PASS.

---

## 5. Kết quả (Worker điền sau khi hoàn thành)

*(Phần này do worker hoàn thiện sau khi thi công)*
