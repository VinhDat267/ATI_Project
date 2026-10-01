# W3-01 · Google Sheets: tool schema và adapter

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/w3-01-sheets-adapter` · **Phụ thuộc:** không · **Làm song song với:** không nên (W3-02 dùng kết quả của task này)

## Mục tiêu

Thêm Google Sheets làm service thứ tư ở tầng tool: định nghĩa tool trong `packages/tool-schemas` và adapter gọi API thật trong `packages/tool-adapters`. Task này **chưa** đăng ký service vào backend, planner hay frontend (đó là W3-02).

## Thiết kế đã chốt

**Xác thực: Google service account**, không dùng OAuth của người dùng.
- Người dùng tạo một service account trong Google Cloud, bật Google Sheets API, rồi chia sẻ (Editor) các spreadsheet thử nghiệm cho email của service account.
- Credentials gồm hai trường: `clientEmail` và `privateKey` (PEM). Ô nhập hiện tại chỉ có một dòng, nên adapter phải chấp nhận `privateKey` có `\n` dạng chữ và tự đổi thành xuống dòng thật.
- Adapter tự ký JWT (RS256) bằng `node:crypto`, đổi lấy access token tại `https://oauth2.googleapis.com/token` với scope `https://www.googleapis.com/auth/spreadsheets`. Token được cache tới gần lúc hết hạn. **Không thêm dependency mới** (không dùng `googleapis`).

**Allowed scope:** danh sách spreadsheet ID (`scopeKey` sẽ là `spreadsheets` ở W3-02). Mọi tool kiểm tra spreadsheet ID nằm trong danh sách **trước** khi gọi API, giống cách GitHub adapter kiểm tra repo.

**Bốn tool** (tên và hành vi):

| Tool | Loại | Input | Output |
|---|---|---|---|
| `sheets.list_spreadsheets` | read, `discovers: 'spreadsheet'`, `listable: true` | `query` (có thể rỗng), `limit` ≤ 10 | Spreadsheet trong allowlist, lọc theo tên: `{ id, title, url }`. Service account không duyệt được Drive, nên lấy tên bằng cách gọi `spreadsheets.get` cho từng ID trong allowlist |
| `sheets.list_sheets` | read, `discovers: 'sheet'` | `spreadsheetId` (`x-resource: 'spreadsheet'`) | Các tab: `{ sheetId, title, spreadsheetId }` |
| `sheets.read_range` | read | `spreadsheetId`, `range` (A1, ví dụ `Tasks!A1:E20`), `limit` số dòng ≤ 50 | `{ range, values: string[][] }`, cắt theo `limit` |
| `sheets.append_rows` | write | `spreadsheetId`, `sheet` (tên tab), `rows: string[][]` (1–20 dòng, mỗi dòng ≤ 20 ô) | `{ spreadsheetId, updatedRange, updatedRows, url }` |

`append_rows` dùng `values:append` với `valueInputOption=USER_ENTERED` và `insertDataOption=INSERT_ROWS`. Ô nào bắt đầu bằng `=`, `+`, `-`, `@` phải được thêm dấu `'` ở đầu để chặn chèn công thức (formula injection).

**Phân loại lỗi** theo `StepError` hiện có: 401/403 → `AUTH_ERROR`; 404 → `NOT_FOUND`; 429 → `RATE_LIMIT`; 5xx và timeout của **lệnh ghi** → `UNKNOWN` (không tự chạy lại), của lệnh đọc → `SERVER_ERROR`/`NETWORK`. Không đưa nội dung response, token hay private key vào thông báo lỗi.

## Việc cần làm

1. `packages/tool-schemas/src/sheets.ts` với bốn tool trên (JSON Schema đầy đủ, `x-resource` cho `spreadsheetId`, mô tả tiếng Việt như các tool khác), xuất ra trong `ALL_TOOLS`.
2. `packages/tool-adapters/src/sheets/sheets-adapter.ts`: adapter theo mẫu `github-adapter.ts`, có rate limiter dùng chung (Google cho phép khoảng 60 request/phút/người dùng), `AbortSignal` cho mọi request, inject được `fetch` để test.
3. Xuất adapter trong `packages/tool-adapters/src/index.ts`.

## Không làm trong task này

- Không đăng ký vào `SERVICE_REGISTRY`, `registered-services.ts`, frontend, planner (W3-02).
- Không sửa, xóa hay định dạng ô; không tạo spreadsheet mới.

## Tiêu chí nghiệm thu

- [ ] Test JWT: ký đúng header/claims (`iss`, `scope`, `aud`, `iat`, `exp` ≤ 1 giờ), kiểm chữ ký bằng public key tương ứng; `privateKey` có `\n` dạng chữ vẫn dùng được; token được cache và làm mới khi sắp hết hạn.
- [ ] Test mỗi tool với `fetch` giả: đúng URL, method, query, body; output đúng định dạng.
- [ ] Test allowlist: spreadsheet ngoài danh sách bị từ chối **trước** khi gọi `fetch` (đếm số lần gọi = 0).
- [ ] Test chặn formula injection trong `append_rows`.
- [ ] Test phân loại lỗi, gồm timeout của lệnh ghi → `UNKNOWN`, bằng `AbortSignal` thật.
- [ ] Test không có private key hay token trong `message` của lỗi.
- [ ] Test mới fail trước khi sửa; `npm run check` exit 0.
- [ ] (Nếu người dùng đã chuẩn bị service account, xem W3-03) Một lần chạy đọc thật `list_spreadsheets` và `list_sheets` trên spreadsheet thử nghiệm; chỉ đọc, ghi kết quả vào nhật ký, không in key.

## Kết quả (agent thi công điền)

- PR:
- Commit:
- Test đã chạy và kết quả:
- Điều chưa làm hoặc khác với task card:
