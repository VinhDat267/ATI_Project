# 29/10/2026 · GMAIL-04 · Nghiệm thu Google thật (đang làm)

Task: [GMAIL-04](../tasks/GMAIL-04-measure-and-live.md). Nhánh `codex/gmail-04-enable-flags`, source `ecf3c61bd82b65a3b5f6ad8ee51e0f54274b24cf`, [PR #182](https://github.com/VinhDat267/ATI_Project/pull/182) vẫn nháp. Đây là checkpoint đang nghiệm thu, không phải kết luận hoàn thành hay review độc lập.

## Môi trường và cách làm

- Dùng `.env` của máy nhóm trưởng trong bộ nhớ, không commit cấu hình/token/địa chỉ thật. Project Gmail `ati-291026`; Google sign-in ATI chưa được cấu hình. Không sửa `.env` của người dùng.
- PostgreSQL 16 riêng: container `ati-gmail04-live-pg-20261029`, tmpfs, bind `127.0.0.1:56536`, migrate 0001–0013; API 3000, web 5174. Không dùng DB dev.
- Child process: live, Gmail và read answers bật; MyCalendar, MySheets, schedules tắt để cô lập. DB này chưa có credential chung của tám dịch vụ khác.
- Người dùng tự đăng nhập, cấp/thu hồi quyền Google, gửi yêu cầu và duyệt kế hoạch trên UI. Assistant đọc DB/API, chạy helper chỉ đọc Gmail và lưu bằng chứng. Không tự thực hiện tool ghi hay tự bấm duyệt.
- Helper và bằng chứng cục bộ được ignore: `node_modules/.cache/gmail04/acceptance.mjs`, `docs/ai-evidence/GMAIL-LIVE/2026-10-29/`. Không đưa nội dung thư hay địa chỉ thật vào log công khai. Access token chỉ giữ trong bộ nhớ.

## Các bước đã có bằng chứng

1. Kết nối đầu tiên: helper `verify-connected` exit 0, DB `active`, API `connected`, đúng tài khoản thử, có refresh token và scope `gmail.modify`.
2. Người dùng xóa grant ở tài khoản Google. Helper `verify-revoked` gọi refresh Google thật qua production `GmailTokenManager` và `CredentialRepo`: `invalid_grant`, `AUTH_ERROR`, DB và API `reconnect_required`, exit 0. Probe chạy trong process riêng; không phải một lần đọc chat bị lỗi token.
3. Người dùng kết nối lại: credential mới; refresh thật và profile Google khớp tài khoản thử, exit 0.
4. Người dùng bấm ngắt trong ATI. Watcher giữ token cũ trong bộ nhớ trước khi ngắt, quan sát row bị xóa, rồi refresh token cũ bị Google từ chối `invalid_grant`. API `not_connected`, helper exit 0. Không lưu token ra file.
5. OAUTH-01 qua Google thật: người dùng gửi câu chỉ đọc khi chưa kết nối, bấm kết nối từ màn từ chối, cấp quyền và quay lại đúng hội thoại. Ảnh người dùng và DB xác nhận trước khi gửi lại: 1 user message, 1 refusal, 0 plan, 0 execution step, 0 message phát sinh sau khi kết nối. Không tự gửi lại yêu cầu.
6. Người dùng bấm gửi lại. Lượt đầu lỗi vì 9router không chạy (`ECONNREFUSED` ở cổng 20128). Đã khởi động CLI cài sẵn, chỉ bind loopback, bỏ cập nhật và mở trình duyệt. `/models` 200; probe ngắn 200 với requested `ag/gemini-3.8-flash`, served `gemini-3.8-flash-n`. Không đổi model hoặc sửa kết quả đo lịch sử. Người dùng tự bấm thử lại.
7. API/DB lưu một `answer`, lookup `gmail.search_threads`, query có `is:unread`, resultCount 10; 0 plan/0 execution step. UI nói **ít nhất 10 luồng**, phù hợp giới hạn tối đa 10 kết quả, không tuyên bố tổng số thư chính xác. Giữ dấu lượt planning error trước đó.
8. `gmail.create_draft`: người dùng xem kế hoạch một bước, assistant đọc DB/API xác nhận đúng người nhận thử, tiêu đề/nội dung định trước, không cc/bcc, không thread trả lời, credential đúng kết nối hiện hành. Hash `64765b52eb21f69ac2cdf3d4862f5a0dd3795d54fd28900b9ff6e4db3fef4ddf` khớp `plan_text` và JSON lưu DB. Sau người dùng duyệt, plan `completed`, đúng một execution `succeeded`, requested_by đúng chủ hội thoại, args đúng bản xem trước. Helper `verify-draft-created` exit 0; đọc lại bằng production `gmail.get_thread` khớp nội dung/người nhận, GET draft metadata 200, có `DRAFT`, không `SENT`.

9. `gmail.send_message`: người dùng đã nhập và duyệt trên UI trước khi assistant đọc kế hoạch. DB plan `completed`, đúng một execution `succeeded`, người yêu cầu đúng chủ hội thoại, tham số thực thi bằng kế hoạch lưu, đúng tài khoản thử và không cc/bcc. Hash `1acf789e1f45992869873994f4fc25d2f85c3ca5ef09a9a1b8ae14779b300440` khớp `plan_text` và JSON. Helper `verify-send-created` exit 0; production `gmail.get_thread` đọc lại khớp tiêu đề/nội dung/người nhận, GET message metadata 200, có `SENT`, không `DRAFT`. Không có snapshot preview trước thực thi cho bước này; bằng chứng duyệt gồm lời người dùng, `decided_at`, owner execution và luồng production kiểm integrity/CAS theo hash, không suy diễn có ảnh preview trước duyệt.

10. `gmail.reply`: helper `verify-reply-created` exit 0; đúng một execution `succeeded`, plan `completed`, hash `b69faaf50ee675251aa8ac44f18d367d67dac5eb43e1b646135bd002173e714e` khớp dữ liệu lưu, args đúng kế hoạch và đúng tài khoản thử. Production `gmail.get_thread` và GET message metadata 200 xác nhận đúng nội dung, có `SENT`, cùng thread gốc, `In-Reply-To` bằng Message-ID thư gốc và `References` chứa Message-ID đó. Không có snapshot preview trước thực thi; người dùng tự duyệt trên UI.

11. `gmail.forward`: helper `verify-forward-created` exit 0; đúng một execution `succeeded`, plan `completed`, hash `e9c3d584f401c9cb658ef13c564471f43483e4f114da7477dedf83951f5b9d19` khớp dữ liệu lưu, tham số đúng kế hoạch và đúng người nhận thử. Production `gmail.get_thread` và GET metadata 200 xác nhận subject chuyển tiếp, lời nhắn, phần trích thư trả lời mới nhất từ luồng nguồn kiểm thử, có `SENT`, không `DRAFT`. Người dùng duyệt trên UI; không có snapshot preview trước thực thi.

12. `gmail.create_label`: helper `verify-label-created` exit 0; đúng một execution `succeeded`, plan `completed`, hash `c51a14d9c7a67982f2ae7620f21e0c63b530b41e9436d7d526ed004a335617c5` khớp dữ liệu lưu; tên nhãn đúng yêu cầu. Production `gmail.list_labels` trả đúng một nhãn trùng tên, type user, ID bằng output execution (`Label_1`), đúng hộp thư thử và credential đã gắn vào plan. Người dùng tự duyệt trên UI; không có snapshot preview trước thực thi.

13. `gmail.modify_thread_labels`: helper `verify-labels-modified` exit 0; đúng một execution `succeeded`, plan `completed`, hash `000348efbff38c559297af3cfca6b35f0fb4f0a94969af232072d5a5ad659468` khớp dữ liệu lưu, args đúng kế hoạch. Đúng luồng gốc kiểm thử, chỉ thêm `Label_1` và bỏ `INBOX`. Production `gmail.list_labels`, `gmail.get_thread` và GET thread metadata 200 xác nhận cả hai thư trong luồng có nhãn thử, không thư nào còn `INBOX`; chưa chuyển cả luồng vào `TRASH`. Người dùng tự duyệt trên UI.

14. `gmail.trash_thread`: helper `verify-thread-trashed` exit 0; đúng một execution `succeeded`, plan `completed`, hash `59981305e07823c0a49b4664e64d29baca00e0010a13ae6ead7423f6b3aa37e8` khớp dữ liệu lưu. Đúng luồng thử, args đúng kế hoạch, cả hai thư có `TRASH`, giữ nhãn thử, không thư nào còn `INBOX`; đọc lại bằng `gmail.get_thread`, `gmail.list_labels` và GET thread metadata 200. Không xóa vĩnh viễn.

15. `verify-write-matrix` exit 0: DB có đúng 7 execution Gmail, mỗi tool ghi đúng một lần, tất cả `succeeded`, plan `completed`, đã có quyết định duyệt và owner đúng. Cả 7 hash/args khớp kế hoạch lưu; mọi người nhận nằm trong tài khoản thử được chỉ định. Bảy bằng chứng đọc lại riêng đều PASS; `write-matrix.json` lưu danh sách plan/hash và SHA-256 file bằng chứng. Không tự suy diễn các phần còn thiếu đã đạt.

16. Ca thu hồi quyền qua UI: người dùng gỡ grant Google rồi tự gửi yêu cầu đọc trong hội thoại đang có. Không dùng helper refresh hoặc sửa credential ở ca này. User message lúc 18:07:33.479Z, production đổi `status_changed_at` lúc 18:07:39.874Z; DB/API `reconnect_required`, 0 plan/0 execution mới. Tuy nhiên terminal là `planning_error`, không nhắc kết nối lại và không có unavailableServices. Kết luận: nhận diện token hỏng và chặn ghi PASS; thông báo chat còn lỗi chung, cần reviewer xem xét, không gọi toàn bộ trải nghiệm UI đã đạt. Ảnh người dùng chỉ chụp giai đoạn đang chờ; terminal được đối chiếu qua API. Bản proof mới phân loại `TOKEN_STATE_PASS_UI_GENERIC_ERROR`; bản proof trước đó dùng PASS cho trạng thái nhưng vẫn ghi terminalType/terminalMentionsReconnect, không được dùng để tuyên bố UI hướng dẫn đúng.

17. Người dùng kết nối lại sau ca token hỏng trong chat. Helper `verify-connected` exit 0: credential mới, DB `active`, API `connected`, đúng email thử, có refresh token và scope modify. `GET /api/auth/config` 200 nhưng `googleEnabled:false`, xác nhận bước Google sign-in thật còn cần cấu hình. Ba biến GOOGLE_OAUTH cho sign-in chưa có; không dùng client/project Gmail để thay thế. Khởi động lại runtime sau khi nhóm trưởng điền client của project đăng nhập riêng, giữ nguyên DB nghiệm thu.

## Chưa đạt hoặc chưa chạy

- Phần 1: **chưa hoàn tất**; chưa kiểm đăng nhập ATI bằng Google vẫn hoạt động sau thu hồi/ngắt Gmail, vì `GOOGLE_OAUTH_*` chưa cấu hình.
- Phần 2: cả 7/7 tool ghi đã đạt, đúng một lần/tool và có đọc lại thật. Đã chứng minh grant hỏng qua manager thật và qua chat thật: DB/API cần kết nối lại, không ghi; UI chat chỉ báo planning_error chung, cần reviewer xem xét trước khi kết luận toàn bộ phần 2 đạt.
- Phần 3: câu Gmail chỉ đọc có bằng chứng; các dịch vụ khác chưa được cấu hình/kiểm trong DB nghiệm thu này. Không suy diễn từ lời người dùng rằng Calendar/Sheets/Slack đã xong sang kết quả đo/nghiệm thu của GMAIL-04.
- Chưa chạy lại model campaign, không thay label/scorer. CI trước đó xanh đúng `ecf3c61`; chưa có review độc lập cho PR rollout. Không merge, không quyết định bật cờ.
- Runtime và DB tạm còn chạy để người dùng tiếp tục. 9router do phiên này khởi động; không dừng khi chưa xong nghiệm thu. Sau cùng cập nhật checkpoint này và task card trong cùng PR; không sửa CURRENT-STATE/ROADMAP.

## SHA-256 bằng chứng cục bộ tại checkpoint

Danh sách dưới đây được lấy từ file thật; dữ liệu gốc nằm ở máy nhóm trưởng, không commit. Có thể có file mới khi tiếp tục nghiệm thu.

```text
b011e04a5ee6cbb85726858576556c8171205218e3d5f1350718f5de77c2d270  chat-no-retry-1793209506068.json
0ffeef6fcbf50c53943c06afb5621ca7bae7a9a1d373777a2971b3e4e1ceda87  connection-1793208969072.json
a1f9d5af99f41594be889f2530ef69319ea68a83c0887864a8da1614416b2160  connection-1793209285022.json
7d8b86cde86a8144a38dd959cb9c68b6f20a3c7c14ef3417acaa37ea7ffea1d3  connection-1793209505799.json
94da275ee2411862b813224cf94c93164fe34677d1282454c701d44e72761c29  connection-1793209636042.json
8a48c9b88cf78b43e4b31cf93b645f9aeb435408cf5f201db379eb994fbd8141  connection-1793211078495.json
2f0b7d6cab1a4f9f0bad94dd2bd10d379e2befd23cb1aba9bf4584e58fc61c07  disconnect-1793209356836.json
975033702b419a57373cf607ab0477d74423ac8c5906f93f62ffa13f3e211ff7  draft-created-1793209883723.json
c4c41ff773d652a598fa5687552694b6857c6757367a73f5f2699bd425c46a63  draft-preview-1793209810295.json
da89ec3a7c4ed07d0725e560a272f99a805eeca234c502972599598b3e98384e  forward-created-1793210254275.json
71ed3a6e85a94b30a1c4290a01a4f83be9b0bf03068d40c1a74930fdf35710d7  gateway-incident.json
e70dcfc6173ae22900d4509e7d6b178c3868d8cd071199c957c5d0ea3bf45458  gateway-recovery.json
fad1af7dc4e5f945a4f34a4c62e88dc8f34985ee66e3513f008dc210950c05f6  google-login-config.json
35fa4e65a0b6252e9bebcde6806dd7a44b31691b86fcc805dd1a302309a535ae  label-created-1793210422843.json
4ac62a0dd5b3dd15bebbf95f33220fa27cf147b8855438e1441dd13e8c6e5c02  labels-modified-1793210544721.json
4a1087ced86dda272faa3feff9f3d2022d90d1d0629c079f1080f9be4991c9f3  read-answer-1793209705438.json
39dac673275363513461919795df7c55ecbd16d4ea036cc192de49b8ae736c72  read-answer-1793209725124.json
44bfbdca923a6b0d45f97b4ab61366759c7e150d8a5e52e84106190c6aae99f1  reconnection-1793209326478.json
7d64d0c15f1fa75314bebec242ada6dd076a6a5db5f361dda3edde5b8857a208  reply-created-1793210168773.json
4d75e8a2907435e6af01583e03305ad28168873344088bd2ec9c8e9499371eae  revocation-1793209148973.json
f1a5f531b329c191a615882b809754b2578cc4871837291a4d882f7da0d24732  send-created-1793210053745.json
61eb94c80919c7aca23672ff65f16e860fd4ab6334554943f48880fd057171ba  setup.json
a97d18a2e8c84e278a22218784ac21985662cc4a673cdc5c0e3d8f87dec6aba6  status-latest.json
0bfa9e452055cced69de24a77091c5239a362025edc66274579b59c4ebb78a72  thread-trashed-1793210646621.json
b05999e90c54f556aa3a5b3ad82a78d506ce7432b54baae3a34a9406c3e41596  ui-revocation-1793210936054.json
b3c5f1d9e6327df89a3f4cbfe72c77524ad11171336a873097dcdda6a68bdc7f  ui-revocation-1793210980646.json
9c2e0ea4934085eb067a13909ce2efa06eb5ea94c1f09ae6c6fb6427ede2ac1e  write-matrix.json
```
