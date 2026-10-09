# FE-08 · Trang giới thiệu và các màn đăng nhập, đăng ký, xác minh, đặt lại

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/fe-08-landing-auth` · **Phụ thuộc:** FE-04b đã merge (lớp nền bản React; FE-04 đã merge) · **Mốc:** 23/10/2026
**Đặc tả:** mục 2, 4, 6 · **Bản mẫu:** `index.html` (trang giới thiệu, modal đăng nhập/đăng ký/quên mật khẩu/Google), `auth-action.html`

## Vì sao quan trọng

Đây là màn đầu tiên người mới thấy. Bản mẫu đã sửa qua nhiều vòng để nói đúng quy trình thật (xác minh email → quản trị viên duyệt → nhận email), đúng quy tắc mật khẩu và đúng luồng Google.

## Việc cần làm

**Cách làm (đổi 07/10/2026, đặc tả mục 1.2):** chép `Landing/LandingPage.tsx` (route `/` khi chưa đăng nhập; hộp đăng nhập/đăng ký/quên mật khẩu dùng cho các route `/login`, `/signup`, `/forgot-password`) và `AuthAction/AuthActionPage.tsx` từ `docs/design/prototypes/react/src/pages/` sang app sau khi FE-04b đã merge; giữ nguyên markup, class, cỡ chữ và màu của bản mẫu; bỏ JS demo, nối store/API; giữ các bảo đảm hành vi đang có. Ảnh "giống bản mẫu" so với trang tương ứng của bản React (`npm run dev` trong `docs/design/prototypes/react/`). Các mục dưới đây là phần dữ liệu và hành vi phải đúng.

1. **`/` khi chưa đăng nhập:** trang giới thiệu cuộn kể chuyện 5 khoảnh khắc (sân khấu dính bên phải trên desktop, thẻ xếp dọc trên điện thoại và khi `prefers-reduced-motion`), phần nguyên tắc, 8 dịch vụ, hướng dẫn bắt đầu. Số liệu mẫu khớp cockpit (issue #42, dòng 104); không có số liệu chưa đo.
2. **`/login`, `/signup`, `/forgot-password`:** giữ route (link trong email và nút trên trang giới thiệu trỏ tới đây), trình bày như thẻ modal của bản mẫu:
   - đăng ký: Họ tên, Email, Mật khẩu ≥ 12 ký tự; lưu ý 3 bước (xác minh email, quản trị viên duyệt, nhận email khi được duyệt);
   - quên mật khẩu: một câu trả lời chung "Nếu email này có tài khoản, bạn sẽ nhận được link đặt lại mật khẩu.";
   - Google: chuyển sang trang Google thật (luồng AUTH-04), không có bảng chọn tài khoản trong trang;
   - không có "Ghi nhớ phiên", "Đăng ký dùng thử", chọn công cụ khi đăng ký.
3. **Các màn trong `auth-action.html`:**
   - xác minh email: thành công (bước 1/3), link hết hạn (24 giờ, gửi lại), link đã dùng;
   - đặt mật khẩu mới: ≥ 12 ký tự, nhập lại; ghi "Link có hiệu lực 30 phút và chỉ dùng được một lần"; thành công thì báo các thiết bị khác đã đăng xuất;
   - Google: đang chuyển trang, chờ duyệt (email đã được Google xác minh nên chỉ còn bước duyệt), huỷ/lỗi;
   - đăng nhập bị chặn: chờ duyệt (không hiện tên/email quản trị viên), bị khoá ("liên hệ quản trị viên", không có nút gửi yêu cầu), sai mật khẩu quá nhiều (5 lần/15 phút, đếm ngược theo `Retry-After`; đặt lại mật khẩu vẫn phải chờ hết thời gian);
   - nút "Thử đăng nhập lại" thay cho "Kiểm tra trạng thái duyệt".
4. Giữ mọi bảo đảm của AUTH-02 → AUTH-05: callback Google xoá query trước khi gọi API, phản hồi muộn không ghi đè phiên mới, thông báo không lộ email có tồn tại hay không.

## Tiêu chí nghiệm thu

- [ ] Test: mật khẩu dưới 12 ký tự bị chặn ở cả đăng ký và đặt lại.
- [ ] Test: màn sai mật khẩu quá nhiều đọc `Retry-After` và đếm ngược; không có câu "đăng nhập lại ngay".
- [ ] Test: màn chờ duyệt không chứa email/tên quản trị viên.
- [ ] Các test AUTH-02, AUTH-04, AUTH-05 (unit và browser) vẫn xanh; browser spec cập nhật cách tìm phần tử trong cùng PR.
- [ ] Browser: trang giới thiệu ở 1440px và 375px, sáng và tối, không cuộn ngang; với `prefers-reduced-motion` không có sân khấu dính.
- [ ] **Giống bản mẫu** (đặc tả mục 1, 1.1, 1.2 bản 07/10; chép trang của bản React rồi nối dữ liệu thật): ảnh app và ảnh bản React của `index.html` (từng đoạn cuộn và các modal đăng nhập/đăng ký/quên mật khẩu) và `auth-action.html` (từng trạng thái) đặt cạnh nhau ở 1440×900 và 375×812, sáng và tối. Danh sách ảnh và SHA256 ghi trong log; ảnh không commit. Mọi khác biệt còn lại nằm trong đặc tả 1.1 hoặc ghi ở phần "Kết quả" kèm lý do.
- [ ] `npm run check` và `npm run test:browser:v3` exit 0.

## Ngoài phạm vi

Mô phỏng hộp thư trong bản mẫu (chỉ để trình diễn). Thay đổi API xác thực.

## Kết quả

Đã triển khai FE-08 trên `feat/fe-08-landing-auth`, từ main `129d9c0`; commit mã cuối `07ce40f203c1c14fb51e9a410ef9b8364fb511d8`. Chép hai trang Landing/AuthAction và CSS từ bản React, nối store/API thật; giữ route email, callback Google xóa query trước xử lý, một callback/StrictMode và bảo vệ phiên trước phản hồi muộn. Không đổi backend.

- Landing có đủ 5 khoảnh khắc, nguyên tắc, 8 dịch vụ và hướng dẫn bắt đầu; modal dùng route `/login`, `/signup`, `/forgot-password`, Google chuyển trang thật. Đóng bằng Escape/nút đóng khôi phục đúng opener header/hero/footer; mỗi active view có một `h1` truy cập được.
- Signup/reset chặn mật khẩu dưới 12 ký tự; forgot giữ câu trả lời chung; pending/disabled/429 dùng mã API thật. Countdown dùng deadline từ HTTP `Retry-After`. Login muộn không thay phiên mới hoặc tái đăng nhập sau logout.
- TDD: baseline 64/64; RED ban đầu 7 fail, race login 2 fail, theme 1 fail, review sửa lại 9 fail. GREEN xác thực cuối 76/76 tại `07ce40f`; `tsc` frontend exit 0.
- `npm run check` tại `f09d9d8` exit 0: 1590 test v3 + 173 evaluation; typecheck/build/security/launcher và 10 kiểm tra native/fixture đạt. Sau đó chỉ sửa một chuỗi fallback xác minh email theo review; đã chạy lại 76 test và `tsc`, chưa chạy lại toàn bộ check cục bộ trên chuỗi mới. CI đúng head bàn giao do parent kiểm tra.
- `npm run test:browser:v3` tại `07ce40f` exit 0: 88 pass qua 11 scenario. Default có 1 skip có chủ đích của case Google vì không bật OIDC; case này chạy và pass trong scenario AUTH-04. Focused FE-08: 9 pass + 1 skip default, 1/1 Google qua OIDC cục bộ.
- Follow-up chỉ sửa selector fixture AUTH-05 logout tại `219a0b7`: chấp nhận CTA của landing cũ hoặc nguồn React; real local OIDC delayed-start-after-logout 1/1 pass, exit 0. Mã sản phẩm giữ `07ce40f`; không chạy lại canonical sau thay selector này theo parent. Merge-tree với FE-09 không còn conflict.
- Review độc lập mã `f09d9d8`: **ĐẠT về mã**, 613/613 frontend, 76/76 focused, 7/7 probe; mutation bỏ bảo vệ focus/Google/login làm test fail. Các P2 focus, pending trung tính và P3 heading đã sửa; copy fallback cuối được parent duyệt. Nghiệm thu/CI/PR/merge vẫn chờ quy trình reviewer.
- Bằng chứng ngoài Git: `C:/Users/VinhDat/AppData/Local/Temp/ati-fe08-2026-10-09/visual/manifest.json`, **96 cặp / 192 PNG**, 1440×900 và 375×812, sáng/tối; mọi ảnh app không cuộn ngang. SHA256 manifest `377ce13a7e8e443979bf5e71fec89139b62a6307d04c43985ea0081ab201b5eb`; bảng từng ảnh/SHA256 và đối chứng trong [log](../log/2026-10-09-codex-fe-08-landing-auth.md). Hai CSS khớp prototype sau chuẩn hóa CRLF/LF; prototype nguyên vẹn.

Khác biệt có lý do theo đặc tả 1.1: bỏ mailbox/quick-fill/scenario và credential demo; semantics form/focus/heading dùng thật. API gộp link xác minh không hợp lệ/đã dùng/hết hạn nên app trình bày một lỗi trung tính với resend, không khẳng định ba trạng thái riêng. Token không trả identity nên dùng nhãn chung. Email `ACCOUNT_PENDING` không trả tình trạng xác minh: bước 1 ghi “Nếu chưa hoàn tất” cho cả email đã/chưa xác minh (375px quấn dòng chặt hơn); Google pending vẫn ghi đã xác minh. Countdown/alert do API quyết định; không có thời gian demo. Google login thành công vào workspace ngay; link thành công giữ phiên và có nút về tài khoản, thêm thông báo thật vào card mẫu. Các khác biệt/ảnh tương ứng được ghi riêng trong manifest và log.

Chưa làm trong FE-08: live SMTP/Google provider, model/service writes, API phân biệt token-state/email verification, FE-09 hoặc backend. OIDC ký cục bộ chứng minh PKCE/callback và UI qua PostgreSQL/HTTP thật; không phải nghiệm thu Google live.
