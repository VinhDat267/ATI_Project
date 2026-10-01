# W3-03 · Google Sheets: đánh giá với model thật và chạy thật bốn service

**Trạng thái:** chờ · **Nhánh gợi ý:** `test/w3-03-sheets-eval-live` · **Phụ thuộc:** W3-02 đã merge; người dùng đã làm xong phần "Chuẩn bị của người dùng"

## Chuẩn bị của người dùng (agent không tự làm)

1. Tạo một project trong Google Cloud Console, bật **Google Sheets API**.
2. Tạo một **service account**, tạo key dạng JSON.
3. Tạo một spreadsheet thử nghiệm (ví dụ "ATI Test Tracker") có tab `Tasks` với dòng tiêu đề `Ngày | Tiêu đề | Issue | Card | Người làm`, rồi **chia sẻ quyền Editor** cho email của service account.
4. Tự điền vào `.env`: `GOOGLE_SA_CLIENT_EMAIL`, `GOOGLE_SA_PRIVATE_KEY` (giữ `\n` dạng chữ), `LIVE_SHEETS_SPREADSHEET_IDS` (ID lấy từ URL của spreadsheet).
5. Lưu credentials vào app qua `evaluations/live-app/setup-credentials.ts` hoặc màn hình "Cài đặt dịch vụ".

Agent không được tự tạo key, đọc giá trị key hay in key ra log.

## Việc cần làm

1. **Golden set cho Sheets:** tạo `evaluations/golden-v2/cases-sheets.json` với **ít nhất 12 câu**: một service (chỉ Sheets), hai service (Sheets + Slack/Trello), bốn service, một câu cần hỏi lại (không nói rõ spreadsheet nào), một câu phải từ chối (yêu cầu xóa dòng — chưa có tool). Có cả tiếng Việt và tiếng Anh. Thêm spreadsheet và tab vào `fixtures.ts` theo đúng hành vi của adapter. **Commit label trước khi chạy model lần nào** (đăng ký trước, như quy tắc trong `evaluations/README.md`).
2. Cho `run.ts` nhận `EVAL_SET=sheets`; thêm test kiểm tra cấu trúc bộ câu như `cases.test.ts`.
3. Chạy với model thật, mỗi câu 3 lần: bộ Sheets, và chạy lại bộ 50 câu cùng bộ 18 câu tự do để chứng minh việc thêm service thứ tư không làm giảm chất lượng các service cũ.
4. **Chạy thật bốn service qua frontend** bằng `evaluations/live-app/` với câu: "Tạo issue … trong repo ati-test, tạo card cùng tên trong danh sách Cần làm của board To Do kèm link issue, thêm một dòng vào tab Tasks của spreadsheet ATI Test Tracker với link issue và card, rồi báo lên kênh ati-test". **Người dùng phải duyệt đúng plan (mã băm) trong chat trước khi bấm Duyệt.** Sau đó đọc lại dòng vừa thêm bằng `sheets.read_range` để đối chiếu.
5. Cập nhật `evaluations/README.md`: kết quả, số liệu, giới hạn.

## Tiêu chí nghiệm thu

- [ ] Label bộ Sheets được commit trước mọi lần chạy model (ghi commit hash trong báo cáo).
- [ ] Bộ Sheets: chọn đúng tool ≥ 85%, chất lượng argument ≥ 75% (chỉ tiêu của đặc tả); nếu không đạt thì ghi rõ, không sửa label cho khớp.
- [ ] Bộ 50 câu và bộ 18 câu tự do không giảm so với lần đo ngày 01/10 (50/50, 18/18); nếu giảm thì ghi rõ câu nào.
- [ ] Một lần chạy thật bốn service thành công, có đối chiếu: issue tồn tại, card đúng list, dòng Sheets có đúng hai link, tin Slack gửi đi.
- [ ] Bằng chứng chạy thật lưu ở `docs/ai-evidence/V3-LIVE-EXECUTION/` (không commit); bằng chứng golden set lưu ở `docs/ai-evidence/V3-GOLDEN-V2/` (commit như trước).
- [ ] `npm run test:eval:v3` đạt.

## Kết quả (agent thi công điền)

- PR:
- Bằng chứng:
- Kết quả từng bộ đánh giá:
- Điều chưa làm hoặc khác với task card:
