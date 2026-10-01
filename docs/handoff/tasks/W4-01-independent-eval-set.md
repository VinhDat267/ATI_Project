# W4-01 · Bộ đánh giá độc lập do thành viên khác viết

**Trạng thái:** chờ · **Nhánh gợi ý:** `test/w4-01-independent-eval` · **Phụ thuộc:** khung làm ngay được; câu hỏi nên viết sau mốc chốt catalog (20/10) để có cả các service mới · **Có phần việc của con người**

## Vấn đề

Hai bộ đánh giá hiện có do cùng một người viết câu hỏi lẫn label, và prompt của planner đã được chỉnh trên chính bộ 50 câu. Kết quả 50/50 và 18/18 vì vậy chưa nói được planner xử lý câu chưa từng gặp tốt đến đâu. Báo cáo giữa kỳ đã hứa: ít nhất 30 câu mới do thành viên khác viết.

## Phân công

- **Con người (các thành viên nhóm, không phải người đã viết prompt):** viết câu hỏi và label theo hướng dẫn. Người viết **không được xem prompt của planner** và không chạy model trước khi nộp.
- **Agent:** dựng khung, công cụ kiểm tra, chạy đánh giá và viết báo cáo. Agent **không viết hay sửa câu hỏi**; chỉ được báo lỗi định dạng để người viết tự sửa.

## Việc cần làm

1. Tạo `evaluations/golden-independent/`:
   - `GUIDE.md`: hướng dẫn tiếng Việt cho người viết, gồm năm nhóm câu (một bước, nhiều bước, liên service, cần hỏi lại, cần từ chối), cách viết label theo các matcher hiện có (`equals`, `includesAny`, `refTo`, `anyOf`…), workspace giả lập dùng chung (`fixtures.ts`), ba ví dụ hoàn chỉnh, và các điều không được làm.
   - `cases.json` rỗng theo đúng định dạng của `golden-v2/cases.json`.
   - Trường `author` cho từng câu (ghi vai trò, ví dụ "member-2", **không ghi họ tên**).
2. Test cấu trúc (theo mẫu `golden-v2/cases.test.ts`): đủ ≥ 30 câu, mỗi nhóm ≥ 4 câu, có cả tiếng Việt và tiếng Anh, label tham chiếu tới tool và tham số có thật, ID trong label có trong fixtures, `author` có giá trị ở mọi câu (người viết bộ câu cũ được ghi là `author-v2`; bộ mới không được có câu nào mang giá trị này).
3. `run.ts` nhận `EVAL_SET=independent`.
4. Sau khi các thành viên nộp câu: commit `cases.json` **trước khi chạy model** (đăng ký trước), rồi chạy với model thật 3 lần, ở cả chế độ search `llm` và `regex`.
5. Báo cáo trong `evaluations/README.md`: so sánh với bộ 50 câu; liệt kê từng câu fail cùng nguyên nhân (planner sai hay label sai). Label sai chỉ được sửa trong commit riêng, có lý do, và giữ nguyên kết quả cũ trong báo cáo.

## Tiêu chí nghiệm thu

- [ ] `GUIDE.md` đủ để một người chưa từng đọc code viết được câu hỏi hợp lệ (người dùng đọc và xác nhận).
- [ ] Test cấu trúc fail với `cases.json` rỗng, pass với bộ câu đã nộp.
- [ ] Commit đăng ký label có trước commit chứa kết quả chạy model đầu tiên.
- [ ] Có kết quả 3 lần chạy: chọn đúng tool, chất lượng argument, tỉ lệ đạt toàn bộ label, latency p50/p95.
- [ ] Không có họ tên người viết trong repo.
- [ ] `npm run test:eval:v3` đạt.

## Kết quả (agent thi công điền)

- PR:
- Commit đăng ký label:
- Kết quả:
- Điều chưa làm hoặc khác với task card:
