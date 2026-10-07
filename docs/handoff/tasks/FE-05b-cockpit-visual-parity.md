# FE-05b · Cockpit: làm giống bản mẫu (khoảnh khắc 1–6, thanh trên, ô nhắn thêm, hai ngăn)

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/fe-05b-cockpit-visual-parity` · **Phụ thuộc:** FE-05 đã merge (#90), FE-04b đã merge · **Mốc:** 13/10/2026 (trước FE-06; dời từ 11/10 khi đổi cách làm 07/10). Được tách 2 PR: (a) thanh trên + khoảnh khắc 1–3 + mục 10; (b) khoảnh khắc 4–6 + ô nhắn thêm + hai ngăn + hộp xem trước
**Đặc tả:** mục 1, 1.1 và 1.2 (bản 07/10), 5, 6, 7 · **Nguồn:** `docs/design/prototypes/react/src/pages/AppStage/AppStagePage.tsx` và `page.css` (bản React của `app-stage.html`): thanh trên, khoảnh khắc 1–6, ô nhắn thêm ở đáy, ngăn "Lịch sử yêu cầu", ngăn "Nhật ký hội thoại", hộp "Xem trước nội dung"

## Vì sao quan trọng

FE-05 làm đúng hành vi của cockpit nhưng hình thức khác bản mẫu khá xa. Ngày 06/10/2026 người dùng chốt: **bản mẫu là chuẩn về hình thức**, app phải giống bản mẫu, chỉ được khác ở các điểm trong đặc tả mục 1.1. FE-06 dựng khoảnh khắc 7–9 trên cùng khung này, nên FE-05b phải xong trước.

**Đổi cách làm 07/10/2026:** người dùng chốt đưa thẳng bản React của bản mẫu vào app (đặc tả mục 1, bản 07/10). Cockpit của app trở thành trang `AppStage` của bản React với dữ liệu thật: giữ nguyên markup, class và cỡ chữ/màu của bản mẫu (Agentic như bản mẫu thể hiện), không đổi sang token suy ra của FE-04 hay nâng chữ lên 14px như bản 06/10 của task này.

Claude Code so bản mẫu với `main` `d5fcc46` ở sandbox, 1440×900 và 375×812, chế độ tối (06/10). Khác biệt lớn nhất:

| Chỗ | Bản mẫu | App hiện tại |
|---|---|---|
| Phần đầu trang ở 1440px | ~94px: thanh trên chứa luôn "Yêu cầu hiện tại" + dải thử nghiệm | ~250px: thanh trên 114px, thêm hàng 4 nút của cockpit, thêm hàng "Yêu cầu hiện tại" |
| Phần đầu trang ở 375px | ~110px | ~320px, `h1` bắt đầu ở gần giữa màn |
| Bề rộng | thanh trên giữa trang (`max-w-5xl`); nội dung 848px; khoảnh khắc 6 rộng 1120px | thanh trên tràn màn; nội dung 768px ở mọi khoảnh khắc |
| Khoảnh khắc 4 | thẻ từng việc + thông báo "ghi thật" + thanh hành động dính đáy | một thẻ lồng các bước, link gạch chân, ô nhập lớn ở đáy thay cho thanh hành động |
| Khoảnh khắc 6 | tiêu đề có dấu tích, chip thời gian, lưới 2×2 biên nhận nối nhau | danh sách dài theo dịch vụ, trường thô (Mã/Liên kết/Tên), "0.007s" |

## Hiện trạng

- `Cockpit.tsx` dựng cả 9 khoảnh khắc, hàng nút riêng, hàng "Yêu cầu hiện tại" và ô nhập; `AppShell.tsx` dựng thanh trên dùng chung cho mọi trang.
- `ExecutionReceipt.tsx`, `ExecutionProgress.tsx`, `ChatContainer.tsx` (chế độ `logOnly` trong ngăn hội thoại), `CockpitDialog.tsx` (hai ngăn và hộp xem trước).
- Gợi ý ở khoảnh khắc 1 và 6 lấy câu từ `assets/cockpit-services.json` theo dịch vụ đã thiết lập.
- Test FE-05 (selector, cockpit, ownership, 15 ca browser) tìm phần tử theo chữ và cấu trúc hiện tại.

## Việc cần làm

**Cách làm (đặc tả mục 1.2, bản 07/10):**
- chép `AppStagePage.tsx` và `page.css` của bản React sang app, tách thành component theo các đoạn trong bảng dưới (id của đoạn giữ như bản mẫu);
- giữ nguyên markup và class, kể cả tên `v3-*`, hậu tố `!` và ghi chú tại chỗ (ví dụ `hidden!` của nút "Xem hội thoại");
- bỏ JS demo (mô hình ảnh chụp, `setMoment` bằng phím 1–9, hẹn giờ giả, menu demo, `executionMode` giả); khoảnh khắc lấy từ `selectMoment`, nội dung lấy từ store/API;
- giữ các bảo đảm của FE-05 (phản hồi muộn gắn đúng hội thoại/kế hoạch/yêu cầu, một ô nhập, focus của ngăn và hộp thoại).

Chỉ được khác bản React ở các điểm trong đặc tả mục 1.1 (bản 07/10). Các mục dưới đây mô tả phần cần nối dữ liệu và những chỗ phải khác.

| Mục | Đoạn trong bản mẫu (cùng id trong `AppStagePage.tsx`) |
|---|---|
| 1 | `<header class="sticky …">` |
| 2–7 | `<section id="moment-1">` → `<section id="moment-6">` |
| 8 | `<footer id="global-bottom-bar">` |
| 9 | `<aside id="chat-drawer">`, `<aside id="history-drawer">`, `#preview-modal`, `#drawer-backdrop` |

1. **Thanh trên và dải thử nghiệm** (`AppShell` + cockpit):
   - khung giữa trang như bản mẫu; logo ô vuông cam chữ "A" kèm chữ "ATI" (ẩn chữ dưới 640px);
   - từ khoảnh khắc 2: nhãn "Yêu cầu hiện tại" và câu yêu cầu cắt một dòng nằm **trong** thanh trên. Câu đầy đủ vẫn đọc được (`title` và tên truy cập được);
   - nút "Lịch sử" (biểu tượng, thêm chữ từ 640px) mở ngăn lịch sử khi đang ở cockpit; ở trang khác giữ hành vi hiện tại;
   - nút "Xem hội thoại" nền tối, kèm số tin, hiện từ khoảnh khắc 2;
   - nút giao diện, avatar;
   - **bỏ hàng 4 nút** của cockpit và hàng "Yêu cầu hiện tại" riêng:
     - "Cuộc hội thoại mới" nằm ở đầu ngăn lịch sử và ở nút "Nhờ việc khác";
     - "Kết nối dịch vụ" nằm ở menu người dùng và link "Kết nối thêm" ở khoảnh khắc 1;
   - dải thử nghiệm như bản mẫu, chỉ hiện khi `runtimeMode` là sandbox (đặc tả 1.1 điểm 9).
   - Cockpit dùng thanh trên của bản React (`<header>` của `AppStagePage.tsx`); `AppShell` của FE-04 không dựng thanh trên ở route cockpit, để không có hai thanh. Menu người dùng (vai trò, tài khoản, đăng xuất) nối vào hành vi hiện có của `UserNavMenu`.
2. **Khoảnh khắc 1 · Nhờ việc:**
   - tiêu đề "Hôm nay bạn muốn nhờ việc gì?", bỏ dòng "ATI · Điều phối công việc"; dòng mô tả 18px;
   - ô nhập dạng thẻ: placeholder là một câu ví dụ; đáy thẻ có "Enter để gửi" và nút "Gửi yêu cầu →";
   - "Gợi ý việc phổ biến theo công cụ của bạn": lưới 2×2 (một cột ở 375px), mỗi thẻ có câu gợi ý và logo một hoặc hai dịch vụ. Nguồn dữ liệu theo đặc tả 1.1 mục 7;
   - đáy: "Đã kết nối:" các chip có logo, "Chưa kết nối:" danh sách chữ phụ, link "Kết nối thêm" (`/settings`) và "Cẩm nang & Mẫu câu lệnh" (`/guide`). Thay lưới 8 ô hiện tại;
   - chip của dịch vụ `unhealthy` hoặc `unchecked` hiện trạng thái bằng chữ và biểu tượng, không chỉ bằng màu (đặc tả mục 6).
3. **Khoảnh khắc 2 · Đang tìm đúng chỗ:**
   - thẻ đầu: nhãn nhỏ "Đang phân tích yêu cầu" và câu yêu cầu trong ngoặc kép làm `h1`;
   - thẻ thứ hai: chấm cam và "Tôi đang kiểm tra các tài nguyên liên quan", rồi danh sách tra cứu từ `gatherState` (biểu tượng đang tìm/đã thấy, tên tài nguyên đậm nếu có).
   - Không có dòng "Thường mất khoảng 3–5 giây" (chưa đo, đặc tả mục 6), không có nút "Xem kế hoạch đã lập". "Hủy yêu cầu này" chưa làm; FE-06 mục 7 có "Thôi chờ" cho trường hợp chờ lâu.
4. **Khoảnh khắc 3 · Hỏi lại:**
   - huy hiệu "Tôi cần bạn xác nhận thêm một thông tin"; câu hỏi của planner làm `h1`;
   - mỗi lựa chọn là một thẻ chọn (radio) có biểu tượng dịch vụ và tên; thẻ cuối "Để tôi gõ tên hoặc link khác" mở ô nhập tự do ngay trong thẻ;
   - không có lựa chọn thì hiện thẳng ô nhập tự do;
   - nút "Xác nhận và tiếp tục" gửi lựa chọn hoặc nội dung vừa gõ;
   - nút "Quay lại" đưa câu yêu cầu gốc vào ô nhập để sửa;
   - ô nhập ở đáy **ẩn** ở khoảnh khắc này (ô trong thẻ là ô nhập duy nhất, đặc tả mục 5);
   - không có dòng phụ "Cập nhật 2 giờ trước" hay nhãn "Khuyên dùng": API chỉ trả tên lựa chọn (đặc tả 1.1 mục 2).
5. **Khoảnh khắc 4 · Chờ duyệt:**
   - tiêu đề "Tôi sẽ làm N việc, theo thứ tự" (N từ plan) và dòng mô tả;
   - mỗi bước một thẻ: ô biểu tượng dịch vụ, chip tên dịch vụ, chip hành động ("Tạo mới", "Thêm dòng", "Gửi tin"…), "Việc n", mô tả đậm, "Đích đến: …" từ `resourceLabels`, nút viên "Xem trước" bên phải;
   - thông báo màu cảnh báo: thao tác ghi thật, không tự hoàn tác, kế hoạch giữ 30 phút;
   - **thanh hành động dính đáy** thay cho ô nhập ở khoảnh khắc này: "Duyệt kế hoạch ✓" lớn, "Sửa qua Chat", "Hủy", "Chi tiết kỹ thuật" ở bên phải;
   - "Sửa qua Chat" mở một ô nhập ngay trên thanh, vẫn chỉ một ô nhập.
6. **Khoảnh khắc 5 · Đang làm:**
   - tiêu đề "Đang thực hiện công việc", dòng mô tả, huy hiệu "Việc k/N";
   - thanh tiến độ = số bước đã xong / tổng số bước. Không tự chạy, không phần trăm giả (đặc tả mục 6);
   - mỗi bước một thẻ có chip trạng thái ("✓ Đã tạo", "Đang chạy", "Chờ"), bước đang chạy viền cam;
   - bước xong có link kết quả và thời lượng;
   - đáy thẻ: "Đang chạy tự động an toàn".
7. **Khoảnh khắc 6 · Xong:**
   - ô dấu tích xanh; tiêu đề "Đã xong N việc trên M công cụ" (đếm từ snapshot); chip "Trong x,y giây";
   - biên nhận dạng lưới 2×2 ở desktop, một cột ở 375px, khung rộng như bản mẫu. Mỗi thẻ có:
     - tên dịch vụ và loại kết quả;
     - chip "✓ Đã tạo thẻ" / "✓ Đã ghi dòng" / "✓ Đã gửi tin" theo tool, chỉ khi bước `succeeded`;
     - mã hoặc số từ output (ví dụ "Issue #42"), dòng phụ nơi ghi;
     - link "Mở … ↗".
   - mũi tên nối hai thẻ chỉ khi tham số của bước sau tham chiếu kết quả bước trước (`$ref`/`$template` trong plan đã duyệt); nhãn nối nói đúng trường được dùng;
   - "Cần sửa? Nhắn thêm với tôi…"; hàng "Tiếp theo:" dạng viên (nguồn theo đặc tả 1.1 mục 7) và nút "Nhờ việc khác";
   - trường kỹ thuật (tool, thời điểm, mã thô) thu vào "Chi tiết kỹ thuật", không hiện mặc định.
8. **Ô nhắn thêm ở đáy** (khoảnh khắc 2, 5, 6): ô một dòng dạng viên, placeholder "Nhắn thêm với tôi để sửa kế hoạch hoặc thêm chi tiết…", nút tối "Gửi →". Dùng `textarea` tự giãn để giữ Shift+Enter xuống dòng (test FE-03); ẩn ở khoảnh khắc 1, 3, 4 và khi ngăn hội thoại mở.
9. **Hai ngăn và hộp xem trước:**
   - nền phía sau tối mờ và nhòe như bản mẫu;
   - ngăn hội thoại:
     - tin người dùng bên phải, dòng "Bạn · giờ" ở trên;
     - tin ATI bên trái, dòng "ATI · giờ";
     - tin kế hoạch sẵn sàng/biên nhận có nền nhấn và **một dòng tóm tắt** (không chép JSON);
     - ô "Nhắn tiếp trong phiên này…" một dòng với nút tròn cam;
   - ngăn lịch sử: nút "Cuộc hội thoại mới" ở đầu.
10. **Chuyển khoảnh khắc** (chuyển từ FE-06 mục 9, vì FE-05b dựng lại vùng cuộn):
    - **P3 vị trí cuộn:** vùng nội dung giữ `scrollTop` của khoảnh khắc trước (kiểm FE-05: cuộn 93px để bấm Duyệt thì tiêu đề khoảnh khắc 5 và 6 bị khuất, ở cả 1440px và 375px). Mỗi lần khoảnh khắc đổi thì cuộn vùng nội dung về đầu;
    - **P3 focus:** nút "Duyệt kế hoạch" biến mất khi sang khoảnh khắc 5 và focus rơi về `body`. Khi khoảnh khắc đổi, focus vào `h1` mới (`tabIndex={-1}`), trừ khi người dùng đang gõ trong ô nhập hoặc đang ở trong ngăn/hộp thoại.
11. **Định dạng:** thời lượng kiểu Việt ("1,2 giây", "< 0,1 giây"), không "0.007s"; giờ theo máy người dùng như hiện tại.

## Tiêu chí nghiệm thu

- [ ] **Giống bản mẫu:** ảnh app và ảnh trang `/app-stage` của bản React đặt cạnh nhau cho thanh trên, khoảnh khắc 1–6, hai ngăn và hộp xem trước:
  - kích thước 1440×900 và 375×812, sáng và tối;
  - bản React chạy bằng `npm run dev` trong `docs/design/prototypes/react/`, chuyển khoảnh khắc bằng phím 1–9;
  - danh sách ảnh và SHA256 ghi trong log; ảnh không commit;
  - mọi khác biệt còn lại nằm trong đặc tả 1.1 hoặc ghi ở phần "Kết quả" kèm lý do.
- [ ] Đo bằng browser test: phần đầu trang (thanh trên + dải thử nghiệm) cao ≤ 100px ở 1440px và ≤ 120px ở 375px; không còn hàng nút riêng của cockpit; không cuộn ngang ở 375px.
- [ ] Test: ô nhập hiển thị đúng một cái ở mọi khoảnh khắc, kể cả khi mở "Sửa qua Chat", chọn "Để tôi gõ…" và mở/đóng ngăn hội thoại.
- [ ] Test: thanh tiến độ khoảnh khắc 5 bằng số bước xong / tổng; mũi tên nối ở khoảnh khắc 6 chỉ có khi plan có tham chiếu giữa hai bước; không có số issue/dòng trước khi bước chạy xong.
- [ ] Test và browser cho mục 10: cuộn xuống ở khoảnh khắc 4, bấm Duyệt → ở khoảnh khắc 5 và 6, `h1` nằm trọn trong vùng nhìn thấy và nhận focus; đang gõ trong ô nhập khi khoảnh khắc đổi thì focus vẫn ở ô nhập. Kiểm ở 1440px và 375px.
- [ ] Cỡ chữ, màu và khoảng cách giống bản React (không nâng lên 14px, không đổi sang token suy ra của FE-04). Test tương phản token của FE-04 cho cockpit được bỏ, ghi rõ trong PR (đặc tả 1.2 điểm 6).
- [ ] Các test FE-02, FE-03, FE-03b, W2-04, AUTH-05 và toàn bộ test FE-05 vẫn xanh: đổi cách tìm phần tử nếu cần, không bỏ ca.
- [ ] `npm run check` và `npm run test:browser:v3` exit 0.

## Ngoài phạm vi

Khoảnh khắc 7–9, màn từ chối/hỏi lại mở rộng, lỗi chung (FE-06, làm sau FE-05b theo cùng chuẩn giống bản mẫu). Các trang khác (FE-07 → FE-10). Không đổi `selectMoment`, store, API hay lời gọi duyệt/thực thi; thay đổi chỉ ở phần hiển thị.

## Kết quả

**Phần (a): đã thi công, chờ review PR; FE-05b toàn bộ chưa đóng.** Nhánh `feat/fe-05b-cockpit-parity-a`, base `7df8eacfbbdd686aeda632530b62f2ce3c606aee` (đã gồm #98 và #99), commit mã `7501a17b550b0b2652808d64451fd1ad0e7816aa`.

- Mục 1–4: cockpit dùng `usePrototypePage` / meta `app-stage`, CSS trang chép nguyên từ bản React; header, dải sandbox và khoảnh khắc 1–3 lấy dữ liệu từ store/API. AppShell chỉ bỏ ở route cockpit. Menu người dùng dùng lại UserNavMenu; “Cuộc hội thoại mới” ở đầu ngăn lịch sử, “Kết nối dịch vụ” ở menu.
- Mục 10: cuộn document về đầu khi đổi khoảnh khắc; focus h1 mới, giữ focus đang gõ và trong dialog. Browser kiểm ở 1440/375 và sáng/tối, gồm chuyển 4 → 5 → 6 và bắt đầu yêu cầu mới khi đang ở ô nhập.
- Một textarea ở khoảnh khắc 1–3, kể cả mở ngăn/ô tùy chọn. Radio chỉ chọn, nút xác nhận mới gửi; hỗ trợ phím mũi tên. Enter/Gửi trong ngăn luôn gửi draft vừa sửa. Giữ phản hồi muộn, Back/Forward, reload, focus trap/Esc và Shift+Enter qua các ca cũ được đổi selector.
- Không có dịch vụ thiết lập: hiện đúng câu hướng dẫn và link settings (đặc tả 1.1.5). Chip chưa kiểm tra/không kết nối được có chữ và biểu tượng; không có ước lượng, khuyến nghị hay giờ mẫu.
- `npm run check`: exit 0; frontend 438/438; các workspace v3 còn lại 47/340/196/25/349 đạt, evaluation 165/165; typecheck, build, kiểm bundle và launcher đạt.
- `npm run test:browser:v3`: exit 0; 61/61 qua 11 scenario (default 44, auth02 2, auth04 5, clarification 2, partial_failure 2, sáu scenario liên dịch vụ mỗi scenario 1). PostgreSQL tmpfs riêng ở 55533, sandbox, tài khoản CI; không dùng DB dev 15433.
- 24 ảnh nguồn/app + 12 ảnh đặt cạnh nhau; 1440×900 và 375×812, sáng/tối, khoảnh khắc 1–3. Danh sách SHA256 và khác biệt có lý do ở [nhật ký](../log/2026-10-07-FE-05b-cockpit-parity-a.md); ảnh nằm ngoài repo.
- Test FE-04 về font-weight nút cockpit và 40×40 ở ngăn chuyển thành kiểm dùng được/đo kích thước của prototype; settings/landing/login vẫn giữ assertion FE-04. FE-05 bỏ ngưỡng tương phản token riêng cho cockpit, vẫn đo màu/tỷ lệ và giữ kiểm focus/overflow. FE-04b Back/Forward kiểm scope app-stage thay scope cũ; màn chưa chuyển vẫn gỡ CSS prototype.
- Review nội bộ phát hiện hai P2 (thiếu trạng thái không có dịch vụ; Enter trong ngăn gửi radio cũ): có RED trước sửa, GREEN 13/13; reviewer kiểm lại 94/94 trong 6 file, không còn hồi quy đáng kể.

**Khác biệt được giữ:** dữ liệu API thay demo; không có dữ liệu thì không hiện cards/bước tìm/tên tài nguyên giả; trạng thái disabled theo thao tác thật; thẻ tùy chọn làm rõ mở sẵn để có đúng một textarea, dùng textarea thay input của demo để giữ Shift+Enter; logo dùng asset đã có, cỡ SVG/badge theo bản mẫu, nội dung gợi ý theo catalog đã thiết lập. Khoảnh khắc 2 chưa có gather step thì hiện “Đang đọc yêu cầu…”. Nút hủy yêu cầu/tới plan của demo bị bỏ vì không có thao tác tương ứng trong contract hiện tại; không giả lập hủy.

**Phần (b), mục 5–9 và 11, còn mở:** khoảnh khắc 4–6, ô nhắn thêm, hai ngăn, hộp xem trước và định dạng thời lượng vẫn FE-05; dùng typography/palette prototype cho cả cockpit. Composer còn nằm trong luồng document, khác composer fixed của demo. Chưa đạt visual parity cho các phần này. Không sửa CURRENT-STATE/ROADMAP, store, API, backend, selectMoment hay lời gọi duyệt/thực thi. Chưa merge; Claude Code review độc lập sau khi mở PR.
