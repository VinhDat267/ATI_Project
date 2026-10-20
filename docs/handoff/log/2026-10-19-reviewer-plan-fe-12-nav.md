# 19/10/2026 · Lập kế hoạch FE-12: thanh điều hướng chung

**Người viết:** reviewer. Nhóm trưởng hỏi ngày 18/10: "hiện tại giao diện UI/UX frontend đang thiếu navigation ở nav bar liệu có nên thêm vào đó không". **Nhánh:** `docs/fe-12-nav-bar`, base `a8383e0`. Chỉ sửa tài liệu.

## Hiện trạng đã đọc trong mã

Trên `main` `a8383e0`:
- **Cockpit** (`apps/chat-web/src/pages/Cockpit/CockpitHeader.tsx`): logo, khối "Yêu cầu hiện tại", nút "Lịch sử" (ngăn hội thoại), "Xem hội thoại", nút sáng/tối và avatar. Không có link sang trang khác.
- **Sáu trang con:** Nhật ký, Kết nối dịch vụ, Tài khoản, Người dùng, Cẩm nang, Chính sách an toàn. Mỗi trang có nút "← Về không gian làm việc" và một bộ link chéo khác nhau (bảng trong task card). Link chéo bị ẩn dưới 768 px, một số dưới 1024 px.
- **Không có `aria-current`** ở trang nào.
- **Menu avatar** (`UserNavMenu.tsx`) có đủ 7 mục ở mọi trang.
- **Câu yêu cầu hiện tại** chỉ có trong nội dung ở một số màn: khoảnh khắc 2, `ResponseCard`, lỗi lập kế hoạch. Các khoảnh khắc 3–9 chỉ có nó trên thanh trên.

## Quyết định của nhóm trưởng

Reviewer dựng mockup trong trình duyệt (ở máy nhóm trưởng, không commit) với ba phương án:
- A: giữ bản mẫu, chỉ làm link chéo cho đều;
- B: một thanh chung cho mọi trang;
- C: như A, cockpit thêm ba nút biểu tượng.

Nhóm trưởng chọn và chỉnh theo thứ tự:
1. Chọn **B**.
2. "hãy căn giữa": các tab căn giữa thanh.
3. "tự nhiên có thêm dòng ở dưới là yêu cầu hiện tại tôi thấy nó không hợp lý và không tốt": bỏ dòng phụ dưới thanh.
4. Khi được hỏi đặt câu yêu cầu ở đâu: "cần nhìn lại câu mình đã gõ ngay trên màn". Chọn dòng "Bạn nhờ: “…”" ngay trên tiêu đề của khoảnh khắc.
5. Duyệt bản tóm tắt ("ok").

## Điểm reviewer tự đặt

Nhóm trưởng đã xem các điểm này trong bản tóm tắt trước khi trả lời "ok":
- danh sách và thứ tự tab; Tài khoản, Chính sách an toàn chỉ trong menu avatar;
- bỏ nút "← Về không gian làm việc" và nhãn vai trò;
- rút gọn chữ trên tab ở 768–1279 px; ẩn tab dưới 768 px;
- trang chưa đăng nhập giữ như cũ.

Sau khi nhóm trưởng duyệt, khi viết task card, reviewer tự đặt thêm:
- 404, Landing, các trang xác thực và `NotFoundView` ngoài phạm vi. Trang 404 có test so với bản mẫu từ FE-04b;
- không sửa `page.css`, vì `fe-07-settings.test.tsx` giữ `Settings/page.css` bằng bản mẫu từng byte;
- bản mẫu trong `docs/` không sửa theo, ghi thành ngoại lệ của đặc tả mục 1.2 điểm 4;
- dòng "Bạn nhờ": tối đa 2 dòng, toàn văn trong DOM; lấy câu từ cùng nguồn với thanh hiện nay;
- test chống chồng lấn ở 1280 và 1024 px, vì khung `max-w-5xl` có thể không đủ chỗ.

## File đã sửa

- Thêm [`tasks/FE-12-shared-nav-bar.md`](../tasks/FE-12-shared-nav-bar.md).
- `docs/superpowers/specs/2026-10-05-ui-redesign-agentic-design.md`: mục 1.1 thêm điểm 10, mục 4 ghi chú FE-12.
- `ROADMAP.md`: dòng FE-12 và đoạn "Cập nhật 19/10 (FE-12)".
- `CURRENT-STATE.md` mục 7: "Chốt 19/10/2026".

## Chưa làm

- Nhóm trưởng giao reviewer thi công (19/10), trên nhánh riêng sau PR này.
- Chưa có mã hay test.
- Mockup chỉ ở máy nhóm trưởng.
