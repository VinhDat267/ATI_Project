# REPORT-01 · Báo cáo cuối kỳ

**Trạng thái:** chờ · **Người làm:** nhóm trưởng (`VinhDat267`) và các thành viên; agent chỉ viết nháp từng mục khi được giao · **Phụ thuộc:** số liệu SCHED-04, GMAIL-04, W4-03 cho chương đánh giá; các chương khác bắt đầu ngay · **Mốc:** khung và chương 1–3 trước 29/10; bản đủ 08/11; nộp theo hạn của môn học
**Kế hoạch tổng:** [FINISH-PLAN](../FINISH-PLAN.md).

## Quy tắc trình bày (đã chốt, CURRENT-STATE mục 7)

- Viết tiếng Việt; tiêu đề mục tiếng Anh; giữ thuật ngữ kỹ thuật tiếng Anh.
- File `.docx`, chữ đen, Times New Roman.
- **Không commit lên repo công khai.** Lưu ở máy nhóm trưởng (`docs/reports/` đã ignore) và bản sao trên Drive của nhóm.
- Báo cáo giữa kỳ (30/09) là điểm xuất phát; mục 5.2 của bản đó là lộ trình đã hứa, nên phải đối chiếu từng mục.

## Cấu trúc đề xuất và nguồn

| # | Mục (tiêu đề tiếng Anh) | Nội dung | Nguồn trong repo |
|---|---|---|---|
| 1 | Introduction | Bài toán, mục tiêu: một câu chat thay 4–5 thao tác trên ít nhất hai hệ thống | `docs/PROJECT-REPORT.md`, CURRENT-STATE mục 1 |
| 2 | Requirements | Yêu cầu chức năng, an toàn (duyệt đúng kế hoạch, mã băm, hạn 30 phút), tiêu chí nghiệm thu của đặc tả v3 §1.4 | Đặc tả v3, `docs/MULTI-SERVICE-SCOPE.md` |
| 3 | System Architecture | Sơ đồ các khối `chat-web`, `chat-api`, `planner`, `executor`, `tool-adapters`, `tool-schemas`, PostgreSQL; luồng một yêu cầu từ chat tới biên nhận | CURRENT-STATE mục 2, `AGENTS.md` |
| 4 | Planner | Router, prefetch, model tự tra cứu, validator 5 lớp, grounding, câu chỉ đọc, kiểu "trả lời" | `packages/planner`, đặc tả v3, task card W3-10, ANS-01 |
| 5 | Execution and Safety | Thực thi tuần tự, `$ref`/`$template`, `unknown` không chạy lại, đối soát khi khởi động, khôi phục | Task card W2-01, W2-02, W2-05, đặc tả v3 §5.8 |
| 6 | Integrations | 8 dịch vụ chung, phạm vi tài nguyên được phép, chuẩn hoá lỗi; Gmail riêng của từng người; OAUTH-01 nếu đã merge | Task card W3-00 → W3-05, GMAIL-01 → 03, OAUTH-01 |
| 7 | Scheduled Workflows | Lịch chạy: mỗi lượt lập kế hoạch mới và chờ duyệt; thứ tự khoá; bộ hẹn giờ; quyết định bật cờ | Đặc tả lịch chạy, SCHED-01 → 04 |
| 8 | Accounts and UI | Tài khoản (đăng ký có duyệt, Google, phiên), giao diện Agentic, cockpit 9 khoảnh khắc | AUTH-01 → 07, FE-04 → FE-12 |
| 9 | Evaluation | Bảng số liệu: golden (W3-06, W3-10), W4-01, W4-02, W4-04, GMAIL-04, SCHED-04, W4-03 (tỉ lệ kế hoạch dùng được); test tự động (số test, CI) | CURRENT-STATE mục 3 (mỗi số **kèm ngày và commit**), các báo cáo trong `docs/ai-evidence/V3-GOLDEN-V2/` |
| 10 | Limitations | Mọi dòng của CURRENT-STATE mục 5 còn mở; các việc backlog không làm (FINISH-PLAN mục 4); bộ câu không độc lập hoàn toàn | CURRENT-STATE mục 5 |
| 11 | Development Process | Quy trình nhiều agent: task card, review độc lập, TDD, đột biến, bằng chứng chạy thật; số PR, số lần review chưa đạt rồi sửa | `docs/handoff/README.md`, `REVIEW-CHECKLIST.md`, `log/` |
| 12 | Future Work | OAuth cho các dịch vụ khác, chế độ tự chạy có giới hạn, nhiều instance (lease), OAUTH-02, task độ trễ | Đặc tả OAuth, ROADMAP |
| 13 | Conclusion | Đối chiếu từng mục tiêu ở mục 1 với kết quả | — |
| — | Appendix | Kịch bản demo, hướng dẫn chạy, bảng số liệu đầy đủ | `docs/demo/DEMO-RUNBOOK.md`, `evaluations/README.md` |

## Việc cần làm

1. **Trước 29/10:** dựng file `.docx` theo cấu trúc trên, áp kiểu chữ; viết mục 1–3 và 11. Các mục này không chờ số liệu mới.
2. **29/10–04/11:** viết mục 4–8 song song với code. Mỗi mục do một người phụ trách; nhóm trưởng phân công trong file.
3. **05–08/11:** viết mục 9–10 với số liệu cuối, rồi mục 12–13 và phụ lục.
4. **Kiểm số liệu** (bắt buộc): mỗi con số trong mục 9 phải có ngày đo, commit, model, và link tới báo cáo trong repo. Số nào không có nguồn thì bỏ. Không làm tròn theo hướng có lợi, không gộp các lượt đo khác ngày thành một số.
5. **Kiểm trung thực:**
   - không gọi bộ W4-01 là độc lập;
   - không gọi kết quả sandbox là chạy thật;
   - không ghi lịch chạy hay Gmail là "đã bật" nếu cờ còn tắt.
6. **Đọc chéo:** mỗi mục có một người khác đọc. Nhóm trưởng đọc cuối.

## Khi giao agent viết nháp một mục

Dùng câu lệnh P-TASK, kèm câu: "Chỉ viết nháp mục <số> của REPORT-01 vào `docs/reports/draft-<số>.md` (đã ignore), tiếng Việt, tiêu đề tiếng Anh, mọi số liệu lấy từ CURRENT-STATE mục 3 kèm ngày và commit, không commit file này." Nhóm trưởng tự chuyển sang `.docx` và sửa văn.

## Tiêu chí nghiệm thu

- [ ] Đủ 13 mục và phụ lục; đúng quy tắc trình bày.
- [ ] Mọi số liệu có nguồn (ngày, commit, báo cáo); không có số tự đặt.
- [ ] Mục giới hạn có đủ các việc còn mở ở CURRENT-STATE mục 5.
- [ ] Đã nộp đúng hạn môn học; bản nộp lưu ở Drive của nhóm.

## Kết quả (người làm điền)

- Ngày nộp:
- Người phụ trách từng mục:
