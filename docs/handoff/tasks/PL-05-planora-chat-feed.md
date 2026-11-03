# PL-05 · Feed hội thoại Planora và một composer (Chat Feed & One-Composer)

**Trạng thái:** sẵn sàng nhận · **Nhánh gợi ý:** `longnguyen005/feat-planora-pl-05` · **Phụ thuộc:** PL-02 và PL-04 đã hoàn tất và được Codex duyệt Đạt.  
**Base SHA:** `b9230b8b592237275866e027c1744362ef4c6eda` (trên integration branch `codex/planora-ui`).  
**Target branch:** `codex/planora-ui`.  
**Đặc tả:** [Planora migration design](../../superpowers/specs/2026-11-02-planora-migration-design.md) mục 4.3, 8.3 · **Kế hoạch:** [Planora migration plan](../../superpowers/plans/2026-11-02-planora-migration.md) mục PL-05.  
**Prompt thi công:** [PL-05.md](../planora-prompts/PL-05.md).  
**Quy ước chung:** [COMMON.md](../planora-prompts/COMMON.md).

---

## 1. Mục tiêu

Khôi phục bố cục không gian làm việc hội thoại Planora (Planora Chat Workspace) và áp dụng triệt để chính sách **một composer duy nhất (One-Composer Policy)**:
1. **Planora Chat Workspace:** Chuyển đổi khung làm việc chính từ Cockpit cũ sang `PlanoraChatWorkspace`, giữ nguyên vai trò controller của `Workspace.tsx` cùng toàn bộ hooks, race guards, store và API layer.
2. **Conversation Feed:** Hiển thị feed đọc được toàn bộ chuỗi hội thoại (`PlanoraConversationFeed`), tin nhắn có timestamp, nhãn người gửi, nguồn `schedule_run` thực tế, và active turn (`PlanoraActiveTurn`) gắn đúng plan/run/proposal.
3. **One-Composer Policy:** Đảm bảo toàn bộ ứng dụng chỉ có đúng một vùng soạn thảo chat (`ChatComposer`), không bao giờ render hai composer hay nút gửi trùng lặp ở bất kỳ active state hay moment nào.
4. **Tương tác & Cuộn:**
   - Xử lý mượt mà IME (tiếng Việt/Nhật không kích hoạt submit nhầm).
   - Phím Enter để gửi, Shift+Enter để xuống dòng.
   - Tự động cuộn xuống đáy khi có tin mới nếu người dùng đang ở gần cuối trang; giữ nguyên vị trí cuộn khi người dùng đang chủ động duyệt đọc lịch sử.
   - Prefill chỉ điền nội dung vào draft, không tự ý gửi tin.
5. **Chống hồi quy Race Conditions:**
   - GET lịch sử cũ trả về trễ không được ghi đè lên SSE mới.
   - Kế hoạch đã duyệt/từ chối (settled) không được phát lại hay sống lại.
   - Execution snapshot phải thuộc đúng plan đang hiển thị.
   - Đổi hội thoại hoặc không gian làm việc phải dọn dẹp state sạch sẽ, không rò rỉ dữ liệu giữa các hội thoại.

---

## 2. Ranh giới sở hữu & Phạm vi file

- **Tạo mới:**
  - `apps/chat-web/src/planora/workspace/PlanoraChatWorkspace.tsx`
  - `apps/chat-web/src/planora/workspace/PlanoraActiveTurn.tsx`
  - `apps/chat-web/src/planora/workspace/PlanoraConversationFeed.tsx`
  - `apps/chat-web/tests/planora-chat.test.tsx`
  - `apps/chat-web/tests/browser/planora-chat.spec.ts`
- **Sửa đổi cho phép:**
  - `apps/chat-web/src/components/Workspace.tsx`
  - `apps/chat-web/src/components/Cockpit.tsx`
  - `apps/chat-web/src/pages/Cockpit/ChatComposer.tsx`
  - `apps/chat-web/src/pages/Cockpit/ConversationDrawer.tsx`
  - `apps/chat-web/src/pages/Cockpit/SavedConversation.tsx`
  - Các tests chat/history/SSE regression liên quan.
- **Ngoài phạm vi:**
  - Không sửa `apps/chat-api` hay backend protocol.
  - Không thay đổi logic chi tiết của Plan/Execution/Receipt cards (thuộc PL-06/PL-07).
  - Không thay đổi thứ tự ưu tiên của `selectMoment` hay cấu trúc schema messages.

---

## 3. Interfaces & Yêu cầu kỹ thuật

1. **`PlanoraChatWorkspace`:**
   - Nhận `ComponentProps<typeof Cockpit>` hoặc props tương thích để giữ nguyên kết nối callback và state từ `Workspace.tsx`.
   - Bố cục responsive hỗ trợ 5 viewports (1440, 1024, 768, 375, 320) trên cả Light và Dark theme.
2. **`PlanoraActiveTurn`:**
   - Tiếp nhận state/snapshot từ `useChatStore` và render active moment hiện hành thông qua `selectMoment`.
   - Đảm bảo thẻ tương tác chính chỉ xuất hiện đúng 1 lần.
3. **`PlanoraConversationFeed`:**
   - Nhận danh sách messages hiện hành và render children cho active card.
   - Không tự ý gọi API ngoài luồng quản lý của `Workspace`.

---

## 4. Tiêu chí nghiệm thu (Acceptance Criteria)

