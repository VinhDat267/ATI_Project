# PL-09 · Kết nối Trello, GitHub, Telegram (Provider Connections)

**Trạng thái:** sẵn sàng nhận · **Nhánh gợi ý:** `longnguyen005/feat-planora-pl-09` · **Phụ thuộc:** PL-08 đã hoàn tất và được Argon High duyệt Đạt.  
**Base SHA:** `13d18efb565ccf8d121f1914a919856aac974590` (HEAD accepted của PL-08).  
**Target branch:** `codex/planora-ui`.  
**Đặc tả:** [Planora migration design](../../superpowers/specs/2026-11-02-planora-migration-design.md), [Design Brief v2.0](../../superpowers/specs/2026-11-05-planora-design-brief.md), [Business-First UX](../../superpowers/specs/2026-11-05-planora-business-first-ux.md) · **Kế hoạch:** [Planora migration plan](../../superpowers/plans/2026-11-02-planora-migration.md) mục PL-09.  
**Prompt thi công:** [PL-09.md](../planora-prompts/PL-09.md).  
**Quy ước chung:** [COMMON.md](../planora-prompts/COMMON.md).

---

## 1. Mục tiêu

Thiết kế và chuẩn hóa các kết nối dịch vụ đối tác (Trello, GitHub, Telegram) theo ngôn ngữ nhận diện Planora và tiêu chuẩn Business-First UX v2.0:
1. **Ngôn ngữ kết nối hướng công việc:** Trình bày theo công việc có thể làm; chỉ hỏi tài nguyên và giới hạn mà người dùng cần quyết định (Trello workspace/board membership, GitHub repos, Telegram chat/nhóm).
2. **Bảo toàn phân quyền & Scope:** Giữ rõ ràng phân quyền admin vs member; khi thiếu phạm vi tài nguyên (`scope_required`), hiển thị CTA chỉnh sửa phạm vi phù hợp thay vì bắt kết nối lại từ đầu.
3. **Quy trình Telegram đặc thù:** Bảo toàn pairing đang chờ, deep link cá nhân/nhóm, timeout/hết hạn, polling và hủy ghép nối; tuyệt đối không gộp thành redirect OAuth thông thường.
4. **Tái sử dụng ConnectionCallbackFrame:** Tích hợp `ConnectionCallbackFrame` đã được chuẩn hóa ở PL-08 cho các views callback (`TrelloCallbackView`, `GitHubCallbackView`, `TelegramCallbackView`), đảm bảo tính presentation-only, không mutate OAuth state, không duplicate nút quay về Cài đặt, và đạt chuẩn tương phản WCAG AA >= 4.5:1.
5. **A11y & Trợ năng:** 100% SVG icons có `aria-hidden="true"`, không dùng ký tự emoji trần trong nhãn điều hướng hoặc trạng thái.

---

## 2. Ranh giới sở hữu & Phạm vi file

- **Sửa đổi cho phép:**
  - `apps/chat-web/src/pages/Settings/TrelloConnection.tsx`
  - `apps/chat-web/src/pages/Settings/GitHubConnection.tsx`
  - `apps/chat-web/src/pages/Settings/TelegramConnection.tsx`
  - `apps/chat-web/src/views/TrelloCallbackView.tsx`
  - `apps/chat-web/src/views/GitHubCallbackView.tsx`
  - `apps/chat-web/src/views/TelegramCallbackView.tsx`
  - Tests provider tương ứng trong `apps/chat-web/tests/`.
- **Ngoài phạm vi:**
  - Không sửa `apps/chat-api` hay backend OAuth protocols.
  - Không sửa `ConnectionCallbackFrame.tsx` chung khi chưa có chỉ đạo từ coordinator.
  - Không tự ý thêm tính năng tự động hóa backend chưa có.

---

## 3. Tiêu chí nghiệm thu (Acceptance Criteria)

- [x] TrelloConnection, GitHubConnection, TelegramConnection được chuyển đổi sang CSS tokens Planora và copy Business-First.
- [x] Bảo toàn 100% Trello board selection, GitHub repo picker, và Telegram pairing polling lifecycle.
- [x] Tích hợp `ConnectionCallbackFrame` cho 3 views callback với WCAG AA contrast (Primary nút dùng `var(--planora-primary)` và `var(--planora-on-primary)`).
- [x] 100% SVG vector icons có `aria-hidden="true"`, không còn emoji trần hoặc rác kỹ thuật.
- [x] Toàn bộ test suite web PASS, `typecheck:v3` và `build:v3` exit code 0.

---

## 4. Kết quả thực hiện

- **Người thực hiện:** Gemini 3.8 Flash High (Antigravity subagent).
- **Trạng thái:** HOÀN THÀNH — READY_FOR_CODEX_REVIEW.
- **Base SHA:** `13d18efb565ccf8d121f1914a919856aac974590`.
- **Target branch:** `codex/planora-ui`.
- **Nhánh thực hiện:** `longnguyen005/feat-planora-pl-09`.

### 4.1. Chi tiết các tệp sửa đổi
1. `apps/chat-web/src/pages/Settings/TrelloConnection.tsx`: Chuyển đổi toàn bộ sang token Planora (`--planora-primary`, `--planora-on-primary`, `--planora-border-strong`, `--planora-divider`, `--planora-paper`, `--planora-surface-inset`), thay thế copy ATI thành Planora trong modal ngắt kết nối, bảo toàn 100% chọn workspace và tối đa 10 bảng Trello.
2. `apps/chat-web/src/pages/Settings/GitHubConnection.tsx`: Áp dụng token Planora cho card, bộ đếm `X/10`, ô tìm kiếm nhanh repository, badge Private/Public, loại bỏ màu cam cũ `#FF5701`, chuẩn hóa copy modal ngắt kết nối.
3. `apps/chat-web/src/pages/Settings/TelegramConnection.tsx`: Chuẩn hóa card kết nối Telegram, danh sách chat và editor phạm vi chat (1-10 cuộc trò chuyện), bảo toàn luồng pairing/deep link và polling lifecycle.
4. `apps/chat-web/src/views/TrelloCallbackView.tsx`: Tích hợp `ConnectionCallbackFrame` presentation-only, loại bỏ nút quay về trùng lặp, bảo đảm tiêu chuẩn WCAG AA.
5. `apps/chat-web/src/views/GitHubCallbackView.tsx`: Tích hợp `ConnectionCallbackFrame` presentation-only, hiển thị badge và trạng thái chuẩn hóa.
6. `apps/chat-web/src/views/TelegramCallbackView.tsx`: Tích hợp `ConnectionCallbackFrame`, bảo toàn deep link Start và Add to Group, nút xác minh `telegram-verify-pairing` khi `TELEGRAM_PAIRING_PENDING`.
7. `apps/chat-web/tests/planora-pl-09-connections.test.tsx`: Bổ sung 10 test cases chuyên sâu kiểm thử toàn diện các tiêu chí trên.

### 4.2. Bằng chứng kiểm thử
- `npm run typecheck:v3`: Exit Code 0 (clean, 0 TypeScript errors).
- `npm test -w @wap/chat-web -- trello github telegram`: Exit Code 0 (35/35 tests PASS).
- `npm test -w @wap/chat-web -- planora-pl-09-connections`: Exit Code 0 (10/10 tests PASS).
- `npm test -w @wap/chat-web`: Exit Code 0 (104/104 test files PASS, 1.184/1.184 tests PASS).
- `npm run build:v3`: Exit Code 0 (Vite build production thành công).
- `node scripts/test-v3-web-build-security.mjs`: Exit Code 0 (PASS, credential sentinels excluded).
