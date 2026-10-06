# Thiết kế lại giao diện ATI theo design system "Agentic"

**Ngày:** 05/10/2026 · **Người viết:** Claude Code (lập kế hoạch) · **Trạng thái:** chờ duyệt cùng PR
**Bản mẫu:** [`docs/design/prototypes/`](../../design/prototypes/README.md) (12 trang HTML, mở thẳng bằng trình duyệt)
**Task thi công:** FE-04 → FE-10 và UI-API-01 trong `docs/handoff/tasks/`

## 1. Mục tiêu và phạm vi

Đưa `apps/chat-web` từ giao diện chat hiện tại sang hướng "sân khấu theo khoảnh khắc": mỗi lúc màn hình chỉ cho thấy một việc người dùng cần làm (gõ yêu cầu, trả lời câu hỏi, duyệt, theo dõi, xử lý lỗi), còn hội thoại đầy đủ nằm trong ngăn kéo bên cạnh.

- Người dùng chính: thành viên nhóm không rành kỹ thuật. Quản trị viên là người dùng thứ hai (kết nối dịch vụ, duyệt tài khoản).
- Mục tiêu phụ: gây ấn tượng khi bảo vệ, nhưng không đổi lấy sự trung thực của giao diện (mục 6).
- **Giữ nguyên hành vi backend**, trừ ba thay đổi nhỏ ở UI-API-01 (mục 9). Không đổi planner, executor, adapter, catalog.
- **Bản mẫu là chuẩn về hình thức** (người dùng chốt 06/10/2026, thay câu "tham chiếu bố cục và nội dung" của bản 05/10).
  - App phải giống bản mẫu về bố cục, thứ tự, thành phần, màu, khoảng cách và chữ trên giao diện, chỉ được khác ở các điểm trong mục 1.1.
  - Không chép mã của bản mẫu (Tailwind v3 qua CDN, JS inline); dựng lại bằng component React và token.
  - Mọi thứ trong bản mẫu ghi "demo", "Kịch bản demo", "Xem như", "Máy chủ: Thử nghiệm/Thật" là công cụ trình diễn, **không đưa vào app**.
- Mỗi task FE có tiêu chí "giống bản mẫu":
  - ảnh app và ảnh bản mẫu đặt cạnh nhau ở 1440×900 và 375×812, sáng và tối;
  - khác biệt còn lại phải thuộc mục 1.1 hoặc được ghi kèm lý do trong phần "Kết quả" của task.

### 1.1 Khác biệt có chủ đích với bản mẫu

1. **Công cụ trình diễn:** "Kịch bản demo", phím 1–9, "Bỏ qua animation tới kết quả", "Xem như", "Máy chủ: Thử nghiệm/Thật", dữ liệu mẫu viết cứng.
2. **Dữ liệu thật thay dữ liệu mẫu.**
   - Tên, số việc, dịch vụ, nơi ghi, thời lượng, số tin và giờ lấy từ store/API.
   - Phần nào bản mẫu có mà API không có dữ liệu thì bỏ phần đó, giữ khung. Ví dụ: lựa chọn hỏi lại chỉ là chuỗi, nên không có dòng "Cập nhật 2 giờ trước" hay nhãn "Khuyên dùng".
3. **Quy tắc trung thực** (mục 6) có hiệu lực cao hơn chữ trong bản mẫu:
   - không có số issue/dòng trước khi bước chạy xong;
   - chip "Đã tạo/Đã ghi/Đã gửi" chỉ khi bước `succeeded`;
   - thanh tiến độ bằng số bước xong / tổng, không tự chạy;
   - không có câu ước lượng chưa đo ("Thường mất khoảng 3–5 giây").
