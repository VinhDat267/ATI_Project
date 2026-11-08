# PL-11 · Lịch chạy và bản tin tự động (Schedules & Auto-Digest UI)

**Trạng thái:** HOÀN THÀNH — ĐÃ DUYỆT ĐẠT (Argon High Round 2 PASS) · **Nhánh thực hiện:** `longnguyen005/feat-planora-pl-11` · **Phụ thuộc:** PL-05 đến PL-10 đã hoàn tất và được Argon High duyệt Đạt.  
**Base SHA:** `89deb95ce3de0f3708c3d07d7184c335b65f61b5` (HEAD accepted của PL-10).  
**Accepted Head SHA:** `b4f42665ee5d05f20fc6d1465cad41111bcec4b3`.  
**Target branch:** `codex/planora-ui`.  
**Đặc tả:** [Planora migration design](../../superpowers/specs/2026-11-02-planora-migration-design.md), [Design Brief v2.0](../../superpowers/specs/2026-11-05-planora-design-brief.md), [Business-First UX](../../superpowers/specs/2026-11-05-planora-business-first-ux.md) · **Kế hoạch:** [Planora migration plan](../../superpowers/plans/2026-11-02-planora-migration.md) mục PL-11.  
**Báo cáo Review:** [2026-11-07-argon-review-pl-11-r2.md](../log/2026-11-07-argon-review-pl-11-r2.md).  
**Prompt thi công:** [PL-11.md](../planora-prompts/PL-11.md).  
**Quy ước chung:** [COMMON.md](../planora-prompts/COMMON.md).

---

## 1. Mục tiêu

Thiết kế trải nghiệm tạo, quản lý và theo dõi lịch chạy và bản tin tự động theo tiêu chuẩn nhận diện Planora và Business-First UX v2.0:
1. **Ngôn ngữ công việc tự nhiên:** Trình bày lịch chạy như một câu công việc rõ ràng: gửi nội dung gì, lấy từ đâu, gửi đến đâu, tần suất/thời gian nào và lần chạy kế tiếp. Loại bỏ hoàn toàn các chuỗi kỹ thuật thô (`auto_digest`, config hash, UUID, raw delivery enums).
2. **Phân biệt rõ ràng hai chế độ phê duyệt:**
   - *"Duyệt trước mỗi lần chạy"* (Cần xác nhận thủ công mỗi đợt gửi).
   - *"Tự gửi theo lịch"* (Tự động gửi bản tin theo cấu hình đã được chấp thuận).
   - Quyền hạn chọn chế độ tự gửi phải dựa 100% vào eligibility/contract từ API hiện tại (`scheduleProposal.approvalModes`), không tự suy đoán theo logo hay tên provider.
3. **Quản lý vòng đời lượt chạy (Schedule Run Lifecycle) trung thực:**
   - Thể hiện đầy đủ các trạng thái lượt chạy: `pending`, `running`, `discarded`, `failed`, `completed`, `digest_sent`, `digest_failed`, `needs_attention` bằng nhãn thân thiện, dễ hiểu.
   - Khi trạng thái gửi bất định (`delivery_unknown`), cấm UI tự động gửi lại hoặc tự lập lại kế hoạch; phải hiển thị cảnh báo và hướng dẫn kiểm tra thực tế.
   - Lý do tạm dừng (`pause_reason`) phải hiển thị rõ nguyên nhân và hành động khắc phục cụ thể (ví dụ: cần kết nối lại tài khoản).
4. **Bảo toàn Hợp đồng Kỹ thuật & Chống Race Conditions:**
   - Giữ nguyên các types `ScheduleView`, `ScheduleRunView`, `ScheduleApprovalMode`, logic hash/snapshot cấu hình và xử lý SSE events.
   - Xử lý mượt mà xung đột stale proposal (HTTP 409), thay đổi phạm vi/cấu hình giữa chừng, ngăn chặn double confirmation, và xử lý đúng khi bấm tạm dừng/huỷ trước khi dispatch hoặc khi delivery đã bắt đầu.
5. **Tiêu chuẩn Thiết kế & Trợ năng Planora (GATE-03):**
   - Áp dụng typography editorial Planora (Be Vietnam Pro, serif headings, cream paper `var(--planora-paper)`, forest green primary `var(--planora-primary)`, viền `var(--planora-divider)` và `var(--planora-border-strong)`).
   - Tương phản WCAG AA $\ge 4.5:1$ trên cả chế độ Sáng và Tối (không dùng `#FF5701`, không dùng class prototype cũ đè token).
   - 100% SVG vector icons có `aria-hidden="true"`, không còn emoji trần hoặc rác kỹ thuật "ATI".

---

## 2. Ranh giới sở hữu & Phạm vi File (Module Ownership)

- **Sửa đổi cho phép:**
  - `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx`
  - `apps/chat-web/src/pages/Cockpit/ScheduleActions.tsx`
  - `apps/chat-web/src/pages/Cockpit/ScheduleRunRecovery.tsx`
  - `apps/chat-web/src/pages/History/ScheduleSection.tsx`
  - Tests lịch chạy/digest trong `apps/chat-web/tests/` (ví dụ: `sched-03-ui.test.tsx`, `sched-03-state.test.ts`, `schedule-*-digest-mode.test.tsx`, `planora-pl-11-schedules.test.tsx`).
- **Ngoài phạm vi:**
  - Không sửa `apps/chat-web/src/hooks/use-schedules.ts` hay backend APIs/schemas trong `packages/*` và `apps/chat-api`.
  - Không tự bật cờ production flag, không mở auto_digest cho provider chưa đủ policy theo backend.
  - Không sửa `CURRENT-STATE.md` hay `ROADMAP.md` (thuộc quyền hạn của coordinator/reviewer).

---

## 3. Tiêu chí nghiệm thu (Acceptance Criteria)

- [x] `ScheduleMoment.tsx`, `ScheduleActions.tsx`, `ScheduleRunRecovery.tsx` và `ScheduleSection.tsx` được chuyển đổi sang CSS tokens Planora và copy Business-First.
- [x] Card tạo/cập nhật/tạm dừng/tiếp tục/huỷ lịch thể hiện rõ: giờ, múi giờ, tần suất, nguồn dữ liệu, đích gửi và lần chạy kế tiếp.
- [x] Phân biệt rõ ràng giữa "Duyệt trước mỗi lần chạy" và "Tự gửi theo lịch", chỉ cho phép chọn auto_digest khi API cho phép.
- [x] Thể hiện đầy đủ trạng thái lượt chạy theo enum thật (`pending`, `running`, `completed`, `failed`, `digest_sent`, `digest_failed`, `needs_attention`).
- [x] Trạng thái bất định (`delivery_unknown`) cấm resend tự động và hiển thị cảnh báo an toàn.
- [x] Bảo toàn 100% hợp đồng kỹ thuật (ScheduleView, ScheduleRunView, config hash, SSE update).
- [x] Đạt chuẩn tương phản WCAG AA $\ge 4.5:1$ ở cả Light/Dark mode; 100% SVG có `aria-hidden="true"`; 0% màu `#FF5701`, 0% "ATI", 0% raw emojis.
- [x] Toàn bộ test suite web PASS, `typecheck:v3` và `build:v3` exit code 0.
- [x] Có bài test đột biến (mutation) chứng minh bảo vệ hợp đồng an toàn và trợ năng.

---

## 4. Kết quả thực hiện

- **Worker:** Antigravity (Gemini 3.8 Flash High)
- **Worktree / Nhánh:** `longnguyen005/feat-planora-pl-11`
- **Target branch:** `codex/planora-ui`
- **Base SHA:** `89deb95ce3de0f3708c3d07d7184c335b65f61b5` (HEAD accepted của PL-10)
- **Commit SHA:** `f643a297a9dc809465f58656c40e364e0870eb18`
- **Orca Task ID:** `task_4f6e0fd7a5bd` (Dispatch `ctx_b2cdaa24a823`)

### Tóm tắt công việc đã thực hiện:
1. **Chuyển đổi toàn diện sang CSS Tokens Planora & Typography Editorial:**
   - Đã loại bỏ 100% màu cam prototype cũ `#FF5701` / `#E04C00` và các class prototype ghi đè (`#111827`, `#E7E7E2`, `#F8F8F6`, `#FFF6EE`).
   - Cập nhật nút Primary và Secondary trong `ScheduleActions.tsx` và `ScheduleMoment.tsx` sang thuần tokens Planora (`--planora-primary`, `--planora-on-primary`, `--planora-paper`, `--planora-divider`, `--planora-surface-inset`).
   - Cập nhật tiêu đề card và modal sang font serif editorial (`font-serif`).
   - Thay thế toàn bộ thương hiệu cũ "ATI" trong copy hiển thị sang nhận diện "Planora".
2. **Nghiệp vụ Business-First UX v2.0 cho Lịch chạy & Bản tin tự động:**
   - Trình bày lịch dạng câu tự nhiên: giờ, múi giờ, tần suất, nguồn dữ liệu, đích gửi, lần chạy kế tiếp.
   - Phân biệt minh bạch giữa "Chờ tôi duyệt mỗi lượt" và "Tự gửi bản tin, không cần duyệt lại", gắn chặt với quyền hạn API (`canAutoDigest`/`eligible`).
   - Thể hiện rõ lý do tạm dừng (`pauseReason`) kèm trạng thái pending rõ ràng.
3. **Quản lý vòng đời lượt chạy (Schedule Run Lifecycle) & Bảo vệ Delivery Unknown:**
   - Trong `ScheduleRunRecovery.tsx`: Hỗ trợ đầy đủ các trạng thái `digest_sent`, `needs_attention`, `digest_failed`, `expired`, `planning_failed`, `interrupted`, `discarded`.
   - **Bảo vệ tuyệt đối khi `delivery_unknown` (`state: needs_attention`):** Hiển thị cảnh báo hướng dẫn kiểm tra kênh đích, tuyệt đối không hiển thị nút tự động resend hoặc replan.
4. **Trợ năng & Kiểm thử Đột biến Mutation Testing:**
   - 100% thẻ `<svg>` vector icons được gắn thuộc tính `aria-hidden="true"`.
   - Tạo mới test suite toàn diện: `apps/chat-web/tests/planora-pl-11-schedules.test.tsx` (13 tests) bao gồm kiểm thử tokens, A11y, lifecycle guards và 3 bài test đột biến M1-M3.
   - Kiểm chứng đột biến thực tế: Đổi token Primary sang `#FF5701` -> 5 tests FAIL; xoá `aria-hidden="true"` trên SVG -> test FAIL; khôi phục -> 100% GREEN.

### Kết quả chạy kiểm thử thực tế & Tái thẩm định Độc lập:
- **Round 1 Review (07/11/2026):** Argon High kết luận `CHƯA ĐẠT` với 1 finding P2 (F1: `WorkflowFlowCanvas` thiếu `variant="planora"` làm rò rỉ palette cũ và bị che khuất bởi `vi.mock`) và 2 findings P3 (F2: câu mô tả duyệt cố định nhánh Calendar, thiếu id radio nhánh Sheets; F3: lệch SHA tài liệu).
- **Khắc phục Round 1 (Commit `b4f42665`):** Gemini 3.8 Flash High bổ sung `variant="planora"` vào `WorkflowFlowCanvas` trong `ScheduleMoment` và `ScheduleSection`, gỡ bỏ hoàn toàn `vi.mock` để kiểm thử render thật của `PlanoraWorkflowSteps`, bổ sung `aria-hidden="true"` cho 100% SVG, cập nhật mô tả duyệt động và id radio.
- **Round 2 Re-Review (07/11/2026):** Argon High kết luận **ĐẠT (PASS)** trên HEAD `b4f42665ee5d05f20fc6d1465cad41111bcec4b3`.
  - `npm run typecheck:v3`: Exit Code **0** (0 lỗi TypeScript).
  - `npm test -w @wap/chat-web -- sched`: Exit Code **0** (7 test files, 78/78 tests PASS).
  - `npm test -w @wap/chat-web`: Exit Code **0** (106 test files, 1.208/1.208 tests PASS).
  - `npm run build:v3`: Exit Code **0** (Production build thành công, 200 modules transformed).
  - `node scripts/test-v3-web-build-security.mjs`: Exit Code **0** (PASS: excludes credential sentinels and 7 forbidden UI claims).
  - **4/4 phép thử đột biến R2-M1..R2-M4 đều bị bắt FAIL thật sự.**
