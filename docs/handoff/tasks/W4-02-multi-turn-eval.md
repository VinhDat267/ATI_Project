# W4-02 · Đánh giá hội thoại nhiều lượt (sửa plan, trả lời câu hỏi làm rõ)

**Trạng thái:** chờ · **Nhánh gợi ý:** `test/w4-02-multi-turn-eval` · **Phụ thuộc:** không

## Vấn đề

Từ PR #13, mỗi plan được lưu vào hội thoại và gửi lại cho model dưới dạng JSON khi người dùng nhắn tiếp ("Sửa qua Chat"). Chưa có phép đo nào cho trường hợp này: model có sửa đúng chỗ người dùng yêu cầu và giữ nguyên phần còn lại không, và plan cũ trong lịch sử có làm hỏng câu trả lời cho yêu cầu mới không. `golden-v2/run.ts` hiện chỉ chạy câu hỏi một lượt.

## Việc cần làm

1. Mở rộng định dạng golden case: thêm trường `turns` (tùy chọn) là các lượt trước, mỗi lượt có `role` và `content`. Lượt `assistant` có thể là một plan JSON, giống cách `chat-service` gửi lại cho model. `run.ts` dựng `history` từ `turns` và chỉ chấm câu trả lời của lượt cuối. Câu không có `turns` chạy như cũ.
2. Tạo `evaluations/golden-v2/cases-multiturn.json`, **ít nhất 12 câu**, gồm:
   - **Sửa plan (≥ 6):** đổi tiêu đề card, đổi kênh Slack, thêm người được gán, bỏ một bước, đổi list, đổi deadline. Label kiểm cả phần được sửa lẫn phần phải giữ nguyên.
   - **Trả lời câu hỏi làm rõ (≥ 3):** lượt trước là câu hỏi của assistant, lượt cuối là câu trả lời ngắn ("Minh Nguyễn", "kênh frontend").
   - **Yêu cầu mới không liên quan sau một plan (≥ 3):** model phải lập plan mới, không mang các bước của plan cũ sang.
3. Commit label trước khi chạy model. Chạy với model thật 3 lần, `EVAL_SEARCH_MODE=llm`.
4. Báo cáo kết quả trong `evaluations/README.md`. Nếu phát hiện lỗi của planner, mở task sửa riêng; không sửa prompt trong PR này.

## Tiêu chí nghiệm thu

- [ ] Test của runner: case có `turns` dựng đúng `history` (kiểm bằng provider giả ghi lại input); case không có `turns` không đổi hành vi.
- [ ] Test cấu trúc cho `cases-multiturn.json` (số câu từng nhóm, label hợp lệ).
- [ ] Label được commit trước lần chạy model đầu tiên.
- [ ] Kết quả 3 lần chạy theo từng nhóm, kèm danh sách câu fail và nguyên nhân.
- [ ] `npm run test:eval:v3` đạt.

## Kết quả (agent thi công điền)

- PR: bộ đo và label, nhánh `test/w4-02-multi-turn-eval`. Reviewer thi công theo yêu cầu nhóm trưởng. [Log](../log/2026-10-18-reviewer-W4-02-multi-turn-eval.md).
- Commit đăng ký label: `4d63bd6` (`cases-multiturn.json`, 12 câu: 6 sửa, 3 trả lời câu hỏi lại, 3 yêu cầu mới), trước mọi lời gọi model. Siết lại ở `9cf3c11` theo review (tiêu đề phải giữ hoặc người dùng viết rõ thì so khớp chính xác), vẫn trước khi đo.
- Sửa P2 lần 2 tại `c864f55`: `mt_reply02` nhận các cụm thất bại có chữ `success`/`succeed` hoặc `thành công` bị phủ định; vẫn loại thông báo thành công. [Log phần sửa cuối](../log/2026-10-18-reviewer-W4-02-final-fix.md).
- Bản sửa cuối: test tập trung 67/67 (reviewer độc lập chạy lại), browser Gmail 4/4, đột biến scorer 3/3 bị bắt; check tại máy exit 0, **2.014 v3 + 389 eval** sau khi chạy lại một timeout FE-04 ngoài diff. Chưa gọi model.
- Kết quả: chưa đo. Ba lần chạy với `EVAL_SEARCH_MODE=llm` làm sau khi merge, khi nhóm trưởng đồng ý, dự kiến cùng đợt đo GMAIL-04 (khoảng 21–22/10). Báo cáo theo nhóm kèm câu fail thuộc PR sau.
- Điều chưa làm hoặc khác với task card:
  - đúng 12 câu, mức tối thiểu;
  - câu trả lời câu hỏi lại không có câu "Minh Nguyễn": fixture không có thành viên tên này, nên thay bằng trả lời list, kênh và repo;
  - bản public che cả câu người dùng ở các lượt trước, task card không ghi.