4. **Cỡ chữ:** tối thiểu 14px (3.2.3). Tiêu đề lớn nhất theo thang 3.1 là 40px; bản mẫu dùng 42–52px ở desktop.
5. **Màu:**
   - dùng token 3.1/3.3;
   - nền `#F6F6F1` thay `#F8F8F6` (3.2.4);
   - chế độ tối theo token (mục 8), không theo `theme.css`;
   - ngoại lệ chữ trắng trên cam (3.2.1) chỉ cho nút. Đoạn chữ thường trên nền cam (ví dụ bong bóng tin của người dùng ở chế độ tối) dùng chữ `#111827` (khoảng 5,5:1).
6. **Trợ năng** (mục 7): vùng chạm tối thiểu 40×40px (nút thanh trên của bản mẫu cao 32px), viền focus, landmark, một `h1` mỗi màn.
7. **Gợi ý việc** ở khoảnh khắc 1 và 6 chỉ dùng dịch vụ đã thiết lập:
   - gợi ý hai dịch vụ chỉ khi cả hai đã thiết lập;
   - chưa có dịch vụ nào thì vùng gợi ý thay bằng câu "Chưa có dịch vụ nào được kết nối" và link tới `/settings`.
8. **Quy tắc cockpit** (mục 5): chỉ một ô nhập chat hiển thị một lúc, kể cả khi bản mẫu hiện hai.
9. **Màn chưa có bản mẫu** (kết thúc không thành công) theo bố cục gần nhất (khoảnh khắc 6).

## 2. Bản mẫu và màn hình tương ứng

| Bản mẫu | Route trong app | Ghi chú |
|---|---|---|
| `index.html` | `/` (chưa đăng nhập) | Trang giới thiệu cuộn kể chuyện 5 khoảnh khắc. Modal đăng nhập/đăng ký trong bản mẫu dùng làm mẫu cho các trang `/login`, `/signup`, `/forgot-password` |
| `app-stage.html` | `/` (đã đăng nhập), `/c/:id` | Cockpit 9 khoảnh khắc, ngăn lịch sử, ngăn hội thoại, xem trước nội dung, menu người dùng, dải thử nghiệm |
| `responses.html` | trong cockpit | Bốn trạng thái khi chưa lập được kế hoạch: dịch vụ chưa kết nối, việc chưa làm được, yêu cầu chỉ để xem, không thấy nơi cần ghi |
| `settings.html` | `/settings` (mới), `/settings#<service>` | Thay `SettingsModal` hiện tại |
| `account.html` | `/account` | Thay `AccountView` |
| `users.html` | `/admin/users` | Thay `AdminUsersView` |
| `history.html` | `/history` (mới) | Trang lịch sử đầy đủ; ngăn lịch sử trong cockpit vẫn giữ |
| `auth-action.html` | `/verify-email`, `/reset-password`, `/auth/google/callback`, các lỗi đăng nhập | Mỗi trạng thái trong bản mẫu là một màn hoặc một trạng thái của màn đăng nhập |
| `errors.html` | trong cockpit và toàn app | Mất mạng, hết phiên, lập kế hoạch lâu, lỗi máy chủ |
| `guide.html` | `/guide` (mới) | Cẩm nang lấy khoá và mẫu câu lệnh |
| `privacy.html` | `/privacy` (mới, công khai) | Chính sách an toàn và dữ liệu |
| `404.html` | mọi route không khớp | Thay `NotFoundView` |

`theme.css` và `theme.js` trong thư mục bản mẫu chỉ phục vụ bản mẫu (ghi đè class Tailwind v3). App làm chế độ tối bằng token (mục 8), không dùng hai file này.

## 3. Design system Agentic và các điểm lệch đã chốt

Nguồn: design system "Agentic" (Themed & Unique) do nhóm cung cấp ngày 05/10/2026.

### 3.1 Token gốc (giữ nguyên)

| Token | Giá trị | Dùng cho |
|---|---|---|
| Primary | `#FF5701` | Nút hành động chính, tín hiệu tương tác, focus |
| Secondary | `#F6F6F1` | Nền trang |
| Surface | `#FFFFFF` | Thẻ, ngăn, hộp thoại |
| Text | `#111827` | Chữ chính |
| Success | `#16A34A` | Thành công |
| Warning | `#D97706` | Cảnh báo, chưa rõ kết quả |
| Danger | `#DC2626` | Lỗi, hành động phá huỷ |

