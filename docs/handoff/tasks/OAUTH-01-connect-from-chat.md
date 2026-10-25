# OAUTH-01 · Kết nối ngay trong hội thoại

**Trạng thái:** chờ, giao reviewer · **Nhánh gợi ý:** `feat/oauth-01-connect-from-chat` · **Phụ thuộc:** không bắt buộc. Migration số 0011 đứng sau 0010 của SCHED-01 (#167), nhưng chạy được dù #167 chưa merge · **Mốc:** merge trong 26/10–29/10/2026
**Đặc tả:** [`2026-10-25-oauth-connect-from-chat-design.md`](../../superpowers/specs/2026-10-25-oauth-connect-from-chat-design.md), đọc hết trước khi làm. Quy tắc của Gmail: [GMAIL-common](GMAIL-common.md).

## Mục tiêu

Khi `GMAIL_ENABLED=on`, người dùng đang ở màn từ chối vì Gmail chưa kết nối:
- bấm "Kết nối Gmail", cấp quyền ở Google, rồi quay về **đúng hội thoại đó**;
- bấm "Gửi lại yêu cầu" để lập kế hoạch lại;
- kế hoạch vẫn phải duyệt như thường.

Khi cờ tắt, hệ thống không đổi.

## Việc cần làm

1. **Migration** `db/v3/0011_oauth_return_to.sql`: cột `oauth_states.return_to` và ràng buộc có tên, đúng đặc tả mục 4.1. Chạy lại được.
2. **Repository** (`google-auth-repo.ts`): `createState` nhận `return_to` tuỳ chọn; `consumeState` trả nó cùng state.
3. **Route** `apps/chat-api/src/routes/connections/gmail.ts`:
   - `start` nhận `returnTo` theo đặc tả 4.2. Kiểm hội thoại thuộc người gọi bằng `ConversationRepo.getConversation`; sai thì trả `400 RETURN_TO_INVALID` và không tạo state;
   - `callback` trả thêm `returnTo` khi thành công (đặc tả 4.3).
   - Truyền `ConversationRepo` (hoặc một hàm kiểm chủ hội thoại) vào `createGmailConnectionRoutes` từ `app.ts`.
4. **Web:**
   - `api-client.ts`: `startGmailConnection(options?: { returnTo?: string })`; `completeGmailConnection` trả `{ email, returnTo? }`;
   - `RefusalMoment`: nút kết nối theo trạng thái Gmail hiện tại, "Gửi lại yêu cầu" và trạng thái thật của từng dịch vụ (đặc tả 5.1, 5.2). Cockpit truyền id hội thoại, dữ liệu dịch vụ hiện tại, và hàm gửi tin bình thường vào màn này;
   - `GmailCallbackView`: điều hướng tới `returnTo` hợp lệ (đặc tả 5.3);
   - `PersonalGmail` giữ nguyên.
5. **Browser:** thêm ca vào nhóm `gmail` theo đặc tả mục 8. Dùng lại OAuth và Gmail giả (`scripts/fake-google-gmail.mjs`) của GMAIL-03.

## Test tối thiểu

Theo đặc tả mục 8: API trên PostgreSQL thật, web unit, browser nhóm `gmail` ở 1440/375 sáng/tối, cùng các ca giữ hành vi khi cờ tắt. Viết test trước, chạy thấy fail đúng lý do, rồi mới cài đặt.

## Đột biến

Tám đột biến ở đặc tả mục 8. Ghi kết quả từng đột biến vào log.

## Tiêu chí nghiệm thu

- [ ] RED trước GREEN; đột biến đều bị bắt.
- [ ] `npm run check` exit 0; `npm run test:browser:v3` exit 0, không sửa assertion cũ.
- [ ] Không có open redirect: chỉ `/c/<uuid>` của chính người gọi.
- [ ] Không gọi Google thật. Nghiệm thu thật đi cùng GMAIL-04 và do nhóm trưởng thao tác.

## Ngoài phạm vi

OAUTH-02 (Google Calendar riêng), provider mới, quay về hội thoại khi người dùng huỷ ở Google (đặc tả mục 7), luồng khoá của quản trị viên ở `/settings`.

## Kết quả (agent thi công điền)

- PR:
- RED/GREEN, đột biến, lệnh kiểm và exit code:
- Điều chưa làm hoặc khác với task card:
