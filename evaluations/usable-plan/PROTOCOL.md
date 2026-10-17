# W4-03 · Quy trình buổi thử "kế hoạch dùng được"

Tài liệu cho người điều phối. Mục tiêu: đo tỉ lệ kế hoạch dùng được (chỉ tiêu ≥ 70% của đặc tả) với người dùng thật, trên ít nhất 20 lượt.

## 1. Định nghĩa

Định nghĩa dưới đây chốt trước buổi thử đầu tiên và **không đổi sau đó**. Chép nguyên văn từ task card W4-03.

> Một **lượt** là một yêu cầu công việc của người tham gia, tính từ câu chat đầu tiên tới khi họ duyệt, hủy hoặc bỏ cuộc. Lượt đó **dùng được** khi:
> - người tham gia bấm **Duyệt** cho plan đầu tiên, hoặc cho plan sau **tối đa một** lần "Sửa qua Chat"; và
> - sau khi thực thi, người tham gia xác nhận kết quả đúng ý (câu hỏi cuối lượt).
>
> Lượt bị **Hủy**, phải sửa từ hai lần trở lên, hoặc thực thi xong nhưng người tham gia nói sai ý, đều **không dùng được**. Câu hỏi làm rõ của AI không tính là một lần sửa.

### Cách áp dụng: chỉ xem, không chạy thật

Theo quyết định của nhóm trưởng ngày 17/10/2026, buổi thử **không ghi lên dịch vụ thật**:
- **Duyệt:** người tham gia nói "duyệt" cho kế hoạch đang hiện. Người điều phối không bấm "Duyệt kế hoạch": ghi `duyet` vào phiếu, hỏi câu cuối lượt, rồi bấm **Hủy**.
- **Câu cuối lượt** được hỏi trên kế hoạch xem trước, thay cho "sau khi thực thi": *"Nếu ATI chạy đúng kế hoạch này, kết quả có đúng ý bạn không?"* Ghi `co` hoặc `khong`.
- **Giới hạn** (báo cáo phải ghi): cách này đo việc người tham gia *sẽ* duyệt kế hoạch họ thấy, không đo kết quả thực thi thật.
- **Ngoại lệ:** chỉ khi nhóm trưởng đồng ý trước cho chạy thật trên tài nguyên thử nghiệm. Khi đó người tham gia tự bấm Duyệt, câu cuối lượt hỏi sau khi xem biên nhận, và phiếu ghi rõ lượt nào chạy thật.

Số lần sửa lấy từ PostgreSQL: mỗi kế hoạch sau kế hoạch đầu tiên của hội thoại là một lần "Sửa qua Chat". Câu hỏi lại của AI không tạo kế hoạch nên không bị tính.

## 2. Người tham gia

- Ít nhất **5 người**, mỗi người ít nhất **4 lượt**, tổng ít nhất **20 lượt**.
- Không phải người viết hoặc chỉnh prompt của planner.
- Mỗi người khoảng 20–30 phút.
- Chỉ ghi mã `P01`, `P02`…; không ghi họ tên, email hay ảnh của người tham gia ở bất kỳ file nào.

## 3. Chuẩn bị trước buổi thử

Người điều phối:
1. Chạy app ở chế độ live theo mục "Through the app" của `evaluations/README.md`:
   - `RUNTIME_MODE=live`, model `ag/gemini-3.8-flash` qua 9router;
   - `GMAIL_ENABLED=off`, `PLANNER_READ_ANSWERS=off`;
   - một PostgreSQL riêng cho buổi thử, giữ nguyên cho tới khi chạy xong báo cáo.
2. Lưu khoá của 8 dịch vụ; "Kiểm tra kết nối" của cả 8 phải OK.
3. Dùng một tài khoản ATI riêng cho buổi thử, tên không phải tên người tham gia; đăng nhập sẵn.
4. Chép `sheet-template.csv` thành `docs/ai-evidence/USABLE-PLAN/<ngày>/sheet.csv`. Thư mục này đã được ignore.
5. Chuẩn bị thẻ bối cảnh nhóm (mục 4) và thẻ tình huống (mục 5).

## 4. Bối cảnh nhóm (đưa cho người tham gia)

Bạn là thành viên nhóm "ATI Test". Nhóm dùng các công cụ sau:

| Công cụ | Nhóm dùng để | Nơi cụ thể |
|---|---|---|
| Trello | việc cần làm | board "To Do", cột "Cần làm" |
| Slack | trao đổi chung | kênh `ati-test` |
| GitHub | lỗi kỹ thuật | repo `VinhDat267/ati-test` |
| Google Sheets | theo dõi kết quả | bảng tính "ATI Test Tracker", tab "Tasks" |
| Google Calendar | lịch họp | lịch "ATI Test" |
| Notion | ghi chú, biên bản | database "ATI Test Notes" |
| Telegram | nhắc việc nhanh | nhóm "ATI Test" |
| Jira | yêu cầu của khách hàng | project `ATIT` |

## 5. Mười tình huống

Mỗi thẻ chỉ mô tả tình huống và điều bạn muốn đạt. **Không gợi ý câu chat**: người tham gia tự viết yêu cầu bằng lời của mình.

