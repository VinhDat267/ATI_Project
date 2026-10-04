# W3-00b · Giao diện cấu hình chung và câu từ chối nêu tên service

**Trạng thái:** xong, #71 merge tại `1200a3f` ngày 04/10/2026 · **Nhánh thi công:** `feat/w3-00b-frontend-and-refusal-naming` · **Phụ thuộc:** W3-00, FE-01 và FE-02 đã merge · Review độc lập đạt sau sửa P2, CI head `e60e4b3` xanh.

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

- [x] Test frontend: nhãn allowlist, tên hiển thị, placeholder lấy từ dữ liệu API (dùng một service giả trong test); ô `multiline` là `textarea` và che giá trị đã lưu.
- [x] Test planner: câu từ chối nêu đúng tên một hoặc nhiều service còn thiếu; câu không khớp service nào vẫn trả lời như cũ.
- [x] Bộ câu hồi quy định tuyến của W3-00 không đổi.
- [x] Test mới fail trước khi sửa (RED gốc W3-00b được kiểm chứng bằng negative controls tái dựng; RED mới P2 quan sát trực tiếp); `npm run check` exit 0; `npm run test:browser:v3` đạt hết.

## Kết quả (agent thi công điền)

- PR: [#71](https://github.com/VinhDat267/ATI_Project/pull/71), nhánh `feat/w3-00b-frontend-and-refusal-naming`, base `main` `54215a3`; đã merge tại `1200a3fcbdb73a6672f5074f76b553452dbeb0d5`, CI head `e60e4b3` SUCCESS. Review độc lập ban đầu bắt một P2 mất credentials mới khi phản hồi lưu cũ về; bản sửa đã được review lại đạt.
- Commit: planner test `ad9c3b7` → code `3a2a29b`; frontend test `4e6d6eb` → code `8acf3483b45b129d383fc9ccdefa0ead4cc6e1f1`. Hai test cũ đã đổi expectation nằm trong các commit code: `vietnamese-responses.test.ts` mong câu Telegram cụ thể; `settings.test.tsx` bổ sung `scopeLabel: 'Board ID'` và placeholder tương ứng.
- Test đã chạy và kết quả: log thi công ngày 04/10/2026 đã được root đối chiếu: `npm run check` exit 0, **1.232 v3 = 47 schema + 340 adapters + 188 planner + 25 executor + 331 API + 301 web**, **165 eval**, typecheck/build/credential scan/launcher và 8 fixture/env guard tests đạt. `npm run test:browser:v3` exit 0, **28/28 ca qua 11 scenario**, không có ca fail. Root chạy lại focused: **12/12 planner + 16/16 frontend**, exit 0; bao gồm hai test cũ ở trên. Bộ hồi quy routing không sửa; static guard bỏ ngoại lệ bảng tên service trong ReconciliationNotice. Bằng chứng và giới hạn xem [log bàn giao](../log/2026-10-04-codex-W3-00b-handoff.md).
- Sửa sau review: test `1a93321` → code `ce690c0099de7d745d9211a742c585a3533b0e4c`. `ServiceCard` dùng cập nhật state dạng hàm, chỉ bỏ trường còn bằng giá trị đã gửi; trường sửa trong lúc POST chờ được giữ. Test mới qua SettingsModal và HTTP native giữ response bằng gate: **RED 2 fail / 2 pass**, đúng lỗi mất draft textarea/password; **GREEN 4/4**, ba file liên quan **20/20**, exit 0. Giá trị đã gửi không đổi vẫn được xóa, bản nhập khi lưu lỗi và scope mới đều được giữ.
- Kiểm tra cuối sau sửa: `npm run check` exit 0, **1.236 v3 = 47 schema + 340 adapters + 188 planner + 25 executor + 331 API + 305 web**, **165 eval**, typecheck/build/credential scan/launcher/8 fixture và env guard tests đạt. `npm run test:browser:v3` exit 0, **28/28 qua 11 scenario**. Reviewer độc lập chạy lại **20/20** test liên quan và **9/9** probe HTTP, đối chứng nguồn trước sửa **1 fail đúng kỳ vọng**; P2 đã đóng, không phát hiện P1/P2 mới trong delta. Xem [log sửa sau review](../log/2026-10-04-codex-W3-00b-review-fix.md).
- Điều chưa làm hoặc khác với task card: output RED gốc của thi công W3-00b chưa thu hồi; review đã tái dựng negative controls từ các commit test trước implementation, không gọi đó là log gốc. RED mới của bản sửa P2 được chạy và lưu trước khi sửa. Model/golden/service thật **NOT_RUN**; không coi browser sandbox là nghiệm thu live. Giữ các blueprint có sẵn và LandingPage ngoài phạm vi. Secret đã lưu không đổi được xóa khỏi ô nhập; nội dung mới chưa gửi và input khi lưu lỗi được giữ. CI đúng head `e60e4b3` đã xanh trước merge #71. PostgreSQL tạm `w300b-pg` cũ đã dọn; DB dev15433 giữ nguyên. Reviewer cập nhật CURRENT-STATE/ROADMAP trong handoff sau merge.
