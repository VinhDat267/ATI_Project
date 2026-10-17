# W4-03 · Đo tỉ lệ plan dùng được với người dùng thật

**Trạng thái:** chờ · **Nhánh gợi ý:** `test/w4-03-usable-plan-study` · **Phụ thuộc:** buổi thử nên chạy sau FE-01 và FE-03 (plan hiện tên tài nguyên thay vì ID; không còn trạng thái dịch vụ giả) · **Có phần việc của con người**

## Vấn đề

Đặc tả đặt chỉ tiêu "tỉ lệ plan dùng được ≥ 70%", nhưng chỉ tiêu này chưa bao giờ được đo, vì nó cần người dùng thật nhìn plan preview và quyết định. Báo cáo giữa kỳ hứa ít nhất 20 lượt duyệt của người dùng.

## Định nghĩa (chốt trước khi đo)

Một **lượt** là một yêu cầu công việc của người tham gia, tính từ câu chat đầu tiên tới khi họ duyệt, hủy hoặc bỏ cuộc. Lượt đó **dùng được** khi:
- người tham gia bấm **Duyệt** cho plan đầu tiên, hoặc cho plan sau **tối đa một** lần "Sửa qua Chat"; và
- sau khi thực thi, người tham gia xác nhận kết quả đúng ý (câu hỏi cuối lượt).

Lượt bị **Hủy**, phải sửa từ hai lần trở lên, hoặc thực thi xong nhưng người tham gia nói sai ý, đều **không dùng được**. Câu hỏi làm rõ của AI không tính là một lần sửa.

## Việc cần làm

**Agent:**
1. Script `evaluations/usable-plan/report.ts`: đọc PostgreSQL theo danh sách conversation ID của buổi thử, tính cho mỗi lượt số plan được tạo, số lần bị thay thế (`superseded`), kết quả (`approved`/`rejected`), trạng thái thực thi cuối và thời gian tới plan preview đầu tiên. Xuất CSV và bảng tóm tắt. Script chỉ đọc, không ghi database.
2. `evaluations/usable-plan/PROTOCOL.md`: quy trình cho người điều phối:
   - danh sách 10 tình huống công việc mô tả bằng lời thường, **không gợi ý câu chat**;
   - môi trường: **chế độ live với model thật**, vì ở sandbox planner luôn dùng mock trả cùng một plan soạn sẵn cho mọi câu chat (`apps/chat-api/src/server.ts`, phát hiện khi review frontend 02/10), nên đo ở sandbox không có ý nghĩa. Người tham gia đánh giá plan ở màn hình xem trước; người điều phối bấm **Hủy** sau khi ghi nhận, trừ khi chủ dự án đồng ý cho chạy thật trên tài nguyên thử nghiệm;
   - cách ghi câu trả lời "kết quả có đúng ý không";
   - **quyền riêng tư:** không ghi họ tên người tham gia, chỉ ghi mã P01, P02…; câu chat của người tham gia không commit lên repo công khai.
3. Test cho script tính toán, chạy trên dữ liệu dựng sẵn trong PostgreSQL thật (lượt duyệt ngay, sửa một lần rồi duyệt, sửa hai lần, hủy).

**Con người:** ít nhất 5 người tham gia, mỗi người 4 lượt trở lên, tổng ≥ 20 lượt. Người tham gia không phải người viết prompt của planner.

## Tiêu chí nghiệm thu

- [ ] Định nghĩa "dùng được" ở trên được ghi vào `PROTOCOL.md` trước buổi thử đầu tiên và không đổi sau đó.
- [ ] Test của script đạt trên PostgreSQL thật.
- [ ] Sau buổi thử: tỉ lệ dùng được trên ≥ 20 lượt, kèm khoảng tin cậy 95% (Wilson), phân tích các lượt không dùng được theo nguyên nhân.
- [ ] Kết quả tóm tắt trong `evaluations/README.md`; dữ liệu thô (câu chat, CSV) giữ ở máy, không commit.
- [ ] `npm run check` exit 0.

