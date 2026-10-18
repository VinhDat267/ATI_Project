# 18/10/2026 · W4-02 · Bộ đo hội thoại nhiều lượt (chưa đo)

**Người viết:** reviewer (nhóm trưởng giao thi công) · **Nhánh:** `test/w4-02-multi-turn-eval`, base `3c950db` · Task: [W4-02](../tasks/W4-02-multi-turn-eval.md), bước 1 và 2, cùng phần commit label của bước 3.

PR này chỉ có bộ đo và label, chưa gọi model. Phép đo 3 lần bằng `ag/gemini-3.8-flash` làm sau khi merge, khi nhóm trưởng đồng ý; dự kiến ghép vào đợt đo GMAIL-04 (khoảng 21–22/10). Báo cáo kết quả thuộc PR sau.

## Đã làm

- **`evaluations/golden-v2/run.ts`:**
  - `historyOf()` dựng lịch sử từ `turns` như `chat-service.ts` (dòng 117–127): câu người dùng giữ nguyên chữ, kế hoạch đã lưu gửi lại dưới dạng JSON, câu hỏi lại là nội dung câu hỏi. `runCase` chuyển lịch sử này vào `processMessage`, và chỉ chấm câu trả lời của lượt cuối. Câu không có `turns` chạy như cũ;
  - `casePrompts()`: bản public che câu cuối và mọi câu người dùng ở các lượt trước. Câu dài được che trước, để câu chứa câu khác bị che trọn;
  - `EVAL_SET=multiturn` đọc `cases-multiturn.json`, dùng catalog chung.
- **`evaluations/golden-v2/scorer.ts`:** trường `turns`; ba category `turn_edit`, `turn_reply`, `turn_new`. Cách chấm không đổi.
- **Label `4d63bd6`** (`cases-multiturn.json`, 12 câu, đồng hồ của bộ core), commit trước mọi lời gọi model:
  - `turn_edit` (6): đổi tiêu đề card, đổi kênh Slack, thêm người được gán, bỏ một bước, đổi list, dời deadline. Label kiểm cả phần đổi lẫn phần giữ nguyên. Ví dụ: đổi kênh vẫn phải giữ list, tiêu đề và tham chiếu tới link card; bỏ bước Trello mà kế hoạch vẫn còn bước đó thì fail vì có lệnh ghi không mong đợi;
  - `turn_reply` (3): câu trả lời ngắn cho câu hỏi lại ("To Do", "the frontend channel", "acme/web");
  - `turn_new` (3): yêu cầu mới không liên quan sau một kế hoạch. Bước nào của kế hoạch cũ quay lại cũng fail.

  Kế hoạch ở lượt trước có `thinking`, như kế hoạch planner thật lưu lại, và đều qua `validatePlan` của planner. Working memory lấy tài nguyên của lượt trước, như app mang sang lượt sau.
- **Test:**
  - `run-multiturn.test.ts` (5): lịch sử dựng đúng; provider giả nhận lịch sử trước câu cuối; câu không có `turns` không đổi; che câu ở các lượt trước; tập `multiturn`;
  - `cases-multiturn.test.ts` (16): số câu từng nhóm; các lượt đúng dạng và kế hoạch cũ hợp lệ; label dùng tham số và tài nguyên có thật; câu sửa có ít nhất hai matcher; câu yêu cầu mới không cho mang bước cũ; mọi tool trong label đến được model khi có lịch sử; một lượt chạy khô qua `main()`.
- Mục "W4-02: multi-turn conversations" trong `evaluations/README.md`, có lệnh đo.

Không sửa mã sản phẩm hay prompt.

## Kiểm thử

- RED trước GREEN: test runner trên mã cũ 4 fail / 1 pass. Bốn ca fail vì hàm chưa tồn tại; ca đạt sẵn là ca "câu không có `turns` không đổi", vốn là ca giữ hành vi cũ. Sau khi sửa, 5/5.
- Label: trước khi commit, test bắt các kế hoạch cũ có `thinking` rỗng, vì validator của planner từ chối. Đã sửa ở generator trước commit label.
- Đột biến, mỗi lần khôi phục và kiểm SHA-256:
  - **runner 5/5:** không gửi các lượt trước; gửi kế hoạch dạng chữ thay vì JSON; đảo thứ tự lượt; không che câu ở lượt trước; report chỉ che câu cuối;
  - **label 5/5:** câu yêu cầu mới cho phép bước cũ; kế hoạch cũ bị validator từ chối; câu sửa chỉ kiểm phần đổi; câu trả lời câu hỏi lại đi sau một kế hoạch; câu sửa mất `turns`.

  Đột biến "report chỉ che câu cuối" ban đầu lọt. Ca chạy khô tìm câu trong file JSON thô, nhưng câu có dấu ngoặc kép bị escape, nên kiểm tra luôn đạt. `8946dc9` chuyển sang duyệt mọi chuỗi đã parse.
- Golden-v2 230/230; typecheck chặt `evaluations/golden-v2` exit 0.
- `npm run check` (PostgreSQL 16 tmpfs riêng ở 55533, sandbox, hai cờ tắt, không dùng `.env`): **exit 0** ngay lượt đầu, **2.014 v3 + 353 eval** (332 + 21 mới); quét bản build đạt 7 mẫu.

Không gọi model.
