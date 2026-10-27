# 26/10/2026 · OAUTH-01 · Sửa sau review độc lập lần 2 (#172)

**Người viết:** reviewer (bên thi công). **Nhánh:** `feat/oauth-01-connect-from-chat`, sửa trên head `da32e65`. Review độc lập lần 2 tại `da32e65`: **chưa đạt**, 1 P2 mới; hai lỗi của lần 1 đã đóng. Log trước: [thi công](2026-10-26-reviewer-OAUTH-01-connect-from-chat.md), [sửa lần 1](2026-10-26-reviewer-OAUTH-01-review-fixes.md).

## P2: nút "Gửi lại yêu cầu" nhận focus nhưng bị ô soạn tin che ở 375 px

Lỗi đúng như mô tả. Ô soạn tin của màn từ chối là footer `position: fixed` ở đáy. Sau khi kết nối Gmail, câu "Gmail đã được kết nối…" đẩy hàng nút xuống dưới footer. Nhấn Tab tới nút thì trình duyệt không cuộn, vì nút vẫn nằm trong viewport, chỉ là bị footer che.

**Nguyên nhân sâu hơn:** cockpit dùng ba trang của bản mẫu: `app-stage`, `responses` (từ chối, trả lời, hỏi lại mở rộng) và `errors` (lỗi lập kế hoạch). Cả ba đều có cùng footer cố định. `ChatComposer` đo chiều cao footer vào biến `--cockpit-bottom-space`, nhưng chỉ `app-stage` dùng biến này để chừa chỗ dưới `body`. Màn từ chối ở trang `responses`, nên chỉ có `pb-24` (96 px) của bản mẫu, thấp hơn footer ở 375 px (120 px khi tính cả khoảng cách 16 px).

**Sửa** (`apps/chat-web/src/index.css`, một chỗ):
- quy tắc chừa chỗ dưới `body` áp cho cả ba trang của cockpit, không chỉ `app-stage`;
- thêm `scroll-padding-bottom: var(--cockpit-bottom-space, 96px)` trên `:root` của ba trang đó. Khi focus di chuyển bằng bàn phím, trình duyệt cuộn để phần tử nằm trên footer, không chỉ nằm trong viewport (cách C43 của WCAG cho tiêu chí 2.4.11).

Thử trước bằng probe trên Chromium thật: chỉ thêm `scroll-padding` cho `app-stage` thì không đổi gì, vì `scroll-padding-bottom` của màn từ chối vẫn là `auto`. Áp cho ba trang thì sau một lần Tab, trang cuộn tới `scrollY 167` và nút nằm ở `top 653` (trước đó `scrollY 0`, `top 820`, bị `chat-prompt-input` che).

Thay đổi áp cho mọi phần tử nhận focus trên ba trang này, không chỉ nút của OAUTH-01. Với trang `responses` và `errors`, khoảng chừa dưới `body` nay theo chiều cao footer đo được (tối thiểu 96 px như cũ), giống `app-stage` đã làm từ FE-05b.

## RED → GREEN

Ca browser mới `OAUTH-01 from chat: actions reached with Tab stay above the composer`, ở 1440 và 375. Ca này đi từ tiêu đề bằng Tab qua từng nút trong `#s1-action-area`, ở hai trạng thái: trước khi kết nối, và sau khi quay về. Mỗi điểm dừng phải nằm trong viewport, và `document.elementFromPoint` tại tâm nút phải là chính nút. Không gọi `click()` vào các nút này, nên Playwright không tự cuộn hộ.

PostgreSQL 16 tmpfs riêng ở 56533, dựng lại sạch trước mỗi lượt; API 3999, web 5199; sandbox, OAuth HTTP giả, không dùng `.env` hay DB dev.

| Lượt | Kết quả |
|---|---|
| RED, mã của `da32e65` | 375 fail: `{"name":"Gửi lại yêu cầu","top":820,"bottom":852,"viewport":900,"unobscured":false,"blocker":"chat-prompt-input"}`; 1440 đạt |
| Thử chỉ `app-stage` | vẫn fail, cùng số |
| GREEN, ba trang | 7/7 ca `OAUTH-01 from chat:` (2 mới, 4 cũ, 1 probe đã xoá) |
| Đột biến: bỏ dòng `scroll-padding-bottom`, giữ phần chừa chỗ | fail đúng như RED; khôi phục, SHA-256 `7ef8da57…` khớp |

## Kiểm toàn bộ

Trên mã cuối, mỗi lượt dùng một DB tạm dựng lại sạch:
- `npm run check` (`VITEST_MAX_WORKERS=2`): **exit 0**, 63 + 408 + 359 + 42 + 554 + 792 = **2.218 v3** + **394 eval**. Không đổi so với lần 1, vì ca mới là browser. Log: `.codex/oauth01/review2-check.log`.
- `npm run test:browser:v3`: **exit 0 ngay lượt đầu**, **126 pass/1 skip có chủ đích, 13 nhóm**. Nhóm default 93; nhóm `gmail` từ 8 lên 10, nhờ hai ca mới. Mọi nhóm khác giữ số cũ, kể cả nhóm `answer` (4 ca, màn trả lời ở trang `responses`). Log: `.codex/oauth01/review2-browser-full.log`.

## Chưa làm

- Không gọi Google thật (đi cùng GMAIL-04).
