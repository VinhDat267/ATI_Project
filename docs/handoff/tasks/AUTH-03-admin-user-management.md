# AUTH-03 · Trang quản trị người dùng: duyệt, khóa, phân quyền

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/auth-03-admin-users` · **Phụ thuộc:** AUTH-01 đã merge · **Làm song song với:** AUTH-02, AUTH-04

Đọc trước: [yêu cầu chung của mảng tài khoản](AUTH-common.md).

## Mục tiêu

Admin duyệt tài khoản mới, khóa/mở khóa tài khoản, cấp hoặc bỏ quyền admin. Đây là điều kiện để bật đăng ký mở, vì người được duyệt dùng được credentials chung của nhóm.

## Việc cần làm

1. **API** `routes/auth/admin-users.ts`. Mọi route kiểm `isAdmin` **bằng dữ liệu trong DB** (không tin claim trong token).
   - `GET /api/admin/users`: lọc theo `status`, tìm theo email/tên, phân trang. Trả:
     - `id`, `email`, `name`, `status`, `role`, `emailVerified`;
     - `hasPassword`, `hasGoogle`, `createdAt`;
     - số phiên đang mở.

     Không bao giờ trả hash mật khẩu.
   - `POST /api/admin/users/:id/approve`: chỉ khi `pending` và `email_verified = true`. Sau đó gửi email "tài khoản đã được duyệt" bằng hàm gửi email của AUTH-02 (nếu AUTH-02 chưa merge thì bỏ qua phần gửi, ghi trong PR).
   - `POST /api/admin/users/:id/disable`: chuyển `disabled` và thu hồi mọi phiên. `POST /api/admin/users/:id/enable`: chuyển về `active`.
   - `POST /api/admin/users/:id/role` với `{ role: 'member' | 'admin' }`.
2. **Ràng buộc an toàn** (kiểm trong một transaction trên PostgreSQL):
   - admin không tự khóa hay tự bỏ quyền admin của mình;
   - luôn còn ít nhất **một** admin `active`;
   - người không phải admin gọi API nhận 403.
3. **Giao diện** view `admin-users`, chỉ hiện với admin (mục "Quản lý người dùng" trong `UserNavMenu`):
   - tab "Chờ duyệt" có số lượng; danh sách tất cả người dùng; ô tìm kiếm;
   - nút Duyệt / Khóa / Mở khóa / Đổi vai trò, mỗi nút có hộp xác nhận. Hộp xác nhận "Duyệt" nhắc rõ: "Người này sẽ dùng được các service đã kết nối của nhóm (Trello, Slack, GitHub…)".
4. **Bật đăng ký:** nếu AUTH-02 đã merge trước task này, đổi mặc định của `AUTH_SIGNUP_ENABLED` thành `true` trong PR này (xem AUTH-02).
5. Ghi lại mỗi thao tác quản trị: ai, làm gì, với ai, lúc nào. Có thể là log có cấu trúc trên console; không bắt buộc thêm bảng.

## Tiêu chí nghiệm thu

- [x] Test quyền: member gọi mọi route admin nhận 403; admin xác định theo DB. Một người vừa bị bỏ quyền admin mà còn access token cũ vẫn bị 403.
- [x] Test duyệt: chỉ duyệt được `pending` đã xác minh email; duyệt xong thì đăng nhập được; email thông báo nằm trong outbox (nếu AUTH-02 đã có).
- [x] Test khóa: người bị khóa bị từ chối **ngay** ở request tiếp theo (nhờ middleware của AUTH-01), refresh trả 401; mở khóa xong thì đăng nhập lại được.
- [x] Test ràng buộc: không tự khóa, không tự bỏ quyền; hai admin cùng bỏ quyền của nhau đồng thời thì vẫn còn ít nhất một admin (PostgreSQL thật, transaction có khóa dòng).
- [x] Test response không chứa hash mật khẩu.
- [x] Browser E2E: admin thấy tài khoản chờ duyệt → duyệt → tài khoản đó đăng nhập được; admin khóa → phiên của người đó bị đẩy về màn hình đăng nhập ở thao tác tiếp theo; member không thấy mục "Quản lý người dùng".
- [x] Test mới fail trước khi sửa; `npm run check` exit 0; `npm run test:browser:v3` đạt hết.

## Kết quả (agent thi công điền)

- PR: https://github.com/VinhDat267/ATI_Project/pull/53; xếp trên AUTH-02 #52; review/local checks đạt, chờ CI cuối.
- Commit sản phẩm: `377d872` (API/UI), `df68137` (email duyệt và regression phiên cạnh tranh), `2c7e685` (bật signup sau ghép UI đầy đủ). AUTH-02 cuối `7d7dd66` đã ghép tại `ce8c122`; task/test bổ sung `502ef34`. Xem [nhật ký](../log/2026-10-04-codex-AUTH-03-admin-users.md).
- Test đã chạy và kết quả:
  - RED: 8 ca HTTP/PostgreSQL và 4 ca UI thất bại do thiếu API/view; lỗi mất phiên trở về landing, UUID hoa, email duyệt trống và thiếu sender đều có RED riêng trước sửa.
  - PostgreSQL thật: 15/15 ca AUTH-03, gồm hai admin bỏ quyền/khóa nhau, chờ advisory lock rồi kiểm lại quyền actor, duyệt đồng thời chỉ một email, khóa thu hồi mọi phiên và phân trang/tìm kiếm không lộ hash.
  - Ca tạo phiên trong lúc khóa: RED thực tế trên AUTH-01, phiên tạo muộn hoạt động lại khi mở khóa; GREEN sau khi dùng khóa dòng của AUTH-02. AUTH-03 thêm regression, không sửa lại implementation phiên của AUTH-02.
  - UI trọng tâm 10/10; toàn bộ web trước stack UI AUTH-02 192/192. Sau stack đầy đủ và đổi signup default, trọng tâm tích hợp API/config/AUTH-02/AUTH-03 36/36 và UI/signup/session/routing 24/24; `npm run typecheck:v3` exit 0.
  - Toàn bộ API lần đầu sau migrate đạt 235/235. Sau thêm ba ca: 236/238, hai fixture khởi động child process có timeout 10 giây; chạy riêng hai file với `--maxWorkers=1` đạt 18/18. Root chạy canonical tuần tự trên head tích hợp cuối; không coi phép chạy từng phần là full-suite PASS.
  - Root chạy browser AUTH-03 trên nhánh ghép AUTH-02 backend + AUTH-03 + FE-03: 1/1, exit 0; duyệt → email outbox → member đăng nhập → khóa → request kế tiếp về màn hình đăng nhập. CI và đủ canonical browser scenario chờ root chạy trên head cuối.
- Điều chưa làm hoặc khác với task card:
  - Duyệt gửi `approvalEmail` qua `EmailSender` của AUTH-02 sau transaction thành công; thiếu sender trả 503 trước cấp quyền. Sandbox dùng outbox; không gọi SMTP thật.
  - Đã ghép toàn bộ AUTH-02 và đổi mặc định `AUTH_SIGNUP_ENABLED` thành `true`; env `false` vẫn đóng đăng ký. Config có RED → GREEN cho mốc này. Browser AUTH-03 đã được thêm vào default selector của script canonical; root ghép thêm selector FE-03 và chạy đủ gate cuối trước PR.
  - Không sửa v2, `CURRENT-STATE.md`, `ROADMAP.md`, private env hoặc DB của người dùng. Không gọi model/provider/cloud DB/service thật. Chưa tự mở PR, push hoặc merge vào main.
  - Review độc lập phát hiện P2: verified pending → disable → enable từng cấp active mà không approve/email. Sửa tại `8f96c86`: chỉ active được khóa; pending disable trả 409 và UI không hiện Khóa/Mở khóa. RED thật: HTTP 200 thay vì 409, UI có nút Khóa; GREEN 16/16 PostgreSQL + 11/11 UI/nav và typecheck exit 0. Account vẫn pending, enable/login bị chặn, không tạo session/outbox/audit. Browser scenario đã thêm assertions cho P2; root chạy lại canonical/review trên head sửa. AUTH-02 base cuối `adbc0a7` đã ghép.
## Xác minh cuối của root/reviewer (04/10/2026)

- PR: https://github.com/VinhDat267/ATI_Project/pull/53; base AUTH-02 #52 `adbc0a7`, nhánh `vinhdat/feat-auth-03-admin-users`. Chưa merge; CI trên head cuối chờ kết quả.
- `npm run check` tại `5bf87c6`: exit 0, **1.014 v3 + 165 evaluation offline**; typecheck/build/credential scan/launcher 1/env guards 3 đạt.
- `npm run test:browser:v3`: exit 0, **23/23** qua 10 scenario. Pending không có Khóa/Mở khóa, disable API409; Duyệt → outbox → member login; active khóa → request/refresh bị từ chối/về login. AUTH-02 signup/reset đi qua approve API thật khi cả hai cùng có mặt.
- P2 bypass pending-disable-enable đã được reviewer xác nhận đóng ở `8f96c86`: chỉ active được khóa; pending giữ luồng Duyệt/email. Rerun độc lập **16/16 PostgreSQL + 11/11 UI**, probe HTTP pending disable/enable409, login403; approve đúng1email; active disable→enable200. Review **Đạt**, không còn P1/P2 được xác nhận.
- Code cuối giữ signup default **true** vì AUTH-02 đầy đủ đã ghép; explicit env **false** vẫn đóng đăng ký.
- Bằng chứng local ngoài repo: `auth03-final-check-p2.log`, `auth03-final-browser-p2.log`, `auth03-p2-independent-pg.log`, `auth03-p2-independent-ui.log`, `auth03-p2-independent-probe.log` trong `C:/Users/VinhDat/.codex/visualizations/2026/10/04/auth02-auth03-fe03/`.
- SMTP/model/provider/SaaS thật **NOT_RUN**. Các container PostgreSQL riêng của agent đã xóa và xác minh; DB người dùng 15433 không bị dùng/sửa. Không sửa CURRENT-STATE/ROADMAP trước merge.
