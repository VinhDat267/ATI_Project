# W3-00b · Giao diện cấu hình chung và câu từ chối nêu tên service

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/w3-00b-frontend-and-refusal-naming` · **Phụ thuộc:** W3-00 đã merge · **Không chặn** các task service; làm song song với W3-01 → W3-05

## Mục tiêu

Hoàn tất phần W3-00 tách ra: frontend không còn viết cố định theo service, và khi người dùng nhắc tới một service chưa kết nối, câu từ chối nói rõ service nào.

## Việc cần làm

1. **Frontend:**
   - Nhãn allowlist trong `SettingsModal.tsx` lấy `scopeLabel` từ `GET /api/services`, bỏ bảng `{ boards, channels, repos }`.
   - Tên hiển thị service trong `ReconciliationNotice.tsx` lấy từ danh sách service của API (tra theo tiền tố tên tool), bỏ bảng `{ trello, slack, github }`.
   - Placeholder trong `MissionControlLaunchpad.tsx` dựng từ danh sách service.
   - Ô credentials `multiline` hiển thị `textarea`; khi đã lưu vẫn che giá trị như ô `password`.
   - Trang giới thiệu (`LandingPageView.tsx`) không thuộc task này.
   - Xóa các mục tương ứng khỏi danh sách ngoại lệ của kiểm tra tĩnh (W3-00).
2. **Câu từ chối nêu tên service:**
   - Router trả thêm danh sách service bị chặn vì chưa cấu hình, ví dụ hàm mới `routeIntent` trả `{ services, unavailable }`. Giữ `classifyIntent` (đang được test và các script audit dùng) như một lớp bọc trả `services`.
   - Hai chỗ gọi trong `planner.ts` (dòng ~305 và ~385) dùng `unavailable` để câu từ chối nêu `name` của service, ví dụ "Google Calendar chưa được kết nối hoặc chưa có tài nguyên được phép".
   - Chính sách không đổi: câu khớp service chưa cấu hình thì vẫn từ chối, không chuyển sang service khác.

## Tiêu chí nghiệm thu

- [ ] Test frontend: nhãn allowlist, tên hiển thị, placeholder lấy từ dữ liệu API (dùng một service giả trong test); ô `multiline` là `textarea` và che giá trị đã lưu.
- [ ] Test planner: câu từ chối nêu đúng tên một hoặc nhiều service còn thiếu; câu không khớp service nào vẫn trả lời như cũ.
- [ ] Bộ câu hồi quy định tuyến của W3-00 không đổi.
- [ ] Test mới fail trước khi sửa; `npm run check` exit 0; `npm run test:browser:v3` đạt hết.

## Kết quả (agent thi công điền)

- PR:
- Commit:
- Test đã chạy và kết quả:
- Điều chưa làm hoặc khác với task card:
