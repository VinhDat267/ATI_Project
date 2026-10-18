# 18/10/2026 · GMAIL-04 · Sửa theo review #154

**Người viết:** reviewer (nhóm trưởng giao thi công) · **Nhánh:** `eval/gmail-04-measure` (#154), từ head `69e76ee` · Task: [GMAIL-04](../tasks/GMAIL-04-measure-and-live.md). [Review độc lập](https://github.com/VinhDat267/ATI_Project/pull/154#issuecomment-6244612341) (18/10): chưa đạt, 2 P2 ở label mới.

Chưa có lời gọi model nào trên hai bộ, nên label được sửa trước khi đo, không phải để khớp kết quả. Mỗi phần sửa nằm trong một commit riêng, có giải thích.

## Đã sửa

- **P2 `an_gm02` nhận câu tìm chữ "unread" thay cho lọc thư chưa đọc.**
  - Label cũ chỉ cần `query` chứa `unread`. Câu tìm `unread` trả 0 thư trong hộp thư giả, nên câu trả lời "không có thư chưa đọc" vẫn đạt, trong khi hộp thư có 8 thư chưa đọc.
  - `b6a5450`: `query` phải lọc thư chưa đọc, chứa `is:unread` hoặc `label:unread`.
- **P2 `gm15` không buộc đọc thư trước khi đăng lên Slack.**
  - Label cũ chỉ chấm bước Slack, nên một kế hoạch đăng nội dung trái với thư mà không hề tìm thư vẫn đạt.
  - Chỉ thêm `expect.searches` vào label thì chưa đủ: scorer chấm lần tra cứu xong là trả kết quả, bỏ qua các bước.
  - `5cf9a02` (scorer): kế hoạch có label tra cứu phải đạt cả lần tra cứu lẫn các bước. Không label cũ nào vừa có `searches` vừa có kế hoạch (đã kiểm cả sáu file label), nên điểm của các bộ cũ không đổi.
  - `b6a5450` (label): `gm15` cần một lần `gmail.search_threads` tìm luồng "Kế hoạch kiểm thử". Câu Slack phải nhắc tới việc kiểm thử; bỏ lựa chọn "PR" vốn quá lỏng.

## Kiểm thử

- Scorer: test mới cho kế hoạch có label tra cứu fail trên scorer cũ (chỉ chấm tra cứu), rồi đạt sau `5cf9a02`. Golden-v2 đạt 205/205.
- Label: hai test mới chạy `an_gm02` và `gm15` qua `runCase()` với planner và fixture thật, mock chỉ thay model:
  - **`an_gm02`:** tìm `unread` trả 0 thư và phải fail; `is:unread`, `in:inbox is:unread`, `label:UNREAD` đều trả 8 thư và phải pass;
  - **`gm15`:** đăng Slack mà không tìm thư phải fail; tìm luồng rồi đăng phải pass.

  Trên label cũ, đúng hai test này fail (2 fail / 34 pass); trên label mới, 36/36.
- Đột biến: thêm 3 đột biến vào luật chấm mới (bỏ chấm bước, bỏ kiểm tra cứu ở tool, bỏ kiểm tra cứu ở tham số). Chạy lại cả bộ: **22/22 bị bắt**.
- Typecheck chặt `evaluations/golden-v2`: exit 0.
- `npm run check` (PostgreSQL 16 tmpfs riêng ở 55533, sandbox, hai cờ tắt, không dùng `.env`): **exit 0** ngay lượt đầu, **2.014 v3 + 330 eval** (thêm 3 test so với `69e76ee`); quét bản build đạt 7 mẫu.

Không gọi model hay Google thật.
