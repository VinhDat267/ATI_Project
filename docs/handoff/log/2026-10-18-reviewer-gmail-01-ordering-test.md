# 18/10/2026 · Sửa test GMAIL-01 chập chờn (thứ tự lưu kết nối và đăng xuất)

**Người viết:** reviewer (nhóm trưởng giao thi công) · **Nhánh:** `test/gmail-01-ordering-flake`, base `3c950db`. Không có task card riêng: CURRENT-STATE mục 5 ghi lỗi này và đề nghị sửa bằng một PR nhỏ.

## Vấn đề

Test `orders %s after the save, never between its check and insert` (`apps/chat-api/tests/db/gmail-connection-repo.test.ts`, hai ca `logout` và `disable`) giữ bất biến của GMAIL-01: đăng xuất hoặc khoá tài khoản không được lọt vào giữa lúc lưu kết nối Gmail kiểm phiên và lúc ghi.

Test cũ suy ra thứ tự commit trong PostgreSQL bằng mốc `performance.now()` lúc hai promise trả về (`loggedOutAt > savedAt`). Nhưng promise của `saveConnection` còn qua COMMIT, `finally` và `release`, nên có thể về sau promise của lệnh `UPDATE` đăng xuất, dù trong DB thứ tự vẫn đúng. Lỗi này đã gặp 9 lần ở máy người chạy, lệch 0,06–0,31 ms.

## Đã sửa (chỉ test)

- Đọc thứ tự từ PostgreSQL:
  - phần lưu dừng ở `DELETE` (sau bước kiểm phiên) vì một client khác giữ dòng credential;
  - test lấy `pg_backend_pid()` của kết nối đăng xuất, gửi lệnh đăng xuất hoặc khoá, rồi chờ tới khi `pg_blocking_pids(<pid đăng xuất>)` chứa pid của phần lưu. Lệnh đăng xuất đang chờ đúng transaction lưu kết nối, nên chỉ chạy được sau khi transaction đó kết thúc;
  - thả client giữ dòng; phần lưu phải trả về kết nối mới, rồi lệnh đăng xuất hoặc khoá mới xong.
- Bỏ lần chờ cố định 400 ms. Bỏ nhánh "lưu thất bại": khi lệnh đăng xuất đang chờ phần lưu, phần lưu luôn đã qua bước kiểm.
- Kiểm thêm trạng thái cuối: kết nối là `v1:new`; phiên đã bị thu hồi (ca `logout`) hoặc tài khoản đã bị khoá (ca `disable`).
- `finally` luôn `ROLLBACK` client giữ dòng trước khi trả về pool. Trước đây, khi một assertion fail, client này về pool mà transaction vẫn mở và còn giữ khoá dòng credential, nên ca tiếp theo cũng fail (thấy khi chạy đột biến bên dưới).

Không sửa mã sản phẩm.

## Kiểm thử

PostgreSQL 16 tmpfs riêng ở 55533. Mỗi file bị đổi tạm đều được khôi phục và kiểm SHA-256.

- File test: 16/16.
- **Tái hiện nguyên nhân:**
  - cho `saveConnection` trả về chậm 300 ms sau COMMIT (thứ tự trong DB không đổi), như khi `release` hoặc event loop chậm;
  - test cũ lấy từ `origin/main`: **2/2 fail** mỗi lần chạy;
  - test mới: **2/2 đạt**.
- **Test mới vẫn giữ bất biến:**
  - bỏ `FOR UPDATE OF s` (khoá phiên) thì ca `logout` fail;
  - bỏ `FOR UPDATE` của `users` thì ca `disable` fail;
  - mỗi đột biến chỉ làm fail đúng ca của nó.
- **Lặp:** hai ca chạy lại 20 lần, **20/20** đạt.
- `npm run check` (sandbox, hai cờ tắt, không dùng `.env`): **exit 0** ngay lượt đầu, **2.014 v3** (63 + 408 + 291 + 42 + 465 + 745) **+ 332 eval**. Số test không đổi vì chỉ sửa nội dung một test.

## Sửa theo review #156

[Review độc lập](https://github.com/VinhDat267/ATI_Project/pull/156#issuecomment-6245561734) tại `b388e03`: chưa đạt, 1 P2. `waitingPid()` chọn PID chỉ theo câu lệnh `DELETE` đang chờ khoá trong `pg_stat_activity`. Một tiến trình ở schema khác, ví dụ một file test chạy song song, chờ đúng câu đó thì có thể bị chọn nhầm, làm cả hai ca fail dù mã sản phẩm giữ khoá đúng.

- Mỗi ca nay dựng sẵn một **tiến trình mồi**: một schema riêng có bảng `service_credentials`, một client giữ dòng, và một client khác gửi đúng câu `DELETE` và bị chặn. Sau ca thì dọn hết.
- `waitingPid()` chỉ nhận PID đang bị **chính client giữ dòng của test** chặn: `$1 = ANY(pg_blocking_pids(pid))` với PID của client đó.

Kiểm thử:
- **RED:** có tiến trình mồi, `waitingPid()` cũ fail **2/2**, ổn định qua 3 lượt. Lý do đúng là lấy nhầm PID: `expected [ 121 ] to include 123`. Ở ca `logout`, lệnh đăng xuất còn được gửi trước khi phần lưu kịp khoá phiên (`expected [] to include 118`).
- **GREEN:** `waitingPid()` mới, file test **16/16**; typecheck `apps/chat-api` exit 0.
- **Chạy lại phần chứng minh:**
  - phần lưu trả về chậm 300 ms: test cũ 2/2 fail, test mới 2/2 đạt;
  - bỏ khoá phiên: chỉ ca `logout` fail; bỏ khoá `users`: chỉ ca `disable` fail;
  - lặp **20/20**.
- `npm run check` (sandbox, hai cờ tắt, không dùng `.env`): **exit 0** ngay lượt đầu, **2.014 v3 + 332 eval**.
