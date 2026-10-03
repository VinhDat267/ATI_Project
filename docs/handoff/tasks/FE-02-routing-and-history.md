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

- PR: [#42](https://github.com/VinhDat267/ATI_Project/pull/42), xếp trên AUTH-01 [#41](https://github.com/VinhDat267/ATI_Project/pull/41); chưa merge.
- Commit: API `4fdd375`, frontend `c4631dc`, tích hợp AUTH-01 `caf1bd6` và các merge tiếp theo; sửa giữ bằng chứng snapshot `3449f07`. Bản kết hợp có W3-08 từ `main` `c5ce8a0` và AUTH-01 head `4f5aa47`.
- Test đã chạy và kết quả:
  - RED→GREEN: routing/history, hydration khi StrictMode chạy lại effect, refresh title, PostgreSQL API, browser empty/reading scroll; regression snapshot lỗi 503 (2 ca, có/không có tiến triển SSE mới) fail trước sửa và giữ đúng detail/preview/evidence sau sửa.
  - PostgreSQL/memory history **9/9**: first-user title 60 code points, rename/owner isolation, 57 dòng trùng timestamp không trùng/mất dòng, timestamp microsecond trong cùng millisecond, literal `%`/`_`/backslash loại decoy, migration hai lần giữ dữ liệu. Mutation bỏ escaping bị regression decoy bắt; lần probe đầu thiếu setup migration được giữ riêng và không tính là bằng chứng sản phẩm.
  - `npm run check` sau sửa review: exit 0; v3 **948/948** = schemas 47, adapters 317, planner 172, executor 25, API 203, web 184; evaluation **165/165**; strict typecheck/build/production credential scan/launcher 1/1/environment guards 3/3 đều đạt.
  - Browser PostgreSQL thật qua đủ 9 scenario: **20/20** trên bản kết hợp; default **11/11** chạy lại sau sửa snapshot. Có Back/Forward, direct URL reload cả pending plan/snapshot, foreign link không lộ dữ liệu, history >50/search/rename, scrollTop 0 và không kéo người đọc phía trên xuống.
  - Review độc lập: probe retention ban đầu fail, sau `3449f07` exit 0; route/history/snapshot 17/17, history DB/memory 9/9, strict exit 0; kết luận kỹ thuật đạt. CI head đầu đã xanh; CI kiểm tra lại head bàn giao có fix review và tài liệu.
- Điều chưa làm hoặc khác với task card:
  - Chọn path route `/`, `/login`, `/c/:id`, không thêm thư viện. App còn **12 dòng**, form/auth ở AuthGate, bố cục ở Workspace, recovery ở hook, view ở `src/views/`.
  - Cursor gồm `updated_at` PostgreSQL microsecond + UUID; memory fallback giữ cùng contract. Migration title dùng `0004`; task AUTH tiếp theo chọn số chưa dùng theo AUTH-common.
  - Merge AUTH-01 #41 trước, retarget FE-02 #42 sang main và kiểm tra lại CI. Local browser dùng cấu hình ngoài repo trỏ đúng DB tạm, giữ nguyên guard local/CI; canonical `npm run test:browser:v3` do GitHub CI chạy. Chưa thay CURRENT-STATE/ROADMAP, không redesign giao diện hay thêm dependency.
