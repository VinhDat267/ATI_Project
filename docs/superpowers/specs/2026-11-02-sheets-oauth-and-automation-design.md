# Đặc tả Thiết kế: Google Sheets OAuth & AI Automation v2 (Smart Range, Idempotent Sync & Scheduled KPI Digest)

**Ngày:** 2026-11-02  
**Nhánh mục tiêu:** `feat/sheets-oauth-v2`  
**Trạng thái:** Approved for Implementation (Zero-Defect Audited)  
**Tài liệu liên quan:**
- Đặc tả nền tảng v3: [`docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md`](2026-09-29-ai-workflow-platform-v3-design.md)
- Đặc tả Google Sheets cá nhân v1 (OAUTH-03): [`docs/superpowers/specs/2026-10-28-oauth-03-personal-sheets-design.md`](2026-10-28-oauth-03-personal-sheets-design.md)
- Đặc tả tham chiếu Schedule Digest: `2026-11-01-github-digest-and-oauth-design.md`

---

## 1. Bối cảnh & Phản biện từ góc nhìn Người dùng / Doanh nghiệp (Brainstorming Critique)

Sau khi triển khai `OAUTH-03` (`mysheets` cá nhân trên `main`), người dùng có thể kết nối tài khoản Google, mở Google Picker chọn bảng tính và đọc/ghi theo tọa độ A1. Tuy nhiên, khi đặt mình vào vị trí **Người dùng thực tế (Project Lead / Operations / Quản lý dự án)** và **Chủ doanh nghiệp sử dụng ATI hằng ngày**, thiết kế v1 bộc lộ 4 điểm nghẽn lớn:

### 1.1. Bốn điểm nghẽn thực tế của thiết kế v1
1. **Chọn bảng tính còn phụ thuộc cứng vào Google Picker popup:**
   - Khi người dùng đang mở sẵn file Google Sheets trên trình duyệt (`https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5.../edit#gid=0`) hoặc dùng trình duyệt chặn popup / third-party cookie của Google Picker, họ không thể dán nhanh đường link bảng tính để cấp quyền.
   - Sau khi chọn bảng tính, giao diện chỉ hiện tên file (`Báo cáo KPI Q4`) mà không cho người dùng (và cả AI) biết bên trong file có những tab (`sheets`) nào (`Tasks`, `KPI Tháng 11`, `Backlog`).
2. **Bắt người dùng và AI phải nhớ tọa độ ô `A1:Z50` cứng nhắc:**
   - Hàm kiểm tra `a1(range)` trong `packages/tool-adapters/src/sheets/sheets-shared.ts` bác bỏ mọi chuỗi không có tọa độ dòng-cột tường minh (`CELL_RE = /^[A-Za-z]{1,3}[1-9]\d*(?::[A-Za-z]{1,3}[1-9]\d*)?$/`).
   - Khi người dùng nói *"Đọc tab Tasks"*, *"Xem 5 dòng mới nhất của bảng KPI"*, hoặc AI truyền `range: "Tasks"`, `range: "Tasks!A:F"`, `range: "Tasks!tail:5"`, adapter lập tức ném lỗi `VALIDATION: Sheets range must be a local A1 cell range`.
   - Khi đọc bảng có dòng tiêu đề (Header row), kết quả trả về chỉ là mảng 2 chiều thô `string[][]`, thiếu ánh xạ cột theo tiêu đề (`headers`, `records`) khi cần phân tích theo tên cột (`Deadline`, `Trạng thái`, `Owner`).
3. **Ghi trùng dữ liệu (Duplicate Rows) khi đồng bộ lặp lại từ GitHub / Jira / Trello / Gmail vào Sheets:**
   - Nghiệp vụ phổ biến nhất của Google Sheets trong AI Automation là làm **Sổ theo dõi trung tâm (Master Tracker)**: đồng bộ danh sách issue GitHub, card Trello, ticket Jira hoặc email quan trọng vào bảng tính.
   - Hiện tại `append_rows` luôn gọi `POST .../values/...:append` vô điều kiện. Nếu người dùng chạy lại workflow hoặc retry sau sự cố mạng, các dòng đã tồn tại (`GH#42`, `PROJ-108`, link card Trello) bị chèn lặp lại thành nhiều bản sao.
   - Ngoài ra, cơ chế chống Formula Injection hiện tại thêm dấu nháy đơn `'` vào trước các ô bắt đầu bằng `=`, `+`, `-`, `@` (kể cả có khoảng trắng đầu dòng). Nếu bộ lọc chống trùng không chuẩn hóa tiền tố `'` khi so khớp, các dòng có số điện thoại `+8490...` hoặc công thức/mention `@minh` sẽ không bao giờ khớp với dữ liệu đã lưu trên Sheets.
4. **Lịch báo cáo KPI / Deadline từ Sheets mỗi sáng bắt người dùng phải vào bấm duyệt thủ công:**
   - Với các lịch định kỳ *"8:00 sáng thứ Hai đến thứ Sáu đọc bảng KPI / tiến độ trên Google Sheets rồi gửi báo cáo tóm tắt vào Slack #bao-cao hoặc Telegram"*, luồng `kind = 'plan'` hiện tại chỉ dừng ở trạng thái `awaiting_approval` (Chờ bạn duyệt).
   - Người dùng muốn có quyền chọn ngay lúc tạo lịch:
     - **Chờ tôi duyệt mỗi lượt (`manual`):** Mặc định an toàn cho mọi tác vụ phức tạp hoặc có ghi dữ liệu.
     - **Tự gửi báo cáo, không cần duyệt lại (`auto_digest`):** Cho phép hệ thống tự đọc bảng tính đã khóa và gửi bản tin tóm tắt KPI/tiến độ vào đúng 1 kênh Slack hoặc nhóm Telegram đã khóa vào mỗi sáng, không cần con người bấm duyệt lại từng lượt.

---

## 2. Mục tiêu & Ranh giới bất biến (Goals & Invariants)

### 2.1. Mục tiêu thiết kế v2
1. **Kết nối OAuth & Chọn bảng tính mượt mà (`mysheets` Scope v2):**
   - Hỗ trợ song song **Google Picker** và **Dán liên kết / ID Google Sheets trực tiếp** trên cả màn hình hoàn tất OAuth (`MySheetsCallbackView`) lẫn Cài đặt (`PersonalMySheets`).
   - Backend `PUT /api/connections/mysheets/scope` chấp nhận cả ID thuần lẫn URL đầy đủ (`https://docs.google.com/spreadsheets/d/<id>/...`), xác thực qua Google Drive API (`mimeType`, `trashed`, `capabilities.canEdit`), đồng thời tự động khám phá danh sách tên tab (`sheets?: string[]`, tối đa 20 tab) qua Google Sheets API (best-effort, không làm hỏng lưu scope nếu API tab không phản hồi).
2. **Đọc bảng tính thông minh (`Smart Range & Header-Aware Read`):**
   - Mở rộng `sheets-shared.ts`, `SheetsAdapter` (`sheets.read_range`) và `PersonalSheetsAdapter` (`mysheets.read_range`) để hỗ trợ:
     - **Tab-only range:** `"Tasks"`, `"'Báo cáo tuần'"`, `"Sheet1!"` $\rightarrow$ tự chuẩn hóa thành dải đọc an toàn `<sheet>!A1:Z<limit>`.
     - **Column-only range:** `"Tasks!A:F"`, `"A:D"` $\rightarrow$ tự chuẩn hóa thành `Tasks!A1:F<limit>` hoặc `A1:D<limit>`.
     - **Tail range (N dòng cuối kèm dòng tiêu đề):** `"Tasks!tail:5"`, `"tail:10"` hoặc tham số `tail: 5` $\rightarrow$ đọc tối đa 500 dòng đầu của tab (`<sheet>!A1:Z500`), giữ lại dòng tiêu đề đầu tiên (`values[0]`) và lấy đúng `N` dòng dữ liệu cuối cùng không rỗng.
     - **Header-aware records:** Khi truyền `headerAware: true` (hoặc dùng `tail`), trả thêm `headers: string[]` và `records: Array<Record<string, string>>` bên cạnh `{ range, values }`. Khi gọi `read_range` truyền thống (`Tasks!A1:B3` không có cờ `headerAware`/`tail`), giữ nguyên 100% cấu trúc trả về `{ range, values, ...(truncated ? { truncated: true } : {}) }` để tương thích ngược tuyệt đối.
3. **Chống ghi trùng dữ liệu (`Idempotent Deduplication Append`) kết hợp bảo vệ Formula Injection:**
   - Hỗ trợ chống ghi trùng trên `sheets.append_rows` và `mysheets.append_rows` thông qua:
     - Cờ tường minh `deduplicate: true` hoặc chỉ định cột khóa `deduplicateColumn: number` (`0..19`) / `deduplicateColumns: number[]`, HOẶC
     - Tự động nhận diện khóa đồng bộ ngoại vi (Auto Sync-Key Detection) ở cột đầu tiên (`row[0]`) khi mọi dòng đầu vào có mã định danh chuẩn từ GitHub/Jira/Trello/Gmail (`GH#123`, `PR#45`, `ISSUE#12`, `[JIRA-101]`, `ABC-123`, URL `https://github.com/...`, `https://trello.com/...`, `https://*.atlassian.net/...`).
   - Khi chế độ chống trùng kích hoạt: đọc các dòng hiện có của tab (`GET .../values/<sheet>!A1:Z500`), chuẩn hóa ô so sánh (loại bỏ dấu `'` escape công thức ở đầu nếu theo sau bởi `[=+\-@]` hoặc khoảng trắng + `[=+\-@]`), loại bỏ các dòng đã tồn tại trên bảng tính cũng như các dòng trùng lặp ngay trong cùng batch `rows`.
   - Nếu tất cả dòng đều đã tồn tại: **không gọi `POST :append`**, trả về `{ spreadsheetId, updatedRange: "<sheet>!A1", updatedRows: 0, skippedDuplicates: rows.length, url }`.
   - Nếu còn dòng mới: áp dụng đúng công thức escape chống Formula Injection (`row.map((cell: string) => (/^\s*[=+\-@]/u.test(cell) ? "'" + cell : cell))`) trước khi gọi `POST :append`, trả về `{ spreadsheetId, updatedRange, updatedRows: newRows.length, skippedDuplicates, url }`.
4. **Lịch tự động gửi báo cáo từ Google Sheets (`approvalMode: 'manual' | 'auto_digest'` & `kind = 'sheets_digest'`):**
   - Cho phép người dùng chọn giữa 2 chế độ ngay trên thẻ xác nhận lịch (`ScheduleMoment.tsx`):
     - `manual`: *"Chờ tôi duyệt mỗi lượt"* (mặc định).
     - `auto_digest`: *"Tự gửi báo cáo, không cần duyệt lại"* (chỉ bật khi yêu cầu lịch chỉ đọc từ 1 bảng tính Google Sheets đã cấp quyền — `mysheets` hoặc `sheets` — và gửi báo cáo tới đúng 1 đích Slack hoặc Telegram đã khóa).
   - Thực thi qua `SheetsDigestRunner` độc lập, kiểm tra bất biến `digest_config_hash`, kiểm tra lại quyền sở hữu bảng tính (`allowedSpreadsheets` / `allowedScope`) và đích gửi (`slack`/`telegram`) trước khi đọc, kiểm tra lại `schedules.version` và `status = 'active'` ngay trước khi gửi tin nhắn, chống Prompt Injection & Slack/Telegram mention injection, và tự tạm dừng lịch sau 3 lần `digest_failed` liên tiếp.

