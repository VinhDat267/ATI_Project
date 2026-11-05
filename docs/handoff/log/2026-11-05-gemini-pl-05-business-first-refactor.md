# 2026-11-05 · gemini · PL-05 · Refactor theo Design Brief v2.0 & Business-First UX

- **Đã làm:**
  - **(Chuẩn D3 - One-Composer Policy) Thống nhất thanh dock composer làm nơi kích hoạt duy nhất:**
    - Cập nhật `apps/chat-web/src/pages/Cockpit/ChatComposer.tsx`: Hỗ trợ prop `submitLabel` động; chuyển nút gửi sang màu xanh rừng Planora (`var(--planora-primary)` `#3c5741`, on-primary `#ffffff` / than tối `#171c18`); loại bỏ triệt để màu cam cũ (`#FF5701`, `#E04D00`, `bg-brand-primary`, `shadow-orange-glow`); cập nhật thông điệp an toàn ở footer thành *"Planora luôn yêu cầu bạn duyệt trước khi ghi hoặc gửi dữ liệu ra bên ngoài."*; publish `--composer-dock-height` lên `:root` qua `useLayoutEffect`.
    - Cập nhật `apps/chat-web/src/planora/workspace/PlanoraChatWorkspace.tsx` & `PlanoraActiveTurn.tsx`:
      - Khi có lựa chọn clarification được chọn, nút gửi của dock tự động đổi nhãn thành *"Xác nhận và tiếp tục →"*.
      - Triệt tiêu nút gửi thứ hai trên thân thẻ Clarification / Thẻ lựa chọn (`hideSubmit={!props.legacyCockpit}`).
      - Thiết lập đồng bộ hai chiều (Two-Way Sync): khi người dùng gõ nội dung mới khác biệt hoặc xóa ô nhập, lựa chọn radio tự động bỏ chọn (`selected = null`).
      - Bảo đảm tương thích ngược với chế độ `legacyCockpit` (`Cockpit.tsx`) cho 100% test files Sprint 1.
  - **(Zero-Duplicate Rule) Khử trùng lặp nội dung feed tuyệt đối:**
    - Mỗi tin nhắn chỉ xuất hiện đúng 1 lần trong feed hội thoại.
    - Không lặp lại câu yêu cầu của người dùng bên trong thân thẻ tương tác (ẩn `RequestEcho` trong chế độ Planora).
  - **(Chuẩn D3 - Anti-Overlap Layout) Chống che khuất tương tác:**
    - Thiết lập `scroll-padding-bottom: calc(var(--composer-dock-height, 120px) + 24px)` trên feed kết hợp cùng dynamic bottom padding, bảo đảm nút hành động cách dock tối thiểu 24px (desktop) và 20px (mobile).
  - **Thương hiệu & Bảng màu Planora:**
    - Cập nhật `apps/chat-web/src/planora/workspace/PlanoraConversationFeed.tsx`: đổi nhãn người gửi trên tin nhắn trợ lý từ `"ATI"` sang `"Planora"`, đổi avatar monogram sang `"P"`.
    - Cập nhật `apps/chat-web/src/pages/Cockpit/CockpitHeader.tsx` & `RequestMoments.tsx` & `ResponseMoment.tsx`: loại bỏ hoàn toàn các class màu cam cũ và nhãn "ATI".
  - **Kiểm thử tự động:**
    - Bổ sung Mục 7 vào `apps/chat-web/tests/planora-chat.test.tsx` với 4 test cases chứng minh One-Composer Policy, Zero-Duplicate Rule, Brand cleanup, và Anti-Overlap Layout. Nâng tổng số test lên 21/21 PASS.

- **PR / commit:**
  - Nhánh: `longnguyen005/feat-planora-pl-05` (target `codex/planora-ui`).
  - Không sửa `CURRENT-STATE.md` hay `ROADMAP.md` (chỉ reviewer cập nhật sau khi merge).

- **Kiểm tra đã chạy (lệnh và kết quả thực tế):**
  - `npm run typecheck:v3`: PASS (exit code 0).
  - `npm test -w @wap/chat-web -- tests/planora-chat.test.tsx`: PASS 21/21 tests (exit code 0).
  - `npm test -w @wap/chat-web`: PASS 100/100 test files, 1119/1119 tests (exit code 0).
  - `npm run build:v3`: PASS (exit code 0).
  - `node scripts/test-v3-web-build-security.mjs`: PASS (exit code 0).

- **Trạng thái:** `STATUS: READY_FOR_CODEX_REVIEW`.
