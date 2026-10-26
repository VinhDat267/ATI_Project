# 25–26/10/2026 · OAUTH-01 · Kết nối Gmail ngay trong hội thoại

**Người viết:** reviewer (bên thi công). Nhóm trưởng duyệt phạm vi và đặc tả ngày 25/10; task card giao reviewer (#169). **Nhánh:** `feat/oauth-01-connect-from-chat`, tách từ `main` `c760aa3`. Task: [OAUTH-01](../tasks/OAUTH-01-connect-from-chat.md). Đặc tả: [kết nối ngay trong hội thoại](../../superpowers/specs/2026-10-25-oauth-connect-from-chat-design.md).

## Đã làm

- **Migration `db/v3/0011_oauth_return_to.sql`:** cột `oauth_states.return_to TEXT` và ràng buộc có tên `oauth_states_return_to_check`. Chạy lại được: mỗi lần migrate, ràng buộc được xoá rồi thêm lại.
- **`GoogleAuthRepo.createState`** nhận `return_to` tuỳ chọn. `consumeState` đã trả `RETURNING o.*`, nên `return_to` đi cùng state mà không cần sửa.
- **Route `apps/chat-api/src/routes/connections/gmail.ts`:**
  - `POST /start` nhận `returnTo` tuỳ chọn. Có `returnTo` thì phải đúng mẫu `/c/<uuid>` và hội thoại phải thuộc người gọi (qua `conversationOwner`, nối từ `ConversationRepo.getConversation` ở `app.ts`). Sai thì trả `400 { code: 'RETURN_TO_INVALID' }` và không tạo state. UUID chữ hoa được đổi sang chữ thường trước khi lưu;
  - không có `returnTo` (như `/settings`) thì chạy như cũ;
  - `POST /callback` trả thêm `returnTo` chỉ khi thành công, lấy từ đúng state vừa dùng. Mọi nhánh lỗi giữ nguyên, không có `returnTo`.
- **Web:**
  - `apiClient.startGmailConnection({ returnTo })` gửi body chỉ khi có `returnTo`; `completeGmailConnection` trả `{ email, returnTo? }`;
  - `conversationReturnPath()` ở `services/gmail-connection.ts` kiểm lại mẫu `/c/<uuid chữ thường>` ở trình duyệt;
  - `RefusalMoment` (màn từ chối): nút "Kết nối Gmail" (hoặc "Kết nối lại Gmail" khi `reconnect_required`) vẫn là thẻ `<a href="/settings#gmail">`. Bấm thường thì gọi `start` với `returnTo` của hội thoại đang mở rồi chuyển sang Google; bấm kèm phím bổ trợ hay chuột giữa thì để trình duyệt mở `/settings#gmail` như cũ. Chặn bấm hai lần, kiểm phiên của đúng người (`gmailSessionOwner`) trước khi chuyển trang, lỗi mạng báo ngay trên màn. Không có hội thoại thì đi `/settings#gmail`;
  - trạng thái từng dịch vụ trên màn lấy theo dữ liệu hiện tại: Gmail đã kết nối ghi "Đã kết nối · <email>", Gmail cần kết nối lại ghi "Cần kết nối lại"; dịch vụ chung đã cấu hình lại thì không còn ghi "chưa thiết lập";
  - khi **mọi** dịch vụ trong `unavailableServices` đã dùng được, màn có câu "<Tên> đã được kết nối. Bạn có thể gửi lại yêu cầu." và nút chính "Gửi lại yêu cầu". Nút gửi đúng câu cũ qua đường gửi tin của cockpit (`send`). Không tự gửi, không tự duyệt;
  - khi một màn từ chối hiện ra, màn gọi `onRefreshServices` một lần (theo id tin), vì danh sách dịch vụ của Workspace chỉ được tải lúc đăng nhập và có thể cũ hơn lời từ chối. Trong lúc đang tải lại, nút "Gửi lại yêu cầu" chưa hiện;
  - `Cockpit` truyền `conversationId`, `onResend={send}`, `servicesLoading` và `onRefreshServices`; `Workspace` truyền `loadServices`;
  - `GmailCallbackView`: thành công có `returnTo` đúng mẫu thì `navigate(returnTo, true)`; sai mẫu hoặc không có thì về `/settings#gmail` như cũ;
  - `PersonalGmail` ở `/settings` không đổi.
- **Browser:** `tests/browser/oauth-01.spec.ts`, 4 ca (1440/375 × sáng/tối) trong nhóm `gmail`: gửi yêu cầu Gmail khi chưa kết nối → màn từ chối → "Kết nối Gmail" → OAuth giả → URL đúng `/c/<id>` → "Đã kết nối · …" → "Gửi lại yêu cầu" → kế hoạch Gmail chờ duyệt, "Gửi từ" đúng hộp thư. Ca kiểm không cuộn ngang ở cả hai khổ.

## Khác với đặc tả và task card

1. **Ràng buộc của migration không có phần `mode = 'connect_gmail'`.** Đặc tả 4.1 ghi `return_to IS NULL OR (mode = 'connect_gmail' AND return_to ~ '^/c/<uuid>$')`. Bản đầu làm đúng như vậy, và `npm run check` lần đầu exit 1: test cũ `gmail-migration.test.ts` ("runs the whole migration set again…") đếm đúng 2 ràng buộc CHECK của `oauth_states` có chữ `mode`, và ràng buộc mới thành cái thứ 3. Không sửa assertion cũ, nên ràng buộc chỉ giữ phần mẫu đường dẫn: `return_to IS NULL OR return_to ~ '^/c/<uuid>$'`. Phần "chỉ cho `connect_gmail`" do mã giữ: chỉ route `connect_gmail` ghi `return_to`, và chỉ callback Gmail đọc nó. Cần nhóm trưởng xác nhận, hoặc cho phép sửa test cũ để đếm theo tên ràng buộc.
2. **Tiền tố tên test browser là `OAUTH-01 from chat:`**, không phải `OAUTH-01:`. Bộ lọc nhóm `default` có `AUTH-01:`, khớp cả `OAUTH-01:`, nên lượt browser đầu chạy 4 ca này trong nhóm `default` (Gmail tắt) và fail. Bộ lọc nhóm `gmail` là `GMAIL-03:|OAUTH-01 from chat:`.
3. **Đọc lại danh sách dịch vụ khi màn từ chối hiện ra** (thêm ngoài task card, để đúng đặc tả 5.1 "trạng thái Gmail hiện tại"). Lượt browser thứ ba bắt được lỗi: ca thứ hai của mỗi khổ ngắt Gmail sau khi trang đã tải danh sách dịch vụ (lúc Gmail còn kết nối từ ca trước), nên màn từ chối coi Gmail đã kết nối, không có nút "Kết nối Gmail" mà lại mời "Gửi lại yêu cầu". Người dùng thật gặp đúng lỗi này khi Gmail bị ngắt ở tab khác, hoặc chuyển sang `reconnect_required` phía server trong lúc trang đang mở. Test unit RED trước khi sửa (`onRefreshServices` được gọi 0 lần); hai ca browser đó là RED ở mức trình duyệt.
4. **Nhãn hàng Gmail:** `not_connected` dùng nhãn có sẵn "Chưa kết nối" (đặc tả 5.1 ghi "Chưa thiết lập"). Khi rà lại đặc tả, hàng `reconnect_required` cũng đang ghi "Chưa kết nối"; đã sửa thành "Cần kết nối lại" như đặc tả, có RED trước (`expected 'GmailChưa kết nối' to contain 'GmailCần kết nối lại'`).
5. **Ba test viết sau khi đã có mã**, để đột biến của task card có test bắt (xem bảng đột biến). Chúng không có RED trên mã chưa sửa; hiệu lực của chúng chỉ được kiểm bằng đột biến:
   - API: callback lỗi sau khi đã dùng state (Google không trả refresh token, thiếu quyền, đổi mã lỗi, đọc hồ sơ lỗi) và phiên bị thu hồi đều không có `returnTo`;
   - API: ca "mỗi luồng chỉ nhận `returnTo` của chính nó" chạy hai vòng, lần lượt hoàn tất luồng bắt đầu trước và luồng bắt đầu sau. Bản đầu chỉ hoàn tất luồng bắt đầu sau, nên đột biến O4 lọt;
   - web: đổi người dùng trong lúc đang chờ `start` thì không chuyển sang Google.

## RED → GREEN

PostgreSQL 16 tmpfs riêng ở 56533, sandbox, không dùng `.env` hay DB dev. Log thô ở `.codex/oauth01/` của worktree (không commit).

| Nhóm test | RED (mã chưa sửa) | GREEN |
|---|---|---|
| API `gmail-connections.test.ts`, describe OAUTH-01 | 3 fail đúng lý do: `start` nhận hội thoại người khác (200 thay vì 400), callback không có `returnTo` | cùng 2 file: 28/28; sau khi thêm test: 33/33 cùng `gmail-migration.test.ts` |
| Migration `oauth-return-to-migration.test.ts` | fail ở `beforeAll`: chưa có `0011_oauth_return_to.sql` (2 ca bị bỏ qua) | 2/2 |
| Web `oauth-01-refusal.test.tsx`, `gmail-callback.test.tsx` | 7 fail / 21 đạt: không có `returnTo`, không có "Kết nối lại Gmail", không báo lỗi, không có "Gửi lại yêu cầu", body `start` rỗng; callback không quay về hội thoại | 28/28 |
| Web: đọc lại dịch vụ khi màn từ chối hiện ra (mục "Khác" số 3) | 1 fail: `onRefreshServices` được gọi 0 lần | cùng `gmail-ui.test.tsx` và `fe-06b-responses.test.tsx` có sẵn: 76/76 bốn file |
| Web: nhãn "Cần kết nối lại" (mục "Khác" số 4) | 1 fail: hàng ghi "Chưa kết nối" | 76/76 bốn file |
| Browser `OAUTH-01 from chat:` | 4/4 fail: 5 file web đưa về bản `main`, API mới. Sau "Kết nối Gmail", URL là `/settings#gmail` thay vì `/c/<id>`. Khôi phục, SHA-256 khớp 5/5. Sau đó, ở lượt browser đầy đủ thứ ba, 2/4 fail vì lỗi danh sách dịch vụ cũ (mục "Khác" số 3) | 4/4 trong nhóm `gmail` (lượt đầy đủ thứ tư) |

Lượt RED browser đầu tiên fail sai lý do (không đăng nhập được, xem mục chập chờn); kết quả trong bảng là lượt chạy lại.

Đặc tả mục 4.1, 5.1 và 8 có ghi chú "(OAUTH-01)" cho các chỗ khác ở trên.

## Đột biến

`.codex/oauth01/mutate.mjs`: áp một đột biến, chạy test liên quan, khôi phục, so SHA-256.

**20/20 bị bắt**: 8 đột biến của task card (O1–O8) và 12 đột biến thêm. O1–O18 và O20 chạy bằng vitest trên PostgreSQL tạm, trên mã cuối (`.codex/oauth01/mutations-2.log`); O19 chạy 4 ca browser `OAUTH-01 from chat:` trên DB tạm dựng lại sạch (`browser-O19.log`).

| # | Đột biến | Test bắt |
|---|---|---|
| O1 | nhận `returnTo` của hội thoại người khác | refuses every other return path without creating a state |
| O2 | nhận địa chỉ ngoài hoặc `//…` | refuses every other return path… |
| O3 | callback trả `returnTo` khi lỗi (Google không trả refresh token) | gives no return path when Google fails after the state was used… |
| O4 | callback trả `returnTo` của state khác của cùng người | gives a failed callback no return path, and each flow only its own |
| O5 | "Gửi lại yêu cầu" tự gửi khi quay về | never sends the request again on its own, và 2 ca khác |
| O6 | "Gửi lại yêu cầu" hiện khi còn dịch vụ chưa dùng được | waits until every missing service can be used… |
| O7 | màn callback điều hướng tới `returnTo` không kiểm mẫu | 5 ca `goes to the settings page when the return path is not a conversation` |
| O8 | nút ở màn từ chối vẫn đi tới `/settings` | connects Gmail straight from the refusal…, và 2 ca khác |
| O9 | không đổi UUID sang chữ thường | keeps the caller's own conversation with the state… |
| O10 | ràng buộc migration nhận mọi đường dẫn bắt đầu bằng `/` | cả 2 ca migration |
| O11 | `returnTo` sai vẫn tạo state | refuses every other return path without creating a state |
| O12 | không chặn bấm hai lần | connects Gmail straight from the refusal… |
| O13 | không kiểm phiên trước khi sang Google | stays on the page when another person signed in… |
| O14 | bấm kèm phím bổ trợ vẫn bắt đầu kết nối | leaves a click with a modifier key to the browser… |
| O15 | Gmail cần kết nối lại vẫn ghi "Kết nối Gmail" | offers to connect again when the connection needs it |
| O16 | không gửi `returnTo` trong body | sends the return path in the body of the start request |
| O17 | màn từ chối không đọc lại dịch vụ | reads the services again when a refusal appears… |
| O18 | hiện "Gửi lại yêu cầu" khi danh sách đang tải lại | reads the services again when a refusal appears… |
| O19 | `Workspace` không nối `onRefreshServices` | browser: ca 1440 dark và 375 dark fail ở "Kết nối Gmail" (2 fail, 2 đạt) |
| O20 | hàng Gmail cần kết nối lại ghi "Chưa kết nối" | offers to connect again when the connection needs it |

## Kiểm toàn bộ

- `npm run check` (`DATABASE_URL` của DB tạm, `RUNTIME_MODE=sandbox`, sau `db:migrate:v3`), trên mã cuối: **exit 0**, 63 + 408 + 359 + 42 + **554** + **789** = **2.215 v3** + **394 eval**. So với `main`: `chat-api` thêm 7 test (5 ở route, 2 ở migration), web thêm 16 (10 ở `oauth-01-refusal`, 6 ở `gmail-callback`). Typecheck, build, quét bản build và các test script đều đạt.
  - Lượt `check` đầu exit 1 vì ràng buộc có `mode` (mục "Khác" số 1); các lượt sau exit 0. Lượt trên mã cuối (sau khi sửa nhãn "Cần kết nối lại") chạy trên DB dựng lại sạch: `.codex/oauth01/check-final.log`.
- `npm run test:browser:v3` trên DB tạm dựng lại sạch ở 56533, cổng riêng (API 3999, web 5199): **exit 0** ở lượt thứ tư và lượt thứ năm (trên mã cuối), cả hai **124 pass/1 skip có chủ đích, 13 nhóm** (default 93, `gmail` 8 = 4 GMAIL-03 + 4 OAUTH-01). Ba lượt đầu:
  - lượt 1 exit 1 ở nhóm `default`: 4 ca OAUTH-01 bị chọn nhầm (mục "Khác" số 2) và 1 ca FE-06A chập chờn (dưới);
  - lượt 2 exit 1 ở nhóm `default`: 1 ca FE-04 chập chờn (dưới);
  - lượt 3 exit 1 ở nhóm `gmail`: 2 ca OAUTH-01 bắt được lỗi danh sách dịch vụ cũ (mục "Khác" số 3). Nhóm `default` lượt này đạt 93/93.
- Không gọi Google hay model thật. Gmail và OAuth là bản giả của GMAIL-03.

## Test chập chờn gặp trong lúc làm (ngoài diff)

- `gmail-migration.test.ts:68` lỗi `could not open relation with OID …` (mục 5 của CURRENT-STATE): 2/5 lượt khi chạy song song ba file `gmail-connections`, `oauth-return-to-migration`, `gmail-migration`; 0/5 khi chạy từng cặp. Câu truy vấn của test gọi `pg_get_constraintdef` trên mọi ràng buộc của DB trong lúc file khác đang chạy DDL. File migration mới của PR này cũng chạy DDL song song, nên có thể làm lỗi này hay gặp hơn. Không sửa test cũ trong PR này.
- Browser lượt 1: `FE-06A … 1440 light` trang trắng, trình duyệt không tải được module (`net::ERR_NO_BUFFER_SPACE`). Lượt 2: `FE-04: shell menu…` hết 30 s chờ ô Email ở `/login`, không có ảnh trang. Cả hai giống các ca chập chờn đã ghi ở mục 5; lượt 3 và 4 hai ca này đạt.
- Container DB tạm `ati-oauth01-pg` đã dừng một lần (exit 0) giữa hai lượt chạy, không do lệnh nào của bên thi công; một lượt RED browser vì thế fail ở bước đăng nhập. Đã dựng lại DB; từ đó mỗi lượt browser chạy trên DB dựng lại sạch (`.codex/oauth01/fresh-db.sh`).

## Chưa làm

- Không gọi Google thật. Nghiệm thu thật đi cùng GMAIL-04, do nhóm trưởng thao tác.
- Quay về hội thoại khi người dùng huỷ ở Google hoặc state hết hạn (đặc tả mục 7): trang callback báo lỗi như cũ.
- OAUTH-02 (Google Calendar riêng), quyết ngày 29/10.
