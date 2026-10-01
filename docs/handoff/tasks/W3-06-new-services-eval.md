# W3-06 · Đánh giá planner với năm service mới

**Trạng thái:** chờ · **Nhánh gợi ý:** `test/w3-06-new-services-eval` · **Phụ thuộc:** các task service (W3-01 → W3-05) **được giữ lại trong phạm vi** đã merge (xem mốc chốt catalog trong ROADMAP)

## Mục tiêu

Đo một lần, trên catalog cuối cùng, xem planner có chọn đúng tool và điền đúng tham số cho năm service mới không, và việc tăng từ 3 lên 8 service có làm giảm chất lượng các service cũ không.

## Việc cần làm

1. **Workspace giả lập:** thêm tài nguyên của từng service mới vào `evaluations/golden-v2/fixtures.ts`, đúng định dạng output của adapter thật (spreadsheet + tab, lịch, database Notion + page, chat Telegram, project + issue Jira). Có cả tên dễ nhầm giữa các service (ví dụ một board Trello và một spreadsheet cùng tên "Frontend").
2. **Bộ câu `cases-services.json`**, label đăng ký trước:
   - ít nhất **8 câu cho mỗi service mới** (≥ 40), mỗi service có: chỉ đọc, ghi một bước, liên service có phụ thuộc dữ liệu (`$ref`/`$template`), một câu cần hỏi lại, một câu phải từ chối (thao tác không có tool, ví dụ xóa);
   - ít nhất **12 câu dễ nhầm giữa các service** (lấy từ các ca định tuyến trong task card W3-01 → W3-05: "bảng" Trello/Sheets, issue GitHub/Jira, tin nhắn Slack/Telegram, "lịch sử" không phải Calendar, "trang tính" không phải Notion…);
   - ít nhất **4 câu đi qua ≥ 4 service**, trong đó ít nhất 2 service mới;
   - có cả tiếng Việt và tiếng Anh; câu có ngày giờ tương đối cho Calendar.
3. **Commit label trước khi chạy model lần nào**; ghi commit hash trong báo cáo. Sửa label sau đó chỉ trong commit riêng, có giải thích, không sửa để khớp kết quả.
4. Cho `run.ts` nhận `EVAL_SET=services`; test kiểm cấu trúc bộ câu như `cases.test.ts` (mọi tool trong label tồn tại trong catalog, mọi ID tài nguyên có trong fixtures).
5. **Test định tuyến tất định** (không gọi model) trong `packages/planner`: chạy `classifyIntent` trên toàn bộ câu của bộ 50, bộ 18, bộ services và câu mẫu trong `MissionControlLaunchpad.tsx`, với hai cấu hình: đủ 8 service, và chỉ 3 service cũ được cấu hình. Ghi bảng kết quả; ở cấu hình chỉ 3 service cũ, **không câu nào của bộ 50 và bộ 18 được phép bị từ chối** vì từ khóa của service mới.
6. **Chạy model thật**, mỗi câu 3 lần: bộ services, bộ 50 câu, bộ 18 câu tự do.
7. Cập nhật `evaluations/README.md`: số liệu theo từng service, p50/p95 latency, giới hạn.

## Tiêu chí nghiệm thu

- [ ] Label commit trước mọi lần chạy model.
- [ ] Bộ services: chọn đúng tool ≥ 85%, chất lượng tham số ≥ 75% (chỉ tiêu của đặc tả), báo **riêng từng service**. Không đạt thì ghi rõ service nào, câu nào; không sửa label cho khớp.
- [ ] Bộ 50 và bộ 18 không giảm so với lần đo 01/10 (50/50, 18/18); nếu giảm, ghi rõ câu nào và vì sao.
- [ ] Test định tuyến tất định đạt ở cả hai cấu hình.
- [ ] Bằng chứng golden lưu `docs/ai-evidence/V3-GOLDEN-V2/` (commit như trước).
- [ ] `npm run test:eval:v3` và `npm run check` exit 0.

## Không làm trong task này

- Không sửa prompt hay planner để tăng điểm. Nếu điểm thấp, ghi lại và đề xuất task sửa riêng; sửa xong phải chạy lại cả ba bộ.

## Kết quả (agent thi công điền)

- PR:
- Commit label:
- Kết quả từng bộ, từng service:
- Điều chưa làm hoặc khác với task card:
