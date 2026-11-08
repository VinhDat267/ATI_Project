# Báo cáo Review Độc lập — PL-05 (Round 6: Refactor Business-First UX theo Design Brief v2.0)

- **Reviewer:** Antigravity / Gemini 4 Argon (High) (`gemini-4-argon-high`)
- **Ngày review:** 2026-11-05
- **Task:** `PL-05` — Feed hội thoại Planora và một composer (Refactor Business-First UX theo Design Brief v2.0)
- **Task Card:** [`docs/handoff/tasks/PL-05-planora-chat-feed.md`](../tasks/PL-05-planora-chat-feed.md)
- **UX Authority:**
  - [`docs/superpowers/specs/2026-11-05-planora-design-brief.md`](../../superpowers/specs/2026-11-05-planora-design-brief.md) (v2.0, MẪU 3)
  - [`docs/superpowers/specs/2026-11-05-planora-business-first-ux.md`](../../superpowers/specs/2026-11-05-planora-business-first-ux.md)
  - [`docs/handoff/tasks/PLANORA-UX-01-business-first-redesign.md`](../tasks/PLANORA-UX-01-business-first-redesign.md)
- **PR_URL / Chế độ:** `LOCAL_ONLY`
- **Target Branch:** `longnguyen005/feat-planora-pl-05` (target `codex/planora-ui`)
- **BASE_SHA:** `e97d71862cee773be9e37f9ef9e456ea36975932`
- **HEAD_SHA:** `a27d2dfcf7157d837d6b9fec4bb1f17c1799871c`
- **Review Worktree:** `C:/Users/Admin/orca/workspaces/ATI_Project/review-planora-pl-05-r6`

---

## 1. Xác minh Git & Phạm vi File

- `git rev-parse HEAD` và `git rev-parse longnguyen005/feat-planora-pl-05` đều khớp chính xác `a27d2dfcf7157d837d6b9fec4bb1f17c1799871c`.
- Parent commit (`BASE_SHA`): `e97d71862cee773be9e37f9ef9e456ea36975932`.
- 12 files thay đổi trong `e97d7186..a27d2dfc` nằm trong phạm vi `apps/chat-web/` và tài liệu bàn giao của task; không sửa `CURRENT-STATE.md`, `ROADMAP.md`, `apps/chat-api`, `packages/*` hay `db/v3`.

---

## 2. Lệnh Kiểm tra Kỹ thuật & Mutation Testing Đã Chạy

| Lệnh kiểm tra | Exit Code | Kết quả thực tế |
| :--- | :---: | :--- |
| `npm run typecheck:v3` | `0` | **PASS** (`tsc --noEmit` cho `apps/chat-api` & `apps/chat-web`) |
| `npm test -w @wap/chat-web -- planora-chat` | `0` | **PASS** (1 file, 21/21 tests PASS) |
| `npm test -w @wap/chat-web` | `0` | **PASS** (100/100 test files, 1119/1119 tests PASS trong 55.94s) |
| `npm run build:v3` | `0` | **PASS** (196 modules transformed, bundle build thành công) |
| `node scripts/test-v3-web-build-security.mjs` | `0` | **PASS** (`production build excludes credential sentinels and 7 forbidden UI claims`) |

### Kiểm chứng Mutation / Regression thực tế (trong workspace review, đã khôi phục sạch sau khi chạy)

| # | Đột biến (Mutation) | File mục tiêu | Exit Code | Kết quả bắt lỗi |
| :-: | :--- | :--- | :---: | :--- |
| **M1** | Đổi `hideSubmit={!props.legacyCockpit}` thành `hideSubmit={false}` (tái xuất hiện nút gửi thứ hai trên thẻ Clarification) | `PlanoraActiveTurn.tsx` | `1` | **CAUGHT** — Test `7.1 One-Composer Policy` fail (`expected [ <button>, <button> ] to have a length of 1 but got 2`) |
| **M2** | Vô hiệu hóa `setSelected(null)` trong `handleDraft` (bỏ đồng bộ hai chiều khi sửa/xóa văn bản) | `PlanoraChatWorkspace.tsx` | `1` | **CAUGHT** — Test `7.1 One-Composer Policy` fail (`expected element to have attribute aria-checked="false"`) |
| **M3** | Đổi `request={props.legacyCockpit ? request : undefined}` thành `request={request}` trên `ClarificationMoment` (hiển thị lại `RequestEcho`) | `PlanoraActiveTurn.tsx` | `1` | **CAUGHT** — Test `7.2 Zero-Duplicate Rule` fail (`expected [ <p>, <span/> ] to have a length of 1`) |
| **M4** | Xóa `scrollPaddingBottom: 'calc(var(--composer-dock-height, 120px) + 24px)'` | `PlanoraConversationFeed.tsx` | `1` | **CAUGHT** — Test `7.4 Layout Anti-Overlap` fail |

---

## 3. Đánh giá Chi tiết 5 Hạng mục Trọng tâm

1. **Xác minh HEAD_SHA (`a27d2dfcf7157d837d6b9fec4bb1f17c1799871c`):** **ĐẠT**.
2. **One-Composer Policy (Chuẩn D3):**
   - Trong `ClarificationMoment` và `ExpandedClarificationMoment`, nút gửi trên thân thẻ đã được ẩn (`hideSubmit={!props.legacyCockpit}`), thanh composer dock ở chân trang trở thành nơi gửi duy nhất và đổi nhãn sang `"Xác nhận và tiếp tục →"` với màu xanh rừng `var(--planora-primary)` khi có radio được chọn.
   - Đồng bộ hai chiều (Two-Way Sync) trong `handleSelect` / `handleDraft` hoạt động đúng: chọn radio điền vào draft, cho phép gõ nối thêm chỉ dẫn (giữ prefix) hoặc tự bỏ chọn radio (`selected = null`) và trả nhãn nút về `"Gửi"` khi xóa/gõ nội dung khác biệt.
   - Tuy nhiên, trong `ClarificationMoment.tsx:194-219`, khi `inputHidden` là `true` (luôn `true` ở chế độ Planora), khối `#custom-sheet-form` và `<label htmlFor="custom-sheet-input">` vẫn render khung rỗng không có `<textarea>` bên trong (xem **Finding P3-1**).
3. **Zero-Duplicate Rule:** **CHƯA ĐẠT ĐẦY ĐỦ** (xem **Finding P2-1**):
   - Ở `ClarificationMoment` thường, `PlanMoment`, `ExecutionMoment`, `ReceiptMoment`, `RecoveryMoment`, `RequestEcho` đã được ẩn khi `!props.legacyCockpit`.
   - Nhưng ở `ExpandedClarificationMoment` (`PlanoraActiveTurn.tsx:185`), việc truyền `request=""` làm hỏng nút **"Sửa yêu cầu"** (`onEdit('')` xóa trắng draft thay vì điền lại câu yêu cầu của người dùng) và vẫn để lại một bong bóng `"Bạn · Yêu cầu đã gửi"` trống rỗng (`#user-request-bubble-text`) bên trong `ResponseCard` (`ResponseMoment.tsx:59-65`).
   - Ở `AnswerMoment` và `RefusalMoment` (`PlanoraActiveTurn.tsx:166,170`), câu yêu cầu của người dùng bị render **2 lần**: 1 lần trong `PlanoraConversationFeed` và 1 lần trong bong bóng `#user-request-bubble-text` của `ResponseCard`.
   - Ở `SlowPlanningMoment` (`PlanoraActiveTurn.tsx:198`), `request={request}` vẫn được truyền nguyên vẹn nên `[data-request-echo]` vẫn xuất hiện lặp lại.
4. **Anti-Overlap Layout:** **ĐẠT**.
   - `ChatComposer.tsx` đo chiều cao thực tế của footer qua `ResizeObserver` và cập nhật `--composer-dock-height` cùng `--cockpit-bottom-space`.
   - `PlanoraConversationFeed.tsx` và `shell.css` áp dụng `scroll-padding-bottom: calc(var(--composer-dock-height, 120px) + 24px)` và `padding-bottom: calc(var(--composer-dock-height, var(--cockpit-bottom-space, 112px)) + 24px)`.
5. **Xóa bỏ màu cam `#FF5701`, nhãn `"ATI"` & rác kỹ thuật:** **CHƯA ĐẠT ĐẦY ĐỦ** (xem **Finding P2-2**):
   - `ChatComposer.tsx`, `PlanoraConversationFeed.tsx`, và `CockpitHeader.tsx` đã chuyển sang `"Planora"`, monogram `"P"`, màu xanh rừng `var(--planora-primary)` và câu thông điệp an toàn mới ở footer.
   - Tuy nhiên, trong `RequestMoments.tsx` và `ResponseMoment.tsx` (hai file nằm trong commit `a27d2dfc` và được báo cáo trong log là đã dọn sạch `#FF5701` / `bg-brand-primary`), vẫn còn nhiều vị trí dùng `#FF5701`, `brand-primary`, `shadow-orange-glow`, huy hiệu `"Make.com Orbital Flow"`, nhãn `"Chưa lập kế hoạch"`, chữ `"ATI"` trong `PlanningErrors.tsx`, nút `"Gửi yêu cầu"` dùng `text-white` thay vì `text-[var(--planora-on-primary)]` (vi phạm tương phản Dark mode của Design Brief v2.0), và `JSON.stringify(state.activePlan)` tại `PlanoraActiveTurn.tsx:366`.

---

## 4. Danh sách Findings (P1 / P2 / P3)

### [P2-1] Truyền `request=""` vào `ExpandedClarificationMoment` làm hỏng nút "Sửa yêu cầu" và `ResponseCard` vẫn lặp bong bóng tin nhắn người dùng ở `ExpandedClarificationMoment`, `AnswerMoment`, `RefusalMoment`, `SlowPlanningMoment`
- **Mức độ:** **P2** (Lỗi hành vi hồi quy + vi phạm Zero-Duplicate Rule `GATE-02`)
- **File & Dòng:**
  - `apps/chat-web/src/planora/workspace/PlanoraActiveTurn.tsx:166-206`
  - `apps/chat-web/src/pages/Responses/ResponseMoment.tsx:56-65`, `425-457`
- **Mô tả & Tác động:**
  1. Tại `PlanoraActiveTurn.tsx:185`, worker truyền `request={props.legacyCockpit ? (request ?? '') : ''}` xuống `ExpandedClarificationMoment` (khi `moment === 3` có `variant` là `'read-only'` hoặc `'destination'`). Bên trong `ExpandedClarificationMoment`:
     - Nút **"Sửa yêu cầu"** (`ResponseMoment.tsx:454`) gọi `onEdit(request)`. Khi `request` bị ép thành `''` ở chế độ Planora, bấm **"Sửa yêu cầu"** sẽ gọi `editRequest('')`, xóa trắng ô nhập thay vì điền lại câu yêu cầu ban đầu của người dùng.
     - Logic nhận diện dịch vụ `mentioned` (`ResponseMoment.tsx:430`) tìm tên dịch vụ trong `${request} ...` cũng bị mất dữ liệu `request`.
     - Trong `ResponseCard` (`ResponseMoment.tsx:59-65`), khối `<div className="flex items-start justify-end gap-3">...<span>Bạn</span><span>Yêu cầu đã gửi</span><p id="user-request-bubble-text">{request}</p>...</div>` không kiểm tra `request` khác rỗng, nên vẫn vẽ một bong bóng `"Bạn · Yêu cầu đã gửi"` trống rỗng ngay bên dưới bong bóng tin nhắn thật trong feed.
  2. Tại `PlanoraActiveTurn.tsx:166,170` (`AnswerMoment` và `RefusalMoment`), `request={request ?? ''}` được truyền vào `ResponseCard` trong khi tin nhắn của người dùng vẫn nằm trong `feedMessages` (`PlanoraChatWorkspace.tsx:256-275`). Kết quả là câu yêu cầu của người dùng xuất hiện **2 lần** trên màn hình (1 lần trong `PlanoraConversationFeed` và 1 lần trong `#user-request-bubble-text` của `ResponseCard`).
  3. Tại `PlanoraActiveTurn.tsx:198` (`SlowPlanningMoment`), `request={request}` vẫn được truyền trực tiếp nên `<RequestEcho request={request} />` (`[data-request-echo]`) vẫn hiển thị lặp lại câu yêu cầu trong chế độ Planora.
- **Cách sửa:**
  - Giữ nguyên `request={request ?? ''}` truyền xuống `ExpandedClarificationMoment`, `AnswerMoment`, `RefusalMoment` để bảo toàn hành vi nút `"Sửa yêu cầu"` (`onEdit(request)`) và `mentioned`.
  - Bổ sung prop `hideRequestEcho?: boolean` (truyền `!props.legacyCockpit` từ `PlanoraActiveTurn`) vào `ExpandedClarificationMoment`, `AnswerMoment`, `RefusalMoment` và `ResponseCard` để khi `hideRequestEcho === true`, `ResponseCard` không render khối bong bóng `#user-request-bubble-text` / `<RequestEcho>`.
  - Truyền `request={props.legacyCockpit ? request : undefined}` cho `SlowPlanningMoment` tại `PlanoraActiveTurn.tsx:198` (và ẩn khối lặp lại câu yêu cầu trong `DiscoveryMoment` / `PlanningErrorMoment` khi ở chế độ Planora).

---

### [P2-2] Còn sót màu cam `#FF5701`, `brand-primary`, huy hiệu `"Make.com Orbital Flow"`, nhãn `"ATI"`, `"Chưa lập kế hoạch"`, `JSON.stringify` và lỗi tương phản `text-white` ở Dark Mode
- **Mức độ:** **P2** (Vi phạm UX Gate 05/11: `GATE-03` WCAG AA Dark Mode & `GATE-04` sạch rác kỹ thuật / nhãn cũ)
- **File & Dòng:**
  - `apps/chat-web/src/pages/Cockpit/RequestMoments.tsx:92, 141, 170, 224, 242-243, 257, 272, 292, 354, 365, 394`
  - `apps/chat-web/src/pages/Responses/ResponseMoment.tsx:13, 50, 78, 206, 443-450`
  - `apps/chat-web/src/pages/Errors/PlanningErrors.tsx:6, 22-27`
  - `apps/chat-web/src/planora/workspace/PlanoraActiveTurn.tsx:366`
- **Mô tả & Tác động:**
  1. **Vi phạm tương phản Dark Mode (`GATE-03`):** Tại `RequestMoments.tsx:170`, nút `"Gửi yêu cầu"` dùng `bg-[var(--planora-primary)] ... text-white` thay vì `text-[var(--planora-on-primary)]`. Ở Dark mode, `--planora-primary` là `#8fb68e` (xanh mạ sáng), chữ trắng `#ffffff` chỉ đạt tương phản **~2.2:1** (Design Brief v2.0 Mục I.1 quy định rõ: *"Tuyệt đối không dùng chữ trắng ở dark mode"*, phải dùng `var(--planora-on-primary)` `#171c18`).
  2. **Còn màu cam `#FF5701` và `brand-primary` trong `RequestMoments.tsx` & `ResponseMoment.tsx`:**
    - `RequestMoments.tsx`: dòng 92 (`text-[#FF5701]` cho tên workspace), dòng 141 (`focus-within:border-brand-primary focus-within:shadow-orange-glow`), dòng 224, 257, 272, 292, 354, 365, 394 (`text-brand-primary` / `border-brand-primary`).
    - `ResponseMoment.tsx`: dòng 13 (`const primary = '... bg-[#FF5701] hover:bg-[#E04D00] text-white ...'`), dòng 50 (`text-[#FF5701]`), dòng 206 (`text-[#FF5701]`), và toàn bộ các nút radio/link trong `ExpandedClarificationMoment` tại dòng 443-450 (`bg-[#FF5701]`, `border-[#FF5701]`, `group-hover:text-[#FF5701]`, `text-[#FF5701]`).
  3. **Còn huy hiệu/nhãn cấm trong `GATE-04`:**
    - `RequestMoments.tsx:242-243`: Vẫn hiển thị huy hiệu màu cam `"Make.com Orbital Flow"`.
    - `ResponseMoment.tsx:78`: Vẫn còn nhánh fallback hiển thị nhãn `"Chưa lập kế hoạch"`.
    - `PlanningErrors.tsx:22-27` (được render trực tiếp bởi `PlanoraActiveTurn.tsx`): Vẫn hiển thị `"ATI đang suy nghĩ lâu hơn thường lệ"`, `"ATI chưa lập xong kế hoạch"` và dùng `#FF5701` tại dòng 6, 22, 24.
    - `PlanoraActiveTurn.tsx:366`: Vẫn còn `<pre className="whitespace-pre-wrap break-all">{JSON.stringify(state.activePlan, null, 2)}</pre>`.
