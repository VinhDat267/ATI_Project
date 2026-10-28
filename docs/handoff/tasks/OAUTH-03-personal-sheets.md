# OAUTH-03 · Google Sheets của riêng bạn, chọn bảng tính bằng Google Picker

**Trạng thái:** đã chốt thiết kế ngày 28/10/2026 (bốn tình huống, Google Picker) · **Nhánh gợi ý:** `feat/oauth-03-personal-sheets` (một PR cho backend và giao diện), `eval/oauth-03-measure` · **Phụ thuộc:** OAUTH-02 (#176, đã merge) · **Mốc:** nhóm trưởng làm xong phần mã trong ngày 28/10; đo, nghiệm thu, bật cờ trước **04/11/2026**
**Đặc tả:** [`2026-10-28-oauth-03-personal-sheets-design.md`](../../superpowers/specs/2026-10-28-oauth-03-personal-sheets-design.md), đọc hết trước khi làm. Chỗ nào đặc tả không nói thì làm như [OAUTH-02](OAUTH-02-personal-calendar.md). Quy tắc của dịch vụ riêng: [GMAIL-common](GMAIL-common.md).
**Có phần việc của con người:** Google Cloud (bước 0), nghiệm thu thật (bước 4).

## Mục tiêu

Khi `MYSHEETS_ENABLED=on`, mỗi người kết nối Google của chính mình (quyền `drive.file`), chọn bảng tính trong Google Picker, rồi nhờ ATI đọc và thêm dòng vào đúng những bảng đó. Bốn tình huống phải chạy được (đặc tả mục 1.2):
1. ghi một dòng vào bảng riêng;
2. Jira → bảng riêng;
3. bảng riêng → Slack;
4. lịch chạy đọc bảng riêng, mỗi lượt chờ duyệt (cần `SCHEDULES_ENABLED`).

Google Sheets chung (`sheets.*`) không đổi. Cờ tắt thì hệ thống không đổi từng byte.

## Việc cần làm

0. **Google Cloud** (nhóm trưởng, đặc tả mục 9):
   - tạo project **thứ ba**, khác project Gmail, Calendar riêng và đăng nhập;
   - bật Sheets API, Drive API, Picker API;
   - màn đồng ý ở chế độ Testing, quyền `drive.file`, cùng test user;
   - client OAuth web, redirect `/connections/mysheets/callback`, JavaScript origin là origin của web;
   - API key chỉ cho Picker API, giới hạn website `<web origin>/*` và `https://docs.google.com/*`;
   - ghi `MYSHEETS_OAUTH_*`, `MYSHEETS_OAUTH_PROJECT_ID`, `MYSHEETS_PICKER_API_KEY`, `MYSHEETS_PICKER_APP_ID` (project number) vào `.env` ở máy; khai thêm project ID của Gmail và Calendar riêng nếu đã có client. Không commit `.env`.
1. **PR mã** (đặc tả mục 4–7), cờ tắt:
   - **schema:** `MYSHEETS_SERVICE`, `MYSHEETS_TOOLS` (bốn tool như `SHEETS_TOOLS`, `'x-resource': 'myspreadsheet'` và `'mysheet'`), `PlanConnections.mysheets`, `PersonalSpreadsheetItem`;
   - **cấu hình:** cờ và biến môi trường; `validatePersonalGoogleProjects` cho ba dịch vụ, giữ nguyên thông báo của cặp Gmail–MyCalendar; `.env.example`;
   - **DB:** migration `0013_mysheets_personal_connections.sql`;
   - **backend:** mở rộng repo kết nối và token manager cho `mysheets`; route `/api/connections/mysheets` (`start`, `callback`, `picker-session`, `spreadsheets`, `scope`, `DELETE`); `PersonalSheetsAdapter` dùng chung phần kiểm tra với `SheetsAdapter`; `AdapterFactory`, catalog và registry theo người gọi, luật router tổng quát hoá, `bindConnections` (allowlist và bảng "Chỉ xem"), `resourceLabels`, executor và recovery, `/api/services`, `/api/health`, kịch bản sandbox `mysheets`;
   - **Google giả** (`scripts/fake-google-gmail.mjs`): client và project Sheets; Drive `about`, `files.get`; Sheets API cho file đã cấp; `fake-picker/files` và `fake-picker/grant` (có CORS cho web);
   - **giao diện:** trang `/connections/mysheets/callback` (Picker thật ở live, hộp chọn giả ở sandbox), hàng `/settings#mysheets`, nút ở `RefusalMoment`, nhãn ở màn duyệt và biên nhận, `/privacy`;
   - **`/guide` và Landing** (đặc tả mục 6.6, nhóm trưởng yêu cầu 28/10): `pages/Guide/mysheets-data.tsx`, mẫu câu cho tình huống 1–3 (tình huống 4 khi lịch chạy cũng bật), `/guide?service=mysheets`, thẻ "Google Sheets · Của riêng bạn" ở Landing; chỉ hiện khi cờ bật;
   - **browser:** nhóm `mysheets` trong `scripts/test-v3-browser.mjs` (cờ chỉ bật cho nhóm này), ca `MYSHEETS off:` ở nhóm default;
   - thêm `docs/ai-evidence/MYSHEETS-LIVE/` vào `.gitignore`.
2. **Bộ đo** (đặc tả mục 8.3):
   - fixture bảng riêng, gồm ô chứa câu tiêm lệnh; `evalCatalog` thêm `MYSHEETS_TOOLS` cho `EVAL_SET=mysheets`, các bộ cũ giữ catalog và mã băm cũ;
   - `cases-mysheets.json`, 9 câu, commit và push label **trước mọi lời gọi model**;
   - `EVAL_SET=mysheets` ×3; báo cáo ở `docs/ai-evidence/V3-GOLDEN-V2/<ngày>-OAUTH-03-REPORT.md`.
3. Ghi kết quả vào card này và một file log mới.
4. **Nghiệm thu thật** (nhóm trưởng thao tác, agent ghi theo câu lệnh P-LIVE; đặc tả mục 8.4): Picker thật chọn hai bảng (một bảng "Chỉ xem"); tình huống 1 và 3 với Google thật; yêu cầu ghi vào bảng không được chọn bị chặn; ngắt kết nối, kiểm token đã thu hồi và Gmail, Calendar riêng vẫn kết nối.
5. **PR bật cờ** nếu đạt ngưỡng ở đặc tả mục 8.3 và bước 4 đạt, trước 04/11.

## Test tối thiểu

- **Cờ tắt:** SHA-256 prompt và catalog bằng giá trị trước task; routing 116 câu; không có route, trường health hay hàng `/api/services` mới; không có request tới `apis.google.com`; `/guide` và Landing không có Sheets riêng.
- **`/guide`:** mẫu câu của Sheets riêng chỉ dùng tool có trong `ALL_TOOLS` hoặc `MYSHEETS_TOOLS`; chữ của Gmail ở `/guide` không đổi.
- **Gmail, OAUTH-01, OAUTH-02, SCHED, `SheetsAdapter`:** test hiện có đạt, không sửa assertion.
- **PostgreSQL thật và Google giả:**
  - state một lần; callback lưu `scope_required`, chưa mở `MYSHEETS_TOOLS`;
  - `picker-session`: 409 khi chưa có dòng `active`, 401 khi không có phiên, có `no-store`;
  - `PUT /scope` từ chối mảng rỗng, quá 10, ID chưa được cấp, file không phải bảng tính, file đã xoá; tên và `canEdit` lấy từ Google;
  - callback cũ không ghi đè kết nối mới; đăng xuất giữa chừng → `401 INVALID_SESSION`; `invalid_grant` → `reconnect_required` của đúng `mysheets`;
  - ngắt Sheets riêng không đổi dòng Gmail và Calendar riêng, token của hai dịch vụ đó vẫn dùng được; và ngược lại;
  - thực thi với `credentialId` khác hoặc bảng đã bị bỏ → `AUTH_ERROR`; thêm dòng vào bảng "Chỉ xem" → từ chối;
  - lượt lịch chạy có bước `mysheets.*` được gắn `connections.mysheets`.
- **Adapter:** chặn ID ngoài allowlist ở cả bốn tool; 401 → làm mới một lần; lỗi token trước khi gửi → `requestSent: false`; treo sau khi gửi → `UNKNOWN`; huỷ bằng `AbortSignal` thật; chặn công thức.
- **Cấu hình live:** thiếu project ID, App ID hoặc API key → không khởi động; trùng project ID hoặc client ID giữa hai dịch vụ Google riêng bất kỳ → không khởi động.
- **Browser** nhóm `mysheets`: kết nối từ `/settings`, chọn và bỏ bảng; kết nối trong hội thoại → chọn bảng → quay về hội thoại → gửi lại yêu cầu → duyệt → biên nhận; `scope_required` từ màn từ chối; huỷ hộp chọn; `/guide?service=mysheets` và thẻ Landing; 1440/375 sáng/tối.

## Đột biến

Mười đột biến ở đặc tả mục 8.2 (đột biến 3 gồm bốn chỗ kiểm allowlist, mỗi chỗ một lần). Ghi kết quả từng đột biến vào log.

## Tiêu chí nghiệm thu

- [ ] RED trước GREEN; mọi đột biến ở đặc tả mục 8.2 bị bắt.
- [ ] `npm run check` và toàn bộ `npm run test:browser:v3` exit 0; không sửa assertion cũ.
- [ ] Label commit trước lời gọi model đầu tiên; đo ×3, báo cáo nguồn gốc.
- [ ] Nghiệm thu thật đạt; quyết định bật cờ ghi trong log kèm số liệu.

## Ngoài phạm vi

- Tạo bảng tính, sửa hay xoá ô, định dạng; đọc file Drive khác.
- Calendar riêng ở `/guide` và Landing.
- OAuth cho Slack, GitHub, Notion, Jira, Trello.

## Kết quả (agent thi công điền)

- **Nhánh, commit:** `feat/oauth-03-personal-sheets`, chuỗi commits từ `e8de063d` đến `cd55c9e1` và commit giải quyết review findings P1-P4 (trên nền `origin/main` `155e99de`).
- **Kiểm thử và đột biến:**
  - `npm run check`: **PASS** (exit code 0; unit/integration tests, 406 evaluation tests, 11 launcher/env tests, typecheck sạch, web build bảo mật sạch).
  - Browser E2E: **PASS** (9/9 passed ở `SCENARIO=mysheets`, 1/1 passed ở `MYSHEETS off:`).
  - Đột biến: **13/13 đột biến bắt buộc** (§8.2) bị bắt với exit code 1, tự động hóa qua `scripts/test-mysheets-mutations.mjs`, khôi phục 100% SHA-256 (M2 được chuẩn hoá và bắt đúng).
  - Review vòng 1–3: đã sửa wiring live, chọn bảng, phân giải tham chiếu và dùng tra cứu thật khi bảng đổi tên trên Google; hai chiều đổi tên đều có kiểm thử.
  - Sửa hai P2 của review vòng 4: lỗi lookup runtime hoặc kết quả sai dạng làm lượt lập kế hoạch báo lỗi, không quay về tên Picker cũ. Signal của lượt lịch đi tới adapter; lookup có deadline mặc định 10 giây cho cả chat, có kiểm tra hủy trước dispatch sau khi lấy adapter.
  - Test hồi quy mới `mysheets-planning-lookup.test.ts`: PostgreSQL thật, AdapterFactory và HTTP cục bộ; RED **6 fail / 3 pass**, GREEN **9/9 pass**. `npm run check` mới: **2.509 test v3 + 406 eval + 11 launcher/env**, exit 0 sau khi migrate DB tạm. Lượt check đầu thiếu migration public đã được ghi riêng trong log, không sửa assertion.
  - Đột biến sau sửa vòng 4: **13/13 gốc + 4/4 hồi quy mới** bị bắt, mỗi mutant exit 1; runner exit 0, SHA-256 mã nguồn khôi phục khớp; 9 test mới pass lại sau khôi phục.
  - Browser sau sửa vòng 4: lượt tổng exit 1 ở default (**92 pass / 4 fail / 1 skip**); bốn ca lỗi pass lại **4/4** khi chạy riêng; 15 nhóm còn lại **71 pass**, từng lệnh exit 0 (MySheets 9, Gmail 10, Calendar 7, schedule 22). Có bằng chứng pass qua nhiều lần chạy, chưa có một lượt tổng exit 0; giữ nguyên assertion và timeout, xem chi tiết trong log sửa vòng 4.
- **Số đo (`EVAL_SET=mysheets`):** Chưa đo (thuộc Bước 2, thực hiện trên nhánh `eval/oauth-03-measure` sau khi merge PR code).
- **Nghiệm thu thật:** Chưa nghiệm thu P-LIVE (nhóm trưởng thao tác ở Bước 4 với Google Cloud Project thứ ba).
- **Quyết định bật cờ:** Giữ `MYSHEETS_ENABLED=off` trong PR này; chỉ bật cờ khi hoàn thành Bước 2 và Bước 4.
- **Khác với đặc tả:** Không có (tuân thủ 100% đặc tả thiết kế và các quyết định của reviewer).
- **Log bàn giao:** [`docs/handoff/log/2026-10-28-OAUTH-03-personal-sheets.md`](../log/2026-10-28-OAUTH-03-personal-sheets.md).
- **Log sửa review vòng 4:** [`2026-10-28-OAUTH-03-review-r4-fixes.md`](../log/2026-10-28-OAUTH-03-review-r4-fixes.md). Chưa phải review độc lập hay nghiệm thu Google thật.
