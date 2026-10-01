# W3-02 · Google Sheets: đăng ký vào nền tảng

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/w3-02-sheets-platform` · **Phụ thuộc:** W3-01 đã merge

## Mục tiêu

Đưa Google Sheets vào toàn bộ luồng sản phẩm như ba service hiện có: cấu hình credentials trên frontend, routing, prefetch, grounding, thực thi sau khi duyệt, và một workflow bốn service chạy được trong sandbox.

## Hiện trạng cần biết

`scopeKey` đang bị viết cố định thành ba giá trị `'boards' | 'channels' | 'repos'` ở nhiều nơi, nên thêm service mới phải sửa cả những chỗ đó:
- `packages/tool-schemas/src/types.ts` (`ServiceDefinition.scopeKey`, `AllowedScope`);
- `apps/chat-api/src/services/registered-services.ts` (`normalizeAllowedScope`, `transports`);
- `apps/chat-api/src/services/adapter-factory.ts`;
- `evaluations/live-execution/harness.ts` (`readLiveConfig`).

## Việc cần làm

1. **Kiểu dữ liệu:** thêm `spreadsheets` vào `scopeKey` và `AllowedScope`. `normalizeAllowedScope` kiểm tra spreadsheet ID theo dạng `^[A-Za-z0-9_-]{20,}$`.
2. **Registry:** thêm mục `sheets` vào `SERVICE_REGISTRY`:
   - `credentialFields`: `clientEmail` (text), `privateKey` (password).
   - `intentKeywords` có cả tiếng Việt và tiếng Anh: `sheets`, `google sheets`, `spreadsheet`, `bảng tính`, `trang tính`, `sheet`, `row`, `dòng`.
   - Xem lại các từ khóa dễ trùng với Trello (`bảng` của Trello là board): không thêm `bảng` đơn lẻ, và có test chứng minh câu "tạo card trên bảng Frontend" không bị route sang Sheets.
3. **Backend:** `transports.sheets` trong `registered-services.ts` gồm `createAdapter` và `checkConnection` (lấy token rồi gọi `spreadsheets.get` cho spreadsheet đầu tiên trong allowlist).
4. **Planner:** `sheets.list_spreadsheets` được prefetch như các tool `listable` khác, `sheets.list_sheets` là con của spreadsheet. Grounding kiểm `spreadsheetId` theo `x-resource`. Không cần sửa prompt nếu test cho thấy model nhận đủ ngữ cảnh; nếu có sửa prompt thì phải chạy lại golden set (W3-03).
5. **Frontend:** màn hình "Cài đặt dịch vụ" hiện Google Sheets từ metadata của API (đã có sẵn cơ chế); nhãn allowlist ghi rõ "Spreadsheet ID". Thêm gợi ý trong ô `privateKey` rằng có thể dán key có `\n`.
6. **Sandbox:** adapter giả trong `apps/chat-api/src/server.ts` trả kết quả cho các tool Sheets. Thêm `SANDBOX_SCENARIO=four_service` với plan: tạo issue GitHub → tạo card Trello có link issue → thêm một dòng vào Sheets chứa cả hai link → báo Slack. Thêm kịch bản tương ứng vào `scripts/test-v3-browser.mjs`.
7. **Chạy thật:** `readLiveConfig` nhận `GOOGLE_SA_CLIENT_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `LIVE_SHEETS_SPREADSHEET_IDS`; thêm tên ba biến (không có giá trị) vào `.env.example`.

## Tiêu chí nghiệm thu

- [ ] Test routing: câu có "Google Sheets"/"bảng tính" chọn Sheets; câu Trello có chữ "bảng" không chọn Sheets.
- [ ] Test `normalizeAllowedScope` cho `spreadsheets` (ID hợp lệ, ID sai dạng, danh sách rỗng).
- [ ] Test API cấu hình: lưu credentials Sheets, `GET /api/services` trả đúng `credentialFields` và allowlist; private key không bao giờ xuất hiện trong response.
- [ ] Test planner: catalog chỉ có tool Sheets khi Sheets đã được cấu hình; grounding từ chối `spreadsheetId` không có trong kết quả search.
- [ ] Browser E2E kịch bản `four_service`: duyệt plan → bốn step `succeeded`, dòng Sheets chứa link issue và link card (kiểm qua `output_json` trong PostgreSQL), tin Slack chứa đủ link.
- [ ] Toàn bộ kịch bản browser cũ vẫn đạt.
- [ ] Test mới fail trước khi sửa; `npm run check` exit 0; `npm run test:browser:v3` đạt hết.

## Kết quả (agent thi công điền)

- PR:
- Commit:
- Test đã chạy và kết quả:
- Điều chưa làm hoặc khác với task card:
