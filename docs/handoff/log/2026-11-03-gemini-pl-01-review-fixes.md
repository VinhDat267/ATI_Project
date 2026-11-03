# Nhật ký thi công: Khắc phục Codex review findings (F1-F5) cho PL-01

- **Ngày:** 03/11/2026
- **Người thực hiện:** Antigravity / Gemini worker
- **Nhiệm vụ:** [PL-01 · Baseline, design tokens và component nền](../tasks/PL-01-planora-foundation.md)
- **Worktree:** `feat-planora-pl-01`
- **Nhánh:** `longnguyen005/feat-planora-pl-01`
- **Target branch:** `codex/planora-ui`
- **Previous Head SHA:** `d63b0e7816e6b6f6b4916c672bf6623f9e93f007`

---

## 1. Tóm tắt 5 Findings P2 từ Codex Review & Giải pháp

### F1 · P2 · Chat mobile bị cắt mất plan và composer & Composer desktop dưới viewport
- **Nguyên nhân:** Sidebar cố định 248px không có responsive breakpoint mobile, đẩy main sang x=248..679 gây tràn ngang trên viewport 375px và 320px; các controls trong card không wrap; composer desktop bị đẩy xuống quá mép 900px do chiều cao container không được neo vào viewport.
- **Khắc phục:**
  - Thêm class `.planora-chat-layout`, `.planora-chat-sidebar`, `.planora-chat-main`, `.planora-chat-feed`, `.planora-chat-composer-dock`, `.planora-mobile-nav-toggle`.
  - Trên mobile (< 1024px): sidebar thu gọn vào menu toggle (`planora-mobile-nav-toggle`), chỉ mở khi click toggle (`planora-sidebar-open`); main chiếm 100% width starting tại x=0.
  - Trên desktop: thiết lập `.planora-chat-plan-sample` có `height: calc(100vh - 60px)`, feed cuộn bên trong qua `flex: 1; overflow-y: auto`, composer dock luôn hiển thị cố định ở chân viewport (`visibleInViewport: true`, `bottom: 896px <= 900px`).
  - Textarea được gán `min-width: 0; flex: 1;`, các nút hành động trong card có `flex-wrap: wrap`.
  - Script capture kiểm tra bounding box thực tế tại 375px và 320px xác nhận không còn bất kỳ clipping nào (`approveBtn`, `textarea`, `sendBtn` đều nằm gọn trong viewport).

### F2 · P2 · Bảng nhật ký mất cột chi tiết trên mobile
- **Nguyên nhân:** Thẻ table nằm trong wrapper card có `overflow: hidden`, khiến cột "Chi tiết kết quả" bị cắt đứt trên mobile (375px/320px) mà không có thanh cuộn ngang để người dùng đọc.
- **Khắc phục:**
  - Bọc bảng trong `<div className="planora-table-scroll" tabIndex={0} role="region" aria-label="Bảng nhật ký thực thi gần đây">`.
  - CSS `.planora-table-scroll`: `overflow-x: auto; -webkit-overflow-scrolling: touch;`.
  - Đặt `minWidth: 540` trên thẻ `<table>` để bảo toàn độ rộng cột trên màn hình nhỏ.
  - Script capture xác nhận: `clientWidth: 325, scrollWidth: 657, overflowX: "auto", hasHorizontalScroll: true` trên 375px và `clientWidth: 270, scrollWidth: 657, hasHorizontalScroll: true` trên 320px.

### F3 · P2 · Showcase không giữ hợp đồng theme hiện tại
- **Nguyên nhân:** `PlanoraShowcase.tsx` tự quản lý state `isDark` riêng rẽ với hook `useTheme` và lưu trực tiếp `localStorage`, gây lệch pha class rỗng sau khi reload hoặc khi chuyển tab.
- **Khắc phục:**
  - Thêm `#theme-bootstrap` inline script trong `apps/chat-web/showcase.html` đồng bộ class `.dark`, `data-theme`, `style.colorScheme` trước first paint (tránh FOUC).
  - Chuyển `PlanoraShowcase.tsx` sang sử dụng trực tiếp hook `useTheme()` từ `../../hooks/use-theme`. Toàn bộ thao tác toggle hay storage event đồng bộ qua một chuẩn duy nhất (`ati-theme`, `data-theme`, `colorScheme`, CustomEvent `ati:theme`).
  - Script capture xác nhận: sau khi reload với `localStorage('ati-theme') = 'dark'`, HTML có đầy đủ `hasDarkClass: true`, `dataTheme: 'dark'`, `colorScheme: 'dark'`.

### F4 · P2 · Độ tương phản màu gợi ý nhập liệu (placeholder) chưa đạt 4.5:1
- **Nguyên nhân:** Token placeholder ban đầu dùng `--planora-muted-subtle` (`#848a7b` trên light cho tương phản 3.7:1; `#8a9382` trên dark cho tương phản 3.9:1), vi phạm WCAG AA 4.5:1.
- **Khắc phục:**
  - Định nghĩa lại `--planora-placeholder: #686e5e` trong Light mode: tương phản 5.19:1 trên paper (`#fffdf7`) và 4.81:1 trên canvas (`#f8f4eb`).
  - Định nghĩa lại `--planora-placeholder: #9ba393` trong Dark mode: tương phản 5.81:1 trên paper (`#202820`) và 6.62:1 trên canvas (`#171c18`).
  - Cập nhật `.planora-field-input::placeholder` và `.planora-field-textarea::placeholder` trong `components.css`.
  - Bổ sung kiểm thử toán học tương phản trong `apps/chat-web/tests/planora-foundation.test.tsx`.

### F5 · P2 · Field làm mất liên kết lỗi ngoại vi và sinh IDREF ảo
- **Nguyên nhân:** `Field.tsx` gán `describedBy = [errorId, helperId].filter(Boolean)` làm mất prop `aria-describedby` bên ngoài truyền vào, đồng thời khi có `error` thì thẻ helper không render nhưng `helperId` vẫn được đưa vào `aria-describedby` tạo IDREF ảo.
- **Khắc phục:**
  - Bóc tách `'aria-describedby': externalDescribedBy` từ props.
  - Chỉ tính `helperId = !error && helper ? `${id}-helper` : undefined`.
  - Hợp nhất `describedBy = [errorId, helperId, externalDescribedBy].filter(Boolean).join(' ') || undefined`.
  - Bổ sung unit test kiểm tra không còn dangling IDREF trong DOM.

### R1 · P3 · Unit test tương phản parse tokens.css thực tế, bắt được mutation CSS
- **Nguyên nhân:** Test tương phản ban đầu dùng object literal JS độc lập để tính tỉ lệ, không đọc file CSS thật nên nếu token CSS bị đổi (ví dụ: `--planora-placeholder: #fffdf7`), test vẫn PASS.
- **Khắc phục:**
  - Chuyển `apps/chat-web/tests/planora-foundation.test.tsx` sang đọc file `apps/chat-web/src/planora/styles/tokens.css` bằng `node:fs` và trích xuất trực tiếp các biến màu `--planora-*` từ các khối selector `:root` (Light) và `html.dark` (Dark).
  - Tự động kiểm tra sự tồn tại của từng token và tính luminance / contrast ratio trực tiếp trên giá trị CSS thật.
  - Đã xác thực bằng mutation test thực tế: khi đổi thử `--planora-placeholder: #fffdf7` trong CSS, test fail lập tức (`AssertionError: expected 1 to be >= 4.5`, exit code 1); khi revert về `#686e5e`, test pass hoàn toàn (exit code 0).

---

## 2. Bằng chứng kiểm thử thực tế (Exit Code 0)

1. **`npm run test -w @wap/chat-web`:**
   ```text
   Test Files  97 passed (97)
   Tests       1056 passed (1056)
   Duration    37.95s
   Exit code:  0
   ```
2. **`npx vitest run evaluations/generic-plumbing/static-guard.test.ts`:**
   ```text
   Test Files  1 passed (1)
   Tests       2 passed (2)
   Duration    1.20s
   Exit code:  0
   ```
3. **`npm run typecheck:v3`:**
   ```text
   tsc -p apps/chat-api/tsconfig.json --noEmit && tsc -p apps/chat-web/tsconfig.json --noEmit
   Exit code:  0
   ```
4. **`npm run build:v3`:**
   ```text
   ✓ 188 modules transformed.
   dist/index.html                  1.60 kB
   dist/assets/index-DaCn9dhd.css 129.74 kB
   dist/assets/index-C9TcQ8g0.js 1,164.62 kB
   built in 672ms
   Exit code:  0
   ```
5. **`node scripts/test-v3-web-build-security.mjs`:**
   ```text
   PASS: production build excludes credential sentinels and 7 forbidden UI claims
   Exit code:  0
   ```
6. **`node scripts/capture-planora-pl01.mjs`:**
   ```text
   - [overflow-320-landing]: PASS
   - [chat-composer-desktop-docked]: PASS {"y":783,"height":113,"bottom":896,"visibleInViewport":true}
   - [chat-mobile-375-no-clipping]: PASS {"vpWidth":375,"approveBtn":{"x":79,"y":1315.96875,"width":179.671875,"right":258.671875,"clipped":false},"textarea":{"x":29,"y":1558.96875,"width":263,"right":292,"clipped":false},"sendBtn":{"x":302,"y":1550.96875,"width":44,"right":346,"clipped":false}}
   - [chat-mobile-320-no-clipping]: PASS {"vpWidth":320,"approveBtn":{"x":79,"y":1503.140625,"width":179.671875,"right":258.671875,"clipped":false},"textarea":{"x":29,"y":1746.140625,"width":208,"right":237,"clipped":false},"sendBtn":{"x":247,"y":1738.140625,"width":44,"right":291,"clipped":false}}
   - [overflow-320-chat-plan]: PASS
   - [overflow-320-settings-scope]: PASS
   - [history-table-scroll-375]: PASS {"clientWidth":325,"scrollWidth":657,"overflowX":"auto","hasHorizontalScroll":true}
   - [history-table-scroll-320]: PASS {"clientWidth":270,"scrollWidth":657,"overflowX":"auto","hasHorizontalScroll":true}
   - [overflow-320-history-schedule]: PASS
   - [theme-contract-reload-dark]: PASS {"hasDarkClass":true,"dataTheme":"dark","colorScheme":"dark","storageTheme":"dark"}
   Kết quả toàn bộ: TẤT CẢ ĐẠT (EXIT 0)
   ```

---

## 3. Danh sách file thay đổi

- `apps/chat-web/src/planora/styles/tokens.css` (F4)
- `apps/chat-web/src/planora/styles/components.css` (F1, F2, F4)
- `apps/chat-web/src/planora/components/Field.tsx` (F5)
- `apps/chat-web/showcase.html` (F3)
- `apps/chat-web/src/planora/samples/PlanoraShowcase.tsx` (F3)
- `apps/chat-web/src/planora/samples/ChatPlanSample.tsx` (F1)
- `apps/chat-web/src/planora/samples/HistoryScheduleSample.tsx` (F2)
- `apps/chat-web/tests/planora-foundation.test.tsx` (Unit tests cho F1-F5)
- `scripts/capture-planora-pl01.mjs` (Assertions chụp ảnh và kiểm chứng bounds)
- `docs/evidence/PL-01/*.png` (16 ảnh màn hình chụp lại)
- `docs/handoff/tasks/PL-01-planora-foundation.md` (Cập nhật kết quả)
