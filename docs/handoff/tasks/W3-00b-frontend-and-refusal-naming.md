# W3-00b · Giao diện cấu hình chung và câu từ chối nêu tên service

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/w3-00b-frontend-and-refusal-naming` · **Phụ thuộc:** W3-00 đã merge · **Không chặn** các task service; làm song song với W3-01 → W3-05 · **Phần giao diện làm sau FE-01 và FE-02** (FE-01 viết lại phần trạng thái dịch vụ trong `MissionControlLaunchpad.tsx`, FE-02 tách `App.tsx`)

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

- PR: [#71](https://github.com/VinhDat267/ATI_Project/pull/71), nhánh `feat/w3-00b-frontend-and-refusal-naming`, base `main` `54215a3`; chưa merge, chờ CI head bàn giao và review độc lập.
- Commit: planner test `ad9c3b7` → code `3a2a29b`; frontend test `4e6d6eb` → code `8acf3483b45b129d383fc9ccdefa0ead4cc6e1f1`. Hai test cũ đã đổi expectation nằm trong các commit code: `vietnamese-responses.test.ts` mong câu Telegram cụ thể; `settings.test.tsx` bổ sung `scopeLabel: 'Board ID'` và placeholder tương ứng.
- Test đã chạy và kết quả: log thi công ngày 04/10/2026 đã được root đối chiếu: `npm run check` exit 0, **1.232 v3 = 47 schema + 340 adapters + 188 planner + 25 executor + 331 API + 301 web**, **165 eval**, typecheck/build/credential scan/launcher và 8 fixture/env guard tests đạt. `npm run test:browser:v3` exit 0, **28/28 ca qua 11 scenario**, không có ca fail. Root chạy lại focused: **12/12 planner + 16/16 frontend**, exit 0; bao gồm hai test cũ ở trên. Bộ hồi quy routing không sửa; static guard bỏ ngoại lệ bảng tên service trong ReconciliationNotice. Bằng chứng và giới hạn xem [log bàn giao](../log/2026-10-04-codex-W3-00b-handoff.md).
- Điều chưa làm hoặc khác với task card: chưa có review độc lập/CI head bàn giao; output RED gốc chưa thu hồi, chỉ xác minh thứ tự test commit trước implementation. Model/golden/service thật **NOT_RUN**; không coi browser sandbox là nghiệm thu live. Giữ các blueprint có sẵn và LandingPage ngoài phạm vi. Secret multiline được xóa khỏi ô nhập sau lưu thành công, không hiển thị lại giá trị đã lưu; lưu lỗi giữ bản nhập. PostgreSQL tạm `w300b-pg` đã dọn sau khi lưu log, DB dev15433 giữ nguyên. CURRENT-STATE/ROADMAP để reviewer cập nhật sau merge.
