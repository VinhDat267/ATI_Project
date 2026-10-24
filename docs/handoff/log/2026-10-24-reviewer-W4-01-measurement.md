# 24/10/2026 · Đo W4-01 bằng model thật

**Người viết:** reviewer. Nhóm trưởng giao. **Nhánh:** `test/w4-01-independent-cases`, base `a020a55`. Task: [W4-01](../tasks/W4-01-independent-eval-set.md) việc 4–5. [Báo cáo](../../ai-evidence/V3-GOLDEN-V2/2026-10-24-W4-01-REPORT.md).

## Quyết định của nhóm trưởng

- **22/10:** định để hai thành viên chưa từng xem code viết 32 câu, có trang form hỗ trợ; hai người đã xem prompt không viết. Cùng ngày, nhóm trưởng dặn chưa đụng tới bốn file `member-1.json` → `member-4.json` và `cases.json` đã sửa trong thư mục chính.
- **23/10:**
  - "hãy sử dụng 4 file": dùng bộ 32 câu đó, huỷ việc viết thêm. Trang form chưa được dùng nên không đưa vào PR;
  - xác nhận câu do bốn thành viên viết, trong đó hai người đã xem hoặc sửa prompt. Repo không ghi mã nào thuộc nhóm nào;
  - đồng ý đẩy nhánh có commit đăng ký lên GitHub trước khi đo.
- **24/10:**
  - đo ngay tối đó, dù vẫn trong ba ngày thử W4-03, vì không có lượt thử nào;
  - khi bộ chạy dừng vì quá hạn, chọn "tính là trượt, chạy tiếp".

Reviewer chỉ kiểm định dạng, không viết hay sửa câu nào.

## Chuẩn bị

- **Worktree riêng** `ATI_Project-wt-w401` từ `origin/main` `a020a55`, `npm ci`. Thư mục chính vẫn giữ nguyên các file `member-*.json`; bộ chạy không cho đo ở đó, vì thư mục `evaluations/golden-independent` chưa sạch.
- **Kiểm `cases.json`:** chép từ thư mục chính, SHA-256 khớp (`c4425f51…`). Nội dung bằng đúng bốn file `member-N.json` ghép theo thứ tự.
- **Kiểm định dạng:**
  - `validate.ts --partial`: cả bốn file exit 0;
  - `validate.ts` đầy đủ: exit 0;
  - test golden-independent và golden-v2: 312/312;
  - chạy khô (provider giả, output ra scratchpad) ở `regex` và `llm`: exit 0.
- **Commit đăng ký** `2cdaf90` (14:17:18Z), chỉ `cases.json`, đẩy lên GitHub ngay. Commit ghi trước rằng kết quả sẽ tách theo người viết.
- **9router:** `/models` trả HTTP 200. `.env` có `LLM_MODEL=ag/gemini-3.8-flash`. Chỉ đọc tên biến và các biến không bí mật.

## Thứ tự chạy (UTC)

Lệnh: `LIVE_EVAL=1 EVAL_SET=independent PLANNER_SEARCH_MODE=<mode> PLANNER_READ_ANSWERS=off GMAIL_ENABLED=off LLM_MODEL=ag/gemini-3.8-flash EVAL_RUNS=3 EVAL_CONCURRENCY=2 node --env-file=<.env của thư mục chính> --import tsx evaluations/golden-v2/run.ts`. Các bước chạy nối tiếp.

1. **14:25–14:27, trên `2cdaf90`.** `llm` dừng sau 9/96 câu, ở `m1-03`; `regex` dừng sau 6/96, ở `m1-05`. Cả hai đều quá hạn 30 s ở cả hai lần thử. Exit 2.
2. **Thử 9router.** 5 yêu cầu nhỏ: HTTP 200, 1,9–8,5 s. Nhóm trưởng xem dashboard 9router. Sau đó 5 yêu cầu nhỏ và 5 yêu cầu khoảng 20.000 ký tự: HTTP 200, 2,1–4,4 s.
3. **14:34–14:37, trên `2cdaf90`.** Dừng đúng như lần 1: `llm` ở `m1-03` (7/96), `regex` ở `m1-05` (6/96). `regex` `m1-06` cũng quá hạn ở lần thử đầu, cả hai lần chạy.
4. **Khoảng 14:40, chạy lại để chẩn đoán**, không chấm điểm. Gửi đúng request của planner, một lần thử, chờ tối đa 180 s:
   - `m1-03` `llm`: 44,6 s, 4.842 reasoning token, 149 token trả lời, `stop`;
   - `m1-05` `regex`: 34,9 s, 3.786 reasoning token, 44 token trả lời.

   Nguyên nhân gốc: model suy nghĩ lâu hơn deadline 30 s. 9router không treo, và model không sinh ra đầu ra dài.
5. **Sửa bộ chạy, commit `91cd5c1` (14:46:43Z).** TDD: 3 test mới chạy bằng deadline và `AbortSignal` thật. RED 4 fail (gồm `stopReason` ở test cũ), GREEN runner 18/18, golden-v2 và golden-independent 315/315, typecheck hai gói exit 0. 2/2 đột biến bị bắt: bỏ bước đặt lại bộ đếm, và không bao giờ dừng khi quá hạn. README ghi quy tắc mới.
6. **Thử 9router** (3 yêu cầu nhỏ: HTTP 200, 2,9–4,1 s), rồi chạy hai lượt đủ:
   - 14:47–15:00, `llm`: exit 0, 96/96;
   - 15:00–15:13, `regex`: exit 0, 96/96.

## Kết quả

- **`llm` ×3:** **89/96** (30, 31, 28), tool 93,7%, tham số 100%, p50/p95 10,8/60,0 s. 17/124 lần thử quá hạn; 4 câu chấm trượt vì quá hạn.
- **`regex` ×3:** **37/96** (12, 12, 13). 27 lượt câu trượt vì bước tra tên bằng regex đọc sai cụm từ; 15 lượt quá hạn.
- **Theo nhóm người viết (`llm`):** đã xem prompt 47/48, chưa xem 42/48.
- **Câu trượt ở `llm`:** các lượt quá hạn, và `m4-07` ×3 vì định tuyến từ khoá chỉ đưa Trello. Không thấy label sai.

Chi tiết theo nhóm câu, dịch vụ, ngôn ngữ, và phân loại 59 lượt trượt của `regex` nằm trong báo cáo.

## Kiểm bản public

Quét sáu thư mục report theo nội dung:
- không có giá trị nào của 15 khoá bí mật trong `.env`;
- không có tên người viết;
- không có prompt của câu nào trong 32 câu.

Commit và `cases.json` chỉ có mã `member-N`.

## Chưa làm

- `npm run test:eval:v3` đầy đủ chưa chạy ở máy, vì Docker tắt và một số test cần PostgreSQL. Chờ CI.
- Chưa có đối chứng bộ 50 câu cùng ngày.
- Nhóm trưởng chưa xác nhận tiêu chí "GUIDE.md đủ cho người chưa đọc code".
- **Đề xuất backlog, chờ nhóm trưởng:**
  - task độ trễ: giới hạn thời gian suy nghĩ của model hoặc xem lại deadline của app, có đối chứng cùng ngày;
  - định tuyến câu "task row … tab" (`m4-07`);
  - bước tra tên của `regex`.
