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

- [ ] Tồn tại đầy đủ 3 component `PlanoraChatWorkspace`, `PlanoraActiveTurn`, `PlanoraConversationFeed` tại `apps/chat-web/src/planora/workspace/`.
- [ ] Màn hình Chat Workspace hiển thị đúng nhận diện Planora, không tràn viền ngang ở bất kỳ viewport nào.
- [ ] Chỉ có đúng 1 composer hiển thị trên toàn màn hình ở tất cả các trạng thái.
- [ ] Gửi tin nhắn bằng Enter, xuống dòng bằng Shift+Enter; IME tiếng Việt không kích hoạt submit ngoài ý muốn.
- [ ] Cuộn tự động hoạt động chuẩn xác khi ở gần cuối; không giật cuộn khi người dùng đang đọc tin cũ.
- [ ] Mở lại hội thoại đã lưu hiển thị thẻ `SavedConversation` đúng như quy định của Sprint 1 (#250).
- [ ] `npm run typecheck:v3` đạt exit code 0.
- [ ] `npm run build:v3` đạt exit code 0.
- [ ] `node scripts/test-v3-web-build-security.mjs` đạt exit code 0.
- [ ] Toàn bộ unit tests và Playwright spec cho PL-05 đều PASS.

---

## 5. Kết quả (Worker điền sau khi hoàn thành)

*(Phần này do worker hoàn thiện sau khi thi công)*
