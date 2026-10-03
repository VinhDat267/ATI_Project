# W3-06 · Đánh giá planner với năm service mới

**Trạng thái:** chờ · **Nhánh gợi ý:** `test/w3-06-new-services-eval` · **Phụ thuộc:** các task service (W3-01 → W3-05) **được giữ lại trong phạm vi** đã merge (xem mốc chốt catalog trong ROADMAP)

## Mục tiêu

Đo một lần, trên catalog cuối cùng, xem planner có chọn đúng tool và điền đúng tham số cho năm service mới không, và việc tăng từ 3 lên 8 service có làm giảm chất lượng các service cũ không.

## Việc cần làm

0. **Sửa label đã lỗi thời, trong commit riêng, trước mọi lần chạy model:**
   - `rf06` ("Schedule a Google Calendar meeting with the frontend team tomorrow at 3pm") có label `refusal` vì trước đây chưa có Calendar. Nếu Calendar còn trong phạm vi, label cũ không còn đúng. Câu này còn yêu cầu mời cả nhóm, trong khi `calendar.create_event` không có `attendees`. Đổi label thành `clarification` hoặc `plan` không mời người là một quyết định nhãn; agent đề xuất, **người dùng chốt** trước khi commit.
   - Rà lại toàn bộ câu `refusal` và câu nhắc tới dịch vụ "chưa hỗ trợ" trong bộ 50 và bộ 18 theo catalog đã chốt; liệt kê câu nào bị ảnh hưởng.
   - Báo cáo so sánh với lần đo 01/10 trên các câu **không đổi label**; câu đổi label báo riêng.
1. **Workspace giả lập:** thêm tài nguyên của từng service mới vào `evaluations/golden-v2/fixtures.ts`, đúng định dạng output của adapter thật (spreadsheet + tab, lịch, database Notion + page, chat Telegram, project + issue Jira). Có cả tên dễ nhầm giữa các service (ví dụ một board Trello và một spreadsheet cùng tên "Frontend").
2. **Bộ câu `cases-services.json`**, label đăng ký trước:
   - ít nhất **8 câu cho mỗi service mới** (≥ 40), mỗi service có: chỉ đọc, ghi một bước, liên service có phụ thuộc dữ liệu (`$ref`/`$template`), một câu cần hỏi lại, một câu phải từ chối (thao tác không có tool, ví dụ xóa);
   - ít nhất **12 câu dễ nhầm giữa các service** (lấy từ các ca định tuyến trong task card W3-01 → W3-05: "bảng" Trello/Sheets, issue GitHub/Jira, tin nhắn Slack/Telegram, "lịch sử" không phải Calendar, "trang tính" không phải Notion…);
   - ít nhất **4 câu đi qua ≥ 4 service**, trong đó ít nhất 2 service mới;
   - có cả tiếng Việt và tiếng Anh; câu có ngày giờ tương đối cho Calendar.
3. **Commit label trước khi chạy model lần nào**; ghi commit hash trong báo cáo. Sửa label sau đó chỉ trong commit riêng, có giải thích, không sửa để khớp kết quả.
4. Cho `run.ts` nhận `EVAL_SET=services`; test kiểm cấu trúc bộ câu như `cases.test.ts` (mọi tool trong label tồn tại trong catalog, mọi ID tài nguyên có trong fixtures).
5. **Định tuyến tất định:** mở rộng bộ câu hồi quy của W3-00 (`evaluations/golden-v2/routing.test.ts`) với các câu của `cases-services.json`; kiểm hai cấu hình như W3-00 (chỉ 3 service cũ được cấu hình; đủ mọi service). Ở cấu hình chỉ 3 service cũ, **không câu nào của bộ 50 và bộ 18 bị từ chối** vì từ khóa của service mới.
6. **Chạy model thật** với `PLANNER_SEARCH_MODE=llm` (chế độ dùng khi chạy thật; service mới không có `gatherRules` cho chế độ `regex`), mỗi câu 3 lần: bộ services, bộ 50 câu, bộ 18 câu tự do.
7. Cập nhật `evaluations/README.md`: số liệu theo từng service, p50/p95 latency, giới hạn.

## Tiêu chí nghiệm thu

- [ ] Label commit trước mọi lần chạy model; sửa label lỗi thời (như `rf06`) nằm trong commit riêng, có giải thích và người dùng đã chốt.
- [ ] Bộ services: chọn đúng tool ≥ 85%, chất lượng tham số ≥ 75% (chỉ tiêu của đặc tả), báo **riêng từng service**. Không đạt thì ghi rõ service nào, câu nào; không sửa label cho khớp.
- [ ] Bộ 50 và bộ 18 không giảm so với lần đo 01/10 (50/50, 18/18) trên các câu không đổi label; nếu giảm, ghi rõ câu nào và vì sao.
- [ ] Test định tuyến tất định đạt ở cả hai cấu hình.
- [ ] Bằng chứng golden lưu `docs/ai-evidence/V3-GOLDEN-V2/` (commit như trước).
- [ ] `npm run test:eval:v3` và `npm run check` exit 0.