- Thang chữ: 14 / 16 / 18 / 24 / 32 / 40 px. Lưới 8pt. Chuyển động 150–250 ms.
- Không thêm màu ngoài bảng khi một token có sẵn giải quyết được.

### 3.2 Điểm lệch có chủ đích (người dùng chốt 05/10/2026)

1. **Chữ trắng trên nút cam `#FF5701`.** Độ tương phản 3,2:1, không đạt WCAG AA cho chữ thường (cần 4,5:1). Giữ để bảo toàn nhận diện. Áp dụng cùng quy tắc cho nút nền Success (3,3:1) và Warning (3,2:1). Bù lại:
   - nhãn nút tối thiểu 14px, đậm 600;
   - nút luôn có viền focus rõ (mục 7);
   - không đặt chữ trắng trên cam ở chữ dưới 14px (ví dụ huy hiệu nhỏ dùng nền nhạt + chữ đậm cùng họ màu).
   Danger `#DC2626` với chữ trắng đạt 4,8:1.
2. **Chữ thường dùng Be Vietnam Pro**, Playfair Display chỉ cho tiêu đề, JetBrains Mono cho mã/ID. Design system ghi font chính là Playfair; ở cỡ 14–16px chữ tiếng Việt có chân khó đọc hơn.
3. **Cỡ chữ tối thiểu 14px trong app.** Bản mẫu dùng nhiều chữ 10–12px (khoảng 1.090 chỗ); **không chép các cỡ đó**. Nhãn phụ, giờ, ID dùng 14px với màu phụ (mục 3.3).
4. **Nền trang dùng `#F6F6F1`.** Bản mẫu dùng `#F8F8F6`, coi là cùng một token.

### 3.3 Token suy ra (design system không có, cần cho app)

| Token | Sáng | Tối | Dùng cho |
|---|---|---|---|
| `--bg-page` | `#F6F6F1` | `#0B1020` | Nền trang |
| `--surface` | `#FFFFFF` | `#131B2F` | Thẻ, ngăn |
| `--surface-inset` | `#F6F6F1` | `#0E1528` | Ô nhập, vùng lõm trong thẻ |
| `--surface-raised` | `#F3F4F6` | `#1A2338` | Chip, hàng hover |
| `--text` | `#111827` | `#F1F5F9` | Chữ chính |
| `--text-secondary` | `#4B5563` | `#B4BFCD` | Chữ phụ |
| `--text-muted` | `#6B7280` | `#A1AEC0` | Giờ, nhãn phụ, gợi ý |
| `--border` | `#E7E7E2` | `rgba(148,163,184,.18)` | Viền mặc định |
| `--border-strong` | `#D1D5DB` | `rgba(148,163,184,.32)` | Viền hover/nhấn |
| `--primary` | `#FF5701` | `#FF5701` | Như 3.1 |
| `--success/-warning/-danger` | như 3.1 | như 3.1 | Nền nút đặc |
| `--{role}-tint` | nền nhạt cùng họ (ví dụ `#F0FDF4`) | `rgba(<màu>, .14)` | Nền huy hiệu, hộp thông báo |
| `--{role}-text` | đậm cùng họ (ví dụ `#15803D`) | sáng cùng họ (ví dụ `#6EE7B7`) | Chữ trên nền nhạt |

Giá trị trong bảng là điểm xuất phát. Cặp nào không đạt 4,5:1 thì **chỉnh token**, không thêm ngoại lệ. Ví dụ đã biết: `--text-muted` `#6B7280` trên `--surface-raised` `#F3F4F6` chỉ đạt khoảng 4,4:1, nên cần làm đậm `--text-muted` hoặc không đặt chữ phụ trên nền chip.

