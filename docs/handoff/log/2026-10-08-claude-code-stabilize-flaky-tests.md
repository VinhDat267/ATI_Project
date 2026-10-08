# 2026-10-08 · claude-code · Sửa ba test chập chờn và cổng DB mặc định của test `chat-api`

- **Đã làm:** người dùng giao trong lúc chờ W3-10 sửa. Không có task card; các mục lấy từ CURRENT-STATE mục 5 (hàng "Test chập chờn" và hàng "Test chat-api mặc định `DATABASE_URL` tới cổng 55532").
  - `apps/chat-web/tests/account-action-regressions.test.tsx`: phần "Phương thức đăng nhập" của `AccountView` chỉ hiện khi `googleEnabled` lấy từ `/api/auth/config`, một request riêng với `/api/account`. `openAccount()` chỉ chờ dữ liệu tài khoản, nên khi `/api/auth/config` về sau thì `getByRole('button', { name: 'Gỡ liên kết' })` không thấy nút (lỗi trên CI run 37632679206 ngày 07/10). Sửa: `openAccount()` chờ thêm tiêu đề "Phương thức đăng nhập". Server giả trong test cho `/api/auth/config` trả về chậm 50 ms, để thứ tự gây lỗi luôn xảy ra thay vì tuỳ may rủi.
  - 12 file test `apps/chat-api/tests/**`: giá trị mặc định khi không đặt `DATABASE_URL` là `postgresql://wap:wap@127.0.0.1:55532/ati_v3` (DB của compose v2 đã xoá ở #80). Đổi sang DB local chuẩn `postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3`, khớp `scripts/v3-local-env.mjs`. CI vẫn đặt `DATABASE_URL` nên không đổi. `scripts/v3-local-env.test.mjs` dùng 55532 làm ví dụ URL bị từ chối, giữ nguyên.
  - `apps/chat-api/tests/auth/auth-sessions.test.ts`: ca `provisions both a new and an existing administrator…` chạy CLI hai lần bằng `node --import tsx`, nhưng chỉ có thời gian chờ mặc định 5 giây. Đặt 30 giây.
  - `apps/chat-api/tests/integration/startup-reconciliation.test.ts`: mỗi ca khởi động API bằng `tsx`; chờ API sẵn sàng tối đa 10 giây, cả ca 15 giây. Đổi thành hằng `PROCESS_START_MS = 30_000` (chờ tiến trình, kể cả chờ tiến trình thoát) và `API_TEST_TIMEOUT_MS = 45_000` (mỗi ca). Không assertion nào dựa vào việc hết giờ sớm.
  - Hai test `chat-api` hết giờ khi review #103 (máy đang chạy Antigravity và Orca của agent khác; bước import của vitest mất 84 giây); chạy lại thì đạt.
- **PR / commit:** nhánh `test/stabilize-flaky-tests`, worktree riêng từ `main` `564b6cb`.
- **Kiểm tra đã chạy (lệnh và kết quả):**
  - RED test tài khoản (server giả trả `/api/auth/config` chậm 50 ms, `openAccount()` cũ): `npx vitest run tests/account-action-regressions.test.tsx` → 1 failed / 8 passed, đúng thông báo của CI "Unable to find … Gỡ liên kết". GREEN sau sửa: 9/9, chạy 5 lần đều 9/9.
  - RED cổng mặc định (PostgreSQL tạm ở 55533, không đặt `DATABASE_URL`): `tests/auth/auth-migration.test.ts` → `connect ECONNREFUSED 127.0.0.1:55532`. GREEN sau sửa: 1/1.
  - Hai file `auth-sessions.test.ts` và `startup-reconciliation.test.ts` không đặt `DATABASE_URL`: 36/36. Hai ca hết giờ không tái hiện được một cách chắc chắn (phụ thuộc tải máy); bằng chứng là log lỗi ngày 08/10.
  - `npm run check` (PostgreSQL tạm tmpfs ở 55533, sandbox, tài khoản test của CI): exit 0, v3 1.432 = 47 + 340 + 196 + 25 + 349 + 475, eval 165.
  - Không chạy browser E2E: PR chỉ đổi test unit/integration, không đổi mã sản phẩm hay test browser.
- **Chưa làm / vấn đề phát hiện:** ca browser `FE-04: retained landing comparison copy … light` (hết 30 giây chờ trang giới thiệu một lần) chưa rõ nguyên nhân, chưa sửa. PR này chỉ Claude Code tự kiểm, nên có người khác xem lại.
- **Việc tiếp theo đề xuất:** merge khi người dùng đồng ý; ghi vào CURRENT-STATE mục 5 ở lần cập nhật sau merge.