## Không làm trong task này

- Không sửa prompt hay planner để tăng điểm. Nếu điểm thấp, ghi lại và đề xuất task sửa riêng; sửa xong phải chạy lại cả ba bộ.

## Kết quả (agent thi công điền)

- PR: [#35](https://github.com/VinhDat267/ATI_Project/pull/35), nhánh `vinhdat/test-w3-06-services-eval`; base `aaa345d` sau Jira #34 và metadata #28.
- Commit label: `1ab7f08` đổi riêng `rf06` thành clarification theo lựa chọn trực tiếp của người dùng ngày 03/10; `20fa6f0` đăng ký 44 câu services trước mọi provider call. 67 câu cũ còn lại giữ nguyên, đối chiếu cả commit baseline 01/10. Fixtures `cb56cfe`, harness `823cf1f`, bản đo đủ source `7ba60ef`. Không sửa prompt/planner.
- Kết quả từng bộ, từng service: ba lượt/câu, `PLANNER_SEARCH_MODE=llm`, concurrency 2, model yêu cầu `ag/gemini-3.8-flash`, mọi completion thành công báo `gemini-3.8-flash`. Core 150/150 (49 câu không đổi 147/147; `rf06` mới 3/3), freeform 51/54, services 111/132. Tools/args: Sheets 100/100%, Calendar 100/87,5%, Notion/Telegram/Jira 100/100%; cả năm đạt hai ngưỡng đo. Services p50/p95 6,105/31,097 s, max 53,021 s; core 5,454/13,105 s; freeform 5,942/13,092 s. Bốn workflow ≥4 service đạt 12/12. Số mẫu và denominator theo từng service ở `evaluations/README.md` và report JSON.
- Điều chưa làm hoặc khác với task card:
  - **Chưa đạt tiêu chí không giảm điểm bộ cũ:** `ff15` 0/3, vì có cả Slack và Telegram `frontend`; model hỏi lại nơi gửi. Không đổi label Slack cũ theo kết quả, không buộc planner chọn một service. Đây là thay đổi ngữ cảnh/oracle cần ghi riêng, không tự kết luận chất lượng ngữ nghĩa giảm.
  - Sáu câu chỉ đọc `sh01/sh07/ca01/no01/tg01/ji01` 0/3 theo kind: 18 lần đọc thành công kết thúc với **15 refusal / 3 plan / 0 clarification**. Validator chấp nhận plan chỉ đọc ở `sh07` lượt 1/3 và `ca01` lượt 1; prompt yêu cầu plan chỉ có lệnh ghi nhưng validator chưa thực thi giới hạn này. `ca01` còn sai matcher mốc cuối ngày; `ca04` 0/3 vì từ chối mời người tham gia thay vì clarification. Policy trả lời chỉ đọc và enforcement cần task sản phẩm riêng; numeric gate không phải nghiệm thu câu trả lời. Không sửa label sau quan sát để nâng điểm.
  - Một chiến dịch services bị gián đoạn 79/132 do tiến trình gateway thay đổi, giữ riêng `interrupted-services-*`; chỉ các chiến dịch đủ được dùng làm số liệu chính. Rerun toàn bộ sau probe mới, không đổi tài khoản/model.
  - Routing kiểm 116 câu ở hai cấu hình; vẫn giữ ngoại lệ được duyệt `rf06` Calendar unavailable ở legacy, không tuyên bố literal cả 68 câu đều có route legacy. `ji06` giữ route GitHub+Jira do keyword `issue` cũ, model chọn đúng lệnh Jira.
  - Catalog đo được đóng băng ở 33 tool/8 service đã merge; giữ mốc chốt 20/10. Nếu catalog đổi, phải đo lại.
  - Usable plan rate chưa đo; không thực thi plan, không gọi service thật. Browser/live-service NOT_RUN trong W3-06. Quality gate sản phẩm còn incomplete; cần chốt policy chỉ đọc/đích thông báo và đánh giá người dùng ở task riêng.
  - Kiểm tra local: `npm run check` exit 0, 874 v3 + 151 eval; strict eval typecheck exit 0, HTTP cancellation dùng AbortSignal thật. Review độc lập tại `49dfc61`: C0/I1/M0; I1 sửa mô tả read-only bằng audit báo cáo thật RED→GREEN, giữ nguyên labels/raw reports/số liệu. CI và verification cùng PR ghi commit đã kiểm.
