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

- **PR:** [#172](https://github.com/VinhDat267/ATI_Project/pull/172), nhánh `feat/oauth-01-connect-from-chat` từ `main` `c760aa3`. Reviewer thi công ngày 25–26/10. Chi tiết: [log](../log/2026-10-26-reviewer-OAUTH-01-connect-from-chat.md).
- **RED/GREEN:** PostgreSQL 16 tạm riêng ở 56533, sandbox, không dùng `.env` hay DB dev.
  - API và migration: RED 3 fail ở route, migration fail vì chưa có file; GREEN 33/33 (cùng `gmail-migration.test.ts`);
  - web: RED 7 fail / 21 đạt; thêm hai RED sau đó (đọc lại dịch vụ, nhãn "Cần kết nối lại"); GREEN 76/76 bốn file;
  - browser `OAUTH-01 from chat:`: RED 4/4 trên mã web của `main` (URL về `/settings#gmail`); GREEN 4/4.
- **Đột biến:** 20/20 bị bắt, gồm đủ 8 đột biến của task card.
- **Kiểm toàn bộ:** `npm run check` exit 0, 63 + 408 + 359 + 42 + 554 + 789 = 2.215 v3 + 394 eval (`chat-api` thêm 7, web thêm 16). `npm run test:browser:v3` exit 0, 124 pass/1 skip có chủ đích, 13 nhóm (`gmail` 8). Cả hai chạy trên mã cuối, DB tạm dựng lại sạch.
- **Khác với task card và đặc tả** (đã ghi "(OAUTH-01)" ở đặc tả 4.1, 5.1, 8):
  - ràng buộc của migration không có phần `mode = 'connect_gmail'`, vì test có sẵn của 0009 đếm đúng 2 ràng buộc nhắc `mode`. Chờ nhóm trưởng xác nhận;
  - mỗi màn từ chối mới gọi lại `GET /api/services`, vì danh sách tải lúc đăng nhập có thể cũ hơn lời từ chối; browser bắt được lỗi này ở lượt chạy thứ ba;
  - tên ca browser bắt đầu bằng `OAUTH-01 from chat:`, vì `OAUTH-01:` khớp bộ lọc `AUTH-01:` của nhóm `default`;
  - ba test viết sau khi đã có mã, để có test bắt đột biến O3, O4, O13; chúng không có RED.
- **Chưa làm:** gọi Google thật (đi cùng GMAIL-04); quay về hội thoại khi người dùng huỷ ở Google (đặc tả mục 7).
