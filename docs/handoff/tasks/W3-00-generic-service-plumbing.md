# W3-00 · Bỏ các chỗ viết cố định theo service trước khi thêm 5 service mới

**Trạng thái:** chờ · **Nhánh gợi ý:** `refactor/w3-00-generic-service-plumbing` · **Phụ thuộc:** không · **Chặn:** W3-01 → W3-05 (mọi task thêm service phải chờ task này merge)

## Vì sao làm trước

Nhóm đã chốt (02/10/2026) thêm năm service: Google Sheets, Google Calendar, Notion, Telegram, Jira. Hiện mỗi service mới phải sửa lõi ở nhiều chỗ, trái với tiêu chí 2 mục 1.4 của đặc tả v3 ("thêm tích hợp không yêu cầu thêm nhánh theo tên dịch vụ trong lõi"). Nếu không sửa trước, năm task service sẽ cùng sửa các file lõi, xung đột nhau và mỗi task tự đặt quy tắc riêng.

Các chỗ viết cố định tìm thấy trên `main` `2ae2a16`:

| Chỗ | Vấn đề |
|---|---|
| `packages/tool-schemas/src/types.ts` | `scopeKey: 'boards' \| 'channels' \| 'repos'`; `AllowedScope` có đúng 3 trường; `ToolDefinition.service: 'trello' \| 'slack' \| string` |
| `packages/tool-adapters/src/base-adapter.ts` | `assertAllowedScope(type: 'board' \| 'channel' \| 'repo', …)` với ba khối `if` gần giống nhau |
| `apps/chat-api/src/services/registered-services.ts` | `normalizeAllowedScope(scopeKey: 'boards' \| 'channels' \| 'repos', …)`, regex kiểm repo viết riêng cho `repos`; `transports` gom cả ba service trong một file |
| `apps/chat-api/src/server.ts` (dòng ~221–411) | Adapter giả và kịch bản sandbox viết bằng chuỗi `if (tool === '…')` trong file khởi động server |
| `evaluations/live-execution/harness.ts` (`readLiveConfig`) | Đọc env riêng cho từng service bằng code lặp |
| `apps/chat-web/src/components/ReconciliationNotice.tsx:43` | Bảng tên hiển thị `{ trello, slack, github }` viết cố định |
| `apps/chat-web/src/components/MissionControlLaunchpad.tsx:199` | Placeholder liệt kê `@trello, @slack, @github` |
| Ô nhập credentials | Chỉ có `text`/`password` một dòng; private key của Google có nhiều dòng |
| `packages/planner/src/router.ts` + `planner.ts` | Khi câu chat khớp từ khóa của một service đã đăng ký nhưng chưa cấu hình, router trả `[]` và planner từ chối bằng một câu chung chung, không nói service nào thiếu |

Điểm cuối cùng là rủi ro lớn nhất khi có 8 service: router chạy trên **toàn bộ** tin nhắn của người dùng trong hội thoại, nên chỉ cần một từ khóa quá rộng của service chưa cấu hình (ví dụ Telegram dùng "tin nhắn", Calendar dùng "lịch") là mọi yêu cầu Slack hoặc mọi câu có "lịch sử", "du lịch" đều bị từ chối.

## Việc cần làm

1. **Kiểu dữ liệu chung** (`tool-schemas`):
   - `ServiceDefinition.scopeKey: string`; thêm `scopeLabel` (nhãn cho UI, ví dụ "Board ID", "Spreadsheet ID") và `scopePattern?: RegExp` (định dạng hợp lệ của một phần tử allowlist).
   - `AllowedScope = Partial<Record<string, string[]>>`; giữ tương thích dữ liệu credentials đã lưu (`{ boards: [...] }` …).
   - `credentialFields[].type` thêm `'multiline'` (cho private key).
   - `ToolDefinition.service: string`.
2. **Tách registry theo service:** mỗi service một file `packages/tool-schemas/src/services/<id>.ts` (định nghĩa service) bên cạnh file tool hiện có; `SERVICE_REGISTRY` và `ALL_TOOLS` chỉ còn là danh sách import. Tương tự trong `apps/chat-api`: `src/services/transports/<id>.ts` (createAdapter + checkConnection), `registered-services.ts` chỉ gom lại. Mục đích: task thêm service chỉ thêm file mới và **một dòng** ở mỗi danh sách, xung đột merge tối thiểu.
3. **Allowlist chung:**
   - `normalizeAllowedScope(definition, value)` dùng `definition.scopePattern`; regex `owner/name` chuyển vào định nghĩa GitHub.
   - `BaseAdapter.assertAllowedScope(scopeKey, value)` một đường code duy nhất; giữ nguyên định dạng thông báo lỗi và `category: 'AUTH_ERROR'`. Sửa các chỗ gọi trong Trello/Slack/GitHub.