- **Cách sửa:**
  - Trong `RequestMoments.tsx`, `ResponseMoment.tsx`, `PlanningErrors.tsx`: thay toàn bộ `#FF5701`, `#E04D00`, `brand-primary`, `shadow-orange-glow` bằng `var(--planora-primary)` / `var(--planora-primary-hover)` và dùng `text-[var(--planora-on-primary)]` cho chữ trên nền primary.
  - Xóa huy hiệu `"Make.com Orbital Flow"` tại `RequestMoments.tsx:242-244` và bỏ fallback `"Chưa lập kế hoạch"` tại `ResponseMoment.tsx:78`.
  - Đổi `"ATI"` thành `"Planora"` trong `PlanningErrors.tsx:26-27` và thay `<pre>{JSON.stringify(state.activePlan, null, 2)}</pre>` tại `PlanoraActiveTurn.tsx:366` bằng danh sách mô tả các bước công việc.

---

### [P3-1] Khung `#custom-sheet-form` rỗng kèm `<label>` mồ côi trong `ClarificationMoment` và đồng bộ selector trong Browser E2E specs
- **Mức độ:** **P3** (Accessibility / DOM cleanliness & E2E spec sync)
- **File & Dòng:**
  - `apps/chat-web/src/pages/Cockpit/ClarificationMoment.tsx:194-219`
  - `apps/chat-web/tests/browser/fe-05-cockpit.spec.ts:14`
  - `apps/chat-web/tests/browser/fe-05b-parity-a.spec.ts:124`
- **Mô tả & Tác động:**
  - Trong `ClarificationMoment.tsx:194-219`, khi `inputHidden` là `true` (chế độ Planora dùng composer ở chân trang), thẻ `<textarea id="custom-sheet-input">` được ẩn nhưng thẻ bao `<div id="custom-sheet-form">` và `<label htmlFor="custom-sheet-input">Nhập tên, link hoặc câu trả lời:</label>` vẫn hiển thị thành một hộp xám rỗng có `<label>` trỏ tới ID không tồn tại.
  - Ngoài ra, hai bài test Playwright `fe-05-cockpit.spec.ts:14` (kiểm tra `page.locator('[data-request-echo]')`) và `fe-05b-parity-a.spec.ts:124` (kiểm tra `page.locator('#custom-sheet-input')`) vẫn tìm phần tử của Cockpit cũ đã được ẩn trong chế độ Planora.
- **Cách sửa:**
  - Trong `ClarificationMoment.tsx:194`, chỉ render `#custom-sheet-form` khi `!inputHidden`.
  - Cập nhật `fe-05-cockpit.spec.ts:14` và `fe-05b-parity-a.spec.ts:124` để kiểm tra câu yêu cầu trong `.planora-conversation-feed` và ô nhập duy nhất ở chân trang khi chạy ở chế độ Planora.

---

## 5. Kết luận Tổng hợp (Verdict)

- **Đánh giá Behavior & Technical:** **FAIL** (Còn lỗi P2-1 làm hỏng nút `"Sửa yêu cầu"` trong `ExpandedClarificationMoment` ở chế độ Planora và lặp bong bóng yêu cầu trong `ResponseCard`).
- **Đánh giá UX Gate 05/11 (Business-First):** **CHƯA ĐẠT** (Còn lỗi P2-1 vi phạm `GATE-02` Zero-Duplicate và P2-2 vi phạm `GATE-03` tương phản Dark mode + `GATE-04` còn `#FF5701`, `"Make.com Orbital Flow"`, `"ATI"`, `"Chưa lập kế hoạch"`, `JSON.stringify`).
- **Overall Verdict:** **Chưa đạt** (Cần xử lý 2 findings P2 và 1 finding P3 nêu trên trước khi duyệt).
