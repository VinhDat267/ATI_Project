# Môi trường v3 cục bộ (PostgreSQL thật, sandbox)

Hướng dẫn này dành cho một checkout mới. Container v3 dùng project Docker `ati-v3`, volume `v3_pgdata` và cổng loopback `55533`; stack v2/G1 ở `55532` không bị dùng chung. Chế độ `sandbox` không gọi Gemini, Trello hoặc Slack thật.

## 1. Chuẩn bị

Cần Node.js >= 22.12, npm và Docker Compose. Tại thư mục gốc repo:

```powershell
npm ci
npm run db:up:v3
Copy-Item .env.example .env
```

Trong `.env` (file cục bộ bị Git bỏ qua), giữ `RUNTIME_MODE=sandbox` và sửa các dòng v3 thành:

```dotenv
DATABASE_URL=postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3
CHAT_ADMIN_EMAIL=admin@localhost.test
CHAT_ADMIN_PASSWORD=<mat-khau-cuc-bo-it-nhat-12-ky-tu>
```

Thay placeholder mật khẩu bằng giá trị riêng, không commit hoặc đưa vào log. Nếu `.env` đã tồn tại, chỉ sửa các dòng cần thiết; không ghi đè file. `SANDBOX_USER_EMAIL/PASSWORD` chỉ dành cho sandbox **không có DB**; tài khoản DB dùng `CHAT_ADMIN_*` ở bước tiếp theo.

## 2. Migrate và tạo tài khoản

```powershell
npm run db:migrate:v3
npm run admin:provision:v3
```

Migration có thể chạy lại. Lệnh provision tạo tài khoản mới; chỉ chạy một lần cho cùng email. Sau đó đăng nhập web bằng `CHAT_ADMIN_EMAIL` và `CHAT_ADMIN_PASSWORD`. Nếu tạo thêm tài khoản, dùng email khác trong `.env` rồi chạy lại provision. Không dùng cơ sở dữ liệu v2 hoặc dữ liệu production cho các lệnh này.

## 3. Kiểm tra và chạy

```powershell
npm run check
npm run up
```

Mở `http://127.0.0.1:5174`, API health ở `http://127.0.0.1:3000/api/health`. Dừng API/web bằng Ctrl+C. `npm run db:down:v3` dừng container và **giữ volume dữ liệu**. Bộ test tích hợp tạo dữ liệu thử trong `ati_v3`; dùng database dùng một lần cho CI. CI khai báo ở `.github/workflows/v3-check.yml` và tự chạy migration trước test.

Các lệnh trên chứng minh khả năng chạy sandbox với PostgreSQL cục bộ. Nghiệm thu production/live vẫn cần kiểm tra credentials, provider, Trello/Slack và phục hồi sau crash theo Phase 6.
