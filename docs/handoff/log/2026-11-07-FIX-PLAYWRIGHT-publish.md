# FIX-PLAYWRIGHT — Đóng gói bản sửa workflow để tạo PR

- Ngày 07/11/2026, Asia/Bangkok; [task card](../tasks/FIX-PLAYWRIGHT-real-user-bugs.md).
- Chủ dự án yêu cầu commit/push/PR trên `fix/playwright-real-user-bugs`; source base `caa6cc5652dcb651a72061329efa1f54bdf80886`. `origin/main` tại thời điểm lấy base là `6e2d3bb9b922c83cc2554b12e198b867513d239d`, khác ba file handoff, không khác runtime code.
- Giữ snapshot 10 file ban đầu ở worktree kiểm tra riêng, không nạp `.env` live. Không thay `CURRENT-STATE.md` hoặc `ROADMAP.md`.

## Hành vi cuối

- GitHub dùng access token `gho_`/`ghp_` mà không refresh bằng refresh token cũ đi kèm.
- Trello chấp nhận `invalid_grant` trên HTTP 400/401/403 và thông báo đã quan sát `refresh_token is invalid`; các lỗi cấu hình hoặc thiếu tham số chỉ nhắc đến `refresh_token` không khiến grant bị đánh dấu mất.
- Readiness chọn kết nối cá nhân đã cấu hình thay vì alias cũ chưa cấu hình, không coi trạng thái chưa kiểm tra là đã mất quyền. Dùng tên Google Calendar/Sheets thay cho ID nội bộ, cải thiện badge và ẩn các alias dư.
- Quy trình dùng Gmail ẩn khi Gmail không có trong catalog; khi Gmail được bật nhưng chưa kết nối, thẻ quy trình và CTA kết nối vẫn hiện.
- Router bỏ qua tên dịch vụ nằm trong một đoạn nội dung Docs có dấu ngoặc kép, giữ yêu cầu gốc gửi model. Không mở rộng chứng nhận sang nội dung nhiều dòng hoặc nhiều đoạn trích dẫn.
- Hai ca hồi quy DeepSeek xác nhận model được cấu hình chuyển nguyên vẹn tới endpoint mặc định và gateway; không đổi default model/provider trong bản vá cuối.

## Kiểm tra

- Bản nháp ban đầu: API 15 PASS, planner 548 PASS; web 1 FAIL / 33 PASS do Gmail-off, typecheck FAIL TS2554 do test mới thiếu `AbortSignal`.
- Trước sửa bổ sung: Trello classifier HTTP thật 4 FAIL / 11 PASS; model forwarding 2 FAIL / 6 PASS; Gmail-off 1 FAIL / 10 PASS. Test dương Gmail bật nhưng chưa nối vẫn giữ luồng; một lượt đầu dùng selector CTA quá chặt đã được sửa rồi tái hiện lại lỗi Gmail-off riêng.
- Sau sửa: API 3 file **30 PASS**, planner 2 file **15 PASS**, web 4 file **35 PASS**; `npm run typecheck:v3` PASS, exit 0.
- Review độc lập: API 30, planner 15, web 17 PASS; probe HTTP loopback xác nhận lỗi cấu hình client không làm mất grant và model cấu hình không bị đổi. Không còn P1/P2 cụ thể trong phạm vi này.
- Kiểm tra tổng và Chromium đang chạy; cần điền kết quả trước commit.

## Ranh giới và sự cố thực thi

- Các lệnh DB của lượt kiểm tra chính đặt rõ `DATABASE_URL` tới PostgreSQL thử riêng cổng 56534. Chromium chạy sandbox trên cổng 3041/5241, không dùng app live.
- Một lệnh API của reviewer ban đầu thiếu `DATABASE_URL`, helper rơi về cổng mặc định 55533 rồi timeout. Không tính lượt đó là lỗi sản phẩm hay bằng chứng đạt. Helper có thể tạo schema thử riêng `trello_refresh_once_<uuid>` trước timeout; tác động tại DB mặc định chưa xác minh. Không thực hiện cleanup hoặc ghi thêm ở đó. Reviewer đã chạy lại với DB thử được chỉ định và đạt.
- Native OAuth/provider/model, 18 lượt workflow và Google Picker live chưa chạy trong task này. Không chuyển trạng thái FLOW-07 thành hoàn thành; không thay cấu hình Cloud, `.env` hoặc bật scheduler live.
- Artifacts riêng: `.audit/publish-playwright/` trong worktree kiểm tra, gồm snapshot, RED/GREEN, source hashes, full-check và browser output; không commit credential hay ảnh tài khoản thật.

## Nguồn hợp đồng đã đối chiếu

- [Atlassian refresh tokens](https://developer.atlassian.com/cloud/oauth/getting-started/refresh-tokens/).
- [DeepSeek model contract](https://api-docs.deepseek.com/quick_start/pricing/).