| Mã | Tình huống | Điều muốn đạt |
|---|---|---|
| T01 | Bạn vừa thấy trang đăng nhập báo lỗi khi mật khẩu có dấu cách. | Lỗi được ghi lại cho nhóm kỹ thuật, và cả nhóm được báo. |
| T02 | Bạn cần nhờ một bạn chuẩn bị slide demo cuối kỳ, hạn thứ Sáu tuần này. | Việc này có trong danh sách việc cần làm của nhóm, và nhóm được báo. |
| T03 | Buổi kiểm thử hôm nay đã xong, kết quả "đạt". | Kết quả được ghi vào bảng theo dõi của nhóm. |
| T04 | Bạn muốn họp review 30 phút với nhóm lúc 15:00 chiều mai. | Có lịch họp, và nhóm được báo kèm link lịch. |
| T05 | Sáng nay nhóm họp, chốt ba việc: sửa lỗi đăng nhập, cập nhật báo cáo, chuẩn bị demo. | Biên bản ngắn được lưu vào sổ ghi chú của nhóm. |
| T06 | Hạn nộp báo cáo tuần là 17:00 hôm nay. | Cả nhóm được nhắc trong nhóm chat nhanh. |
| T07 | Một người dùng báo không đổi được mật khẩu. | Có một ticket cho việc này, và kênh chung được báo kèm mã ticket. |
| T08 | Trang Cài đặt bị lệch giao diện trên điện thoại. | Lỗi được ghi ở nơi nhóm theo dõi lỗi kỹ thuật, và có thẻ việc cần làm trỏ tới lỗi đó. |
| T09 | Khách hàng muốn thêm chức năng xuất báo cáo PDF. | Yêu cầu thành ticket, sổ ghi chú có một ghi chú kèm link ticket, và nhóm được báo. |
| T10 | Buổi demo cuối kỳ dự kiến 9:00 sáng thứ Hai tuần sau, dài 1 tiếng. | Có lịch, và bảng theo dõi có thêm một dòng về buổi demo kèm link lịch. |

Chia lượt để mỗi tình huống được dùng hai lần:

| Người | Tình huống |
|---|---|
| P01 | T01, T02, T03, T04 |
| P02 | T05, T06, T07, T08 |
| P03 | T09, T10, T01, T02 |
| P04 | T03, T04, T05, T06 |
| P05 | T07, T08, T09, T10 |

Có thêm người thì lặp lại từ P01.

## 6. Mỗi lượt

1. Bấm "Cuộc hội thoại mới". Mỗi lượt là **một hội thoại mới**. Ghi mã hội thoại trong URL `/c/<mã>` vào phiếu.
2. Đưa thẻ tình huống. Người tham gia tự gõ yêu cầu; người điều phối không gợi ý câu chữ và không sửa câu.
3. ATI hỏi lại thì người tham gia trả lời. Việc này không tính là một lần sửa.
4. Khi kế hoạch hiện ra, người tham gia đọc (có thể bấm "Xem trước"), rồi chọn một trong bốn:
   - **Duyệt:** người tham gia nói "duyệt". Người điều phối hỏi câu cuối lượt, ghi `duyet` và `co`/`khong`, rồi bấm **Hủy**. Không bấm "Duyệt kế hoạch".
   - **Sửa qua Chat:** người tham gia gõ chỗ cần sửa, kế hoạch mới thay kế hoạch cũ. Sửa lần thứ hai trở đi thì lượt đó không dùng được, nhưng vẫn để người tham gia đi tới quyết định cuối.
   - **Hủy:** người tham gia bấm Hủy. Ghi `huy`.
   - **Bỏ cuộc:** người tham gia dừng, hoặc lượt quá 10 phút. Ghi `bo-cuoc`; nếu còn kế hoạch chờ duyệt thì bấm Hủy.
5. Ghi chú (tuỳ chọn): lý do ngắn bằng lời của người điều phối, ví dụ "sai kênh", "thiếu hạn". **Không chép câu chat.**

## 7. Phiếu ghi

`sheet.csv`, mỗi lượt một dòng:

| Cột | Giá trị |
|---|---|
| `participant` | `P01`, `P02`… |
| `turn` | số thứ tự lượt của người đó: 1, 2, 3… |
| `conversation_id` | mã hội thoại trong URL `/c/<mã>` |
| `decision` | `duyet`, `huy` hoặc `bo-cuoc` |
| `matches_intent` | `co` hoặc `khong`; bắt buộc khi `decision` là `duyet`, để trống khi khác |
| `note` | ghi chú ngắn, không chứa câu chat |

## 8. Sau buổi thử

1. Chạy báo cáo, trỏ `DATABASE_URL` vào database của buổi thử. Báo cáo chỉ đọc, trong một transaction `READ ONLY`:

   ```bash
   node --env-file=.env --import tsx evaluations/usable-plan/report.ts --sheet docs/ai-evidence/USABLE-PLAN/<ngày>/sheet.csv --out docs/ai-evidence/USABLE-PLAN/<ngày>/
   ```

   - **Kết quả:** `turns.csv` (mỗi lượt một dòng: số kế hoạch, số lần sửa, số câu hỏi lại, thời gian tới kế hoạch đầu tiên, trạng thái cuối, kết luận và nguyên nhân) và `summary.md` (tỉ lệ, khoảng tin cậy 95% Wilson, nguyên nhân không dùng được).
   - **Exit code:** 2 nếu chưa đủ 20 lượt hoặc 5 người; 1 nếu phiếu sai định dạng hoặc lỗi database.
2. Đưa phần tóm tắt (tỉ lệ, khoảng tin cậy, bảng nguyên nhân, giới hạn "chỉ xem") vào `evaluations/README.md`. Không đưa câu chat, mã hội thoại hay ghi chú vào repo.
3. Giữ phiếu, `turns.csv` và database ở máy. Dọn database khi nhóm trưởng yêu cầu.

## 9. Quyền riêng tư

- Chỉ dùng mã người tham gia. Không ghi họ tên, email, ảnh.
- Câu chat chỉ nằm trong database của buổi thử. Báo cáo không đọc nội dung câu chat và không xuất ra file nào.
- Phiếu và kết quả nằm trong `docs/ai-evidence/USABLE-PLAN/`, đã ignore, không commit lên repo công khai.
