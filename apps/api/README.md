# `@wap/api`

API HTTP local của MVP B. API-01 cung cấp một boundary chạy trên `127.0.0.1`, đăng nhập một tài khoản demo duy nhất, bearer session trong bộ nhớ và `GET /api/v1/servers`. Các route run vẫn trả `501 NOT_IMPLEMENTED` cho tới khi API-02 nối queue/engine.

## Cấu hình bắt buộc

Không có mật khẩu hay secret mặc định trong mã nguồn. Trước khi chạy cần đặt:

- `G1_DATABASE_URL`: PostgreSQL của workspace.
- `API_DEMO_EMAIL`: email tài khoản demo đã seed trong database.
- `API_DEMO_PASSWORD_HASH`: chuỗi scrypt theo định dạng `scrypt$16384$8$1$<salt-hex-32>$<key-hex-128>`.
- `API_CURSOR_KEY`: khóa 32 byte ở dạng base64 chuẩn (dùng cho cursor ở các đợt sau).

Tuỳ chọn: `API_PORT` (mặc định `3001`), `API_SESSION_TTL_MS` (mặc định 8 giờ), `G1_USER_ID`, và `API_PLANNER_MODE` (`disabled` hoặc `dev_fixture`). Tạo hash/key trong một phiên shell riêng hoặc secret manager; không truyền mật khẩu như command-line argument.

## Lệnh

Từ root workspace:

```text
npm run build -w @wap/api
npm run test:unit -w @wap/api
npm run test:integration -w @wap/api
npm run api:dev
```

Integration test tự tạo database tạm trong PostgreSQL local và xoá database đó khi kết thúc. API chỉ bind loopback; mọi request trả `x-request-id`, JSON strict và `Cache-Control: no-store`.
