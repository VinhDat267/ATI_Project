# AUTH-05 · Trang quản lý tài khoản

**Trạng thái:** xong · **PR:** #68 và bản sửa sau review #73 (`198fe6d`) · **Review:** delta/runner đạt độc lập; Google/SMTP thật chờ AUTH-06 · **Phụ thuộc:** AUTH-01 và AUTH-04 đã merge

Đọc trước: [yêu cầu chung của mảng tài khoản](AUTH-common.md).

## Nội dung trang "Tài khoản"

Mở từ mục "Tài khoản" trong `UserNavMenu`, view `account`.

1. **Hồ sơ:** email (chỉ đọc), tên (sửa được, 1–100 ký tự), ngày tạo, vai trò.
2. **Mật khẩu:**
   - có mật khẩu: "Đổi mật khẩu" yêu cầu mật khẩu hiện tại + mật khẩu mới. Đổi xong thu hồi **mọi phiên khác**, giữ phiên hiện tại;
   - chưa có mật khẩu (tài khoản chỉ dùng Google): hiện hướng dẫn dùng "Quên mật khẩu" để đặt mật khẩu qua email (AUTH-02), không đặt trực tiếp khi chưa xác thực lại.
3. **Phương thức đăng nhập:** trạng thái mật khẩu, trạng thái Google (email Google đã liên kết nếu có).
   - Nút "Liên kết Google" dùng `mode: 'link'` của AUTH-04.
   - Nút "Gỡ liên kết" chỉ bật khi có mật khẩu.
   - Ẩn phần này nếu `googleEnabled: false`.
4. **Phiên đăng nhập:** danh sách phiên đang mở (thiết bị/trình duyệt rút gọn từ `user_agent`, thời điểm tạo, lần dùng cuối, đánh dấu "phiên này"). Nút "Đăng xuất phiên này" cho từng phiên khác, và "Đăng xuất khỏi mọi thiết bị khác".
5. **Không có** xóa tài khoản hay đổi email trong phạm vi môn học. Người dùng muốn ngừng dùng thì nhờ admin khóa (AUTH-03). Trang ghi rõ điều này.

## API

Đặt trong `routes/auth/account.ts`:
- `PATCH /api/account/profile`;
- `POST /api/account/change-password`;
- `GET /api/account/sessions`;
- `POST /api/account/sessions/:id/revoke`;
- `POST /api/account/sessions/revoke-others`.

Mọi route chỉ thao tác trên phiên và dữ liệu của chính người dùng (lấy từ token, kiểm lại trong DB).

## Tiêu chí nghiệm thu

- [x] Test đổi mật khẩu:
  - sai mật khẩu hiện tại bị từ chối và tính vào giới hạn đăng nhập sai;
  - đổi xong, các phiên khác bị thu hồi, phiên hiện tại vẫn dùng được;
  - mật khẩu mới < 12 ký tự bị từ chối.
- [x] Test phiên: người dùng A không xem được hay thu hồi phiên của người dùng B (403/404); phiên đã thu hồi biến mất khỏi danh sách và refresh của nó trả 401.
- [x] Test sửa tên: tên rỗng hoặc quá dài bị từ chối; tên mới hiện trong `GET /api/auth/me` và access token phát hành sau đó.
- [x] Test giao diện:
  - tài khoản chỉ có Google không thấy ô "mật khẩu hiện tại" mà thấy hướng dẫn;
  - nút "Gỡ liên kết" bị khóa khi không có mật khẩu.
- [x] Browser E2E:
  - đăng nhập ở hai context trình duyệt, ở context 1 bấm "Đăng xuất khỏi mọi thiết bị khác", context 2 bị đưa về màn hình đăng nhập ở thao tác tiếp theo;
  - đổi tên thì tên mới hiện trên `UserNavMenu`.
- [x] Test mới fail trước khi sửa; `npm run check` exit 0; `npm run test:browser:v3` đạt hết.

## Kết quả (agent thi công điền)

- PR: [#68](https://github.com/VinhDat267/ATI_Project/pull/68), nhánh `feat/auth-05-account-page` (Claude Code thi công); bản sửa sau review độc lập [#73](https://github.com/VinhDat267/ATI_Project/pull/73), nhánh `vinhdat/fix-auth05-account-actions` (Codex).
- Commit:
  - test RED backend `5d768d3`;
  - backend `f52f8a9`;
  - test RED frontend `c0df781`;
  - frontend `3d2e1e9`;
  - browser `87cbf2d`;
  - test link reset `7d6d129`, sửa test đó `2f6d512`;
  - kèm commit tài liệu.
- Đã làm:
  - **API** (`routes/auth/account.ts`, mount `/api/account`):
    - `GET /api/account`: hồ sơ, ngày tạo, vai trò, phương thức đăng nhập, email Google;
    - năm route theo task card.
    - Mọi route qua middleware phiên. Thao tác trên phiên của người khác trả 404, giống phiên không tồn tại.
  - **Đổi mật khẩu:**
    - Sai mật khẩu hiện tại trả **400** `INVALID_CURRENT_PASSWORD`, không trả 401 (401 làm client đăng xuất). Lần sai được tính vào giới hạn đăng nhập sai (`LoginFailures`, tách từ route đăng nhập và dùng chung một instance); quá giới hạn trả 429.
    - Đổi xong trong một transaction có khóa dòng user: thu hồi mọi phiên khác và vô hiệu link đặt lại mật khẩu chưa dùng.
    - Tài khoản chỉ có Google trả 409 `PASSWORD_NOT_SET`.
  - **Phiên:** nhãn thiết bị rút gọn từ `user_agent` ở server (`auth/user-agent.ts`); API không trả chuỗi `user_agent` gốc.
  - **Migration `0008_account_google_email.sql`** (idempotent) thêm `users.google_email`.
    - Ghi mỗi lần liên kết hoặc đăng nhập Google; xóa khi gỡ liên kết.
    - Liên kết cũ hiện "Đã liên kết" không kèm email, cho tới lần đăng nhập Google kế tiếp.
  - **Giao diện:**
    - `AccountView` ở `/account`, mở từ mục "Tài khoản" trong `UserNavMenu`.
    - Tên mới ghi vào user đang đăng nhập nên menu cập nhật ngay.
    - Màn hình callback Google sau khi liên kết có nút "Về trang tài khoản".
- Test đã chạy và kết quả (04/10/2026, PostgreSQL tạm ở 55533):
  - **RED:**
    - backend 21/21 fail đúng lý do (route 404, chưa có module nhãn thiết bị);
    - frontend 8/8 fail, cộng 1 test nút "Về trang tài khoản" fail trước khi sửa;
    - browser `AUTH-05:` trên code chỉ có backend: hết 30 s chờ nút "Tài khoản".
  - **GREEN:**
    - `tests/auth` **130/130** (22 test mới, gồm test link reset);
    - `account-view.test.tsx` **9/9**;
    - browser `AUTH-05:` `--repeat-each=3` **3/3**.
  - **Mutation:** **20/20** bị bắt (13 backend, 7 frontend).
    - Lần chạy đầu, test link reset fail ngay trên code thật: route reset trả 503 vì app trong test không có email sender. Đây là lỗi của test, đã sửa ở `2f6d512`.
    - Vì test đó luôn fail, kết quả lần đầu của mutation B3 không có giá trị. Chạy lại B3 sau khi sửa thì bị bắt đúng bởi test đó. Các mutation khác bị bắt bởi test riêng của chúng.
  - **`npm run check`:** exit 0; v3 1.219 = 47 schema + 340 adapters + 180 planner + 25 executor + 331 API + 296 web; eval 165; typecheck, build, quét bản build đạt.
  - **`npm run test:browser:v3`:** exit 0, 28/28 ca qua 11 scenario (default 16, gồm AUTH-05).
- Điều chưa làm hoặc khác với task card:
  - **Thêm `GET /api/account`**, ngoài 5 route trong task card, để có ngày tạo và email Google.
  - **"Lần dùng cuối"** là lần refresh token gần nhất: access token không ghi `last_used_at` cho từng request.
  - **Gỡ liên kết Google** không có hộp xác nhận, vì liên kết lại được ngay.
  - **Liên kết/gỡ Google chỉ test bằng unit test và repo trên PostgreSQL.** Browser không chạy luồng Google ở trang tài khoản, vì sandbox không bật Google; scenario `auth04` vẫn chạy luồng đăng nhập bằng OIDC giả.
  - Google và SMTP thật thuộc AUTH-06.

### Sửa sau review độc lập #68 (Codex, 04/10/2026)

- Người dùng yêu cầu sửa cả **2 P2 và 1 P3** trong [review #68](https://github.com/VinhDat267/ATI_Project/pull/68#issuecomment-5981102502). Nhánh `vinhdat/fix-auth05-account-actions`, base `9ad154d`.
- Commit: test trước sửa `b0f5151`; mã sửa và hoàn thiện observer browser `68523f09ec286b9eec607886cade0db7ebcadd76`; bàn giao ban đầu `370912e`. Sau gate CI, runner được bổ sung khóa JWT test chung cho API và worker browser.
- **Google link/unlink:** dùng transport xác thực có refresh giới hạn và kiểm quyền sở hữu phiên. Chỉ retry khi server từ chối xác thực bằng 401, trước khi tạo state/thay đổi liên kết; không retry 5xx hoặc mất kết nối. Start mode login và callback OAuth vẫn dùng transport một lần, không tự refresh/retry callback.
- **Tên hiển thị:** response chỉ đồng bộ input nếu draft vẫn bằng snapshot đã gửi; giữ nội dung sửa trong lúc PATCH chờ. Tên đã lưu vẫn cập nhật user/menu; draft chưa sửa vẫn được chuẩn hóa sau thành công; lỗi giữ draft.
- **Redirect Google:** chỉ chuyển trang khi AccountView còn mount và phiên khởi tạo vẫn hiện hành; chấp nhận token refresh trong cùng user/session. Response muộn sau logout, đổi principal hoặc rời trang không giành điều hướng.
- **RED/GREEN thật:** native HTTP với component/client thật: RED **5 fail / 4 pass**, GREEN **9/9**; cùng bốn file hồi quy cũ đạt **78/78**, exit 0. Browser với API/PostgreSQL thật và provider OIDC giả: RED **4/4 fail**, GREEN **4/4 pass**. Observer đọc bản clone của response để xác nhận body đã đến kể cả khi client hủy xử lý trước JSON; không thay body/response của ứng dụng. Negative control dùng AccountView cũ cùng transport mới: **1 fail**, exit 1, do vẫn chuyển sang callback sau khi về workspace; khôi phục nguồn mới đúng SHA-256.
- **Canonical trên code `68523f0`:** `npm run check` exit 0, **1.245 v3 = 47 schema + 340 adapters + 188 planner + 25 executor + 331 API + 314 web**, **165 eval**, typecheck/build/credential scan/launcher1/fixture và env guard8 đạt. `npm run test:browser:v3` exit 0, **32/32 qua 11 scenario**. Scenario `auth04` nay chạy thêm bốn ca `AUTH-05 Google:` nên browser thường xuyên bao phủ link/unlink tại trang tài khoản.
- **Reviewer độc lập:** chạy lại focused **78/78**, toàn bộ frontend **314/314**, thêm **21/21** probe native HTTP, exit 0. Negative control với client cũ **2 fail / 19 skipped**; view cũ **1 fail / 20 skipped**, exit 1 đúng lỗi thiếu refresh và ghi đè draft rỗng. Không có finding cần sửa trong delta; sẵn sàng mở PR, còn gate CI trên HEAD cuối. Reviewer không chạy lại browser/PostgreSQL; bằng chứng canonical ở trên do người sửa chạy. Báo cáo và harness lưu ngoài repo trong thư mục bằng chứng.
- **Gate CI và hoàn thiện runner:** [run đầu của PR #73](https://github.com/VinhDat267/ATI_Project/actions/runs/37212230875) đạt check nhưng fail ca JWT hết hạn: CI không đặt `JWT_SECRET`, API tự sinh khóa riêng trong khi test worker chưa có khóa. Tái hiện local khi bỏ biến này: **1 fail**, exit 1 đúng `createHmac` nhận undefined. Runner auth04 nay sinh khóa ngẫu nhiên 32 byte nếu chưa cấu hình, truyền chung cho API và worker, giữ khóa đã cấu hình. Không đổi API/config production/test expectation. Chạy lại khi cả `JWT_SECRET` và `ENCRYPTION_KEY` đều không đặt từ ngoài: `npm run check` **exit 0, 1.245 v3 + 165 eval**; browser **exit 0, 32/32 qua 11 scenario**, auth04 **5/5**. Logs `ci-env-red.log`, `check-ci-env.log`, `browser-ci-env.log` được giữ ngoài repo. Container test tái tạo riêng đã dọn sau khi kiểm 0 client; DB dev vẫn healthy.
- **Review runner bổ sung:** reviewer kiểm syntax, **2/2** environment guard và **9/9** kiểm runner offline, exit 0; xác nhận khóa tự sinh được truyền chung, khóa đã cấu hình giữ nguyên, guard target DB/live vẫn chặn và teardown fixture giữ nguyên. Không có finding cần sửa; reviewer không chạy browser/PG/provider, còn gate CI trên HEAD mới. Báo cáo `reviewer/AUTH05-RUNNER-FOLLOWUP-REVIEW.md` giữ ngoài repo.
- Không sửa backend hoặc chính sách hủy mutation in-flight. Google thật/SMTP thật/model/service thật **NOT_RUN**; nghiệm thu Google consent/config thật vẫn thuộc AUTH-06.

### Sau merge #73 (reviewer, 04/10/2026)

- Merge `198fe6d91e27e084aef44d37974064994d2f3c99`, 22:38:04 Việt Nam. [CI cuối](https://github.com/VinhDat267/ATI_Project/actions/runs/37213086389) SUCCESS trên head `4e469a12482e487a3a25ebe7c1747c77a0502780`; `git diff --exit-code` giữa head và cây merge đạt. Bản sửa đã vào main.
- Số liệu hiện hành: check **1.245 v3 + 165 eval**, browser **32/32 qua 11 scenario**; review độc lập delta và runner đạt với giới hạn đã ghi trên. Các số liệu #68/#71 ở phần lịch sử không được coi là số hiện tại.
- Đóng task trong phạm vi card dựa trên test sản phẩm và các lần chạy đã ghi. Browser Google account dùng OIDC giả; nghiệm thu Google/SMTP thật còn AUTH-06. Không nâng quan sát revoke/password in-flight thành yêu cầu mới.