### 2.2. Các bất biến kỹ thuật bắt buộc (Hard Constraints)
1. **Bất biến `ALL_TOOLS` & `SERVICE_REGISTRY`:**
   - `ALL_TOOLS` giữ nguyên đúng **33 tools**; `SERVICE_REGISTRY` giữ nguyên đúng **8 services** (`trello`, `slack`, `gmail`, `sheets`, `calendar`, `notion`, `telegram`, `github`).
   - Định nghĩa `SHEETS_TOOLS` trong `packages/tool-schemas/src/sheets.ts` không được thay đổi bất kỳ ký tự nào để giữ nguyên tuyệt đối SHA-256 system prompt khi các cờ tùy chọn tắt:
     - `read-answers.test.ts`: `b31234b91e0c22191f5b0c5fb4be73299e673178df36ea3accb2633b42ec64f9`
     - `schedules.test.ts`: `14ea8a4bcf831da986cf449f823c959e172c331a7e7cd6c16ef74e927f00fdb1`, `b324fa473c28841041540c3e84df742083d1ccb7a92824c16da5bbc6e57deb70`, `0826b45b85fada72ebdce87f5d4ccaee8c922821a42ff1a3364284de153be460`.
2. **Bất biến 11 phép thử đột biến (`scripts/test-mysheets-mutations.mjs`):**
   - Toàn bộ 11 chuỗi mục tiêu (M1..M11) trong `scripts/test-mysheets-mutations.mjs` phải giữ nguyên từng ký tự và toàn bộ 11 mutation đều phải bị bộ test bắt sống (killed 11/11).

---

## 3. Thiết kế Chi tiết Từng Phân hệ

### 3.1. Phân hệ 1: Kết nối OAuth & Chọn bảng tính mượt mà (`mysheets` Scope v2)

#### 3.1.1. Trích xuất Spreadsheet ID từ URL hoặc ID (`extractSpreadsheetId`)
Hỗ trợ người dùng dán bất kỳ định dạng nào sau đây:
- ID trực tiếp: `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms` (`^[A-Za-z0-9_-]{1,128}$`)
- URL đầy đủ của Google Sheets:
  - `https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0`
  - `https://docs.google.com/spreadsheets/u/0/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?usp=sharing`
- Quy tắc trích xuất (`normalizeSpreadsheetIdInput(raw: string): string | null`):
  - `trim()` chuỗi đầu vào.
  - Nếu khớp mẫu URL Google Sheets `^https:\/\/docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{1,128})(?:\/|[?#]|$)`, trả về group `1`.
  - Nếu khớp `^[A-Za-z0-9_-]{1,128}$`, trả về chính chuỗi đó.
  - Mọi trường hợp khác (URL domain khác, chuỗi rỗng, ký tự lạ) trả về `null` (báo lỗi `400 Bad Request` ở API hoặc thông báo tiếng Việt trên UI).

#### 3.1.2. Khám phá danh sách Tab (`sheets?: string[]`) trong `PUT /api/connections/mysheets/scope`
- Mở rộng kiểu `PersonalSpreadsheetItem` trong `packages/tool-schemas/src/types.ts` và `apps/chat-web/src/types.ts`:
  ```ts
  export interface PersonalSpreadsheetItem {
    id: string;
    title: string;
    canEdit: boolean;
    sheets?: string[];
  }
  ```
- Trong `PUT /api/connections/mysheets/scope` (`apps/chat-api/src/routes/connections/mysheets.ts`):
  - Chuẩn hóa từng phần tử trong `spreadsheetIds` qua `normalizeSpreadsheetIdInput` trước khi kiểm tra trùng lặp và giới hạn 1..20 bảng tính.
  - Giữ nguyên luồng gọi Google Drive API `GET https://www.googleapis.com/drive/v3/files/{id}?fields=id,name,mimeType,trashed,capabilities(canEdit)&supportsAllDrives=true` (bảo toàn nguyên vẹn chuỗi M3, M4 của mutation test).
  - Sau khi xác nhận file hợp lệ (`mimeType === 'application/vnd.google-apps.spreadsheet'` và `!fileData.trashed`), thực hiện lời gọi phụ best-effort:
    - `GET https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}?fields=sheets.properties(sheetId,title)` với cùng `accessToken`.
    - Nếu phản hồi `200 OK` và `Array.isArray(sheetMeta?.sheets)`: trích xuất tối đa 20 tên tab không rỗng (`sheets: string[]`). Nếu có ít nhất 1 tên tab, gắn `sheets` vào `PersonalSpreadsheetItem`.
    - Nếu lời gọi phụ trả về lỗi hoặc exception (hoặc trong các bài test chỉ mock Drive API), bỏ qua không gắn trường `sheets` (để `selectedSpreadsheets` giữ nguyên `{ id, title, canEdit }` tương thích ngược 100% với các test hiện hữu).

#### 3.1.3. Giao diện chọn bảng tính (`MySheetsCallbackView.tsx` & `PersonalMySheets.tsx`)
- Trên `MySheetsCallbackView.tsx` và `PersonalMySheets.tsx`:
  - Bên cạnh nút **"Chọn bảng tính từ Google Drive"** (Google Picker), bổ sung ô nhập nhanh:
    - Input placeholder: `"Dán liên kết hoặc ID Google Sheets..."` (`aria-label="Dán liên kết hoặc ID Google Sheets"`).
    - Nút `"Thêm bảng tính"`: trích xuất ID từ URL/ID, kiểm tra hợp lệ, thêm vào danh sách tạm chọn (hoặc lưu scope) để người dùng không bị kẹt nếu không muốn mở Google Picker.
  - Hiển thị danh sách các tab (`sheets`) dưới dạng nhãn nhỏ (`Tabs: Tasks, KPI...`) ngay dưới tên bảng tính nếu `item.sheets?.length` tồn tại.

---

### 3.2. Phân hệ 2: Đọc bảng tính thông minh (`Smart Range & Header-Aware Read`)

#### 3.2.1. Cú pháp dải ô thông minh trong `packages/tool-adapters/src/sheets/sheets-shared.ts`
Hàm `resolveReadRange(value: unknown, options?: { limit?: number; tail?: unknown; headerAware?: unknown })` mở rộng khả năng đọc mà vẫn giữ chặt hàng rào bảo mật:

1. **Kiểm tra an toàn cơ sở (`validateSafeSheetInput`):**
   - Từ chối ngay lập tức (ném `VALIDATION` trước mọi `fetch`) nếu chuỗi rỗng, dài `> 100` ký tự, có ký tự điều khiển (`[\x00-\x1F\x7F]`), hoặc chứa `/`, `\`, `?`, `#`, `[`, `]`, hoặc bắt đầu bằng `http:` / `https:`.
   - Nếu có dấu nháy đơn `'`, kiểm tra nghiêm ngặt quy tắc đóng mở nháy đơn (`readQuotedSheetTitle`) trong thời gian tuyến tính $O(n)$ để chống ReDoS và chống thoát ngữ cảnh tên tab.
2. **Các chế độ dải ô được hỗ trợ:**
   - **Chế độ 1 — Tọa độ A1 chuẩn (`Standard A1`):**
     - Ví dụ: `"Tasks!A1:B3"`, `"'Team''s Tasks'!A1:B2"`, `"A1:B2"`, `"A1"`.
     - Khi không truyền `tail` và không truyền `headerAware: true`, hàm hoạt động y hệt `a1(value)` hiện tại: gửi đúng chuỗi đã chuẩn hóa tới Google Sheets API và trả về `{ range, values, ...(truncated ? { truncated: true } : {}) }`.
   - **Chế độ 2 — Chỉ truyền tên Tab (`Tab-only Range`):**
     - Ví dụ: `"Tasks"`, `"'Báo cáo Q4'"`, `"Sheet1"`, `"Tasks!"`.
     - Nhận diện: chuỗi không có `!` và không khớp mẫu tọa độ ô `CELL_RE` (`^[A-Za-z]{1,3}[1-9]\d*(?::[A-Za-z]{1,3}[1-9]\d*)?$`), HOẶC kết thúc bằng `!`.
     - Chuẩn hóa thành: `${a1Sheet(tabName)}!A1:Z500` (nếu có `tail`) hoặc `${a1Sheet(tabName)}!A1:Z50` (mặc định).
   - **Chế độ 3 — Dải cột không ghi số dòng (`Column-only Range`):**
     - Ví dụ: `"Tasks!A:F"`, `"'Team''s Tasks'!B:E"`, `"A:D"`.
     - Nhận diện: phần sau `!` (hoặc toàn chuỗi nếu không có `!`) khớp `^([A-Za-z]{1,3}):([A-Za-z]{1,3})$`.
     - Chuẩn hóa thành: `${sheetPrefix}${colStart}1:${colEnd}500` (nếu có `tail`) hoặc `${sheetPrefix}${colStart}1:${colEnd}50`.
   - **Chế độ 4 — Lấy N dòng cuối cùng (`Tail Range`):**
     - Ví dụ: `"Tasks!tail:5"`, `"'Báo cáo'!tail:10"`, `"tail:5"`, hoặc truyền tham số `tail: 5` (`1..50`) trong `args`.
     - Nhận diện: phần sau `!` (hoặc toàn chuỗi) khớp `^tail:([1-9]\d*)$` (với `1 <= N <= 50`), hoặc `args.tail` là số nguyên `1..50` (nếu ngoài khoảng `1..50` $\rightarrow$ ném `VALIDATION`).
     - Cách xử lý:
       - Truy vấn Google Sheets API với dải `${sheetPrefix}A1:Z500` (nếu không có tên tab thì dùng `A1:Z500`).
       - Lọc bỏ các dòng hoàn toàn rỗng ở cuối (`row.every(cell => cell.trim() === '')`).
       - Nếu `headerAware !== false` và bảng có từ 2 dòng trở lên: giữ lại dòng đầu tiên `values[0]` làm dòng tiêu đề (`headers`), và cắt lấy tối đa `tailCount` dòng dữ liệu cuối cùng (`dataRows.slice(-tailCount)`). Ghép lại `values = [headerRow, ...slicedDataRows]`.
   - **Chế độ 5 — Trích xuất cấu trúc theo dòng tiêu đề (`Header-Aware Records`):**
     - Khi `args.headerAware === true` hoặc khi dùng cú pháp `tail`:
       - Dòng đầu tiên `values[0]` được trích xuất thành `headers: string[]` (trim từng tên cột; nếu cột thứ `i` rỗng thì đặt tên dự phòng `col_${i + 1}`).
       - Các dòng tiếp theo `values.slice(1)` được ánh xạ thành `records: Array<Record<string, string>>`.
       - Trả về `{ range, values, headers, records, totalDataRows, ...(truncated ? { truncated: true } : {}) }`.

---

### 3.3. Phân hệ 3: Chống ghi trùng dữ liệu (`Idempotent Deduplication Append`) & Bảo vệ Formula Injection

#### 3.3.1. Kích hoạt chế độ chống ghi trùng trong `append_rows`
Khi gọi `sheets.append_rows` hoặc `mysheets.append_rows` với `args`:
- `deduplicate?: boolean`
- `deduplicateColumn?: number` (chỉ số cột khóa `0..19`)
- `deduplicateColumns?: number[]` (mảng chỉ số cột khóa `0..19`)

Quy tắc kích hoạt (`resolveDeduplicationPolicy(rows, args)`):
1. Nếu `args.deduplicate === false`: tắt chống trùng (`enabled: false`).
2. Nếu `args.deduplicate === true` hoặc `args.deduplicateColumn !== undefined` hoặc `args.deduplicateColumns !== undefined`:
   - Kiểm tra kiểu hợp lệ (nếu `deduplicateColumn` không phải số nguyên `0..19` $\rightarrow$ ném `VALIDATION`).
   - Bật chống trùng (`enabled: true`) với các cột khóa đã chỉ định (hoặc toàn bộ dòng nếu không chỉ định cột).
