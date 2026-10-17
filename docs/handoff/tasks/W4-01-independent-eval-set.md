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

- PR: (điền khi mở PR), nhánh `test/w4-01-independent-eval`, base `ab54c77`. Nhóm trưởng giao reviewer dựng khung ngày 17/10/2026. [Log](../log/2026-10-17-reviewer-W4-01-independent-eval-framework.md).
- Commit đăng ký label: chưa có (bộ câu còn rỗng).
- Kết quả: **phần khung xong; chưa có câu nào, chưa chạy model.**
  - `evaluations/golden-independent/GUIDE.md`, tiếng Việt, không cần đọc code:
    - mục đích và quy tắc: không xem prompt, không xem bộ cũ, không chạy AI trước khi nộp, không chép ví dụ, không ghi tên;
    - năm nhóm câu (thêm `read_only` không bắt buộc);
    - workspace giả lập của `golden-v2/fixtures.ts` với tên → ID, và đồng hồ 10:00 thứ Ba 29/09/2026;
    - 14 tool ghi và tham số; cách viết label, mọi loại điều kiện kèm ví dụ;
    - 5 ví dụ hoàn chỉnh (mỗi nhóm một ví dụ), cách tự kiểm và cách nộp.
  - `cases.json` rỗng theo định dạng của `golden-v2` (`version`, `clock`, `timeZone`, `cases`).
  - `validate.ts`: kiểm định dạng từng câu, báo lỗi bằng tiếng Việt kèm mã câu. Không có `--partial` thì kiểm thêm thành phần: ≥ 30 câu, mỗi nhóm ≥ 4, mỗi ngôn ngữ ≥ 5.
  - `cases.test.ts`: 36 test, gồm 24 kiểu lỗi, các ví dụ của GUIDE qua được bộ kiểm, GUIDE liệt kê đủ tool ghi và ID, và CLI.
  - `golden-v2/run.ts` nhận `EVAL_SET=independent`: đọc `golden-independent/cases.json`, từ chối chạy khi bộ chưa qua kiểm đầy đủ, kiểm commit đăng ký cả thư mục mới, ghi `author` của từng câu vào báo cáo. `GoldenCase` thêm trường `author`.
  - 21/21 đột biến bị bắt; `npm run check` exit 0: **1.953 v3 + 210 eval** (173 + 37 test mới); chi tiết trong log.
- Điều chưa làm hoặc khác với task card:
  - **Chưa có câu, chưa chạy model, chưa có báo cáo** (việc 4, 5). Cần các thành viên viết từ 22/10. Bốn tiêu chí còn mở: nhóm trưởng xác nhận `GUIDE.md` đủ cho người chưa đọc code; commit đăng ký; kết quả 3 lần chạy; test cấu trúc đạt với bộ đã nộp.
  - **Test cấu trúc vẫn đạt khi `cases.json` rỗng**, nếu không thì `npm run check` đỏ cho tới khi có câu. Test chứng minh bộ rỗng không qua kiểm đầy đủ (8 lỗi thiếu); CLI và runner từ chối bộ rỗng với exit 1. Khi đã có câu trong `cases.json`, test bắt buộc cả bộ qua kiểm đầy đủ.
  - **Không thêm `author: "author-v2"` vào ba file label cũ**, vì sửa các file đó làm đổi SHA-256 đã đăng ký mà các báo cáo cũ ghi lại. Câu cũ không có `author` nghĩa là `author-v2`; bộ kiểm từ chối giá trị `author-v2` ở bộ mới.
  - **Thêm so với task card:**
    - mỗi câu ghi `services` (dịch vụ câu chat nhắc tới), để báo cáo tính được theo dịch vụ;
    - "có cả tiếng Việt và tiếng Anh" thành mỗi ngôn ngữ ≥ 5 câu;
    - không dùng `memory` (câu một lượt);
    - đồng hồ giữ như bộ services để dùng chung workspace giả lập;
    - câu trùng bộ cũ hoặc trùng ví dụ của GUIDE bị từ chối.
