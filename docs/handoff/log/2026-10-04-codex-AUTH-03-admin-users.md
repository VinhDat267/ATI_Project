# 2026-10-04 · Codex · AUTH-03 quản trị người dùng

- **Base:** `3212181`; worktree riêng `C:/Users/VinhDat/.codex/worktrees/auth-03-admin-users/ATI_Project`, nhánh `vinhdat/feat-auth-03-admin-users`.
- **Commit sản phẩm:** `377d872` thêm API/UI; ghép backend AUTH-02 `99b539c` tại `e8daa2d`; `df68137` nối email duyệt và regression cạnh tranh tạo phiên; test/metadata `502ef34`; toàn bộ UI AUTH-02 `9cefe3e` ghép tại `dbc88c1`; `2c7e685` bật signup default; AUTH-02 cuối `7d7dd66` ghép tại `ce8c122`. Không tự sửa task card khác, v2, `CURRENT-STATE.md` hoặc `ROADMAP.md`; task/log AUTH-02 chỉ được mang theo từ merge phụ thuộc.
- **Phạm vi:** repository quản trị riêng `admin-user-repo.ts`, router `/api/admin/users`, view `/admin/users`, menu admin, API client/types, test HTTP/PostgreSQL/UI/browser. Không thêm migration AUTH-03 hay thư viện mới; dùng migration/email của AUTH-02.

## Hành vi và ràng buộc

- Mọi route dùng tài khoản đọc từ PostgreSQL; không dùng claim role hoặc allowlist cấu hình dịch vụ để cấp quyền quản trị người dùng.
- Mỗi mutation có transaction, advisory lock dùng chung cho mọi API process trong cùng schema, khóa actor/target theo thứ tự UUID, rồi đọc lại role/status và phiên của actor sau khi chờ. Hai admin bỏ quyền hoặc khóa nhau vẫn giữ một admin active; actor mất quyền trong lúc chờ bị 403.
- Không tự khóa hoặc tự bỏ quyền admin. Chỉ duyệt pending đã xác minh email. Sau sửa review P2, `disable` chỉ áp dụng active; pending không thể chuyển disabled để dùng `enable` bỏ qua Duyệt. `enable` chỉ áp dụng tài khoản disabled đã xác minh.
- Disable thu hồi mọi phiên trong transaction. Session creation của AUTH-02 khóa và đọc lại user; regression AUTH-03 chứng minh phiên tạo từ snapshot active cũ không sống lại sau enable.
- GET có status/search/page/limit, tìm kiếm wildcard theo nghĩa đen, truy vấn tham số, giới hạn phân trang và chỉ chọn metadata an toàn. Không trả password hash hoặc Google subject; số phiên chỉ gồm phiên chưa thu hồi/chưa hết hạn.
- Audit JSON chỉ chứa event, actorId, targetId, action và thời điểm DB; không email/name/token/password/nội dung thư. Chỉ ghi sau mutation thành công.
- Approve dùng `approvalEmail` và `sendEmailSafely` của AUTH-02 sau commit; hai approve đồng thời chỉ có một winner và một thư. Thiếu sender trả 503 trước cấp quyền. SMTP delivery thật chưa chạy; lỗi transport dùng warning tổng quát của AUTH-02.
- UI tiếng Việt theo màu/font/component hiện có: tất cả/chờ duyệt có số lượng, tìm kiếm, phân trang, trạng thái xác minh và phiên. Mỗi action cần xác nhận; Duyệt nhắc quyền dùng dịch vụ chung. Mất phiên chuyển sang `/login`; logout chủ động vẫn về trang chủ.

## Bằng chứng

1. TDD RED: 8 HTTP/PostgreSQL assertions nhận 404 khi API chưa có; 4 UI ca chưa có route/menu. Các RED riêng: mất phiên về landing, UUID hợp lệ viết hoa bị 404, outbox approval rỗng, thiếu email sender vẫn cấp quyền.
2. Race RED thực tế: transaction giữ row lock, đổi disabled và revoke; `SessionRepo.create` cũ chờ FK rồi tạo phiên từ snapshot active. Sau enable, `findActiveUser` trả active user/sid thay vì null. Sau ghép AUTH-02 row-lock fix, regression GREEN.
3. `npm test -w @wap/chat-api -- tests/auth/admin-users.test.ts tests/auth/admin-users-session-race.test.ts`: **15/15**, exit 0, PostgreSQL thật.
4. `npm test -w @wap/chat-web -- tests/admin-users.test.tsx tests/components/user-nav-menu.test.tsx`: **10/10**, exit 0. Toàn bộ web trước stack UI AUTH-02: **192/192**, exit 0.
5. `npm run typecheck:v3`: exit 0; `git diff --check`: exit 0.
6. Full API trước ba test thêm: **235/235**. Rerun sau thêm: **236/238**, hai lỗi timeout khởi động child process tại `memory-execution-snapshot` partial_failure và `startup-reconciliation` pending-plan. Hai file chạy riêng `--maxWorkers=1`: **18/18**, exit 0. Chưa gọi rerun từng phần là full API PASS.
7. Root browser checkpoint kết hợp AUTH-02 backend + AUTH-03 `df68137` + FE-03: **1/1**, exit 0, 7,5 giây. Scenario `AUTH-03:` kiểm DB/outbox và hai browser context thật: approve, login member, ẩn menu admin/chặn direct route, disable, request kế tiếp về login, access/refresh cũ 401 và zero phiên chưa revoke.
8. Sau stack UI AUTH-02 đầy đủ, config test mặc định mở có RED (`false` thay vì `true`) rồi GREEN tại `2c7e685`. Focused API/config/registration/admin/race **36/36**, focused UI/admin/signup/session/routing **24/24** và typecheck exit 0. Không chạy thêm broad suite đồng thời với root để tránh làm nhiễu timeout fixture khởi động.

Lần full API chạy trước khi public schema được migrate từng lỗi 15 test/suite (thiếu bảng public và tên DB không phải `ati_v3`); đã sửa môi trường thử nghiệm riêng rồi chạy lại. Không sửa product/test để che lỗi môi trường.

## Môi trường và bàn giao

- PostgreSQL 16 Alpine riêng, container `ati-auth03-codex-test`, ID `8421a0a86649c49469a6cd118ea3a79b9637bc2aec69028120cd5cce960a6a0c`, labels `ati.task=AUTH-03`, `ati.owner=codex`, tmpfs dữ liệu, loopback **52788**. DB `ati_v3` đã migrate 0001–0005; DB ban đầu `ati_auth03` chỉ dùng focused tests. Không dùng cổng người dùng 15433 hoặc cổng canonical 55533.
- Sau các phép kiểm tra, container thử nghiệm này đã được xóa theo đúng ID/name/labels đã xác minh; `docker ps -a --filter id=8421a0a86649` trả rỗng. Không xóa volume hoặc DB của người dùng. Bản sửa assertion no-referrer browser AUTH-02 `4f50970` cũng đã ghép để PR xếp trên base cuối không chứa thay đổi của task phụ thuộc.
- `AUTH_SIGNUP_ENABLED` đã bật mặc định true sau khi cả backend/UI AUTH-02 và AUTH-03 có mặt. Env explicit false vẫn đóng được đăng ký; `.env.example` ghi mốc hiện tại.
- Browser `AUTH-03:` đã thêm vào grep default của `scripts/test-v3-browser.mjs`; selector AUTH-02 từ merge phụ thuộc được giữ nguyên. Root giữ thêm selector FE-03 khi ghép nhánh.
- **Chờ root:** canonical check/browser tuần tự trên head cuối, review độc lập và CI đúng head, mở PR xếp trên AUTH-02. Không push/mở PR/merge main trong phiên này.
- **NOT_RUN:** SMTP/live provider/cloud DB/service thật. Không thay env riêng hoặc read/write credentials người dùng.

## Sửa P2 sau review độc lập

- **Phát hiện:** verified pending có thể `disable` 200 rồi `enable` 200 thành active mà chưa từng approve; không có approval email. Bản kiểm trước sửa của root đạt 1012 v3 + 165 eval và 23 browser nhưng chưa bảo vệ chuỗi chuyển trạng thái này.
- **Sửa sản phẩm `8f96c86`:** giữ kiểm tra trong transaction sau khóa dòng; `disable` pending trả `409 ACCOUNT_NOT_DISABLEABLE` trước UPDATE/audit. UI chỉ hiện Khóa cho active, Mở khóa cho disabled; pending giữ nhãn Chờ duyệt và nút Duyệt cùng xác nhận quyền dùng dịch vụ. Không thêm migration hoặc sửa luồng approve.
- **RED trên PostgreSQL/HTTP thật:** test `rejects disabling a verified pending account so enable cannot bypass approval` nhận 200 thay vì 409. UI test `keeps pending accounts in the approval flow without lock or unlock actions` tìm thấy Khóa thay vì không có. Cả hai lệnh exit 1 trước sửa.
- **GREEN:** `npm test -w @wap/chat-api -- tests/auth/admin-users.test.ts tests/auth/admin-users-session-race.test.ts` **16/16**, exit 0; UI/admin-nav **11/11**, exit 0; `npm run typecheck:v3` exit 0. Regression kiểm pending không đổi, enable 409, login 403 ACCOUNT_PENDING, zero session/outbox/audit; test active disable → enable cũ vẫn đạt.
- Browser AUTH-03 đã thêm assertions: pending không có Khóa/Mở khóa và gọi HTTP disable trực tiếp trả 409 trước Duyệt. **Chưa chạy browser bản sửa** ở agent thi công; root chạy canonical/review tuần tự trên head cuối.
- AUTH-02 docs/base PR cuối `adbc0a7` đã merge; signup default true giữ nguyên. Không sửa task card mới hoặc tạo log mới; cập nhật ngay task/log AUTH-03 này.
- DB P2 riêng: `ati-auth03-review-p2`, ID `4d32956f5b5a84ef406abf7e1d0920cd1e19a6dbb10a43897b93d3881c97d47b`, labels task AUTH-03/owner codex, tmpfs PostgreSQL, loopback **56728**. Sau kiểm tra đã xóa container này và xác minh ID không còn trong `docker ps -a`; không dùng DB/cổng canonical hoặc của người dùng.
