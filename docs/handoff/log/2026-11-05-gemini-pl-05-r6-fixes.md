# 2026-11-05 · gemini · PL-05 · Fix Review Findings Round 6 (P2-1, P2-2, P3-1)

- **Đã làm:**
  - **Xử lý [P2-1] - Khôi phục nút "Sửa yêu cầu" và triệt tiêu bong bóng lặp lại:**
    - Cập nhật `apps/chat-web/src/planora/workspace/PlanoraActiveTurn.tsx`:
      - Truyền nguyên vẹn `request={request ?? ''}` xuống `ExpandedClarificationMoment`, `AnswerMoment`, `RefusalMoment` để bảo toàn hành vi nút "Sửa yêu cầu" (`onEdit(request)`) và logic phát hiện dịch vụ (`mentioned`).
      - Bổ sung prop `hideRequestEcho?: boolean` (truyền `!props.legacyCockpit`) vào `ExpandedClarificationMoment`, `AnswerMoment`, `RefusalMoment`, `PlanningErrorMoment` và `ResponseCard`.
      - Trong `ResponseCard` (`ResponseMoment.tsx`), khi `hideRequestEcho === true`, triệt tiêu hoàn toàn khối bong bóng `#user-request-bubble-text` và `<RequestEcho>`.
      - Ở `SlowPlanningMoment`, truyền `request={props.legacyCockpit ? request : undefined}` để triệt tiêu `<RequestEcho>`.
  - **Xử lý [P2-2] - Xóa sạch #FF5701, Make.com Orbital Flow, ATI, Chưa lập kế hoạch, JSON.stringify và sửa tương phản Dark Mode:**
    - Trong `apps/chat-web/src/pages/Cockpit/RequestMoments.tsx`:
      - Nút "Gửi yêu cầu" dùng `text-[var(--planora-on-primary)]` trên nền `var(--planora-primary)` và `hover:bg-[var(--planora-primary-hover)]` đạt chuẩn tương phản WCAG AA Dark Mode.
      - Thay thế toàn bộ `#FF5701`, `brand-primary`, `shadow-orange-glow` bằng CSS variables `var(--planora-primary)`, `var(--planora-primary-hover)`, và focus ring chuẩn.
      - Xóa bỏ hoàn toàn huy hiệu cấm `"Make.com Orbital Flow"`.
    - Trong `apps/chat-web/src/pages/Responses/ResponseMoment.tsx`:
      - Thay toàn bộ `#FF5701`, `#E04D00` bằng `var(--planora-primary)` / `var(--planora-primary-hover)` và `text-[var(--planora-on-primary)]`.
      - Loại bỏ fallback `"Chưa lập kế hoạch"`.
    - Trong `apps/chat-web/src/pages/Errors/PlanningErrors.tsx`:
      - Thay đổi nhãn "ATI đang suy nghĩ lâu hơn thường lệ", "ATI chưa lập xong kế hoạch" thành "Planora đang chuẩn bị kế hoạch...", đổi các màu cam còn sót sang `var(--planora-primary)`.
    - Trong `apps/chat-web/src/planora/workspace/PlanoraActiveTurn.tsx`:
      - Thay thế khối `<pre>{JSON.stringify(state.activePlan, null, 2)}</pre>` bằng danh sách mô tả các bước công việc thân thiện nghiệp vụ.
  - **Xử lý [P3-1] - Khung custom-sheet-form rỗng và đồng bộ browser tests:**
    - Trong `apps/chat-web/src/pages/Cockpit/ClarificationMoment.tsx`: chỉ render `#custom-sheet-form` và `<label>` khi `!inputHidden`.
    - Đồng bộ selector trong `apps/chat-web/tests/browser/fe-05-cockpit.spec.ts` và `apps/chat-web/tests/browser/fe-05b-parity-a.spec.ts` để tương thích cả Cockpit và Planora Feed.
  - **Bổ sung Unit Tests:**
    - Bổ sung 4 unit test cases mới vào `apps/chat-web/tests/planora-chat.test.tsx` kiểm chứng P2-1, P2-2, P3-1. Nâng tổng số test `planora-chat` lên 25/25 PASS.

- **PR / commit:**
  - Nhánh: `longnguyen005/feat-planora-pl-05` (target `codex/planora-ui`).
  - Không sửa `CURRENT-STATE.md` hay `ROADMAP.md` (chỉ reviewer cập nhật sau khi merge).

- **Kiểm tra đã chạy (lệnh và kết quả thực tế):**
  - `npm run typecheck:v3`: PASS (exit code 0).
  - `npm test -w @wap/chat-web -- planora-chat`: PASS 25/25 tests (exit code 0).
  - `npm test -w @wap/chat-web`: PASS 100/100 test files, 1123/1123 tests (exit code 0).
  - `npm run build:v3`: PASS (exit code 0, 196 modules transformed).
  - `node scripts/test-v3-web-build-security.mjs`: PASS (exit code 0, excludes credential sentinels and 7 forbidden UI claims).

- **Trạng thái:** `STATUS: READY_FOR_REVIEW`.