3. Nếu không truyền cờ `deduplicate`, tự động kiểm tra xem **mọi dòng** trong `rows` có chứa **Khóa đồng bộ ngoại vi (External Sync Key)** ở cột `0` (`row[0]`) hay không (`SYNC_KEY_RE`):
   - Mã GitHub / Issue / PR: `^(?:GH|ISSUE|PR)#\d+$/i` hoặc `^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+$`
   - Mã Jira / Linear / Tracker: `^\[?[A-Z][A-Z0-9_]{1,9}-\d+\]?$`
   - Mã Trello / Gmail ID hoặc URL định danh: `^https:\/\/(?:github\.com|trello\.com|[\w.-]+\.atlassian\.net|mail\.google\.com)\/\S+$`
   - Nếu tất cả các dòng trong `rows` đều khớp `SYNC_KEY_RE` ở cột `0`: tự động bật chống trùng theo cột `0` (`enabled: true, keyColumns: [0], autoDetected: true`)!
   - Nếu không khớp (ví dụ dữ liệu thường `[['=SUM(A1)', '+1']]` hoặc `[['Buy milk', 'false']]`): giữ `enabled: false` để không phát sinh thêm request `GET /values/` ngoài ý muốn.

#### 3.3.2. Thuật toán so khớp chuẩn hóa & Bảo toàn Formula Injection (`sheets-shared.ts`)
1. **Chuẩn hóa giá trị ô khi so sánh (`normalizeCellForDedup(cell: string): string`):**
   - Chuyển thành chuỗi, bỏ tiền tố `'` nếu chuỗi bắt đầu bằng `'` theo sau bởi `\s*[=+\-@]` (do Google Sheets hoặc `safeRows` thêm vào ở lần ghi trước), sau đó `.trim()`.
2. **Tạo khóa dòng (`buildRowDedupSignature(row: string[], keyColumns: number[] | null): string`):**
   - Nếu `keyColumns` có giá trị: lấy các cột tương ứng `keyColumns.map(idx => normalizeCellForDedup(row[idx] ?? '')).join('\u001f')`.
   - Nếu `keyColumns === null`: lấy toàn bộ các cột của dòng `row.map(normalizeCellForDedup)` (bỏ các ô rỗng dư ở cuối dòng) nối bằng `\u001f`.
3. **Luồng thực thi trong `SheetsAdapter` và `PersonalSheetsAdapter`:**
   - Bước 1: Kiểm tra `spreadsheetId`, `sheet`, `rows` (`validateAppendRows`) và gọi `ensureSheet` (xác nhận tab tồn tại).
   - Bước 2: Nếu `dedupPolicy.enabled === true`:
     - Gọi `GET /v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(`${a1Sheet(sheet)}!A1:Z500`)}` (chế độ đọc, có retry đọc chuẩn).
     - Xây dựng tập `seenKeys = new Set<string>()` từ các dòng hiện có trên tab.
     - Duyệt qua từng `row` trong `args.rows`: tính `sig = buildRowDedupSignature(row, dedupPolicy.keyColumns)`. Nếu `sig` rỗng hoặc chưa có trong `seenKeys`, thêm vào `rowsToAppend` và đánh dấu `seenKeys.add(sig)` (nhờ đó loại bỏ luôn cả các dòng trùng nhau bên trong cùng một mảng `args.rows`).
     - Tính `skippedDuplicates = rows.length - rowsToAppend.length`.
     - Nếu `rowsToAppend.length === 0`:
       - Không gọi `POST :append`!
       - Trả về ngay:
         ```ts
         {
           spreadsheetId: id,
           updatedRange: `${a1Sheet(sheet)}!A1`,
           updatedRows: 0,
           skippedDuplicates: rows.length,
           url: spreadsheetUrl(id),
         }
         ```
   - Bước 3: Với các dòng cần ghi (`rowsToAppend`), áp dụng **chính xác** hàm `safeRows(rowsToAppend)` trong `sheets-shared.ts`:
     ```ts
     row.map((cell: string) => (/^\s*[=+\-@]/u.test(cell) ? "'" + cell : cell))
     ```
     (Bảo toàn nguyên vẹn chuỗi mục tiêu của M9 trong `scripts/test-mysheets-mutations.mjs`!)
   - Bước 4: Gửi `POST /v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(`${a1Sheet(sheet)}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`.
   - Bước 5: Trả về kết quả:
     - Nếu `dedupPolicy.enabled === false`: trả về `{ spreadsheetId: id, updatedRange, updatedRows, url: spreadsheetUrl(id) }` (giữ nguyên 100% shape cho các unit test cũ).
     - Nếu `dedupPolicy.enabled === true`: trả về `{ spreadsheetId: id, updatedRange, updatedRows, skippedDuplicates, url: spreadsheetUrl(id) }`.

---

### 3.4. Phân hệ 4: Lịch chạy Tự động Báo cáo KPI / Tiến độ từ Google Sheets (`sheets_digest`)

#### 3.4.1. Mô hình dữ liệu & Migration `db/v3/0016_sheets_automation_and_digest.sql`
Tạo migration idempotent `db/v3/0016_sheets_automation_and_digest.sql`:
1. **Bảng `schedules`:**
   - Thêm cột:
     - `kind TEXT NOT NULL DEFAULT 'plan'`
     - `digest_config JSONB`
     - `digest_config_hash TEXT`
     - `digest_approved_at TIMESTAMPTZ`
   - Ràng buộc `schedules_kind_check`:
     `CHECK (kind IN ('plan', 'sheets_digest'))`
   - Ràng buộc hai chiều `schedules_kind_digest_check`:
     ```sql
     CHECK (
       (kind = 'plan' AND digest_config IS NULL AND digest_config_hash IS NULL AND digest_approved_at IS NULL)
       OR (
         kind = 'sheets_digest'
         AND digest_config IS NOT NULL
         AND jsonb_typeof(digest_config) = 'object'
         AND digest_config_hash IS NOT NULL
         AND digest_config_hash ~ '^[0-9a-f]{64}$'
         AND digest_approved_at IS NOT NULL
       )
     )
     ```
2. **Bảng `schedule_runs`:**
   - Thêm cột `delivery JSONB`.
   - Cập nhật `schedule_runs_status_check`:
     `CHECK (status IN ('planning', 'planned', 'planning_failed', 'missed', 'blocked', 'interrupted', 'discarded', 'digest_sent', 'digest_failed'))`
   - Thêm ràng buộc hai chiều `schedule_runs_delivery_check`:
     ```sql
     CHECK (
       (status = 'digest_sent' AND delivery IS NOT NULL AND jsonb_typeof(delivery) = 'object')
       OR (status <> 'digest_sent' AND delivery IS NULL)
     )
     ```
   - Giữ nguyên `schedule_runs_plan_check` (`(status = 'planned') = (plan_id IS NOT NULL)`), `schedule_runs_one_planning`, `schedule_runs_slot`, `schedules_due`.

#### 3.4.2. Hợp đồng TypeScript (`packages/tool-schemas/src/types.ts`)
```ts
export type ScheduleKind = 'plan' | 'sheets_digest';
export type ScheduleApprovalMode = 'manual' | 'auto_digest';

