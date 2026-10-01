# FE-02 · Điều hướng bằng URL, tách `App.tsx`, lịch sử hội thoại dùng được

**Trạng thái:** chờ · **Nhánh gợi ý:** `refactor/fe-02-routing-and-history` · **Phụ thuộc:** không · **Chặn:** phần giao diện của AUTH-02 → AUTH-05 và W3-00b · **Làm song song với:** FE-01 (cả hai sửa `App.tsx`; task merge sau tự rebase)

## Vì sao làm trước các task tài khoản

`App.tsx` (542 dòng) tự giữ cùng lúc:
- view bằng `useState<'landing' | 'login'>` và `history.pushState`;
- trạng thái đăng nhập, form login;
- logic phục hồi thực thi;
- toàn bộ bố cục.

Mảng tài khoản sẽ thêm khoảng 8 view (signup, verify-email, forgot/reset, google-callback, account, admin-users…), W3-00b cũng sửa file này. Nếu không tách trước, 5–6 task làm song song sẽ cùng sửa một file.

## Lỗi hiện tại (đã xác nhận khi chạy sandbox)

- **Nút Back/Forward của trình duyệt không đổi màn hình:** code đổi URL bằng `pushState` nhưng không có listener `popstate` (`grep popstate` không có kết quả).
- **Tải lại trang thì mất hội thoại đang mở:** `conversationId` không nằm trong URL, nên app về màn hình trống. Không chia sẻ hay mở lại được link của một hội thoại.
- **Sau khi đăng nhập, URL vẫn là `?view=login`.**
- **Lịch sử hội thoại không phân biệt được:**
  - API `GET /api/conversations` không có trường tiêu đề, nên mọi mục đều hiện "Hội thoại mới" (sandbox có 50 mục giống hệt nhau);
  - `listConversations` giới hạn cứng 50, không phân trang: hội thoại cũ hơn không mở lại được.
- **Màn hình trống bị cuộn xuống đáy khi mở:** hiệu ứng tự cuộn của `ChatContainer` chạy cả khi chưa có tin nhắn, nên phần đầu của launchpad bị che (đo được `scrollTop` 621/1141).

## Việc cần làm

1. **Điều hướng:**
   - một bảng route nhỏ `src/routes.ts` dùng đường dẫn hoặc `?view=` (chọn một, ghi lý do), không thêm thư viện nếu không cần;
   - xử lý `popstate`;
   - route `/c/<conversationId>` (hoặc `?c=`) để mở đúng hội thoại khi tải lại hoặc mở link;
   - hội thoại không thuộc người dùng thì báo "không tìm thấy", không lộ dữ liệu.
2. **Tách `App.tsx`:**
   - `AuthGate` (chưa đăng nhập → trang công khai);
   - `Workspace` (sidebar + chat);
   - `useExecutionRecovery` (logic `recover`);
   - mỗi view một file trong `src/views/`.

   Task sau thêm view bằng một file mới + một dòng trong `routes.ts`. Bỏ nhánh `process.env.NODE_ENV === 'test'` trong code chạy thật.
3. **Tiêu đề hội thoại:**
   - backend thêm cột `title` (migration idempotent), đặt bằng 60 ký tự đầu của tin nhắn người dùng đầu tiên;
   - người dùng đổi tên được;
   - API trả `title`.
4. **Phân trang lịch sử:** cursor theo `updated_at`, tải thêm khi cuộn; ô tìm theo tiêu đề.
5. **Cuộn:** chỉ tự cuộn xuống khi có tin nhắn mới và người dùng đang ở gần đáy. Màn hình trống bắt đầu ở đầu trang.

## Tiêu chí nghiệm thu

- [ ] Test: Back/Forward đổi đúng màn hình; tải lại `/c/<id>` mở đúng hội thoại, kể cả plan và tiến trình (dùng snapshot đã có); id của người khác thì báo không tìm thấy.
- [ ] Test API: `title` được đặt từ tin nhắn đầu, đổi tên được (chỉ chủ hội thoại); phân trang trả đủ khi có hơn 50 hội thoại (PostgreSQL thật); migration chạy hai lần không đổi dữ liệu.
- [ ] Test cuộn: màn hình trống có `scrollTop = 0`; có tin mới khi đang ở đáy thì cuộn xuống; đang đọc phía trên thì không bị kéo xuống.
- [ ] `App.tsx` dưới 150 dòng, không còn logic phục hồi hay form đăng nhập.
- [ ] Toàn bộ test cũ đạt (đổi import/đường dẫn ghi rõ trong PR); `npm run check` exit 0; `npm run test:browser:v3` đạt hết.

## Kết quả (agent thi công điền)

- PR:
- Commit:
- Test đã chạy và kết quả:
- Điều chưa làm hoặc khác với task card:
