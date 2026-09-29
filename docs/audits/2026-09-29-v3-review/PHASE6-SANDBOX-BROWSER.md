# Phase 6 — Browser E2E trên sandbox và PostgreSQL

**Phạm vi:** Chromium headless → Vite web v3 → Express API v3 → PostgreSQL `ati_v3` trong container riêng. Trello, Slack và planner dùng adapter/provider sandbox có nhãn; không có thao tác SaaS thật.

**Lệnh đã chạy cục bộ (29/09/2026):** `npm run test:browser:v3` — 4/4 browser tests qua trong ba lượt server: mặc định 2, hỏi rõ 1, lỗi một phần 1. `npm run check` — 199/199 tests trong 6 workspace, build và launcher qua; thêm 3 kiểm tra bảo vệ DB cục bộ. Kết quả CI GitHub của nhánh được theo dõi trong [PR #2](https://github.com/VinhDat267/ATI_Project/pull/2).

| Luồng | Kiểm tra ở trình duyệt | Kiểm tra trong PostgreSQL |
|---|---|---|
| Duyệt và thực thi | Đăng nhập, gửi chat, xem plan, duyệt, thấy 3/3 bước xong | Plan `completed`; ba bước `succeeded` |
| Hủy | Hủy plan chờ duyệt | Plan `rejected` |
| Hỏi rõ tên | Tra cứu sandbox trả hai người tên Minh, hỏi người dùng, nhận lựa chọn và hiển thị plan | Message clarification được lưu cùng conversation |
| Lỗi một phần | Sandbox chặn Slack trước khi gửi bằng lỗi validation; UI cho bỏ qua | Bước thứ ba `failed` rồi `skipped`; plan `completed` |

`npm run test:browser:v3` sẽ chạy các kịch bản này từ tài khoản `CHAT_ADMIN_*` đã provision trong `.env`. CI dùng tài khoản thử riêng. Browser screenshots lưu trong thư mục kết quả test bị Git bỏ qua.

**Giới hạn nghiệm thu:** Kết quả trên xác nhận đường chạy browser/API/DB cho sandbox. Chưa có bằng chứng Gemini/Trello/Slack live, retry sau lỗi, xử lý lệnh ghi `UNKNOWN`, phục hồi sau crash hoặc chất lượng planner trên yêu cầu độc lập. Lỗi validation được chọn vì hệ thống biết chắc lệnh Slack chưa gửi; lỗi mạng sau khi gửi phải được đánh giá theo quy trình reconciliation riêng.