export interface SheetsDigestConfig {
  version: 1;
  source: {
    service: 'mysheets' | 'sheets';
    credentialId?: string;
    email?: string;
    spreadsheetId: string;
    spreadsheetTitle: string;
    sheetName?: string;
    range?: string;
    tailRows: number;
  };
  destination:
    | { service: 'slack'; channelId: string; channelLabel?: string }
    | { service: 'telegram'; chatId: string; chatLabel?: string };
  focus?: string;
  includeAiSummary: boolean;
}

export interface SheetsDigestCandidate {
  canAutoDigest: boolean;
  config?: SheetsDigestConfig;
  reason?: string;
}

export interface SheetsDigestDelivery {
  destination: 'slack' | 'telegram';
  targetId: string;
  targetLabel?: string;
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheetName?: string;
  rowCount: number;
  summaryMode: 'ai' | 'deterministic';
  sentAt: string;
}
```
- Mở rộng `ScheduleProposalMetadata`: thêm `digestCandidate?: SheetsDigestCandidate`.
- Mở rộng `ScheduleView`: thêm `kind?: ScheduleKind`, `approvalMode?: ScheduleApprovalMode`, `digestConfig?: SheetsDigestConfig | null`.
- Mở rộng `ScheduleRunState`: thêm `'digest_sent' | 'digest_failed'`.
- Mở rộng `ScheduleRunView`: thêm `delivery?: SheetsDigestDelivery | null`.

#### 3.4.3. Phát hiện ứng viên `SheetsDigestCandidate` (`apps/chat-api/src/services/schedules/sheets-digest-candidate.ts`)
Trong `ChatService.prepareProposal`:
- Nếu `proposal.services` chứa ít nhất một dịch vụ nguồn bảng tính (`'mysheets'` hoặc `'sheets'`), gọi `analyzeSheetsDigestCandidate`:
  1. **Kiểm tra tập dịch vụ (`services`):**
     - Chỉ được chứa nguồn bảng tính (`mysheets` hoặc `sheets`) và đúng **một** dịch vụ đích thông báo (`slack` hoặc `telegram`).
     - Nếu chứa bất kỳ dịch vụ nào khác (`github`, `jira`, `trello`, `gmail`, `calendar`, `notion`, `mycalendar`) hoặc thiếu đích gửi (`slack`/`telegram`), hoặc có cả `slack` lẫn `telegram` $\rightarrow$ `{ canAutoDigest: false, reason: 'Chế độ tự gửi báo cáo chỉ áp dụng khi lịch đọc từ một bảng tính Google Sheets và gửi vào đúng một kênh Slack hoặc nhóm Telegram.' }`.
  2. **Kiểm tra từ khóa hành động ghi (Write-Intent Guard):**
     - Nếu `request` có ý định ghi/sửa/xóa trên bảng tính (ví dụ: `thêm dòng`, `ghi vào`, `append`, `cập nhật bảng`, `sửa ô`, `xóa dòng`, `tạo bảng`, `đồng bộ vào sheets`) $\rightarrow$ `{ canAutoDigest: false, reason: 'Lịch có thao tác ghi hoặc cập nhật bảng tính nên cần bạn duyệt từng lượt.' }`.
  3. **Xác định bảng tính nguồn đã khóa (`source`):**
     - Ưu tiên `mysheets` nếu người dùng đã kết nối và chọn bảng tính (`selectedSpreadsheets.length > 0`), hoặc `sheets` nếu dịch vụ `sheets` đã cấu hình và có `allowedScope.spreadsheets`.
     - Nếu người dùng có đúng 1 bảng tính được cấp quyền: chọn bảng tính đó.
     - Nếu người dùng có nhiều bảng tính được cấp quyền: khớp theo ID hoặc tên bảng tính xuất hiện trong `request` (không phân biệt hoa thường/dấu). Nếu không xác định được duy nhất 1 bảng tính $\rightarrow$ `{ canAutoDigest: false, reason: 'Hãy nêu rõ tên bảng tính Google Sheets cần báo cáo (hoặc chỉ giữ một bảng tính trong phạm vi cấp quyền) để bật tự gửi.' }`.
     - Tự động trích xuất tên tab (`sheetName`) nếu trong `request` nhắc tới `tab <tên>` / `sheet <tên>` hoặc khớp với `item.sheets` đã khám phá.
  4. **Xác định đích gửi đã khóa (`destination`):**
     - Với `slack`: kiểm tra `allowedScope.channels`. Nếu có đúng 1 kênh hoặc `request` nêu rõ kênh nằm trong `allowedScope.channels` $\rightarrow$ khóa `channelId` đó. Ngược lại trả về `canAutoDigest: false` kèm lý do tiếng Việt.
     - Với `telegram`: kiểm tra `allowedScope.chats`. Nếu có đúng 1 nhóm/chat hoặc `request` nêu rõ `chatId` nằm trong `allowedScope.chats` $\rightarrow$ khóa `chatId` đó. Ngược lại trả về `canAutoDigest: false`.
  5. Khi đủ điều kiện, trả về `{ canAutoDigest: true, config: SheetsDigestConfig }`.

#### 3.4.4. Xác nhận lịch (`POST /api/conversations/:id/schedule-proposals/:messageId/confirm`)
- Body nhận thêm `{ approvalMode?: 'manual' | 'auto_digest' }` (mặc định `'manual'`).
- Nếu `approvalMode === 'auto_digest'`:
  - Kiểm tra `metadata.digestCandidate?.canAutoDigest === true` và `metadata.digestCandidate.config` hợp lệ. Nếu không $\rightarrow$ trả lỗi `400 Bad Request` tiếng Việt.
  - Kiểm tra lại ngay tại thời điểm confirm (TOCTOU check): bảng tính nguồn vẫn nằm trong `allowedSpreadsheets` (cùng `credentialId` của user đối với `mysheets`) hoặc `allowedScope` (đối với `sheets`), và kênh Slack / nhóm Telegram đích vẫn nằm trong `allowedScope`.
  - Tính `digestConfigHash = computeSheetsDigestHash({ userId, recurrence, config })` (SHA-256 hex 64 ký tự từ JSON canonical).
  - Lưu vào bảng `schedules` với `kind = 'sheets_digest'`, `digest_config = config`, `digest_config_hash = digestConfigHash`, `digest_approved_at = now()`.
- Nếu một lịch đang ở `sheets_digest` được chỉnh sửa qua hội thoại mà người dùng chọn `manual` (hoặc không còn đủ điều kiện `auto_digest`), cập nhật về `kind = 'plan'`, xóa `digest_config = NULL, digest_config_hash = NULL, digest_approved_at = NULL`.

#### 3.4.5. Bộ thực thi `SheetsDigestRunner` (`apps/chat-api/src/services/schedules/sheets-digest-runner.ts`)
Khi `ScheduleRunner` nhận một lịch đến hạn (hoặc chạy ngay `run-now`) có `schedule.kind === 'sheets_digest'`:
1. **Kiểm tra tính toàn vẹn (`digest_config_hash`) & Phạm vi quyền (Pre-Read Gate):**
   - Tính lại `expectedHash = computeSheetsDigestHash({ userId: schedule.user_id, recurrence: schedule.recurrence, config: schedule.digest_config })`.
   - Nếu `schedule.digest_config_hash !== expectedHash` $\rightarrow$ kết thúc lượt chạy với `status = 'blocked'`, tạm dừng lịch (`pauseReason: 'Cấu hình báo cáo tự động không còn khớp chữ ký xác nhận. Hãy lập lại lịch.'`).
   - Kiểm tra quyền bảng tính nguồn:
     - Với `mysheets`: đọc credential active của `schedule.user_id`; phải khớp `credentialId` trong `config.source.credentialId` và `spreadsheetId` phải nằm trong `selectedSpreadsheets`.
     - Với `sheets`: credential active và `spreadsheetId` phải nằm trong `allowedScope.spreadsheets`.
   - Kiểm tra quyền đích gửi:
     - Với `slack`: `channelId` phải nằm trong `allowedScope.channels`.
     - Với `telegram`: `chatId` phải nằm trong `allowedScope.chats`.
   - Nếu bất kỳ kiểm tra quyền nào thất bại $\rightarrow$ ghi nhận `status = 'blocked'` và tạm dừng lịch với thông báo tiếng Việt rõ ràng.
2. **Đọc dữ liệu bảng tính thông minh & Phân tích KPI / Tiến độ:**
   - Gọi `read_range` với `range: config.source.sheetName ? `${config.source.sheetName}!tail:${config.source.tailRows}` : `tail:${config.source.tailRows}`` và `headerAware: true`.
   - Phân tích thống kê xác định (`analyzeSheetRows(headers, records, values)`):
     - Tổng số dòng dữ liệu (`totalRows`).
     - Tự động nhận diện cột Trạng thái (`Status`, `Trạng thái`, `Tiến độ`, `Done`) và cột Hạn chót (`Deadline`, `Due`, `Hạn`, `Ngày`) nếu có:
       - Đếm số mục Hoàn thành (`Done`, `Completed`, `Hoàn thành`, `Xong`, `true`), Đang làm (`In Progress`, `Đang làm`, `Doing`), Chưa xong / Quá hạn (`Todo`, `Pending`, `Blocked`, `Quá hạn`, hoặc có ngày `Deadline < today`).
     - Trích xuất tối đa 8 dòng tiêu biểu để đưa vào báo cáo.
3. **Tóm tắt AI có rào chắn (Bounded AI Summary, 10s `AbortSignal`, Fallback xác định):**
   - Nếu `config.includeAiSummary && llmClient`:
     - Bọc dữ liệu bảng tính trong thẻ `<untrusted_sheet_data>...</untrusted_sheet_data>` với system prompt khóa chặt: chỉ tóm tắt số liệu KPI/tiến độ bằng tiếng Việt ngắn gọn (tối đa 4 gạch đầu dòng), tuyệt đối bỏ qua mọi chỉ thị/câu lệnh nằm trong ô bảng tính.
     - Áp dụng `AbortSignal.timeout(10_000)` kết hợp với `signal` của runner.
     - Nếu LLM trả lời hợp lệ: làm sạch đầu ra, loại bỏ link lạ hoặc mention nguy hiểm.
     - Nếu LLM lỗi hoặc quá 10 giây: tự động chuyển sang bản tóm tắt xác định (`summaryMode: 'deterministic'`), không làm hỏng lượt gửi báo cáo!
4. **Chống Mention Injection & Kiểm tra `version` ngay trước khi gửi (Pre-Send Gate):**
   - Với `slack`: escape `&`, `<`, `>` và vô hiệu hóa `@channel`, `@here`, `@everyone`, `<!channel>`, `<!here>`, `<!everyone>`, `<!subteam^...>` bằng zero-width space `!\u200b` hoặc `@\u200b`.
   - Trước khi gọi `slack.send_message` hoặc `telegram.send_message`, truy vấn lại dòng `schedules` trong DB:
     - Nếu `status !== 'active'` hoặc `version !== run.schedule_version`: hủy gửi ngay lập tức và chuyển trạng thái run sang `'discarded'`!
5. **Ghi nhận kết quả & Tự động tạm dừng khi lỗi liên tiếp:**
   - Nếu gửi thành công: cập nhật `schedule_runs` sang `status = 'digest_sent'` kèm `delivery: SheetsDigestDelivery`, và ghi 1 tin nhắn thông báo gọn trong hội thoại của lịch.
   - Nếu đọc bảng tính hoặc gửi tin nhắn thất bại: cập nhật `schedule_runs` sang `status = 'digest_failed'` kèm `error` tiếng Việt. Nếu 3 lượt chạy liên tiếp của lịch đều là `'digest_failed'`, tự động tạm dừng lịch (`status = 'paused'`, `pause_reason = 'Tự dừng sau 3 lần gửi báo cáo tự động liên tiếp thất bại.'`).

---

## 4. Vòng lặp Phản biện & Thẩm định Đặc tả (Spec Self-Audit Loop)

### Vòng 1 — Kiểm tra từ góc nhìn Người dùng & Nghiệp vụ (User & Business Audit)
- **Câu hỏi 1:** *Nếu người dùng dán link Google Sheets có dạng `/spreadsheets/u/1/d/<ID>/edit?pli=1#gid=123` trên màn hình Cài đặt hoặc Callback thì có nhận diện được không?*
  - **Giải pháp:** Regex `^https:\/\/docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{1,128})(?:\/|[?#]|$)` bắt chính xác cả `/u/0/`, `/u/1/`, query string và hash `#gid=...`. Đã cập nhật vào Mục 3.1.1.