- [x] Tồn tại đầy đủ 3 component `PlanoraChatWorkspace`, `PlanoraActiveTurn`, `PlanoraConversationFeed` tại `apps/chat-web/src/planora/workspace/`.
- [x] Màn hình Chat Workspace hiển thị đúng nhận diện Planora, không tràn viền ngang ở bất kỳ viewport nào.
- [x] Chỉ có đúng 1 composer hiển thị trên toàn màn hình ở tất cả các trạng thái (One-Composer Policy).
- [x] Gửi tin nhắn bằng Enter, xuống dòng bằng Shift+Enter; IME tiếng Việt không kích hoạt submit ngoài ý muốn (`isComposing` guard).
- [x] Cuộn tự động hoạt động chuẩn xác khi ở gần cuối (<120px threshold); không giật cuộn khi người dùng đang đọc tin cũ.
- [x] Mở lại hội thoại đã lưu hiển thị thẻ `SavedConversation` đúng như quy định của Sprint 1 (#250).
- [x] `npm run typecheck:v3` đạt exit code 0.
- [x] `npm run build:v3` đạt exit code 0.
- [x] `node scripts/test-v3-web-build-security.mjs` đạt exit code 0.
- [x] Toàn bộ 100/100 test files (1110/1110 tests) và Playwright spec cho PL-05 đều PASS.

---

## 5. Kết quả (Worker điền sau khi hoàn thành)

- **Worker:** Gemini subagent (Antigravity).
- **Nhánh thực hiện:** `longnguyen005/feat-planora-pl-05`.
- **Base SHA:** `b9230b8b592237275866e027c1744362ef4c6eda`.
- **Target Branch:** `codex/planora-ui`.
- **Các thành phần đã triển khai:**
  1. `apps/chat-web/src/planora/workspace/PlanoraChatWorkspace.tsx`: Component điều phối trung tâm thay thế Cockpit layout, duy trì toàn bộ callbacks, state từ `Workspace.tsx`, đồng thời bảo đảm phân tách rõ ràng luồng feed lịch sử (`feedMessages`) và active turn card (`PlanoraActiveTurn`).
  2. `apps/chat-web/src/planora/workspace/PlanoraActiveTurn.tsx`: Tích hợp toàn diện 13 moments và các trạng thái phụ (`selectMoment`), đảm bảo mỗi turn chỉ render một card thao tác duy nhất và gắn đúng plan/run/proposal ID.
  3. `apps/chat-web/src/planora/workspace/PlanoraConversationFeed.tsx`: Hiển thị feed đọc được toàn bộ chuỗi hội thoại với nhãn người gửi ("Bạn", scheduled run origin, "ATI"), timestamps, auto-scroll thông minh (ngưỡng 120px) và aria-live stream.
  4. `apps/chat-web/src/pages/Cockpit/ChatComposer.tsx`: Cập nhật dynamic aria-label & placeholder theo moment (ví dụ moment 3: "Nhập câu trả lời làm rõ yêu cầu"), hỗ trợ đầy đủ variant bottom/response/inline/drawer.
  5. `apps/chat-web/src/components/Cockpit.tsx`: Ủy quyền rendering sang `PlanoraChatWorkspace`, giữ nguyên export `resourceDestination`.
  6. `apps/chat-web/src/components/Workspace.tsx`: Cập nhật popstate restoration guard và truyền `PlanoraChatWorkspace`.
  7. `apps/chat-web/tests/planora-chat.test.tsx`: Bộ 12 unit tests bao phủ toàn bộ One-Composer Policy, IME composition, Enter/Shift+Enter, scheduled origin attribution, auto-scroll và saved conversation.
  8. `apps/chat-web/tests/browser/planora-chat.spec.ts`: Playwright browser test bao phủ 5 viewports (1440, 1024, 768, 375, 320) trên 2 theme (light, dark).

- **Kiểm tra đã chạy và kết quả:**
  - `npm run typecheck:v3`: PASS (exit code 0).
  - `npm test -w @wap/chat-web -- tests/planora-chat.test.tsx`: PASS 12/12 tests (exit code 0).
  - `npm test -w @wap/chat-web -- tests/fe-02-routing-history.test.tsx tests/fe-03b-new-conversation-race.test.tsx tests/fe-05-cockpit.test.tsx tests/fe-05b-parity-a.test.tsx tests/fe-05b-parity-b.test.tsx tests/sprint1-reopen-conversation.test.tsx tests/sched-03-ui.test.tsx tests/planora-chat.test.tsx`: PASS 8/8 test files, 170/170 tests (exit code 0).
  - `npm test -w @wap/chat-web -- tests/app-routing.test.tsx`: PASS 8/8 tests (exit code 0).
  - `npm test -w @wap/chat-web -- tests/planning-navigation.test.tsx`: PASS 28/28 tests (exit code 0).
  - `npm test -w @wap/chat-web -- tests/read-answers.test.tsx`: PASS 6/6 tests (exit code 0).
  - `npm test -w @wap/chat-web -- tests/fe-06b-responses.test.tsx`: PASS 29/29 tests (exit code 0).
  - `npm test -w @wap/chat-web -- tests/app-safety.test.tsx`: PASS 9/9 tests (exit code 0).
  - `npm test -w @wap/chat-web`: PASS 100/100 test files, 1110/1110 tests (exit code 0).
  - `npm run build:v3`: PASS (exit code 0).
  - `node scripts/test-v3-web-build-security.mjs`: PASS (exit code 0).
- **Trạng thái:** `STATUS: READY_FOR_CODEX_REVIEW`.