Màu nhận diện dịch vụ (Trello `#0079BF`, Slack, GitHub…) chỉ dùng trong logo SVG. Chữ link dịch vụ dùng `--{role}-text` hoặc `--text`, không dùng màu thương hiệu dịch vụ làm màu chữ.

## 4. Điều hướng

- Giữ router hiện tại (`routes.ts`, không thêm thư viện). Thêm các route: `/settings`, `/history`, `/guide`, `/privacy`.
- `/privacy` và `/guide` xem được khi chưa đăng nhập; các route còn lại như hiện tại.
- Link trong email (`/verify-email`, `/reset-password`, `/?view=…`) giữ nguyên đường dẫn và tham số.
- Thanh trên của mọi trang đã đăng nhập: logo (về cockpit), nút lịch sử, nút giao diện Sáng/Tối, avatar mở menu người dùng. Menu người dùng gồm: Nhật ký điều phối, Kết nối dịch vụ, Cẩm nang, Tài khoản, Quản lý người dùng (chỉ quản trị viên), Chính sách an toàn, Đăng xuất. Không có "Đăng xuất mọi thiết bị" trong menu; tính năng này ở trang Tài khoản.
- Chữ viết tắt trên avatar lấy chữ cái đầu của từ đầu và từ cuối trong tên ("Lan Nguyễn" → "LN"), không phải hai ký tự đầu.

## 5. Cockpit: trạng thái thật → khoảnh khắc

Cockpit không có "kịch bản demo". Khoảnh khắc hiển thị được suy ra từ store (`chat-store`) và snapshot thực thi:

| Điều kiện (ưu tiên từ trên xuống) | Khoảnh khắc | Bản mẫu |
|---|---|---|
| `execution.status === 'reconciliation_required'` | 9 · Khôi phục sau khi máy chủ khởi động lại (chạy tiếp/dừng theo `recoveryActions`) | `app-stage.html` #9 |
| Có bước `unknown` | 8 · Chưa rõ kết quả: chỉ **Bỏ qua** hoặc **Dừng**, không chạy lại | #8 |
| Có bước `failed` đã biết lỗi | 7 · Lỗi đã biết: thử lại / sửa rồi thử lại / bỏ qua / dừng theo `recoveryActions` | #7 |
| `planStatus === 'completed'` | 6 · Xong, biên nhận có link | #6 |
| `planStatus ∈ {approving, executing}` | 5 · Đang làm, từng bước | #5 |
| `planStatus === 'preview'` | 4 · Chờ duyệt | #4 |
| Có `activeClarification` | 3 · Hỏi lại (gồm "không thấy nơi cần ghi" và "yêu cầu chỉ để xem") | #3, `responses.html` 3–4 |
| Tin mới nhất là `refusal` | Từ chối (dịch vụ chưa kết nối / việc chưa làm được) | `responses.html` 1–2 |
| `isPlanning` (có hoặc chưa có `gatherState`) | 2 · Đang tìm đúng chỗ | #2 |
| `planStatus ∈ {stopped, rejected, failed}` | Kết thúc không thành công: tóm tắt việc đã làm/chưa làm và nút "Nhờ việc khác" | **chưa có bản mẫu**, làm theo bố cục #6 |
| Còn lại | 1 · Nhờ việc | #1 |

Quy tắc chung của cockpit:
- **Chỉ một ô nhập chat hiển thị tại một thời điểm.** Ngăn hội thoại mở thì ô nhập dưới cùng ẩn, và ngược lại.
- Ngăn hội thoại hiển thị toàn bộ `messages` (`role="log"`, `aria-live="polite"`), giữ hành vi cuộn hiện tại.
- Hành vi bất đồng bộ giữ nguyên các bảo đảm đã có (FE-02, FE-03b, W2-04): phản hồi về muộn không giành điều hướng, gửi đúng hội thoại đang chọn.
- Trang trí chuyển cảnh giữa các khoảnh khắc ≤ 250 ms, tắt hẳn khi `prefers-reduced-motion`.

## 6. Quy tắc trung thực

Rút ra từ các vòng review bản mẫu ngày 05/10/2026. Giao diện **không** được:

- hiện số liệu chưa đo (uptime, %, "100% minh bạch"), mã tự đặt ("REQ-2026-042", "#ATI-500-…"), vị trí địa lý của phiên, điểm "bảo mật: tốt";
- hiện tính năng không có: mời thành viên, từ chối tài khoản chờ duyệt, gỡ khoá dịch vụ, lưu bản nháp khi hết phiên, lịch sử của cả nhóm, gửi yêu cầu mở khoá, chọn tài khoản Google ngay trong trang;
- cho chạy lại bước `unknown`;
- ghi số issue/dòng trước khi bước đó chạy xong (kế hoạch nói "Tạo issue trong kho ati-test", chỉ biên nhận mới có "#42");
- nói "đã xác nhận" kết quả mà hệ thống không đọc lại (ví dụ tin Slack);
- tự cộng thêm hiệu ứng tiến độ giả (thanh %, bước kiểm tra giả).

Trạng thái kết nối dịch vụ chỉ có 4 giá trị, khớp `connectionStatus` của API: Chưa kết nối (`unconfigured`), Chưa kiểm tra (`unchecked`), Kết nối tốt (`healthy`), Không kết nối được (`unhealthy`).

## 7. Trợ năng

- Mỗi trang một `h1`. Landmark `header`, `nav`, `main`.
- Mọi nút chỉ có biểu tượng có `aria-label`. Trạng thái không chỉ thể hiện bằng màu.
- Focus thấy rõ: `outline: 2px solid var(--primary); outline-offset: 2px` cho mọi thành phần tương tác.
- Ngăn kéo/hộp thoại: `role="dialog"`, `aria-modal`, giữ focus bên trong, Esc đóng, đóng xong trả focus về đúng phần tử đã mở (kể cả khi danh sách đã vẽ lại).
- Menu: `role="menu"`/`menuitem`, phím mũi tên, Esc.
- Độ tương phản ≥ 4,5:1 cho chữ thường ở cả hai chế độ, trừ ngoại lệ 3.2.1.
- Vùng chạm tối thiểu 40×40 px trên màn hình cảm ứng.

## 8. Chế độ tối

- Token ở mục 3.3 khai báo bằng CSS variable; Tailwind v4 dùng `@theme` để tạo class từ token, và `@custom-variant dark (&:where(.dark, .dark *));` để bật theo class.
- Class `dark` trên `<html>`. Lựa chọn lưu ở `localStorage` khoá `ati-theme` (`light` | `dark`), đọc/ghi trong `try/catch`. Chưa chọn thì theo `prefers-color-scheme`, và đổi theo khi hệ điều hành đổi.
- Script nhỏ inline trong `index.html` (trước khi React chạy) đặt class để không nháy giao diện sáng.
- Đổi ở một tab thì các tab khác đổi theo (sự kiện `storage`).

## 9. Thay đổi backend cần cho giao diện (UI-API-01)

1. **Từ chối có cấu trúc.** Tin `refusal` (metadata và sự kiện SSE) thêm `reason`, `suggestion` và `unavailableServices: [{ id, name }]` khi router từ chối vì dịch vụ chưa kết nối. Router đã có sẵn danh sách này (`routeIntent().unavailable`). Giữ nguyên nội dung văn bản hiện có cho tương thích.
2. **Lưu riêng nơi được dùng.** `POST /api/services/:service/credentials` hiện bắt nhập lại toàn bộ khoá ngay cả khi chỉ đổi danh sách nơi được dùng. Thêm cách lưu chỉ `allowedScope` (giữ khoá đã mã hoá), vẫn chỉ quản trị viên.
3. **Không** thêm API cho: mời thành viên, từ chối tài khoản, gỡ khoá, lịch sử cả nhóm, lọc lịch sử theo trạng thái/công cụ. Bộ lọc trạng thái/công cụ trong `history.html` không làm ở đợt này.

Hành vi "yêu cầu chỉ để xem thì hỏi lại ngay" thuộc **W3-10**, không thuộc UI-API-01. Màn hỏi lại dùng chung `ClarificationCard` mới.

## 10. Kiểm thử

- Test component cho từng màn hình mới (Vitest + Testing Library), gồm ca phản hồi về muộn sau khi người dùng đã đổi sang việc khác (quy tắc phiên, mục 2).
- Bộ browser E2E hiện có (32 ca, 11 scenario) dựa vào chữ và cấu trúc giao diện cũ. Mỗi task FE cập nhật đúng các spec bị ảnh hưởng **trong cùng PR**; không xoá ca kiểm thử hành vi, chỉ đổi cách tìm phần tử.
- Kiểm thử tương phản tự động cho token (một test đọc token và tính tỉ lệ cho các cặp chữ/nền đã khai báo), có danh sách ngoại lệ 3.2.1.
- Trước khi mở PR: `npm run check` và `npm run test:browser:v3` exit 0.

## 11. Thứ tự, mốc và phương án cắt

| Task | Nội dung | Mốc mục tiêu |
|---|---|---|
| FE-04 | Token, font, chế độ tối, khung trang (thanh trên, menu người dùng, dải thử nghiệm), route mới rỗng | 10/10 |
| UI-API-01 | Từ chối có cấu trúc, lưu riêng nơi được dùng | 12/10 (song song FE-04) |
| FE-05 | Cockpit khoảnh khắc 1–6, ngăn hội thoại, ngăn lịch sử | 16/10 (xong 06/10, #90) |
| FE-05b | Làm cockpit giống bản mẫu: thanh trên, khoảnh khắc 1–6, ô nhắn thêm, hai ngăn (thêm 06/10) | 11/10, trước FE-06 |
| FE-06 | Cockpit khoảnh khắc 7–9, màn từ chối/hỏi lại, trạng thái lỗi chung | 20/10 |
| FE-07 | Trang Kết nối dịch vụ | 20/10 (song song FE-06) |
| FE-08 | Trang giới thiệu và các màn đăng nhập/xác minh/đặt lại | 23/10 |
| FE-09 | Tài khoản, Quản lý người dùng, Lịch sử | 27/10 |
| FE-10 | Cẩm nang, Chính sách, 404, rà soát tương phản và trợ năng toàn app | 28/10 |

- Ngừng thêm tính năng từ 29/10 (ROADMAP tuần 5).
- **Buổi thử W4-03 (22–28/10)** đo tỉ lệ plan dùng được qua giao diện. Nếu FE-05 chưa merge trước buổi thử thì W4-03 chạy trên giao diện hiện tại và báo cáo ghi rõ; không đổi giao diện giữa chừng một buổi đo.
- Nếu trễ, cắt theo thứ tự: FE-10 phần Cẩm nang/Chính sách → FE-09 phần Lịch sử → FE-08 trang giới thiệu (giữ trang hiện tại). FE-04, FE-05, FE-05b, FE-06, FE-07 là phần tối thiểu để demo.

## 12. Rủi ro

- Viết lại `Workspace`/`ChatContainer` dễ phá các bảo đảm bất đồng bộ đã sửa ở FE-02/FE-03b/W2-04/AUTH-05. Task FE-05 bắt buộc giữ các test đó xanh và thêm ca mới cho chuyển khoảnh khắc.
- Đổi chữ trên giao diện làm hỏng hàng loạt browser test; ước lượng thời gian sửa test vào mỗi task.
- Bản mẫu có chỗ nói quá đã được sửa trong các vòng review; khi thi công, mục 6 có hiệu lực cao hơn chữ trong bản mẫu.
