# 19/10/2026 · Thi công FE-12: thanh điều hướng chung

**Người viết:** reviewer, thi công theo yêu cầu nhóm trưởng ("commit và mở PR và bạn thi công luôn", 19/10). **Nhánh:** `feat/fe-12-shared-nav-bar`, tách từ `docs/fe-12-nav-bar` (`3d69457`, PR #161 lập kế hoạch). Task: [FE-12](../tasks/FE-12-shared-nav-bar.md).

## Đã làm

- **`components/layout/MainNav.tsx` (mới):** thanh dùng chung.
  - Lưới ba cột `1fr auto 1fr`, mỗi cụm ghim cột (`col-start-1/2/3`). Nhờ vậy cụm tab ở đúng giữa thanh, và cụm phải vẫn ở mép phải khi tab bị ẩn trên điện thoại.
  - Tab là `<a href>` trong `<nav aria-label="Điều hướng chính">`; tab đang mở có `aria-current="page"`, chữ đậm, gạch chân `#FF5701`. Bấm thường gọi `navigate`; bấm kèm phím bổ trợ hoặc chuột giữa để trình duyệt tự xử lý.
  - Chữ đầy đủ từ 1280 px, chữ rút gọn 768–1279 px (`aria-label` luôn là tên đầy đủ), ẩn tab dưới 768 px. Dưới 768 px, trang con ghi tên trang cạnh logo (`pageName`).
  - Cụm phải: `actions` của trang, `ThemeToggle` của bản mẫu, `UserNavMenu` (7 mục, như cũ). `children` nằm dưới thanh, trong cùng header dính.
  - Class màu lấy từ header của bản React (`bg-[#F8F8F6]/90`, `border-[#E7E7E2]`, `text-[#4B5563]`, `text-[#111827]`); `prototype/theme.css` đã có bản tối cho các class này.
- **Cockpit:**
  - `CockpitHeader.tsx` dựng trên `MainNav` (`current="workspace"`). Hai nút "Lịch sử", "Xem hội thoại" thành `actions`, giữ `id`, `aria-*` và hành vi; chữ chỉ hiện từ 1280 px, không xuống dòng. Bỏ khối "Yêu cầu hiện tại" và nút sáng/tối riêng của cockpit (`#btn-theme-toggle`), dùng `ThemeToggle` chung. Dải "Chế độ thử nghiệm" là `children`.
  - `pages/Cockpit/RequestEcho.tsx` (mới): dòng `Bạn nhờ: “…”`, cắt 2 dòng (`line-clamp-2`), toàn văn trong DOM và `title`. Câu yêu cầu nằm trong một `span` riêng.
  - `Cockpit.tsx` truyền `request` (cùng nguồn với thanh cũ) cho khoảnh khắc 3, 4, 5, 6, kết thúc không thành công, 7–9 và lập kế hoạch lâu. Mỗi màn đặt `RequestEcho` ngay trên `h1`. Khoảnh khắc 1, 2, câu trả lời, từ chối, hỏi lại mở rộng và lỗi lập kế hoạch không có dòng này (đã rà theo mã: các màn đó tự hiện câu yêu cầu, hoặc chưa có câu).
- **Sáu trang con:** Nhật ký, Kết nối dịch vụ, Tài khoản, Người dùng thay header bằng `MainNav`. Cẩm nang và Chính sách an toàn dùng `MainNav` khi đã đăng nhập; chưa đăng nhập giữ nguyên header cũ, chỉ bỏ hai nhánh không còn chạy được khi `user` là `null` (link Người dùng của admin, menu avatar). Bỏ import và biến không còn dùng (`role` ở Settings). Không sửa `page.css`.
- Giữ kiểu xuống dòng của từng file: `History` toàn CRLF; `Account`, `Users` trộn CRLF/LF như trước (`git ls-files --eol` khớp trước/sau). Vì repo đặt `* -text`, `git diff --check` báo CR cuối dòng là khoảng trắng thừa ở các dòng mới của ba file này. Commit trước của các file này cũng bị báo như vậy (ví dụ `97a76fe` với `HistoryPage.tsx`). `git -c core.whitespace=cr-at-eol diff --check` đạt.
- `scripts/test-v3-browser.mjs`: thêm `FE-12:` vào nhóm default.

## TDD

Viết hai file test trước khi có mã: `tests/fe-12-main-nav.test.tsx`, `tests/fe-12-request-echo.test.tsx`.
- **RED:** `npx vitest run` hai file, exit 1. File thanh điều hướng lỗi import (`Failed to resolve import "../src/components/layout/MainNav"`). File dòng yêu cầu: 11 fail, 5 đạt. Các ca fail: 8 khoảnh khắc (`expected null not to be null`), câu dài, lập kế hoạch lâu, và "thanh cockpit không còn câu yêu cầu" (`expected <div …> to be null`). 5 ca đạt là ca giữ (không có dòng yêu cầu ở khoảnh khắc 1/2/answer/refusal; nút "Xem hội thoại" ẩn ở khoảnh khắc 1).
- **GREEN:** sau khi làm, hai file 28/28.

## Test cũ phải sửa

Chỉ sửa phần khẳng định thanh cũ; không nới assertion khác.

| File | Trước | Sau | Lý do |
|---|---|---|---|
| `fe-05b-parity-a.test.tsx` (ca khám phá) | `header #top-bar-query` có `title` là câu yêu cầu | thanh không chứa câu yêu cầu; không có dòng "Bạn nhờ" ở khoảnh khắc 2 | khối "Yêu cầu hiện tại" đã bỏ; khoảnh khắc 2 tự hiện câu trong tiêu đề |
| `fe-05b-parity-a.test.tsx` (2 ca dịch vụ) | `getByRole('link', {name: 'Kết nối dịch vụ'})` toàn trang | cùng truy vấn trong `main` | thanh có tab cùng tên; ca này kiểm link hướng dẫn trong khoảnh khắc |
| `fe-06b-responses.test.tsx` (2 ca) | link "Kết nối dịch vụ" / `/Kết nối/` toàn trang | trong `main` | như trên |
| `fe-07-settings.test.tsx` (2 ca) | nhãn vai trò trong `banner` | mở menu avatar, đọc vai trò ở đầu menu | nhãn vai trò rời thanh (task card mục 1); menu vẫn ghi vai trò |
| `planning-navigation.test.tsx` | `getByText(câu yêu cầu)` khi đang lập kế hoạch | `#moment-2-query-display` chứa câu | câu chỉ còn trong tiêu đề khoảnh khắc 2, có ngoặc kép |
| `browser/fe-05-cockpit.spec.ts` | chữ "Yêu cầu hiện tại" ẩn ở khoảnh khắc 1, hiện ở khoảnh khắc 4 | không có dòng "Bạn nhờ" ở khoảnh khắc 1; có và chứa câu ở khoảnh khắc 4 | như trên |
| `browser/auth-05-account.spec.ts`, `browser/auth-05-google-actions.spec.ts` | link "Quay lại không gian làm việc" | logo của thanh (`/Về không gian làm việc/`) | nút quay lại đã bỏ; logo về không gian làm việc ở mọi khổ |

Ca `app-routing.test.tsx` (5 ca tìm `getByText('Saved request')`) fail ở lượt đầu vì câu nằm chung chữ với ngoặc kép. Đã sửa ở mã (câu yêu cầu thành `span` riêng), không sửa test.

## Test browser mới

`tests/browser/fe-12-nav.spec.ts`, 4 ca, sandbox, PostgreSQL thật:
1. Admin, 1440 px: từ mỗi trang (cockpit, Nhật ký, Kết nối dịch vụ, Tài khoản, Người dùng, Cẩm nang, Chính sách an toàn) bấm tới cả 5 tab; URL và `aria-current` đúng (35 lượt).
2. Bố cục ở 1440, 1280, 1024, 375 px, sáng và tối, trên 7 trang:
   - không cuộn ngang;
   - cụm phải sát mép phải và nằm trên một dòng;
   - từ 768 px: ba cụm không giao nhau;
   - từ 1024 px: tâm cụm tab lệch tâm thanh ≤ 2 px;
   - dưới 768 px: không có tab, trang con có tên trang.

   Cockpit dùng một hội thoại dựng sẵn có kế hoạch chờ duyệt và 12 tin ("Xem hội thoại 12"). Ảnh toàn trang của mọi tổ hợp, kèm SHA-256 trong output.
3. Thành viên: 4 tab ở 1440 px; ở 375 px đi được Kết nối dịch vụ, Cẩm nang, Tài khoản, Chính sách an toàn, Nhật ký qua menu avatar, và về không gian làm việc qua logo.
4. Cockpit thật: khoảnh khắc 1 không có dòng "Bạn nhờ" và không có "Xem hội thoại"; sau khi gửi, dòng nằm trước `#heading-moment-4`; thanh không chứa câu; hai ngăn vẫn mở; Hủy kế hoạch.

Lượt đầu, ảnh 1440 px cho thấy nhãn "Lịch sử", "Xem hội thoại" bị xuống dòng. Thêm `whitespace-nowrap` thì cụm phải rộng 330 px, hơn cột bên (326 px), nên cụm tab lệch tâm; test bắt được. Giảm khoảng cách tab (`gap-1`) và giữa các cột (`gap-2`); thêm assertion "cụm phải nằm trên một dòng".

## Đột biến

- **Mức unit, 8/8 bị bắt** (mỗi đột biến làm fail đúng ca của nó): bỏ `aria-current`; thành viên thấy tab Người dùng; chặn cả bấm kèm phím bổ trợ; bỏ `aria-label` đầy đủ; bỏ dòng yêu cầu ở khoảnh khắc 4; thêm dòng yêu cầu vào khoảnh khắc 2; Cẩm nang đã đăng nhập giữ header cũ; bỏ dòng yêu cầu ở khoảnh khắc 7.
- **Mức trình duyệt (test bố cục), 2/3 bị bắt:**
  - đổi lưới thành `flex justify-between`: fail "tabs centred" ở cockpit 1440 px;
  - bỏ `col-start-3`: fail "avatar cluster sits at the right edge" ở 375 px;
  - bỏ `whitespace-nowrap` ở nút "Xem hội thoại": **sống sót**. Sau khi thu khoảng cách, nhãn không còn xuống dòng ở các khổ đang đo, nên đây là đột biến tương đương ở các khổ đó. Assertion "trên một dòng" vẫn giữ nếu bố cục thay đổi.

  Script đếm của reviewer in nhãn INVALID cho cả 3 lượt vì một lỗi regex; kết quả trên đọc tay từ mã thoát và thông báo lỗi.

## Kết quả kiểm

Máy nhóm trưởng, worktree `ATI_Project-wt-fe12-impl`, PostgreSQL 16 tmpfs riêng ở `127.0.0.1:55533` (không dùng DB dev 15433), `RUNTIME_MODE=sandbox`, hai cờ tắt, không có `.env` trong worktree.

- **Test web:** `npx vitest run` ở `apps/chat-web`, **773/773** (745 cũ + 28 mới), exit 0. Lượt đầu 15 fail đều do các assertion cũ của thanh trên (bảng ở trên).
- **`npm run check`:** exit 0. **2.042 v3** = 63 schema + 408 adapter + 291 planner + 42 executor + 465 API + 773 web, **389 eval**; kèm typecheck, build, kiểm bản build, launcher và 10 test Node cuối.
- **`npm run test:browser:v3`:**
  - lượt 1 exit 1: nhóm default 88 pass, 4 fail, 1 skip. Bốn ca fail đều là `FE-05: real sandbox request approval…` (sáng/tối × 1440/375), hết 30 s ở `locator.fill`. Nguyên nhân là lỗi của reviewer khi sửa test: file viết nhiều lệnh trên một dòng, và chú thích `//` chèn giữa dòng 14 đã vô hiệu hoá phần còn lại của dòng (bấm "Sửa qua Chat"). Đổi sang chú thích khối `/* */`;
  - lượt 2 exit 0: **119 pass, 1 skip có chủ đích, 13 nhóm** (default 92 = 88 + 4 FE-12; auth02 2, auth04 6, clarification 3, partial_failure 2, sáu nhóm service mỗi nhóm 1, answer 4, gmail 4).
- **Ảnh trước/sau**, không commit:
  - **Màn chụp:** 9 màn × 1440/1024/375 px × sáng/tối; mỗi bộ 54 ảnh. Các màn: cockpit khoảnh khắc 1, 4 (kế hoạch dựng sẵn, 12 tin) và 6 (duyệt trong sandbox); Nhật ký; Kết nối dịch vụ; Tài khoản; Người dùng; Cẩm nang và Chính sách an toàn khi đã đăng nhập;
  - **Bộ "trước":** app của `main` `a8383e0`, chạy ở thư mục chính với biến môi trường ghi đè (DB tạm, sandbox). **Bộ "sau":** app của nhánh này;
  - **Nơi lưu:** `.codex/fe12-screenshots-2026-10-19/` (ignore) ở thư mục chính. Kiểm SHA-256 sau khi chép: 54/54 + 54/54 khớp;
  - **Manifest:** `fe12-shots-before.sha256` `2f22f6e046a465d037925dd52fc9c1056345c4050fe8699d37014d7ea6e8d217`, `fe12-shots-after.sha256` `b968d198a22c15f28fa145d3a555650506933ceef322720812a7ab09ab285296`;
  - **Ảnh của test browser:** test bố cục còn chụp thêm 56 ảnh (7 màn × 4 khổ × 2 chế độ) trong thư mục kết quả Playwright; SHA-256 in trong output của test.

## Khác task card hoặc chưa làm

- Nút sáng/tối của cockpit đổi sang `ThemeToggle` của bản mẫu (cùng nút với các trang con), nên `#btn-theme-toggle` không còn. Không test nào dùng `id` này.
- Bề rộng thanh `max-w-7xl` (task card để bên thi công chọn).
- Không xoá `AppShell.tsx`/`ShellPageView.tsx` (tuỳ chọn); không có nơi nào dựng hai file này.
