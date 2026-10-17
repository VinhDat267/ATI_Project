# W4-04 · Đo latency qua frontend với số mẫu đủ lớn

**Trạng thái:** chờ · **Nhánh gợi ý:** `test/w4-04-frontend-latency` · **Phụ thuộc:** không

## Vấn đề

Thời gian từ lúc gửi câu chat tới khi plan preview hiện ra mới được đo qua frontend **hai lần** (17,3 s và 8,6 s), chênh nhau gấp đôi. Các số p50/p95 khác đều đo qua script gọi thẳng planner, không qua frontend, backend và SSE. Báo cáo cuối kỳ cần ít nhất 20 lượt đo qua đúng đường đi của sản phẩm.

## Việc cần làm

1. Thêm chế độ đo hàng loạt cho `evaluations/live-app/` (ví dụ biến `LIVE_APP_PROMPTS_FILE`): đọc danh sách câu chat từ file, với mỗi câu:
   - gửi câu chat qua frontend; ghi thời điểm gửi, thời điểm thấy plan preview (hoặc câu hỏi làm rõ, hoặc thông báo từ chối), và loại câu trả lời;
   - **luôn bấm Hủy**, không bao giờ bấm Duyệt. Chế độ này không được ghi gì ra service thật;
   - nghỉ giữa các câu để không vượt rate limit của model.
2. Lấy thêm thời gian của từng giai đoạn từ phía server nếu có thể đọc được mà không sửa code sản phẩm (ví dụ thời điểm lưu tin nhắn và thời điểm lưu plan trong PostgreSQL), để tách thời gian của model khỏi thời gian của frontend/SSE.
3. Bộ ≥ 20 câu đo: lấy từ bộ 18 câu tự do và bộ services (W3-06), đổi tài nguyên sang tài nguyên thử nghiệm thật; có câu một, hai, ba service và ít nhất 4 câu đi qua ≥ 4 service. Phép đo chính thức chạy sau mốc chốt catalog (20/10).
4. Chạy chế độ live với model thật, ghi bằng chứng vào `docs/ai-evidence/V3-LIVE-EXECUTION/` (không commit), tóm tắt p50/p95/max theo số service vào `evaluations/README.md`.

## Tiêu chí nghiệm thu

- [ ] Test (sandbox, browser thật) cho chế độ đo hàng loạt: chạy hết danh sách, mọi plan kết thúc ở trạng thái `rejected`, **không có dòng nào trong `execution_steps`**.
- [ ] Có ≥ 20 lượt đo live, mỗi lượt ghi loại câu trả lời và thời gian.
- [ ] Kết quả nói rõ phần trăm lượt dưới 15 s (chỉ tiêu của đặc tả) và tách được thời gian model với phần còn lại, hoặc ghi rõ vì sao chưa tách được.
- [ ] `npm run check` exit 0.

## Kết quả (agent thi công điền)

- PR: [#151](https://github.com/VinhDat267/ATI_Project/pull/151), nhánh `test/w4-04-frontend-latency`, base `ab54c77`. Nhóm trưởng giao reviewer làm ngày 17/10/2026. [Log](../log/2026-10-17-reviewer-W4-04-batch-latency.md).
- Bằng chứng: phép đo live chưa chạy. Khi chạy, bằng chứng nằm trong `docs/ai-evidence/V3-LIVE-EXECUTION/W4-04-<ngày>/` (ignore, không commit): `batch.json` và `summary.md`.
- Kết quả: **phần công cụ xong; phép đo live chưa chạy.**
  - `evaluations/live-app/batch.ts`: mỗi câu một hội thoại mới.
    - Ghi lúc bấm gửi và lúc phản hồi đầu tiên hiện ra, theo `data-moment` của cockpit: xem trước kế hoạch (4), hỏi lại (3), từ chối, trả lời, lỗi lập kế hoạch (`#view-server`).
    - Bấm **Hủy** với mọi kế hoạch. Phản hồi đến sau `LIVE_APP_TURN_TIMEOUT_MS` được chờ thêm tối đa `LIVE_APP_GRACE_MS` để hủy cả kế hoạch đến muộn; cuối lượt chạy kiểm lại mọi hội thoại.
    - Không có nút hay request duyệt nào trong mã; test kiểm mã nguồn.
    - Nghỉ `LIVE_APP_PAUSE_MS` (mặc định 5 s) giữa các câu.
  - Thời gian phía server đọc từ PostgreSQL, không sửa mã sản phẩm: lưu câu chat → lưu working memory (planner: model, tra danh mục, tra cứu, kiểm kế hoạch) → lưu phản hồi. Phần còn lại (request, SSE, vẽ) là hiệu của hai số.
  - `latency.e2e.ts` và `latency.config.ts` (cần `LIVE_APP_LATENCY=1`): ghi `batch.json` sau mỗi lượt và `summary.md` ở cuối (tỉ lệ dưới 15 s, p50/p95/max theo số dịch vụ, loại phản hồi, phần của server). Lượt chạy fail nếu có bước thực thi hoặc còn kế hoạch mở.
  - `latency-prompts.json`: 24 câu chuyển từ bộ tự do và bộ services sang tài nguyên thử nghiệm thật, mỗi nhóm 1, 2, 3 và ≥ 4 dịch vụ có 6 câu.
  - Test: 23 test đơn vị và PostgreSQL thật (`batch.test.ts`). 3 test browser sandbox (`w4-04-latency-batch.spec.ts`): chạy hết danh sách, mọi kế hoạch `rejected`, 0 `execution_steps`; kế hoạch đến muộn vẫn bị hủy; lượt hỏi lại không có kế hoạch. `scripts/test-v3-browser.mjs` thêm `W4-04:` vào nhóm default và `W4-04 clarification` vào nhóm clarification.
  - 13/13 đột biến bị bắt; `npm run check` exit 0: **1.953 v3 + 196 eval** (173 + 23 test mới). Chi tiết trong log.
- Điều chưa làm hoặc khác với task card:
  - **Chưa chạy phép đo live.** Tiêu chí "≥ 20 lượt đo live" và "phần trăm dưới 15 s" còn mở. Theo task card, phép đo chính thức chạy sau mốc chốt catalog 20/10, trên app live với `ag/gemini-3.8-flash`. Lượt chạy chỉ gọi model, không ghi lên dịch vụ, nhưng vẫn cần nhóm trưởng đồng ý vì dùng quota và tài khoản thật.
  - **Chưa tách được thời gian model** khỏi phần còn lại của planner: chat-api không ghi thời gian từng lời gọi model, và task card không cho sửa mã sản phẩm. Phép đo tách được server với frontend/SSE. Theo W3-10 (đo planner trực tiếp), model chiếm 99,96% thời gian lập kế hoạch.
  - Thời gian lấy theo lúc Playwright thấy phần tử, nên có thêm độ trễ dò của Playwright (cỡ vài chục ms).
