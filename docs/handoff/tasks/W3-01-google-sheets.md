# W3-01 · Google Sheets

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/w3-01-google-sheets` · **Phụ thuộc:** W3-00 đã merge · **Làm song song với:** W3-03, W3-04, W3-05 · **Chặn:** W3-02 (Calendar dùng lại phần xác thực Google của task này)

Đọc trước: [yêu cầu chung cho task thêm service](W3-service-common.md). Card này chỉ ghi phần riêng của Google Sheets.

## Xác thực: Google service account (dùng chung cho Sheets và Calendar)

- Không dùng OAuth của người dùng. Người dùng tạo service account, chia sẻ spreadsheet thử nghiệm cho email của service account (xem W3-07).
- `credentialFields`: `clientEmail` (`text`), `privateKey` (`multiline`, PEM). Vẫn phải chấp nhận key có `\n` dạng chữ (khi dán từ file JSON hoặc từ `.env`) và đổi thành xuống dòng thật.
- Tạo module dùng chung `packages/tool-adapters/src/google/service-account.ts`:
  - tự ký JWT RS256 bằng `node:crypto`, claims `iss`, `scope`, `aud = https://oauth2.googleapis.com/token`, `iat`, `exp` ≤ 1 giờ;
  - đổi lấy access token, cache theo `(clientEmail, scope)` tới trước khi hết hạn khoảng 60 giây;
  - lỗi đổi token → `AUTH_ERROR`, không chứa key hay assertion.
- Scope token của Sheets: `https://www.googleapis.com/auth/spreadsheets`.

## Thiết kế service

- `id: 'sheets'`, `name: 'Google Sheets'`, `scopeKey: 'spreadsheets'`, `scopeLabel: 'Spreadsheet ID'`, `scopePattern: /^[A-Za-z0-9_-]{20,}$/`.
- `intentKeywords`: `sheets`, `google sheets`, `spreadsheet`, `bảng tính`, `trang tính`, `sheet`. **Không** dùng `bảng` (Trello dùng cho board), `dòng`, `row` (quá chung).
- `checkConnection`: lấy token rồi `spreadsheets.get` (chỉ `fields=properties.title`) cho spreadsheet đầu tiên trong allowlist.
- Rate limit: khoảng 60 request/phút cho mỗi service account.

| Tool | Loại | Input | Output |
|---|---|---|---|
| `sheets.list_spreadsheets` | read, `discovers: 'spreadsheet'`, `listable` | `query` (có thể rỗng), `limit` ≤ 10 | `{ id, title, url }` của spreadsheet trong allowlist, lọc theo tên |
| `sheets.list_sheets` | read, `discovers: 'sheet'`, `listable` (con của spreadsheet) | `spreadsheetId` (`x-resource: 'spreadsheet'`), `query` (có thể rỗng), `limit` ≤ 10 | `{ id, title, spreadsheetId }[]`; `id` là `sheetId` của Google đổi tên |
| `sheets.read_range` | read | `spreadsheetId`, `range` (A1, ví dụ `Tasks!A1:E20`), `limit` số dòng ≤ 50 | `{ range, values: string[][] }`, cắt theo `limit` |
| `sheets.append_rows` | write, `riskLevel: 'medium'` | `spreadsheetId`, `sheet` (tên tab, `x-resource: 'sheet'`, `x-resource-field: 'title'`), `rows: string[][]` (1–20 dòng, mỗi dòng ≤ 20 ô, mỗi ô ≤ 1000 ký tự) | `{ spreadsheetId, updatedRange, updatedRows, url }` |

- `append_rows` dùng `values:append`, `valueInputOption=USER_ENTERED`, `insertDataOption=INSERT_ROWS`.
- **Chặn chèn công thức:** ô bắt đầu bằng `=`, `+`, `-`, `@` (kể cả sau khoảng trắng đầu) được thêm `'` ở đầu.
- Không có tool sửa, xóa, định dạng ô hay tạo spreadsheet.
- Giới hạn đã biết: bộ nhớ grounding không ghi tab thuộc spreadsheet nào (chỉ Trello có `boardId`), nên plan dùng tab của spreadsheet A với spreadsheet B vẫn qua validator; adapter sẽ trả lỗi `VALIDATION`/`NOT_FOUND` khi chạy. Không sửa lõi planner trong task này.

## Ca định tuyến dễ nhầm (thêm vào test)

- "Tạo card trên bảng Frontend rồi báo Slack" → Trello + Slack, không có Sheets; không bị từ chối khi Sheets chưa cấu hình.
- "Ghi một dòng vào bảng tính ATI Test Tracker" → Sheets.
- "Thêm dòng checklist vào card" → Trello, không có Sheets.

## Sandbox

Kịch bản `sheets_slack`: đọc vài dòng của tab `Tasks` → thêm một dòng mới → báo Slack có `updatedRange` của step trước.

## Tiêu chí riêng (ngoài tiêu chí chung)

- [ ] Test JWT: header và claims đúng; kiểm chữ ký bằng public key tương ứng; key có `\n` dạng chữ dùng được; token được cache và làm mới khi sắp hết hạn; hai scope khác nhau có hai token khác nhau.
- [ ] Test chặn chèn công thức với cả bốn ký tự đầu và có khoảng trắng đầu.
- [ ] Test `read_range` cắt đúng `limit`, và từ chối `range` trỏ sang spreadsheet khác (chỉ chấp nhận dạng `Tab!A1:B2` hoặc `A1:B2`).

## Kết quả (agent thi công điền)

- PR:
- Commit:
- Tài liệu API đã đọc (đường dẫn, ngày):
- Test đã chạy và kết quả:
- Điều chưa làm hoặc khác với task card:
