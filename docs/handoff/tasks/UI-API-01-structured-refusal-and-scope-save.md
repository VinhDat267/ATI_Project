# UI-API-01 · Từ chối có cấu trúc và lưu riêng nơi được dùng

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/ui-api-01-refusal-and-scope` · **Phụ thuộc:** không · **Mốc:** 12/10/2026 (song song FE-04)
**Đặc tả:** [UI redesign](../../superpowers/specs/2026-10-05-ui-redesign-agentic-design.md) mục 9 · **Dùng bởi:** FE-06 (màn từ chối), FE-07 (trang Kết nối dịch vụ)

## Vì sao quan trọng

Hai màn hình mới cần dữ liệu mà API chưa trả:

1. Màn từ chối cần biết **dịch vụ nào** chưa kết nối để hiện trạng thái từng dịch vụ và nút "Kết nối Notion". Hiện tin `refusal` chỉ là văn bản ("Từ chối yêu cầu: Notion chưa được kết nối… Gợi ý: …"), giao diện phải đoán bằng cách tách chuỗi.
2. Trang Kết nối dịch vụ: muốn thêm một kênh Slack, quản trị viên phải nhập lại toàn bộ khoá, vì `POST /api/services/:service/credentials` yêu cầu đủ khoá hợp lệ mỗi lần lưu.

## Hiện trạng

- `planner.ts` hàm `unroutable(route.unavailable)` trả `{ kind: 'refusal', reason, suggestion }`; `route.unavailable` đã có `[{ id, name }]` nhưng bị bỏ.
- `chat-service.ts` lưu tin `assistant` với nội dung văn bản và metadata `{ type: 'refusal', ...correlation }`, phát SSE `refusal`.
- `services-routes.ts` lưu credentials: kiểm `isAdmin`, `hasValidCredentials`, `normalizeAllowedScope`, mã hoá toàn bộ `{ ...credentials, allowedScope }`.

## Việc cần làm

1. **Từ chối có cấu trúc:**
   - `RefusalResponse` (tool-schemas) thêm trường tuỳ chọn `unavailableServices?: Array<{ id: string; name: string }>`;
   - `unroutable()` điền trường này khi có `route.unavailable`;
   - metadata tin `refusal` và payload SSE `refusal` có thêm `reason`, `suggestion`, `unavailableServices` (nếu có);
   - giữ nguyên nội dung văn bản của tin để lịch sử cũ và giao diện hiện tại vẫn hiển thị đúng;
   - từ chối do model sinh (không qua router) không có `unavailableServices`.
2. **Lưu riêng nơi được dùng:**
   - thêm route (ví dụ `PUT /api/services/:service/scope` với body `{ allowedScope }`) chỉ cho quản trị viên;
   - đọc credentials đã mã hoá, giải mã, thay `allowedScope` đã chuẩn hoá, mã hoá lại và lưu; khoá giữ nguyên;
   - dịch vụ chưa có credentials trả 409; scope rỗng hoặc sai định dạng trả 400 như route hiện có;
   - lưu xong xoá kết quả kiểm tra kết nối cũ của dịch vụ đó (giống route credentials) và gọi `onCredentialsChanged`;
   - `api-client` thêm hàm tương ứng.

## Tiêu chí nghiệm thu

- [ ] Test planner: yêu cầu cần Notion và Jira chưa kết nối → refusal có `unavailableServices` đúng hai dịch vụ, `reason` giữ câu hiện tại.
- [ ] Test chat-service: metadata tin và payload SSE `refusal` có `unavailableServices`; nội dung văn bản không đổi.
- [ ] Test route scope trên PostgreSQL thật: quản trị viên đổi scope được và khoá giải mã ra vẫn như cũ; thành viên nhận 403; chưa có credentials 409; scope rỗng/sai định dạng 400; trạng thái kiểm tra về `unchecked`.
- [ ] Không log giá trị khoá trong bất kỳ nhánh nào (test bắt log).
- [ ] `npm run check` và `npm run test:browser:v3` exit 0.

## Ngoài phạm vi

Giao diện (FE-06, FE-07). Gỡ khoá dịch vụ. Lưu tên tài nguyên kèm ID.

## Kết quả

_(agent thi công điền)_
