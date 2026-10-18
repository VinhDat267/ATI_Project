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

## Lượt 2: sửa theo review lại `69e76ee..06a06ad`

[Review lại](https://github.com/VinhDat267/ATI_Project/pull/154#issuecomment-6244773528) (18/10): chưa đạt, 1 P2. Phần scorer chấm cả tra cứu lẫn các bước đã đúng. Nhưng label tra cứu vẫn chỉ kiểm câu tìm, nên câu tìm khớp label mà không tìm thấy gì vẫn đạt:
- `an_gm02`: `-is:unread` hoặc `is:unread in:trash` trả 0 thư, vẫn đạt;
- `gm15`: tìm thư trong Trash, nhận `[]`, rồi đăng Slack, vẫn đạt 3/3 matcher.

Lỗi cùng loại còn ở bốn label reviewer chưa nêu: `an_no01` và `an_ji01` (ví dụ `Footer bug` khớp `includesAll ['Footer']` nhưng trả 0 issue), `an_gm01`, `an_gm04`. Vá từng câu tìm không bao giờ kín, nên sửa ở scorer:
- **`30733f0` (scorer, fixture):**
  - label tra cứu có thêm `found`, danh sách ID mà kết quả của lần tra cứu phải có, tính như một matcher nữa. ID lấy từ mọi trường `id` trong kết quả, kể cả lồng trong object (luồng thư, issue Jira, trang Notion);
  - hộp thư giả hiểu toán tử phủ định `-` như Gmail. `-is:unread` trả 0 thư, đúng như Gmail thật với hộp thư toàn thư chưa đọc.
- **`a9d7a5b` (label, commit riêng):** thêm `found` cho mọi label tra cứu có tham số không cố định:
  - `an_gm02`: đủ 8 luồng chưa đọc, nên câu tìm chỉ lấy được một phần (`is:unread subject:Họp`) cũng không đạt;
  - `an_gm01`: luồng 3; `an_gm04`: luồng 7; `gm15`: luồng 5;
  - `an_no01`: trang Release notes; `an_ji01`: FE-42.

  Label chỉ có tham số cố định (`equals`/`instantEquals`: vùng Sheets, khung giờ Calendar, danh mục Telegram, `get_thread`) giữ nguyên.

  Test mới buộc mọi label tra cứu có tham số không cố định phải có `found`, và mỗi ID phải có trong fixture.

Kiểm thử lượt 2:
- Scorer: test `found` fail trên scorer `06a06ad` (chưa tính `found`), đạt sau `30733f0`. Fixture: test phủ định fail trước, đạt sau.
- Label: phản ví dụ của reviewer chạy qua `runCase()`. `an_gm02` với `unread`, `-is:unread`, `is:unread in:trash`, `is:unread subject:Họp` đều fail; `is:unread`, `in:inbox is:unread`, `label:UNREAD` đều pass. `gm15` tìm trong Trash fail; đọc luồng rồi đăng thì pass. Trên label ở `06a06ad`, đúng 3 test mới fail (3 fail / 34 pass); trên label mới, golden-v2 đạt 209/209.
- Đột biến: thêm 4 đột biến (bỏ `found`; `found` chỉ cần một ID; không lấy ID lồng; bỏ phủ định). Cả bộ **26/26 bị bắt**.
- Typecheck chặt `evaluations/golden-v2`: exit 0.
- `npm run check` (PostgreSQL 16 tmpfs riêng ở 55533, sandbox, hai cờ tắt, không dùng `.env`): **exit 0** ngay lượt đầu, **2.014 v3 + 332 eval** (thêm 2 test so với `06a06ad`); quét bản build đạt 7 mẫu.
