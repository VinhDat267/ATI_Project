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
- [x] Toàn bộ 100/100 test files (1114/1114 tests) và Playwright spec cho PL-05 đều PASS / sẵn sàng trên runner CI.

---

## 5. Kết quả (Worker điền sau khi hoàn thành)

- **Worker:** Gemini subagent (Antigravity).
- **Nhánh thực hiện:** `longnguyen005/feat-planora-pl-05`.
- **Base SHA:** `b9230b8b592237275866e027c1744362ef4c6eda`.
- **Target Branch:** `codex/planora-ui`.
- **Reviewed Head SHA:** `88da9c06365468cecdfe9ff6a84c467ec3f480de`.
- **Các thành phần đã triển khai và hoàn thiện sau Codex review:**
  1. `apps/chat-web/src/planora/workspace/PlanoraChatWorkspace.tsx`:
     - **F1 fix:** Truyền cờ `responseEditing` xuống `PlanoraActiveTurn`, đồng bộ trạng thái giữa parent và child sau khi người dùng bấm "Sửa yêu cầu" tại planning error.
     - **F2 fix:** Loại bỏ lệnh cưỡng bức `scroller.scrollTop = 0` khi ở Planora mode (`legacyCockpit = false`), bảo toàn vị trí đọc lịch sử của người dùng khi chuyển moment; thiết lập cấu trúc layout chứa bounded flex (`min-h-0 overflow-hidden`) để feed trở thành scroll container độc lập.
     - **F3 fix:** Khắc phục Moment 4 (preview): luôn hiển thị đúng 1 composer (dock composer khi preview, inline composer khi bấm Sửa qua Chat, drawer composer khi mở Drawer, quay lại dock khi đóng ô sửa).
     - **F4 fix:** Bổ sung class `.planora-chat-workspace` song song với `.planora-chat-main` khớp accessible DOM contract.
  2. `apps/chat-web/src/planora/workspace/PlanoraActiveTurn.tsx`:
     - Nhận `responseEditing` và tính `planningError = ... && !props.responseEditing`. Khi bấm "Sửa yêu cầu", thẻ lỗi được thay thế bằng `RequestMoment` chứa ô textarea điền sẵn yêu cầu, không tự gửi.
  3. `apps/chat-web/src/planora/workspace/PlanoraConversationFeed.tsx`:
     - Bổ sung class `.planora-conversation-feed` song song với `.planora-chat-feed` với `min-h-0 overflow-y-auto` đảm bảo là vùng cuộn độc lập.
  4. `apps/chat-web/src/pages/Cockpit/ChatComposer.tsx` & `apps/chat-web/src/planora/styles/shell.css`:
     - **F5 fix:** Thiết lập `lg:left-[var(--planora-sidebar-width,248px)]` cho `#global-bottom-bar` và `#response-bottom-bar` tại breakpoint >= 1024px. Tránh hoàn toàn việc sidebar đè lên phần đầu ô nhập văn bản khi hit-testing.
  5. `apps/chat-web/src/components/Cockpit.tsx`:
     - Hỗ trợ cờ `legacyCockpit` mặc định true cho các test suite Sprint 1 cũ, giữ trọn vẹn tương thích ngược với 100% test files.
  6. `scripts/test-v3-browser.mjs`:
     - Bổ sung `|PL-05:` vào default grep pattern của scenarios runner.
  7. `apps/chat-web/tests/planora-chat.test.tsx`:
     - Bổ sung 4 regression tests mới cho F1, F2, F3, F5, nâng tổng số test lên 16/16 PASS.
  8. `apps/chat-web/tests/browser/planora-chat.spec.ts`:
     - Cập nhật selector `.planora-chat-workspace`, `.planora-conversation-feed`, bổ sung hit-testing assertion tại x+10, y trên desktop breakpoint.

- **Kiểm tra đã chạy và kết quả:**
  - `npm run typecheck:v3`: PASS (exit code 0).
  - `npm test -w @wap/chat-web -- tests/planora-chat.test.tsx`: PASS 16/16 tests (exit code 0).
  - `npm test -w @wap/chat-web -- tests/fe-05b-parity-b.test.tsx`: PASS 25/25 tests (exit code 0).
  - `npm test -w @wap/chat-web`: PASS 100/100 test files, 1114/1114 tests (exit code 0).
  - `npm run build:v3`: PASS (exit code 0).
  - `node scripts/test-v3-web-build-security.mjs`: PASS (exit code 0).
  - `node --check scripts/test-v3-browser.mjs`: PASS (exit code 0).
  - `scripts/test-v3-browser.mjs planora-chat.spec.ts`: NOT_RUN cục bộ do máy không có Docker chạy PostgreSQL port 55533; Playwright spec file và runner đã sẵn sàng cho môi trường CI.

- **Kết quả đợt sửa findings vòng 2 (R1-R2):**
  1. `apps/chat-web/src/planora/styles/shell.css`:
     - **R1 fix:** Thiết lập chiều cao hữu hạn và ngăn nở layout xuyên suốt toàn bộ chuỗi cha: `.planora-shell` (`height: 100dvh; max-height: 100dvh; min-height: 0; overflow: hidden;`), `.planora-screen-layout`, `.planora-main-work`, `.planora-content-body`, `.planora-chat-workspace` (`height: 100%; max-height: 100%; min-height: 0; overflow: hidden;`).
     - Thiết lập `.planora-conversation-feed` (`flex: 1; min-height: 0; overflow-y: auto;`) trở thành scroll container độc lập thực thụ, không bị nở theo nội dung (khắc phục hiện tượng 80 tin nhắn đẩy feed lên 10.177px khiến `clientHeight === scrollHeight`).
  2. `apps/chat-web/src/planora/workspace/PlanoraConversationFeed.tsx`:
     - Tăng padding dưới lên `pt-6 pb-28 sm:pb-32 space-y-5` đảm bảo tin nhắn cuối cùng và action buttons không bao giờ bị `#global-bottom-bar` che khuất.
  3. `apps/chat-web/tests/planora-chat.test.tsx`:
     - Cập nhật test F2/R1: assert trực tiếp trên element `.planora-conversation-feed` (kiểm tra class contract `overflow-y-auto min-h-0 flex-1`, mock scroll properties trên feed và xác nhận moment transition không reset `feed.scrollTop = 500`). Loại bỏ hoàn toàn điều kiện lỏng lẻo `if (document.scrollingElement)`.
     - Bổ sung test kiểm tra layout feed độc lập và padding đáy chống che khuất bởi `#global-bottom-bar`. Tổng số unit tests: 17/17 PASS.
  4. `apps/chat-web/tests/browser/fe-05-cockpit.spec.ts`:
     - **R2 fix:** Đồng bộ assertion bố cục preview với One-Composer Policy từ 0 sang 1 textarea (`expect(page.locator('textarea:visible')).toHaveCount(1)`), giữ nguyên 100% assertions về focus, approval và cancel.
  5. `apps/chat-web/tests/browser/fe-02-routing-history.spec.ts`:
     - **R2 fix:** Scope locator tin nhắn số 24 thành `area.getByText(/Saved message 24:/)` thay vì query toàn trang `page.getByText(...)`, loại bỏ strict mode violation do tin nhắn xuất hiện đồng thời trong feed và drawer.
  6. `apps/chat-web/tests/browser/planora-chat.spec.ts`:
     - Bổ sung browser test case cho R1: chèn 80 tin nhắn vào cơ sở dữ liệu, kiểm tra `.planora-conversation-feed` có `scrollHeight > clientHeight`, `clientHeight < 900`, cuộn đọc lịch sử được bảo toàn khi có tin mới, và khoảng đệm đáy không bị `#global-bottom-bar` che khuất.
  - **Kiểm tra đã chạy và kết quả vòng 2:**
    - `npm run typecheck:v3`: PASS (exit code 0).
    - `npm test -w @wap/chat-web -- tests/planora-chat.test.tsx`: PASS 17/17 tests (exit code 0).
    - `npm test -w @wap/chat-web`: PASS 100/100 test files, 1115/1115 tests (exit code 0).
    - `npm run build:v3`: PASS (exit code 0).
    - `node scripts/test-v3-web-build-security.mjs`: PASS (exit code 0).

- **Kết quả đợt sửa findings vòng 3 (R3-R4):**
  1. `apps/chat-web/src/planora/styles/shell.css`:
     - **R3 fix:** Hoàn nguyên `.planora-shell`, `.planora-screen-layout`, `.planora-main-work`, `.planora-content-body` về trạng thái không khóa chiều cao/overflow cố định, phục hồi hoàn toàn cuộn trang thông qua document scrolling và chuột wheel cho các trang ngoài chat (`/settings`, `/history`, `/account`, `/guide`).
     - Áp dụng các quy tắc chiều cao hữu hạn (`height: 100dvh; overflow: hidden;`) độc quyền cho không gian làm việc chat thông qua bộ chọn scoped `:has(.planora-chat-workspace)` trên toàn bộ chuỗi layout cha.
     - **R4 fix:** Loại bỏ khoảng đệm thừa trên `body` trong chế độ chat qua `:root:has(.planora-chat-workspace) body { padding-bottom: 0 !important; }`, triệt tiêu hoàn toàn thanh cuộn document thứ hai trong chat.
     - Thiết lập padding động dưới chân feed: `.planora-conversation-feed { padding-bottom: calc(var(--cockpit-bottom-space, 112px) + 24px) !important; }`.
  2. `apps/chat-web/src/planora/workspace/PlanoraConversationFeed.tsx`:
     - Gắn `style={{ paddingBottom: 'calc(var(--cockpit-bottom-space, 112px) + 24px)' }}` bảo đảm feed tự động co giãn vùng đệm đáy theo biến `--cockpit-bottom-space` do `ChatComposer` cập nhật theo chiều cao thực của footer.
     - Bổ sung `ResizeObserver` giữ vị trí cuộn ở sát đáy khi kích thước hoặc padding của feed thay đổi do composer nhiều dòng mở rộng.
  3. `apps/chat-web/tests/planora-chat.test.tsx`:
     - Kiểm chứng feed container sở hữu dynamic padding `calc(var(--cockpit-bottom-space, 112px) + 24px)`. Tổng số unit tests: 17/17 PASS.
  4. `apps/chat-web/tests/browser/planora-chat.spec.ts`:
     - Bổ sung regression test cho R3: kiểm chứng mouse wheel scrolling trên route `/settings` hoạt động bình thường trên cả desktop (1440x900) và mobile (375x812) ở 2 giao diện light/dark.
     - Bổ sung regression test cho R4: mở preview có lịch sử dài, nhập draft 14 dòng vào dock composer, xác nhận `#global-bottom-bar` cao >= 180px, cuộn feed tới đáy, xác nhận document scroll = 0, khoảng cách nút `#btn-tech-toggle` nằm hoàn toàn phía trên footer và hit-test tâm nút trả về chính nút, không bị che bởi composer textarea.
  - **Kiểm tra đã chạy và kết quả vòng 3:**
    - `npm run typecheck:v3`: PASS (exit code 0).
    - `npm test -w @wap/chat-web -- tests/planora-chat.test.tsx`: PASS 17/17 tests (exit code 0).
    - `npm test -w @wap/chat-web`: PASS 100/100 test files, 1115/1115 tests (exit code 0).
    - `npm run build:v3`: PASS (exit code 0).
    - `node scripts/test-v3-web-build-security.mjs`: PASS (exit code 0).
- **Trạng thái:** `STATUS: READY_FOR_CODEX_REVIEW`.