4. **Sandbox tách khỏi `server.ts`:** chuyển adapter giả sang `apps/chat-api/src/sandbox/`: mỗi service một file `fake-results/<id>.ts` (map tên tool → hàm trả kết quả giả), kịch bản (`default`, `three_service`, `clarification`, …) sang `scenarios.ts`. Hành vi không đổi: `npm run test:browser:v3` vẫn 8/8.
5. **Cấu hình chạy thật:** `readLiveConfig` đọc từ một bảng `evaluations/live-execution/live-services.ts`, mỗi service một mục (tên biến env của credentials, tên biến allowlist, cách kiểm định dạng). Giữ nguyên tên biến env đang dùng.
6. **Router an toàn hơn khi có nhiều service:**
   - `classifyIntent` trả thêm danh sách service bị chặn vì chưa cấu hình (ví dụ `{ services, unavailable }`); hai chỗ gọi trong `planner.ts` cập nhật theo.
   - Câu từ chối **nêu tên** service còn thiếu ("Google Calendar chưa được kết nối…"), dùng `name` trong registry.
   - Giữ nguyên chính sách hiện tại: nếu câu khớp một service chưa cấu hình thì từ chối, không lặng lẽ chuyển sang service khác.
   - Thêm **test bất biến của registry**: không từ khóa nào (`intentKeywords`, `fallbackIntentKeywords`) xuất hiện ở hai service; không service nào dùng các từ quá rộng trong danh sách cấm: `lịch`, `bảng`, `trang`, `tin nhắn` (trừ Slack, đang dùng), `message` (trừ Slack), `issue` (trừ GitHub), `task`, `chat`, `nhóm`, `page`, `database`, `sprint`, `board` (trừ Trello). Danh sách cấm đặt trong file test, kèm lý do từng từ.
7. **Frontend:**
   - Tên hiển thị service lấy từ `GET /api/services` (hoặc từ tiền tố tên tool tra trong danh sách đó), bỏ bảng viết cố định trong `ReconciliationNotice.tsx`.
   - Placeholder trong `MissionControlLaunchpad.tsx` dựng từ danh sách service.
   - Ô credentials kiểu `multiline` hiển thị `textarea`, vẫn che giá trị khi đã lưu.
   - Trang giới thiệu (`LandingPageView.tsx`) **không** thuộc task này.
8. **Kiểm tra tĩnh chống viết cố định:** một test quét `packages/planner/src`, `packages/executor/src`, `apps/chat-api/src/routes`, `apps/chat-web/src/components` (trừ file test, trừ ví dụ trong chuỗi hiển thị đã được duyệt trong danh sách ngoại lệ có ghi lý do) và fail nếu thấy chuỗi `'trello'`, `'slack'`, `'github'` dùng để rẽ nhánh.
9. **Test hợp đồng mở rộng:** trong test (không phải code production), đăng ký một service giả `demo` gồm một tool đọc `demo.list_things` (`listable`, `discovers: 'thing'`) và một tool ghi `demo.create_thing`, cùng transport giả. Chứng minh không cần sửa lõi mà vẫn: hiện trong `GET /api/services`, lưu được credentials và allowlist, router chọn đúng, planner nhận tool, adapter factory tạo adapter, allowlist chặn tài nguyên ngoài danh sách.

## Không làm trong task này

- Chưa thêm service thật nào.
- Không đổi tên tool, tên biến env hay định dạng dữ liệu đã lưu trong PostgreSQL.
- Không sửa prompt của planner.

## Tiêu chí nghiệm thu

- [ ] Toàn bộ test cũ vẫn đạt, không sửa expectation của test cũ trừ chỗ đổi chữ ký hàm (ghi rõ từng chỗ trong PR).
- [ ] Test mới fail trước khi sửa: router nêu tên service thiếu; bất biến từ khóa của registry; kiểm tra tĩnh chống viết cố định; test hợp đồng với service `demo`; `assertAllowedScope` chung cho scope key bất kỳ; `normalizeAllowedScope` dùng `scopePattern`; ô `multiline`.
- [ ] Credentials đã lưu trước task này (định dạng `{ boards: [...] }`) vẫn đọc được: test trên PostgreSQL thật.
- [ ] `npm run check` exit 0; `npm run test:browser:v3` 8/8.
- [ ] PR ghi một bảng "trước/sau": số file phải sửa để thêm một service (trước: liệt kê; sau: chỉ file mới + một dòng ở mỗi danh sách).

## Kết quả (agent thi công điền)

- PR:
- Commit:
- Test đã chạy và kết quả:
- Điều chưa làm hoặc khác với task card:
