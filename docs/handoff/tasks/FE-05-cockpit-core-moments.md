# FE-05 · Cockpit: khoảnh khắc 1–6, ngăn hội thoại, ngăn lịch sử

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/fe-05-cockpit-core` · **Phụ thuộc:** FE-04 đã merge · **Mốc:** 16/10/2026 (trước buổi thử W4-03)
**Đặc tả:** mục 5, 6, 7 · **Bản mẫu:** `app-stage.html` khoảnh khắc 1–6, ngăn "Lịch sử yêu cầu", ngăn "Nhật ký hội thoại", hộp "Xem trước nội dung"

## Vì sao quan trọng

Đây là luồng chính người chấm sẽ thấy: gõ một câu → ATI tìm đúng chỗ → duyệt → chạy → biên nhận có link. Giao diện chat hiện tại trộn mọi thứ vào một dòng tin nhắn; cockpit cho thấy đúng một việc cần làm mỗi lúc.

## Hiện trạng

- `Workspace` + `ChatContainer` hiển thị tin nhắn, `GatherProgress`, `ClarificationCard`, `PlanPreview`, `ExecutionProgress` nối tiếp trong một luồng chat; `MissionControlLaunchpad` là màn trống ban đầu.
- Store (`chat-store`) đã có đủ trạng thái: `isPlanning`, `gatherState`, `activeClarification`, `activePlan`, `planStatus`, `stepStatuses`, `executionSnapshot`.
- Các bảo đảm bất đồng bộ đã có test: FE-02 (route/Back), FE-03b (gửi tin sau "Cuộc hội thoại mới"), W2-04 (snapshot khi mở lại), AUTH-05 (phản hồi muộn).

## Việc cần làm

1. **Bộ chọn khoảnh khắc** thuần (`selectMoment(state, snapshot)`) theo bảng đặc tả mục 5. Component cockpit chỉ đọc kết quả này; không có nút "Kịch bản demo".
2. **Khoảnh khắc 1 · Nhờ việc:**
   - ô nhập lớn (`textarea`, Enter gửi, Shift+Enter xuống dòng, khoá khi đang lập kế hoạch);
   - gợi ý việc theo các dịch vụ **đã thiết lập** (lấy từ `GET /api/services`), có logo SVG;
   - hàng dịch vụ đã kết nối và chưa kết nối, link "Kết nối thêm" tới `/settings`.
3. **Khoảnh khắc 2 · Đang tìm đúng chỗ:** dựng từ `gatherState.steps` (tên dịch vụ + logo + câu tiếng Việt), không dùng tên tool kỹ thuật làm nhãn chính; chưa có `gatherState` thì hiện "Đang đọc yêu cầu…".
4. **Khoảnh khắc 3 · Hỏi lại** (bản đơn giản cho câu hỏi chọn tài nguyên): câu hỏi, các lựa chọn dạng nút, ô trả lời tự do là **ô nhập chính**. Các biến thể từ chối/chỉ để xem thuộc FE-06.
5. **Khoảnh khắc 4 · Chờ duyệt:**
   - mỗi bước: logo dịch vụ, mô tả, nơi ghi (dùng `resourceLabels`), nhãn "Tạo mới"/"Cập nhật";
   - "Xem trước" mở hộp nội dung sẽ ghi (tiêu đề, nội dung, đích);
   - nút chính "Duyệt kế hoạch", nút phụ "Sửa qua chat", "Huỷ";
   - "Chi tiết kỹ thuật" thu gọn chứa JSON;
   - chưa có bước nào ghi số issue/dòng (đặc tả mục 6).
6. **Khoảnh khắc 5 · Đang làm:** danh sách dọc từng bước với trạng thái và thời lượng; bước đang chạy có chỉ báo; không có thanh % giả.
7. **Khoảnh khắc 6 · Xong:** biên nhận theo dịch vụ, link chỉ `http`/`https`, mở tab mới `rel="noopener noreferrer"`; thời gian tổng; hai gợi ý việc tiếp theo và nút "Nhờ việc khác". Không ghi "đã xác nhận" cho kết quả không đọc lại.
8. **Ngăn hội thoại** (bên phải) và **ngăn lịch sử** (bên trái): `role="dialog"`, giữ focus, Esc đóng, trả focus. Ngăn lịch sử dùng lại `SidebarHistory` (tìm kiếm, đổi tên, tải thêm của FE-02). **Chỉ một ô nhập chat hiển thị một lúc.**
9. Thanh trên hiện "Yêu cầu hiện tại" từ khoảnh khắc 2 trở đi; ẩn ở khoảnh khắc 1.

## Tiêu chí nghiệm thu

- [ ] Test `selectMoment` cho đủ các dòng của bảng đặc tả mục 5, kể cả thứ tự ưu tiên (ví dụ có bước `unknown` thì là 8 dù `planStatus` là `executing`).
- [ ] Test: chỉ một ô nhập chat hiển thị ở mọi khoảnh khắc, khi mở/đóng ngăn hội thoại.
- [ ] Test phản hồi muộn: plan của hội thoại A về sau khi người dùng đã chuyển sang hội thoại B → cockpit của B không đổi khoảnh khắc.
- [ ] Test: kế hoạch chưa chạy không hiện số issue/dòng; biên nhận có link bấm được chỉ với `http`/`https`.
- [ ] Các test FE-02, FE-03, FE-03b, W2-04, AUTH-05 hiện có vẫn xanh (đổi cách tìm phần tử nếu cần, không bỏ ca).
- [ ] Browser: luồng sandbox gõ → duyệt → biên nhận chạy được ở cả chế độ sáng và tối, ở 1440px và 375px; không cuộn ngang ở 375px.
- [ ] `npm run check` và `npm run test:browser:v3` exit 0.

## Ngoài phạm vi

Khoảnh khắc 7–9, màn từ chối/hỏi lại mở rộng, mất mạng/hết phiên (FE-06). Trang `/history` đầy đủ (FE-09).

## Kết quả

_(agent thi công điền)_
