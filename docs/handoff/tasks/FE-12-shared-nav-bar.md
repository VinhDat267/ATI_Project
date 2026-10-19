# FE-12 · Thanh điều hướng chung cho mọi trang sau khi đăng nhập

**Trạng thái:** đang làm, giao reviewer ngày 19/10/2026 theo yêu cầu nhóm trưởng · **Nhánh gợi ý:** `feat/fe-12-shared-nav-bar` · **Phụ thuộc:** không · **Mốc:** merge trước **29/10/2026** (mốc ngừng thêm tính năng); **không merge trong 23–25/10** (buổi thử W4-03 chạy trên giao diện hiện tại). Nên mở PR trước 22/10 hoặc trong 26–28/10.
**Nguồn:** nhóm trưởng chốt ngày 19/10/2026 sau khi xem mockup trong phiên lập kế hoạch với reviewer ([log](../log/2026-10-19-reviewer-plan-fe-12-nav.md)).

## Vì sao làm

Thanh trên hiện chép từ 12 bản mẫu nên mỗi trang một kiểu:
- **Cockpit** (`/`, `/c/:id`) là trang dùng nhiều nhất nhưng không có link nào sang Nhật ký, Kết nối dịch vụ hay Cẩm nang. Muốn sang các trang đó phải mở menu avatar.
- **Các trang con** có nút "← Về không gian làm việc" kèm 2–3 link chéo, mỗi trang một bộ khác nhau:
  - Nhật ký: Kết nối dịch vụ, Cẩm nang, Người dùng;
  - Kết nối dịch vụ: Nhật ký, Cẩm nang;
  - Tài khoản: Nhật ký, Kết nối dịch vụ;
  - Người dùng: Nhật ký, Kết nối dịch vụ, Tài khoản;
  - Cẩm nang: Kết nối dịch vụ, Nhật ký, Người dùng;
  - Chính sách an toàn: Cẩm nang, Kết nối dịch vụ.
- **Điện thoại:** dưới 768 px các link chéo bị ẩn hết. Không trang nào đánh dấu trang đang mở.

Đây là **chỗ đổi hình thức so với bản mẫu**, ngoài quy tắc chốt 07/10 ("app theo đúng 12 bản mẫu"). Nhóm trưởng chốt ngày 19/10. Đặc tả giao diện mục 1.1 (điểm 10) và mục 4 đã ghi theo.

## Thiết kế đã chốt

```
Máy tính (≥ 1280 px), cockpit đang có yêu cầu (admin):

[A] ATI    Không gian làm việc  Nhật ký  Kết nối dịch vụ  Cẩm nang  Người dùng    [Lịch sử] [Xem hội thoại 4] ☾ (VD)
           ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾  ← tab đang mở: chữ đậm, gạch chân cam
───────────────────────────────────────────────────────────────────────────────────────────────────────────────
                 Bạn nhờ: “Tạo issue GitHub rồi báo Slack #ati-test”
                 Kế hoạch đã sẵn sàng
                 …
```

### 1. Một thanh dùng chung

- **Một component dùng chung**, ví dụ `apps/chat-web/src/components/layout/MainNav.tsx`; tên do bên thi công đặt. Thanh dùng ở:
  - cockpit (`CockpitHeader.tsx`);
  - `/history`, `/settings`, `/account`, `/admin/users`;
  - `/guide` và `/privacy` khi đã đăng nhập.
- **Bố cục ba cột:**
  - trái: logo, về `/`;
  - giữa: các tab, **căn đúng giữa thanh**, không phải giữa logo và cụm phải. Ví dụ dùng `grid-template-columns: 1fr auto 1fr`;
  - phải: nút sáng/tối và avatar (`UserNavMenu`). Riêng cockpit thêm hai nút ở mục 3.
- **Tab, theo thứ tự:**

  | Tab | Đường dẫn | Tab đang mở khi ở |
  |---|---|---|
  | Không gian làm việc | `/` | `/`, `/c/:id` |
  | Nhật ký | `/history` | `/history` |
  | Kết nối dịch vụ | `/settings` | `/settings` (kể cả `#<id>`) |
  | Cẩm nang | `/guide` | `/guide` |
  | Người dùng (chỉ khi `user.role === 'admin'`, giống `UserNavMenu`) | `/admin/users` | `/admin/users` |

  `/account` và `/privacy` không có tab, nên ở hai trang đó không tab nào đang mở. Hai trang này vẫn mở từ menu avatar.
- **Tab đang mở:** chữ đậm, gạch chân màu cam `#FF5701`, có `aria-current="page"`.
- **Tab là link thật:** `<a href>` nằm trong `<nav aria-label="Điều hướng chính">`. Bấm thường thì gọi `navigate(path)`. Bấm kèm Ctrl/Cmd/Shift/Alt hoặc chuột giữa thì để trình duyệt tự xử lý, như `appLink` trong `GuidePage.tsx`.
- **Bỏ khỏi các trang con:**
  - nút "← Về không gian làm việc" / "Quay lại";
  - các link chéo cũ;
  - nhãn vai trò (`#role-pill-badge`). Menu avatar đã ghi vai trò.

  Giữ nguyên nút sáng/tối và menu avatar. Menu avatar vẫn đủ 7 mục, vì điện thoại dùng nó để đi trang khác.
- **Thanh dính trên đầu khi cuộn**, như hiện nay.

### 2. Theo độ rộng màn hình

| Độ rộng | Tab | Hai nút của cockpit |
|---|---|---|
| ≥ 1280 px | chữ đầy đủ | chữ + biểu tượng ("Lịch sử", "Xem hội thoại 4") |
| 768–1279 px | chữ rút gọn: "Làm việc", "Nhật ký", "Kết nối", "Cẩm nang", "Người dùng" | chỉ biểu tượng; "Xem hội thoại" vẫn có số tin |
| < 768 px | ẩn; trang con ghi tên trang đang mở cạnh logo; đi trang khác qua menu avatar | chỉ biểu tượng, như hiện nay |

- **Tên truy cập của tab luôn là tên đầy đủ**, kể cả khi chữ hiển thị được rút gọn. Ví dụ tab "Kết nối" vẫn có tên truy cập "Kết nối dịch vụ".
- **Không chồng lấn, không cuộn ngang:** ở mọi khổ, tab, logo và cụm phải không đè lên nhau, và trang không cuộn ngang. Ca khó nhất là cockpit của admin có 5 tab và "Xem hội thoại 99" ở 1280 px và 1024 px.
- **Bề rộng thanh do bên thi công chọn.** Khung `max-w-5xl` hiện nay có thể không đủ chỗ cho 5 tab ở giữa cộng cụm phải.

### 3. Cockpit: không còn dòng "Yêu cầu hiện tại" trên thanh

- **Hai nút "Lịch sử" và "Xem hội thoại"** lên cụm phải của thanh, trước nút sáng/tối.
  - Giữ `id` (`btn-open-history`, `btn-open-chat`), `aria-label`, `aria-expanded`, `aria-controls` và hành vi mở ngăn, trả focus, như hiện nay.
  - "Xem hội thoại" vẫn ẩn ở khoảnh khắc 1.
- **Bỏ khối "Yêu cầu hiện tại"** (`#top-bar-query-container`) khỏi thanh. **Không thêm dòng thứ hai** dưới thanh; nhóm trưởng đã xem phương án có dòng phụ và không chọn.
- **Câu yêu cầu chuyển vào nội dung màn:** một dòng chữ nhỏ ngay trên tiêu đề (`h1`) của khoảnh khắc, dạng `Bạn nhờ: “<câu yêu cầu>”`.
  - **Nguồn:** giống thanh hiện nay, là tin người dùng mới nhất (`request` trong `Cockpit.tsx`). Không đổi cách chọn câu.
  - **Màn có dòng này:** mọi màn có câu yêu cầu mà nội dung chưa hiện câu đó: khoảnh khắc 3 (hỏi lại thường), 4, 5, 6, kết thúc không thành công, 7, 8, 9, lập kế hoạch lâu.
  - **Màn không có dòng này:**
    - khoảnh khắc 1;
    - các màn đã hiện câu yêu cầu trong nội dung: khoảnh khắc 2 (`#moment-2-query-display`), câu trả lời, từ chối, hỏi lại mở rộng (`#user-request-bubble-text` của `ResponseCard`) và lỗi lập kế hoạch (`#failed-prompt-text`).

    Bên thi công rà lại danh sách này theo mã thật và ghi kết quả.
  - **Câu dài:** tối đa 2 dòng, cắt bằng "…". Toàn văn vẫn có trong DOM để trình đọc màn hình đọc được, và có trong `title`.
  - **Màu và cỡ chữ:** theo chữ phụ của bản mẫu (cỡ 12px, màu `#6B7280`, câu yêu cầu màu `#111827`). Đọc được ở cả chế độ sáng và tối.
- **Dải "Chế độ thử nghiệm"** vẫn nằm dưới thanh của cockpit như hiện nay.

### 4. Không đổi

- **Chưa đăng nhập:** `/guide` và `/privacy` giữ thanh hiện tại (logo, nút sáng/tối, "Đăng nhập").
- **Các trang ngoài phạm vi:** Landing, các trang xác thực (`/login`, `/signup`, `/verify-email`, `/reset-password`, `/forgot-password`, `/auth/google/callback`), callback Gmail, trang 404 và màn lỗi tải hội thoại (`NotFoundView`). Trang 404 có test so với bản mẫu từ FE-04b.
- **`page.css` của các trang:** không sửa, vì `fe-07-settings.test.tsx` giữ `Settings/page.css` giống bản mẫu từng byte. Style của thanh mới đặt trong component dùng chung. Selector `#role-pill-badge` còn sót trong `page.css` là vô hại.
- **Bản React của bản mẫu** (`docs/design/prototypes/react/`) giữ nguyên. Bản mẫu vẫn là bản gốc; app lệch ở đúng điểm này.

## Việc cần làm

1. **Test trước (TDD):** viết test của component dùng chung và dòng "Bạn nhờ" trước, chạy cho fail, ghi output fail thật vào log.
2. **Dựng component dùng chung** theo mục 1–2, rồi thay header ở 7 nơi. Dùng lại các class màu đang có trong header của bản React (ví dụ `bg-[#F8F8F6]/90`, `border-[#E7E7E2]`, `text-[#4B5563]`), để `prototype/theme.css` lo chế độ tối như các trang khác. Kiểm cả trong ngữ cảnh `app-stage` (cockpit) lẫn ngữ cảnh trang con.
3. **Cockpit:** làm theo mục 3.
4. **Sửa các test đang khẳng định thanh cũ**, ví dụ:
   - "Về không gian làm việc" ở `auth-05-account.spec.ts`, `auth-05-google-actions.spec.ts`, `fe-10-guide-privacy.*`;
   - `top-bar-query` và "Yêu cầu hiện tại" ở `fe-05b-parity-*`, `cockpit-test-helpers.ts`.

   Chỉ sửa đúng phần thanh đã đổi. Mỗi assertion sửa hoặc bỏ phải ghi lý do trong log. Không nới các assertion khác.
5. **Dọn tuỳ chọn:** `AppShell.tsx` và `ShellPageView.tsx` hiện không còn nơi nào dựng. Xoá được nếu xác nhận như vậy và không còn test nào cần.

## Tiêu chí nghiệm thu

- [ ] **Test của component** (Vitest + Testing Library):
  - thành viên thấy 4 tab, admin thấy 5;
  - tab đang mở đúng cho từng route ở bảng mục 1, và `/account`, `/privacy` không có tab nào `aria-current`;
  - bấm tab gọi `navigate` đúng đường dẫn; bấm kèm phím bổ trợ không chặn;
  - tên truy cập đầy đủ khi chữ rút gọn;
  - chưa đăng nhập thì `/guide`, `/privacy` không có tab.
- [ ] **Test của cockpit:**
  - dòng "Bạn nhờ" có ở mọi màn liệt kê ở mục 3, và không có ở khoảnh khắc 1 cùng các màn đã hiện câu yêu cầu;
  - câu dài vẫn đủ toàn văn trong DOM;
  - `#btn-open-history`, `#btn-open-chat` mở đúng ngăn và trả focus về nút khi đóng;
  - không còn `#top-bar-query-container`.
- [ ] **Test browser mới** (ví dụ `fe-12-nav.spec.ts`, sandbox, PostgreSQL thật), ở 1440, 1024 và 375 px, sáng và tối:
  - từ mỗi trang đi được tới mọi tab;
  - URL và `aria-current` đúng;
  - ở 1280 và 1024 px, hộp bao của logo, cụm tab và cụm phải không giao nhau, kể cả cockpit admin có "Xem hội thoại" hai chữ số;
  - tâm của cụm tab lệch tâm thanh không quá 2 px;
  - không cuộn ngang ở 375 và 1024 px;
  - ở 375 px, menu avatar mở được mọi trang.

  Thêm tiền tố `FE-12:` vào nhóm default của `scripts/test-v3-browser.mjs`.
- [ ] **Ảnh chụp trước/sau**, không commit; ghi SHA-256 trong log:
  - các trang: cockpit (khoảnh khắc 1, 4, 6), Nhật ký, Kết nối dịch vụ, Tài khoản, Người dùng (admin), Cẩm nang và Chính sách an toàn (đã đăng nhập);
  - mỗi trang ở 1440, 1024, 375 px, sáng và tối.

  Nhóm trưởng xem bộ ảnh trước khi merge.
- [ ] **Không đổi gì ngoài thanh trên và dòng "Bạn nhờ"**, trên mọi trang.
- [ ] **Lệnh kiểm:** `npm run check` và `npm run test:browser:v3` exit 0; ghi số test thật.

## Ngoài phạm vi

- Đổi tên "Lịch sử" (ngăn hội thoại) hoặc gộp nó với trang Nhật ký.
- Sửa chữ nhỏ dưới 3:1 và vùng chạm dưới 40 px trên toàn app (CURRENT-STATE mục 5, chờ nhóm trưởng quyết).
- Trang 404, Landing và các trang xác thực.
- Dòng "Bạn nhờ" lấy câu gốc thay vì tin mới nhất sau khi "Sửa qua Chat". Giữ cách chọn câu như thanh hiện nay.

## Kết quả (agent thi công điền)

- **PR:** nhánh `feat/fe-12-shared-nav-bar`, tách từ `docs/fe-12-nav-bar` (#161). Reviewer thi công theo yêu cầu nhóm trưởng ngày 19/10. [Log](../log/2026-10-19-reviewer-FE-12-shared-nav-bar.md).
- **Đã làm:**
  - `components/layout/MainNav.tsx`: thanh dùng chung theo mục 1–2; lưới `1fr auto 1fr`, các cụm ghim cột.
  - `pages/Cockpit/RequestEcho.tsx`: dòng "Bạn nhờ".
  - `CockpitHeader.tsx` dựng trên `MainNav`: hai nút ngăn thành `actions`, dải thử nghiệm thành `children`, bỏ khối "Yêu cầu hiện tại".
  - Khoảnh khắc 3, 4, 5, 6, kết thúc không thành công, 7–9 và lập kế hoạch lâu có dòng "Bạn nhờ" ngay trên `h1`.
  - Sáu trang con dùng `MainNav`. Cẩm nang và Chính sách an toàn chỉ khi đã đăng nhập.
  - `FE-12:` thêm vào nhóm default của runner browser.
- **Test:**
  - TDD: hai file test unit viết trước, RED (lỗi import và 11 ca fail), GREEN 28/28.
  - Test browser mới `fe-12-nav.spec.ts`, 4 ca: đi mọi tab từ mọi trang; bố cục ở 1440/1280/1024/375, sáng/tối; thành viên và menu avatar trên điện thoại; dòng "Bạn nhờ" và hai ngăn trong cockpit thật.
  - Sửa 7 test cũ khẳng định thanh cũ, mỗi chỗ ghi lý do trong log.
- **Đột biến:** 8/8 mức unit bị bắt. Mức trình duyệt 2/3 bị bắt; đột biến bỏ `whitespace-nowrap` sống sót vì tương đương ở các khổ đang đo (log ghi rõ).
- **Lệnh kiểm:**
  - `npm run check` exit 0: **2.042 v3 + 389 eval**;
  - `npm run test:browser:v3` exit 0: **119 pass, 1 skip có chủ đích, 13 nhóm**. Lượt đầu có 4 fail ở FE-05 do lỗi reviewer chèn chú thích giữa dòng khi sửa test; đã sửa;
  - PostgreSQL 16 tạm ở 55533, sandbox.
- **Ảnh trước/sau:** 54 + 54 ảnh, 9 màn × 3 khổ × sáng/tối, ở `.codex/fe12-screenshots-2026-10-19/` của máy nhóm trưởng (ignore). SHA-256 manifest ghi trong log. **Nhóm trưởng xem bộ ảnh trước khi merge.**
- **Khác task card:**
  - nút sáng/tối của cockpit dùng `ThemeToggle` chung, nên `#btn-theme-toggle` không còn;
  - bề rộng thanh chọn `max-w-7xl`. Ở 1280 px, cụm phải của cockpit cần 330 px, nên khoảng cách giữa các tab là `gap-1` và giữa các cột là `gap-2`;
  - không xoá `AppShell.tsx`/`ShellPageView.tsx` (tuỳ chọn).