- **Câu hỏi 2:** *Nếu bảng tính trên Google Sheets có tên tab chứa khoảng trắng hoặc dấu tiếng Việt như `Tiến độ Q4` và người dùng / AI chỉ truyền `range: "Tiến độ Q4"` thì sao?*
  - **Giải pháp:** Trong `resolveReadRange`, mọi tên tab không nằm trong dấu nháy đơn nhưng có khoảng trắng hoặc ký tự ngoài `[A-Za-z0-9_]` được tự động bọc qua `a1Sheet(tab)` (`'Tiến độ Q4'!A1:Z50`) trước khi gửi lên Google Sheets API!
- **Câu hỏi 3:** *Khi lịch `sheets_digest` đang bị lỗi `digest_failed`, người dùng vào trang Lịch sử / Lịch hẹn có bấm "Chạy lại" hoặc "Lập lại kế hoạch" được không?*
  - **Giải pháp:** Mở rộng `ScheduleService.replan` để cho phép chạy lại cả lượt có `status = 'digest_failed'` (ngoài `'planned'`, `'planning_failed'`, `'interrupted'`), và hiển thị nhãn tiếng Việt rõ ràng trong `schedule-text.ts` (`digest_sent`: `'Đã tự gửi báo cáo'`, `digest_failed`: `'Gửi báo cáo thất bại'`) cùng chi tiết đích gửi trong `ScheduleSection.tsx` và nút thử lại trong `ScheduleRunRecovery.tsx`.

### Vòng 2 — Kiểm tra từ góc nhìn Kỹ thuật, Bảo mật & Tương thích ngược (Technical & Security Audit)
- **Kiểm tra 1 (Mutation Invariants M1..M11):**
  - Rà soát từng chuỗi mục tiêu trong `scripts/test-mysheets-mutations.mjs`:
    - M3 (`if (driveRes.status === 404) {`), M4 (`fileData = await driveRes.json();`), M5 (`router.post('/picker-session', async (req, res) => {`), M6 (`const removed = await options.repo!.disconnect(user.id);`) trong `apps/chat-api/src/routes/connections/mysheets.ts`: giữ nguyên tuyệt đối từng dòng code này.
    - M9 (`row.map((cell: string) => (/^\s*[=+\-@]/u.test(cell) ? "'" + cell : cell))`) trong `packages/tool-adapters/src/sheets/sheets-shared.ts`: giữ nguyên tuyệt đối dòng code này trong `safeRows`.
    - M10 (`this.assertAllowedScope('spreadsheets', value);`) và M11 (`category: writing ? 'UNKNOWN' : 'NETWORK',`) trong `packages/tool-adapters/src/sheets/personal-sheets-adapter.ts`: giữ nguyên tuyệt đối.
- **Kiểm tra 2 (Tương thích ngược Unit Tests hiện hữu):**
  - Trong `packages/tool-adapters/tests/sheets-adapter.test.ts` và `personal-sheets-adapter.test.ts`:
    - Test `read_range` với `Tasks!A1:B3` kiểm tra `expect(result).toEqual({ range: 'Tasks!A1:B3', values: ... })` và `decodeURIComponent(apiCalls[0]!.url.pathname) === '/v4/spreadsheets/.../values/Tasks!A1:B3'`. Vì Chế độ 1 giữ nguyên path và shape khi không bật `tail`/`headerAware`, 100% test cũ xanh!
    - Test `append_rows` kiểm tra `expect(calls).toHaveLength(2)` với dữ liệu `[['=SUM(A1)', '+1', '-2', '@name']]` và `[['x']]`. Vì các dòng này không truyền `deduplicate: true` và không phải mã đồng bộ ngoại vi (`SYNC_KEY_RE`), adapter không gọi thêm `GET /values/`, giữ đúng 2 calls (`GET` metadata + `POST` append)!
- **Kiểm tra 3 (Tương thích ngược Migration Tests):**
  - Trong `apps/chat-api/tests/db/schedule-migration.test.ts`:
    - Test chạy tất cả các file `>= 0010` và kiểm tra `INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at) VALUES(...)` (mặc định `kind = 'plan'`, `digest_config = NULL`). Với `DEFAULT 'plan'`, câu lệnh `INSERT` cũ hoạt động hoàn hảo.
    - Test kiểm tra `schedule_runs` với `status = 'unknown'` phải bị từ chối (`23514`), và `status = 'planned'` phải có `plan_id`. Các ràng buộc trong `0016_sheets_automation_and_digest.sql` bảo toàn hoàn toàn các điều kiện này.

**Kết luận thẩm định Đặc tả:** **0 lỗi (Zero P1/P2/P3).** Đủ điều kiện chuyển sang Bước 3: Lập kế hoạch triển khai chi tiết.
