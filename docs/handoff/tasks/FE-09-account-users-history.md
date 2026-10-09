# FE-09 · Trang Tài khoản, Quản lý người dùng, Lịch sử

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/fe-09-account-users-history` · **Phụ thuộc:** FE-04b đã merge (lớp nền bản React; FE-04 đã merge) · **Mốc:** 27/10/2026
**Đặc tả:** mục 4, 6 · **Bản mẫu:** `account.html`, `users.html`, `history.html`

## Vì sao quan trọng

Ba trang này đã có chức năng (AUTH-03, AUTH-05, FE-02) nhưng giao diện cũ. Bản mẫu đã được review để chỉ hiện đúng những gì API hỗ trợ.

## Việc cần làm

**Cách làm (đổi 07/10/2026, đặc tả mục 1.2):** chép `Account/AccountPage.tsx`, `Users/UsersPage.tsx` (route `/admin/users`), `History/HistoryPage.tsx` từ `docs/design/prototypes/react/src/pages/` sang app sau khi FE-04b đã merge; giữ nguyên markup, class, cỡ chữ và màu của bản mẫu; bỏ JS demo, nối store/API; giữ các bảo đảm hành vi đang có. Ảnh "giống bản mẫu" so với trang tương ứng của bản React (`npm run dev` trong `docs/design/prototypes/react/`). Các mục dưới đây là phần dữ liệu và hành vi phải đúng.

1. **`/account`** (thay `AccountView`):
   - hồ sơ: đổi tên; email chỉ đọc kèm trạng thái xác minh; vai trò;
   - đổi mật khẩu ≥ 12 ký tự; câu đúng: "Sau khi đổi mật khẩu, các thiết bị khác sẽ bị đăng xuất và các link đặt lại mật khẩu cũ hết hiệu lực.";
   - phiên đăng nhập: thiết bị/trình duyệt và lần dùng gần nhất (không vị trí), thu hồi từng phiên, "Đăng xuất khỏi mọi thiết bị khác";
   - Google: liên kết/gỡ; gỡ cần mật khẩu hiện tại; tài khoản chưa có mật khẩu thì nút gỡ bị khoá kèm hướng dẫn dùng "Quên mật khẩu";
   - không có điểm "bảo mật: tốt".
2. **`/admin/users`** (thay `AdminUsersView`):
   - tab Chờ duyệt: chỉ "Duyệt & kích hoạt"; tài khoản chưa xác minh email có nút Duyệt bị khoá kèm lý do; không có Từ chối, Mời;
   - tab Thành viên: khoá (xác nhận: "bị đăng xuất khỏi mọi thiết bị…"), mở khoá, đổi vai trò; dòng của chính mình không có thao tác;
   - duyệt xong báo "Đã duyệt. Hệ thống gửi email báo cho người dùng."; khi máy chủ chưa cấu hình email thì hiện đúng lỗi 503 của API.
3. **`/history`:** lịch sử hội thoại của chính người dùng (không có "toàn bộ nhóm", không lọc theo người yêu cầu), tìm theo tiêu đề, đổi tên tại chỗ (Enter lưu, Esc huỷ), "Tải thêm" theo cursor, mở lại hội thoại tới `/c/:id`. Không làm bộ lọc trạng thái/công cụ (đặc tả mục 9.3).
4. Giữ các bảo đảm AUTH-05/#73: phản hồi lưu tên đến muộn không xoá draft mới; link/unlink dùng protected transport.

## Tiêu chí nghiệm thu

- [x] Test: không có thao tác Từ chối/Mời; Duyệt bị khoá khi chưa xác minh email.
- [x] Test: gỡ Google bắt buộc mật khẩu; tài khoản chưa có mật khẩu không gỡ được.
- [x] Test: đổi tên hội thoại lưu bằng Enter, huỷ bằng Esc, phản hồi muộn không ghi đè tên vừa gõ lại.
- [x] Các test `account-view`, `account-action-regressions`, `admin-users`, `app-routing`, browser AUTH-03/AUTH-05/FE-02 vẫn xanh.
- [x] Không cuộn ngang ở 375px; chế độ tối giống bản React.
- [x] **Giống bản mẫu** (đặc tả mục 1, 1.1, 1.2 bản 07/10; chép trang của bản React rồi nối dữ liệu thật): ảnh app và ảnh bản React của `account.html`, `users.html`, `history.html` đặt cạnh nhau ở 1440×900 và 375×812, sáng và tối. Danh sách ảnh và SHA256 ghi trong log; ảnh không commit. Mọi khác biệt còn lại nằm trong đặc tả 1.1 hoặc ghi ở phần "Kết quả" kèm lý do.
- [x] `npm run check` và `npm run test:browser:v3` exit 0.

## Ngoài phạm vi

Từ chối tài khoản, mời thành viên, lịch sử cả nhóm, lọc lịch sử theo trạng thái/công cụ (cần API mới, chưa lập kế hoạch).

## Kết quả

Đã port ba trang từ source React vào `apps/chat-web/src/pages/{Account,Users,History}`, giữ CSS byte-for-byte, nối API/store thực tế và chuyển route riêng trong App.tsx. Giữ AccountView/AdminUsersView wrappers và các regression AUTH-03/AUTH-05/#73. Tên/draft mới không bị response cũ ghi đè; đổi search/user không làm busy kẹt; Enter/Esc trả focus sau khi editor đóng. Không sửa backend/schema trong diff FE-09.

Nhánh `feat/fe-09-account-users-history`, worktree `C:/Users/VinhDat/orca/workspaces/ATI_Project/fe-09-account-users-history`. Phụ thuộc [AUTH-07 / PR #120](https://github.com/VinhDat267/ATI_Project/pull/120), base `1792f120ed02842cb57688d182867d8462333705` trên `fix/auth-google-unlink-password`, để mật khẩu khi gỡ Google được kiểm thật. Merge backend trước rồi retarget FE-09 về main; không tự merge.

Ngoại lệ theo hợp đồng dữ liệu/đặc tả 1.1: bỏ demo nav, vị trí/điểm bảo mật giả, stats/filter nhóm/trạng thái/công cụ/receipts/prompt/tool chips của History, role selection khi approve và role-filter selector của Users (API không có role filter). Giữ đổi vai trò thật. Tab thành viên ghép hai stream active/disabled phân trang độc lập, có thể 40 dòng/trang, không khẳng định 20 dòng; stats lấy tổng thật của server. Email verification lấy authenticated user vì AccountProfile chưa trả trường đó; thiếu trường thì không tự gắn badge đã xác minh. Native no-email backend trả HTTP 503 thật, UI giữ lỗi/retry và SQL account vẫn pending. UserNavMenu chỉ thêm hai props class tùy chọn, mặc định giữ nguyên, để dùng avatar/menu source ngoài CSS Cockpit.

Gate tại `b63d586ea945b4e26f5f219f403de0dc6b2b367c` (production `1b2ac12e11a1853e17142ee63284fae0e5d7e8cd`): `npm run check` exit 0, 1.599 v3 (368 API + 607 web trong sáu workspace), 173 eval, typecheck/build/security/launcher/env/OIDC. Hai phát hiện review đã sửa bằng RED→GREEN: mật khẩu hiện tại gồm 12 dấu cách vẫn được gửi nguyên giá trị để API xác minh; thanh độ dài mật khẩu về 0 khi input được xoá sau thành công, giữ đúng độ dài draft mới gõ trong lúc chờ response. Focused account/FE-09 32/32; browser FE-09 cuối tại `4ca2b700` 6/6, exit 0, gồm literal unlink và meter clear/newer draft với HTTP/PostgreSQL thật. FE-04 private flow 1/1 sau khi chuyển runtime-warning assertion về Cockpit, giữ theme/keyboard/badge behavior. Final `npm run test:browser:v3` tại `5726cd27b43c1919ada03073eaaa6299fdeb54e9`: 84/84 trong 11 groups, exit 0, lần final đầu tiên. Canonical cũ 82/82 được giữ riêng trước hai fix.

Visual: `C:/Users/VinhDat/orca/artifacts/fe-09/visual/comparison.html`, `manifest.json`, `SHA256SUMS.txt`: 40 PNG (12 cặp bắt buộc, 4 cặp Users members bổ sung, 8 menu). Đủ 1440×900 / 375×812 sáng/tối, app/menu không cuộn ngang; CSS cả ba trang SHA256 bằng source. Data/session/count/date/status và unsupported omissions được ghi rõ trong manifest/log; không tuyên bố pixel-equal với dataset demo. Ảnh ngoài repo. [Log và toàn bộ SHA256](../log/2026-10-09-codex-fe-09-account-users-history.md), [kế hoạch](../../superpowers/plans/2026-10-09-fe-09-account-users-history.md).

Whitespace-only head `4ca2b700216edfb30ad8f9f4e19cd67906f93506` xoá ba lỗi spacing, giữ CRLF/CSS; gate `diff --check` với `cr-at-eol` exit 0. Test-only head `5726cd27b43c1919ada03073eaaa6299fdeb54e9` khôi phục LF gốc của AUTH-05 browser specs, thống nhất login Email `exact:true` với FE-08 để tránh conflict giữa hai PR. Manifest nguồn cuối tại head này; không đổi hành vi ứng dụng so với fullcheck.

Review source độc lập ĐẠT qua `4ca2b700`: whole-frontend 607/607 tại `b63d586`, probe cuối 14/14, mutants name/history/session-owner và meter bỏ đồng bộ/reset 0 đều bắt lỗi. Receipt `C:/Users/VinhDat/orca/artifacts/fe-09/independent-review-4ca2b70.json`; ba whitespace edits được kiểm riêng, không đổi semantic/CSS. Parent readonly merge-tree với FE-08 `219a0b790e7c3f544e59c726e0816dd5fe88188e`: exit 0, không conflict app/test/docs; chưa working merge. Local gates đã đạt; exact-head CI/PR/merge do parent phụ trách. Chỉ có bằng chứng local sandbox, không suy rộng sang SMTP/Google/model/dịch vụ live.
