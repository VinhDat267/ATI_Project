# AUTH-07 · kiểm mật khẩu thật khi gỡ Google

- Ngày: 09/10/2026 Asia/Saigon. Task: [AUTH-07](../tasks/AUTH-07-google-unlink-password.md).
- Worktree: `C:/Users/VinhDat/orca/workspaces/ATI_Project/auth-google-unlink-password`; nhánh `fix/auth-google-unlink-password`; base `129d9c0b20f1d3afa087cdc0aec8383c381008f7`.
- Code commits: `fe9914f54ac12054e3df0218b9ccf5c57f66bf2e`, `be9417da011bfc3a5be935f7d226a6bfe00329fa`. Parent làm review độc lập, tạo PR và kiểm exact-head CI; chưa merge.
- Đọc task, AGENTS, CURRENT-STATE/README, REVIEW-CHECKLIST, ba log ngày mới nhất, AUTH-common/AUTH-04/05; worktree không có `.codegraph` nên không khởi tạo index. `npm ci` riêng. Các checkout FE-08/09 độc lập; không sửa thay đổi người dùng hoặc CURRENT-STATE/ROADMAP.
- [Kế hoạch](../../superpowers/plans/2026-10-09-auth-07-google-unlink-password.md); TDD, systematic-debugging, receiving-code-review và verification-before-completion.

## Thay đổi

`routes/auth/google.ts` yêu cầu current password là chuỗi không rỗng, tối đa 128 ký tự; không áp minimum của mật khẩu mới lên mật khẩu cũ. `verifyPassword` kiểm hash thật. Sai mật khẩu trả 400 để giữ phiên, dùng chung `LoginFailures` với login/đổi mật khẩu; 429 kèm `Retry-After`. Input sai hình thức không dùng hạn mức.

`GoogleAuthRepo.unlink(userId, sessionId, expectedPasswordHash, clock)` lấy khóa user rồi session trong transaction, kiểm lại active user, session còn mở/còn hạn và password hash trước khi xóa `google_sub`/`google_email`. Clock được đọc sau cả hai khóa để không dùng thời điểm trước lúc chờ. Password vừa đổi trả 409 `PASSWORD_CHANGED_ELSEWHERE`; không có password vẫn 409 `PASSWORD_REQUIRED`. Session-creation guard theo Google sub được giữ. Main không có provider marker/revocation riêng cho phiên Google; giữ quy tắc quản lý phiên thực tế, không thêm schema hay semantics mới.

Web chỉ cập nhật contract `unlinkGoogle(currentPassword: string)` và caller cũ có form mật khẩu được che, chặn rỗng, xóa khi hủy/thành công. Protected transport và các probe AUTH-05 refresh/late response/uncertain mutation được giữ. Browser AUTH-05 dùng mật khẩu thật của tài khoản fixture. FE-09 đưa caller prototype vào nhánh phụ thuộc backend này; AUTH-07 không đưa hình thức prototype vào diff.

## Bằng chứng thực tế

Log ngoài repo: `C:/Users/VinhDat/AppData/Local/Temp/ati-auth07-2026-10-09/`.

| Lệnh / bước | Kết quả | Log |
|---|---|---|
| Baseline workspace đúng config, AUTH-04/05 API | 34/34, exit 0 | `baseline-api.txt` |
| Baseline web | 59/59, exit 0 | `baseline-web.txt` |
| HTTP + PostgreSQL AUTH-07 trước sửa | 5 fail / 8 pass, exit 1 | `red-api.txt` |
| Client/caller trước sửa | 3 fail / 48 pass, exit 1 | `red-web.txt` |
| Code checkpoint đầu | 47 API + 60 web, exit 0; typecheck exit 0 | `green-api.txt`, `green-web.txt`, `typecheck-checkpoint.txt` |
| Natural session expiry trước sửa review | 2 fail (200 thay vì 401), exit 1 | `red-natural-expiry.txt` |
| API cuối, gồm AUTH-04/05 | 49/49, exit 0 | `green-natural-expiry-api.txt` |
| Masked form trước sửa | 4 fail / 16 pass, exit 1 | `red-masked-caller.txt` |
| Web focused cuối | 61/61, exit 0 | `green-masked-caller.txt` |
| `npm run check` trên code của `be9417d` | 1.587 v3 (47 + 340 + 212 + 25 + 368 + 595), 173 eval; typecheck/build/security/launcher/env/OIDC; exit 0 | `check-final-code.txt` |
| `npm run test:browser:v3` trên `be9417d` | 78/78, 11 nhóm, exit 0; full lần đầu | `browser-final-code.txt` |

Concurrency dùng SQL thật: connection khác giữ `FOR UPDATE`; test chờ `pg_stat_activity.wait_event_type='Lock'` rồi mới đổi password/status hoặc revoke/expire session và commit. Unlink sau đó trả 409/401 và giữ link. Hai ca natural expiry chỉ tăng injected clock khi đang chờ khóa user/session, không sửa `expires_at`; bỏ thời gian mới làm cả hai trả 200. Tám request nhập sai đồng thời: đúng năm 400, ba 429 với `Retry-After=900`. Sai password giữ `/me` và refresh của cả hai phiên dùng được; password đúng không đổi password hay tạo/thu hồi phiên.

Lỗi môi trường đã giữ: lệnh baseline `npx vitest` từ root thiếu setup matcher DOM (`baseline-focused.txt`, không dùng làm baseline); chạy lại qua workspace đạt 34 + 59. Full check đầu trước migration public thất bại 22 test, 20 skipped, 1 error ở API do thiếu bảng (`check-code.txt`); web 594/594. Chạy migration/provision của repo vào DB sandbox rồi full check mới đạt; không xóa test hoặc thay timeout để đạt.

## Bootstrap review và giới hạn

PostgreSQL 16 `ati-auth07-pg`, tmpfs `/var/lib/postgresql/data`, bind `127.0.0.1:56550`; API `3050`, web `5150` đã dừng sau gate. DB public đã migrate/provision bằng CLI repo, giữ container cho reviewer. Không có `.env` trong checkout, không đọc/copy original `.env` hay gọi Google/SMTP/model/dịch vụ thật. Chỉ dùng OIDC/sandbox fixture local; live acceptance của AUTH-06 không được suy rộng sang delta này.

Bootstrap ngoài repo chỉ có giá trị fixture: `C:/Users/VinhDat/AppData/Local/Temp/ati-auth07-2026-10-09/review-env.ps1`. Từ review checkout riêng, dot-source file này rồi `npm ci`, `npm run check`, và `npm test -w @wap/chat-api -- tests/auth/google-unlink-password.test.ts tests/auth/google-auth.test.ts tests/auth/account.test.ts`. Browser chạy sau khi điều phối slot. Không đưa secret/hash/token vào logger mới hoặc repo evidence. Local gates không thay exact-head CI hoặc review độc lập; chưa tự merge.