## Kết quả (agent thi công điền)

- PR: [#149](https://github.com/VinhDat267/ATI_Project/pull/149), nhánh `test/w4-03-usable-plan-study`, base `ab54c77`. Nhóm trưởng giao reviewer dựng khung ngày 17/10/2026. [Log](../log/2026-10-17-reviewer-W4-03-usable-plan-framework.md).
- Kết quả: **phần agent xong; buổi thử chưa chạy.**
  - `evaluations/usable-plan/PROTOCOL.md`:
    - định nghĩa chép nguyên văn từ task card, chốt trước buổi thử đầu tiên;
    - chế độ live với `ag/gemini-3.8-flash`, `GMAIL_ENABLED=off`, `PLANNER_READ_ANSWERS=off`;
    - bối cảnh nhóm (8 tài nguyên thử nghiệm) và 10 tình huống bằng lời thường, không gợi ý câu chat, phủ cả 8 dịch vụ; bảng chia lượt cho 5 người × 4 lượt, mỗi tình huống 2 lần;
    - các bước của một lượt, phiếu ghi và quyền riêng tư (mã P01…, không chép câu chat).
  - `evaluations/usable-plan/report.ts` và `report-lib.ts`:
    - đọc phiếu CSV, rồi đọc PostgreSQL trong transaction `READ ONLY` (luôn rollback) theo danh sách mã hội thoại;
    - mỗi lượt: số kế hoạch, số `superseded`, số lần sửa (mỗi kế hoạch sau kế hoạch đầu), số câu hỏi lại, số lần từ chối, thời gian từ câu đầu tới kế hoạch đầu, trạng thái kế hoạch cuối, số bước đã thực thi;
    - xuất `turns.csv` và `summary.md` (tỉ lệ, Wilson 95%, nguyên nhân không dùng được, trạng thái cuối). Không đọc nội dung câu chat.
  - `report.test.ts`: 25 test, gồm nhóm PostgreSQL thật (schema riêng dựng từ migration `db/v3`, 5 hội thoại: duyệt ngay, sửa một lần, sửa hai lần, hủy, có câu hỏi lại) và test transaction chỉ đọc từ chối `INSERT`. RED (chưa có module) → GREEN 25/25; 12/12 đột biến bị bắt.
  - `sheet-template.csv`; `.gitignore` thêm `docs/ai-evidence/USABLE-PLAN/`; mục "W4-03: usable-plan study" trong `evaluations/README.md` ghi rõ **chưa đo**.
  - `npm run check` exit 0: **1.953 v3 + 198 eval** (173 + 25 test mới); chi tiết trong log.
- Điều chưa làm hoặc khác với task card:
  - **Chưa chạy buổi thử**, nên ba tiêu chí sau buổi thử (tỉ lệ trên ≥ 20 lượt, Wilson, tóm tắt kết quả trong README) còn mở. Cần nhóm trưởng hẹn ít nhất 5 người (23–25/10).
  - **"Sau khi thực thi" đổi thành "nếu chạy đúng kế hoạch này".** Theo quyết định của nhóm trưởng ngày 17/10, buổi thử chỉ xem, không ghi lên dịch vụ: người tham gia nói "duyệt", người điều phối ghi nhận, hỏi câu cuối lượt trên kế hoạch xem trước, rồi bấm Hủy. Định nghĩa giữ nguyên chữ; `PROTOCOL.md` ghi cách áp dụng và giới hạn (đo việc *sẽ* duyệt, không đo kết quả thực thi). Vì vậy quyết định "duyệt" lấy từ phiếu, không lấy từ `approved` trong PostgreSQL (mọi kế hoạch được duyệt đều thành `rejected` sau khi bấm Hủy).
  - Thời gian tới kế hoạch đầu tiên tính từ câu chat đầu, nên gồm cả lúc người tham gia trả lời câu hỏi lại; chỉ để tham khảo, không phải phép đo W4-04.
