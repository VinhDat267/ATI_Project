# OAuth phần 1: kết nối ngay trong hội thoại (OAUTH-01)

**Ngày:** 25/10/2026. **Trạng thái:** nhóm trưởng duyệt phạm vi ngày 25/10 ("duyệt, viết đặc tả OAUTH-01 đi"). **Nguồn:** đề xuất "OAuth và tạo lịch workflow bằng AI" của `longnguyen005` (24/10), mục 1 "Luồng kết nối từ trong chat". Phần lịch chạy của đề xuất đó nằm ở [đặc tả lịch chạy](2026-10-24-scheduled-workflows-design.md).

## 1. Bối cảnh và quyết định

### 1.1. Phạm vi OAuth chốt ngày 25/10

Mốc ngừng thêm tính năng là 04/11. Vì vậy OAuth được làm hẹp, nhưng phần làm phải chạy thật:

| Phần | Nội dung | Quyết định |
|---|---|---|
| **OAUTH-01** (đặc tả này) | Kết nối ngay trong hội thoại cho dịch vụ đã có OAuth (Gmail), quay về đúng hội thoại và gửi lại yêu cầu | Bắt buộc; reviewer thi công; merge trước 29/10 |
| OAUTH-02 | Google Calendar "của riêng bạn": mỗi người kết nối lịch Google của mình, dựng trên hạ tầng Gmail | Tuỳ chọn. Nhóm trưởng quyết làm hay bỏ ngày 29/10 (chỉ làm nếu OAUTH-01 và phần sửa SCHED-01/02 đã merge). Mốc cắt 01/11. Có đặc tả riêng nếu làm |
| Không làm | OAuth cho Slack, GitHub App, Notion, Jira, Trello; Telegram giữ bot token; chế độ tự chạy theo quyền đã cấp; Google Picker; xác minh ứng dụng Google cho production | Ghi vào báo cáo môn học là hướng phát triển, kèm bảng từng provider trong đề xuất của Long |

Lý do không làm các provider khác trong đợt này:
- mỗi provider cần đăng ký app, callback và nghiệm thu gọi thật riêng;
- các dịch vụ này là tài nguyên chung của nhóm, và khoá do quản trị viên nhập vẫn hợp lý;
- không kịp trước 04/11 cùng với SCHED-01 → 04.

### 1.2. Hiện trạng (sau GMAIL-03, #147)

- Khi kế hoạch bị từ chối vì Gmail chưa kết nối, màn từ chối (`RefusalMoment`) có nút "Kết nối Gmail" đưa người dùng tới `/settings#gmail`.
- Bấm kết nối ở đó, rồi Google chuyển về `/connections/gmail/callback`. Callback xong, app đưa người dùng về `/settings#gmail`.
- Người dùng phải tự tìm lại hội thoại và gõ lại yêu cầu.
- Mở lại hội thoại đó vẫn thấy màn từ chối cũ, kể cả khi Gmail đã kết nối. Danh sách dịch vụ trên màn vẫn ghi Gmail là "chưa thiết lập", vì trạng thái lấy từ `unavailableServices` của lần từ chối.

### 1.3. Điều kiện tiên quyết

- **GMAIL-04:** nghiệm thu Google thật phần 1–3, rồi PR bật cờ. Do nhóm trưởng thao tác.
- OAUTH-01 thi công và kiểm bằng OAuth và Gmail giả, như GMAIL-03. Việc chạy thật với Google nằm trong GMAIL-04, hoặc lượt nghiệm thu sau đó.

## 2. Mục tiêu, không làm, những điều không được xảy ra

**Mục tiêu.** Người dùng đang trong một hội thoại thì làm được cả chuỗi sau mà không rời luồng:
1. gửi yêu cầu cần Gmail;
2. thấy màn từ chối vì Gmail chưa kết nối;
3. bấm "Kết nối Gmail" và cấp quyền ở Google;
4. quay về **đúng hội thoại đó**;
5. bấm "Gửi lại yêu cầu";
6. thấy kế hoạch chờ duyệt.

**Không làm:**
- provider mới;
- quay về hội thoại sau khi quản trị viên lưu khoá của dịch vụ chung. Quản trị viên vẫn dùng `/settings` như hiện nay, nhưng nút "Gửi lại yêu cầu" (mục 5.2) vẫn hiện khi mọi dịch vụ thiếu đã dùng được;
- quay về hội thoại khi người dùng huỷ ở Google (mục 7).

**Những điều không được xảy ra:**
- yêu cầu tự gửi lại, hoặc kế hoạch tự được duyệt, sau khi kết nối;
- app chuyển tới một địa chỉ ngoài ATI (open redirect), hoặc tới hội thoại của người khác;
- khi `GMAIL_ENABLED` tắt, có bất cứ gì khác đi;
- địa chỉ quay về làm thay đổi kết nối nào được lưu.

## 3. Luồng người dùng

1. Trong hội thoại `/c/<id>`, người dùng gửi "Gửi thư cho lan@example.com báo lịch họp". Gmail chưa kết nối, nên planner từ chối với `unavailableServices: [gmail]` (như hiện nay).
2. Màn từ chối có nút chính **"Kết nối Gmail"** (hoặc "Kết nối lại Gmail" khi kết nối cần kết nối lại). Bấm nút, app gọi `start` kèm `returnTo: "/c/<id>"` rồi chuyển thẳng sang màn cấp quyền của Google. App không đi qua `/settings`.
3. Người dùng chọn tài khoản và đồng ý.
4. Google chuyển về `/connections/gmail/callback`. Callback hoàn tất như hiện nay, server trả về thêm `returnTo`, và app thay địa chỉ hiện tại bằng `/c/<id>`.
5. Hội thoại mở lại ở màn từ chối cũ, nhưng:
   - hàng Gmail ghi "Đã kết nối · <email>";
   - có câu "Gmail đã được kết nối. Bạn có thể gửi lại yêu cầu.";
   - nút chính là **"Gửi lại yêu cầu"**.
6. Bấm "Gửi lại yêu cầu", app gửi đúng câu yêu cầu cũ thành một tin mới, như khi người dùng tự gõ rồi Enter. Planner lập kế hoạch mới, và kế hoạch chờ duyệt như mọi kế hoạch khác.

## 4. Backend (`apps/chat-api`)

### 4.1. Migration `db/v3/0011_oauth_return_to.sql`

- Thêm cột `oauth_states.return_to TEXT NULL`.
- Thêm ràng buộc có tên: `return_to IS NULL OR (mode = 'connect_gmail' AND return_to ~ '^/c/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')`.
- Chạy lại được, như các migration khác.
- **(OAUTH-01)** Ràng buộc đúng như trên, tên `oauth_states_return_to_check`. Test có sẵn của 0009 trước đây đếm đúng 2 ràng buộc CHECK của `oauth_states` có chữ `mode`; sau review #172, test đó kiểm đúng tập tên `oauth_states_mode_check`, `oauth_states_mode_owner_check`, `oauth_states_return_to_check`. Việc sửa assertion cũ này chờ nhóm trưởng xác nhận.
- Số 0011 là vì 0010 thuộc SCHED-01 (#167). Nếu #167 chưa merge khi OAUTH-01 merge, bộ chạy migration vẫn chạy được vì nó chạy mọi file theo thứ tự tên.

### 4.2. `POST /api/connections/gmail/start`

Body mới, tuỳ chọn: `{ "returnTo": "/c/<uuid>" }`.
- **Không có `returnTo`** (hoặc body rỗng): chạy như hiện nay. `/settings` vẫn gọi kiểu này.
- **Có `returnTo`:**
  - chỉ nhận chuỗi đúng mẫu `/c/<uuid>`, đổi về chữ thường;
  - hội thoại phải tồn tại và thuộc người gọi;
  - sai một trong các điều kiện trên → `400 { error: 'Không mở được kết nối từ hội thoại này.', code: 'RETURN_TO_INVALID' }`, không tạo state. Mã lỗi giống nhau cho mọi trường hợp sai, để không lộ việc một hội thoại có tồn tại hay không;
  - đúng → lưu vào `oauth_states.return_to` cùng state của luồng.
- Mọi bảo đảm hiện có giữ nguyên: state một lần, hạn 10 phút, gắn phiên và trình duyệt, PKCE.

### 4.3. `POST /api/connections/gmail/callback`

- **Khi thành công:** trả `{ email, returnTo? }`. `returnTo` lấy từ chính state vừa được dùng; không có thì bỏ trường.
- **Khi lỗi:** trả như hiện nay, không có `returnTo`.
- `returnTo` không ảnh hưởng tới việc lưu kết nối, thứ tự khoá, hay việc thu hồi grant bị từ chối.

## 5. Web (`apps/chat-web`)

### 5.1. Màn từ chối khi thiếu Gmail

`RefusalMoment` nhận trạng thái Gmail hiện tại từ `GET /api/services`: `personalStatus` của hàng `gmail`, cùng `email`.

| Trạng thái Gmail lúc hiện màn | Hàng Gmail | Nút chính |
|---|---|---|
| `not_connected` | Chưa thiết lập | **Kết nối Gmail** |
| `reconnect_required` | Cần kết nối lại | **Kết nối lại Gmail** |
| `connected` | Đã kết nối · `<email>` | không có nút kết nối; xem 5.2 |

Bấm nút kết nối thì gọi `startGmailConnection({ returnTo: '/c/<id hội thoại đang mở>' })`, rồi `redirectToGmail(url)`. Bảo vệ như `PersonalGmail`:
- chặn bấm hai lần;
- kiểm phiên còn của đúng người (`gmailSessionOwner`) trước khi chuyển trang;
- lỗi mạng thì báo ngay trên màn: "Không thể bắt đầu kết nối Gmail. Hãy kiểm tra mạng và thử lại.".

Dịch vụ chung giữ hành vi hiện nay (quản trị viên tới `/settings#<id>`, thành viên được nhắc báo quản trị viên). Riêng trạng thái trong danh sách lấy theo dữ liệu hiện tại: dịch vụ đã cấu hình lại thì không còn ghi "chưa thiết lập".

**(OAUTH-01)** Khi làm:
- hàng `not_connected` dùng nhãn có sẵn của màn từ chối, "Chưa kết nối", như mọi dịch vụ khác;
- danh sách dịch vụ của trang chỉ được tải lúc đăng nhập, nên có thể cũ hơn lời từ chối (Gmail bị ngắt ở tab khác, hoặc chuyển sang `reconnect_required` phía server). Vì vậy mỗi màn từ chối mới gọi lại `GET /api/services` một lần, và nút "Gửi lại yêu cầu" chỉ hiện khi đã có dữ liệu mới.

### 5.2. "Gửi lại yêu cầu"

- **Khi nào hiện:** trên màn từ chối có `unavailableServices`, khi **mọi** dịch vụ trong danh sách đó **đã dùng được** với người đang xem. Gmail dùng được là `personalStatus === 'connected'`; dịch vụ chung dùng được là `configured === true`. Khi đó nút này là nút chính, đi kèm câu "<Tên dịch vụ> đã được kết nối. Bạn có thể gửi lại yêu cầu.". Nếu còn dịch vụ chưa dùng được thì nút không hiện.
- **Khi bấm:** gửi đúng câu `request` của màn từ chối thành một tin mới, qua đường gửi tin bình thường của cockpit. Tin có `requestId` mới và cùng trạng thái "đang lập kế hoạch" như mọi lần gửi. Không gửi gì khác; không tự duyệt.
- "Sửa yêu cầu" vẫn còn, như hiện nay.

### 5.3. Màn callback (`GmailCallbackView`)

- **Thành công và có `returnTo`:** app kiểm lại mẫu `/c/<uuid>` ở trình duyệt, rồi `navigate(returnTo, true)`. Nếu mẫu sai thì về `/settings#gmail`.
- **Thành công, không có `returnTo`:** như hiện nay, về `/settings#gmail` với thông báo đã kết nối.
- **Lỗi, kể cả khi người dùng huỷ ở Google:** như hiện nay. Xem giới hạn ở mục 7.

### 5.4. `/settings`

`PersonalGmail` không đổi: gọi `start` không kèm `returnTo`.

## 6. An toàn

- **Không có open redirect.** Server chỉ lưu `/c/<uuid>` của hội thoại thuộc người gọi; trình duyệt kiểm lại mẫu trước khi chuyển trang. Địa chỉ ngoài, `//…`, đường dẫn khác `/c/…`, có query hay fragment đều bị từ chối.
- **`returnTo` gắn với state.** State dùng một lần, có hạn và gắn phiên, nên luồng khác không đọc được `returnTo` của luồng này. Đăng xuất hoặc phiên hết hạn thì callback lỗi như hiện nay, và không có `returnTo`.
- **Không tự gửi, không tự duyệt.** Kế hoạch mới vẫn có mã băm và lần duyệt riêng.
- **Token và mã OAuth không đổi chỗ.** Chúng không vào URL lịch sử, log hay prompt.

## 7. Giới hạn đã biết

- Người dùng huỷ ở Google, hoặc state hết hạn: trang callback báo lỗi như hiện nay, với link "Về Kết nối dịch vụ". App không biết hội thoại để quay về, vì `returnTo` chỉ được trả khi state được dùng thành công. Người dùng dùng nút Back của trình duyệt.
- Chế độ thử nghiệm của Google: refresh token hết hạn sau 7 ngày (đã ghi ở GMAIL-03). Kết nối lại từ chat cũng đi đúng luồng này.

## 8. Kiểm thử bắt buộc

- **API** (PostgreSQL thật, OAuth giả như GMAIL-01):
  - `returnTo` hợp lệ thì được lưu, và callback thành công trả lại đúng giá trị đó;
  - `start` không body vẫn chạy như cũ, callback không có `returnTo`;
  - bị từ chối với `RETURN_TO_INVALID` và không tạo state: hội thoại của người khác; UUID không tồn tại; `https://evil.example`; `//evil.example`; `/settings`; `/c/<uuid>?x=1`; `/c/<uuid>#x`; chuỗi quá dài; kiểu không phải chuỗi;
  - callback lỗi (state sai, phiên đã thu hồi) không có `returnTo`;
  - hai luồng song song với hai `returnTo` khác nhau: mỗi callback nhận đúng `returnTo` của state của nó (nếu lưu được);
  - ràng buộc của migration từ chối giá trị sai, kể cả khi chèn trực tiếp bằng SQL.
- **Web** (unit):
  - nút ở màn từ chối gọi `start` với đúng `returnTo` rồi chuyển trang;
  - bấm hai lần chỉ gọi một lần;
  - lỗi mạng hiện câu báo;
  - trạng thái `connected` hiện hàng "Đã kết nối" và nút "Gửi lại yêu cầu";
  - "Gửi lại" gửi đúng câu cũ qua đường gửi thường;
  - `reconnect_required` hiện "Kết nối lại Gmail";
  - còn dịch vụ thiếu thì không có "Gửi lại";
  - màn callback điều hướng tới `returnTo` hợp lệ, và về `/settings#gmail` khi `returnTo` sai mẫu.
- **Browser** (nhóm `gmail`; tên ca bắt đầu bằng `OAUTH-01 from chat:`, vì `OAUTH-01:` khớp bộ lọc `AUTH-01:` của nhóm `default`):
  - trong hội thoại, gửi yêu cầu Gmail khi chưa kết nối → màn từ chối → "Kết nối Gmail" → OAuth giả → URL là đúng `/c/<id>` → "Gửi lại yêu cầu" → kế hoạch Gmail chờ duyệt;
  - chạy ở 1440 và 375, sáng và tối;
  - ca `GMAIL-03 off` ở nhóm default không đổi.
- **Cờ tắt:** `npm run check` và `npm run test:browser:v3` đạt, không sửa assertion cũ.

**Đột biến bắt buộc** (mỗi đột biến phải làm ít nhất một test fail):
- nhận `returnTo` của hội thoại người khác;
- nhận địa chỉ ngoài hoặc `//…`;
- callback trả `returnTo` khi lỗi;
- callback trả `returnTo` của state khác;
- "Gửi lại yêu cầu" tự gửi khi quay về;
- "Gửi lại yêu cầu" hiện khi còn dịch vụ chưa dùng được;
- màn callback điều hướng tới `returnTo` không kiểm mẫu;
- nút ở màn từ chối vẫn đi tới `/settings`.

## 9. Ai làm và mốc

- **Thi công:** reviewer, theo [OAUTH-01](../../handoff/tasks/OAUTH-01-connect-from-chat.md). Cần review độc lập. Merge trước 29/10 (sau 26/10, khi buổi thử W4-03 đã xong).
- **29/10:** nhóm trưởng quyết làm hay bỏ OAUTH-02.
- **Nghiệm thu với Google thật:** cùng lượt GMAIL-04, hoặc ngay sau đó, do nhóm trưởng thao tác. Bằng chứng giữ ở `docs/ai-evidence/GMAIL-LIVE/` (ignore).
