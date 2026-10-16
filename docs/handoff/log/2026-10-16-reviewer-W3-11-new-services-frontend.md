# 16/10/2026 · W3-11 · Chạy thật năm service mới qua giao diện

**Người viết:** reviewer (nhóm trưởng giao thi công, ngồi duyệt cùng) · **Nhánh:** `test/w3-11-new-services-frontend`, base `e03a9c8` · Task: [W3-11](../tasks/W3-11-new-services-through-frontend.md).

## Môi trường

- App live chạy từ worktree riêng, `RUNTIME_MODE=live`, model `ag/gemini-3.8-flash` qua 9router (HTTP 200 lúc kiểm). Cờ `GMAIL_ENABLED` và `PLANNER_READ_ANSWERS` tắt.
- PostgreSQL 16 tmpfs riêng ở cổng 57533. Không dùng DB của `.env`. Migration 0001–0009 và tạo admin từ `CHAT_ADMIN_*` của `.env`. Biến `.env` được nạp bằng `--env-file`; `DATABASE_URL` đặt trong shell nên thắng giá trị của `.env`.
- Kiểm `.env` mà không in giá trị: 8 dịch vụ đều có khoá và allowlist một tài nguyên thử nghiệm.
- Khoá:
  - 7 dịch vụ lưu bằng `setup-credentials.ts` với `LIVE_APP_SKIP_SERVICES=sheets`;
  - Google Sheets do nhóm trưởng nhập ở `/settings`, gồm private key nhiều dòng thật.

  Cả 8 dịch vụ "Kiểm tra kết nối" `healthy`.

## Harness `evaluations/live-app/`

Bản cũ (01/10) không chạy được với giao diện hiện tại. Đã sửa:
- đăng nhập ở `/login` theo nhãn ô; chờ ô nhập chung của cockpit;
- lấy mã hội thoại từ URL `/c/:id` thay cho response `POST /api/conversations`;
- nút "Duyệt kế hoạch" và "Hủy" theo tên chính xác; khi Hủy, kiểm `rejected` và 0 `execution_steps`;
- sau khi duyệt, chờ kế hoạch ra khỏi `pending`/`approved`/`executing`; kiểm tiêu đề biên nhận "Đã xong N việc trên M công cụ"; lưu link biên nhận;
- `plan.json` có thêm `resource_labels`; ảnh chụp che menu người dùng;
- `LIVE_APP_CANCEL=1`: dừng ở xem trước rồi Hủy, không ghi;
- `setup-credentials.ts`: `LIVE_APP_SKIP_SERVICES` để chừa dịch vụ cho người nhập qua giao diện.

Không sửa mã sản phẩm.

## Các lượt chạy

Mỗi lệnh ghi chỉ chạy sau khi nhóm trưởng trả lời duyệt đúng kế hoạch và mã băm reviewer gửi trong chat; reviewer ghi đúng mã băm đó vào `confirm.txt`.

| Lượt | Plan hash | Tới xem trước | Kết quả trong PostgreSQL | Đọc lại |
|---|---|---|---|---|
| Hủy: Trello + Slack | `8f28d53fbe29…` | 9,7 s | `rejected`, 0 bước | — |
| Sheets + Slack | `c2bd9fc9d077…` | 12,3 s | `completed`, 2/2 `succeeded` | `sheets.read_range`: `Tasks!A3:B3` = 16/10/2026, "Kiểm tra W3-11 Sheets qua giao diện" |
| Calendar + Slack | `0fd1803c3077…` | 15,0 s | `completed`, 2/2 | `calendar.list_events`: sự kiện `ujv7cah9…`, 17/10 15:00–15:30 |
| Notion + Slack | `964af12a398d…` | 12,8 s | `completed`, 2/2 | `notion.query_database`: page `3fbf24d5-…-81aa…`, Trạng thái "Mới" |
| Telegram + Slack | `3fc1ad27de7d…` | 12,1 s | `completed`, 2/2, `messageId` 7 | nhóm trưởng xác nhận tin đã hiện trong nhóm ATI Test |
| Jira + Slack | `c815976561ff…` | 7,1 s | `completed`, 2/2 | `jira.search_issues`: `ATIT-5` |
| Jira → Notion → Telegram → Slack | `946c59595f7e…` | 13,9 s | `completed`, 4/4, thực thi 5,1 s | `ATIT-6`; Link của page Notion "Kiểm tra W3-11 workflow" bằng URL `ATIT-6`; Telegram `messageId` 8, nhóm trưởng xác nhận đã hiện |

- **Giao diện:** màn xem trước hiện tên tài nguyên thay cho ID ("Cần làm (board To Do)", "ATI Test Tracker", "ATI Test Notes", "ati-test"). Biên nhận có link "Xem dòng", "Mở lịch", "Mở trang", "Mở issue"; workflow hiện các mũi tên `url` giữa các bước.
- **Đọc lại:** dùng một script ở máy reviewer, chỉ chạy tool có `sideEffect: 'read'` trong allowlist, khoá lấy từ `.env`, không in khoá.
- **Slack:** tin Slack không đọc lại được bằng tool (đã biết).

## Khác với task card

- Không còn nhãn Đọc/Ghi: từ FE-05b mỗi bước có nhãn hành động, và kế hoạch chỉ gồm bước ghi.
- Ảnh toàn trang có ô nhắn thêm (cố định ở đáy màn hình) đè lên giữa biên nhận, ngay chỗ đáy khung nhìn 720 px ban đầu. Nhiều khả năng do cách Playwright chụp toàn trang giữ phần tử cố định theo khung nhìn ban đầu; chưa kiểm bằng cách cuộn trên trình duyệt thật.
- Thời gian tới xem trước là từng lượt, không phải phép đo W4-04.

## Gate

- `npm run check` trên nhánh (PostgreSQL 16 tmpfs riêng ở 55533, sandbox, không `.env`): exit 0, **1.953 v3** (63 + 408 + 291 + 42 + 464 + 685) **+ 173 eval**, build, quét bản build, launcher đạt. Bộ test không chạy file `evaluations/live-app/`.
- Typecheck riêng ba file harness: `tsc --noEmit --strict` (module `nodenext`), exit 0.
- Harness được kiểm bằng chính 7 lượt chạy live ở trên, mỗi lượt exit 0.

## Dọn dẹp

- App live đã dừng, PostgreSQL tạm đã xoá, khoá lưu trong đó mất theo. DB dev 15433 không bị đụng.
- Tài nguyên thử nghiệm giữ nguyên: dòng Sheets, sự kiện Calendar, hai page Notion, `ATIT-5`, `ATIT-6`, hai tin Telegram, 6 tin Slack. Dọn chỉ khi nhóm trưởng yêu cầu.
