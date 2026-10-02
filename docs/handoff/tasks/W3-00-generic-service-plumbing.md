# W3-00 · Bỏ các chỗ viết cố định theo service trước khi thêm 5 service mới

**Trạng thái:** chờ · **Nhánh gợi ý:** `refactor/w3-00-generic-service-plumbing` · **Phụ thuộc:** không · **Chặn:** W3-01 → W3-05 (mọi task thêm service phải chờ task này merge)

Phần giao diện và câu từ chối nêu tên service nằm ở [W3-00b](W3-00b-frontend-and-refusal-naming.md), không chặn các task service, để task này nhỏ và merge sớm.

## Vì sao làm trước

Nhóm đã chốt (02/10/2026) thêm năm service: Google Sheets, Google Calendar, Notion, Telegram, Jira. Hiện mỗi service mới phải sửa lõi ở nhiều chỗ, trái với tiêu chí 2 mục 1.4 của đặc tả v3 ("thêm tích hợp không yêu cầu thêm nhánh theo tên dịch vụ trong lõi"). Nếu không sửa trước, năm task service sẽ cùng sửa các file lõi, xung đột nhau và mỗi task tự đặt quy tắc riêng.

Các chỗ viết cố định tìm thấy trên `main` `2ae2a16`:

| Chỗ | Vấn đề | Xử lý |
|---|---|---|
| `packages/tool-schemas/src/types.ts` | `scopeKey: 'boards' \| 'channels' \| 'repos'`; `AllowedScope` có đúng 3 trường | Task này |
| `packages/tool-adapters/src/base-adapter.ts` | `assertAllowedScope(type: 'board' \| 'channel' \| 'repo', …)` với ba khối `if` gần giống nhau | Task này |
| `apps/chat-api/src/services/registered-services.ts` | `normalizeAllowedScope(scopeKey: 'boards' \| 'channels' \| 'repos', …)`, regex repo viết riêng; `transports` gom cả ba service | Task này |
| `apps/chat-api/src/server.ts` (dòng ~221–411) | Adapter giả và kịch bản sandbox viết bằng chuỗi `if (tool === '…')` | Task này |
| `evaluations/live-execution/harness.ts` (`readLiveConfig`) | Đọc env riêng cho từng service bằng code lặp | Task này |
| `apps/chat-web/src/components/SettingsModal.tsx:174` | Nhãn allowlist `{ boards: 'board', channels: 'channel', repos: 'Repository' }` | API trả `scopeLabel` ở task này; frontend dùng ở W3-00b |
| `apps/chat-web/src/components/ReconciliationNotice.tsx:43`, `MissionControlLaunchpad.tsx:199` | Tên hiển thị và placeholder viết cố định | W3-00b |
| `packages/planner/src/validator.ts:145–165, 467` | Kiểm tra thành viên đúng board của card (`trello.create_card`, `trello.add_member`) | **Giữ nguyên**, ghi là ngoại lệ (quy tắc nghiệp vụ riêng của Trello, không cản việc thêm service khác) |
| `packages/planner/src/prompts/system-prompt.ts:37–48` | Ví dụ plan liên service dùng tool Trello/Slack, chỉ hiện khi các tool đó có trong catalog | **Giữ nguyên**, ngoại lệ; sửa prompt sẽ làm mất giá trị so sánh của golden set |
| `packages/planner/src/search.ts:24` (`KEPT_FIELDS`) | Chỉ giữ `id, name, fullName, number, title, boardId, boardIds, url` khi đưa kết quả search vào bộ nhớ grounding | Thêm `key` (Jira dùng issue key/project key làm định danh); không đổi gì khác |

## Việc cần làm

1. **Kiểu dữ liệu chung** (`tool-schemas`):
   - `ServiceDefinition.scopeKey: string`; thêm `scopeLabel` (nhãn cho UI, ví dụ "Board ID") và `scopePattern?: RegExp` (định dạng hợp lệ của một phần tử allowlist).
   - `AllowedScope = Partial<Record<string, string[]>>`; dữ liệu credentials đã lưu (`{ boards: [...] }` …) giữ nguyên định dạng.
   - `credentialFields[].type` thêm `'multiline'` (kiểu dữ liệu; phần hiển thị ở W3-00b).
   - `ToolDefinition.service: string`.
   - `GET /api/services` trả thêm `scopeLabel`.
2. **Tách registry theo service** để task thêm service chỉ thêm file mới và **một dòng** ở mỗi danh sách:
   - đổi `packages/tool-schemas/src/services.ts` thành thư mục `src/registry/` (một file mỗi service + `index.ts` gom `SERVICE_REGISTRY`); không đặt song song file `services.ts` và thư mục `services/` cùng tên;
   - `apps/chat-api/src/services/transports/<id>.ts` (createAdapter + checkConnection), `registered-services.ts` chỉ gom lại.
3. **Allowlist chung:**
   - `normalizeAllowedScope(definition, value)` dùng `definition.scopePattern`; regex `owner/name` chuyển vào định nghĩa GitHub.
   - `BaseAdapter.assertAllowedScope(scopeKey, value)` một đường code; giữ nguyên định dạng thông báo lỗi và `category: 'AUTH_ERROR'`. Sửa các chỗ gọi trong Trello/Slack/GitHub.
4. **Sandbox tách khỏi `server.ts`:** chuyển sang `apps/chat-api/src/sandbox/`: mỗi service một file `fake-results/<id>.ts` (map tên tool → hàm trả kết quả giả), kịch bản sang `scenarios.ts`. Hành vi không đổi: `npm run test:browser:v3` vẫn 8/8.
5. **Cấu hình chạy thật:** `readLiveConfig` đọc từ bảng `evaluations/live-execution/live-services.ts`, mỗi service một mục. Giữ nguyên tên biến env đang dùng.
6. **`KEPT_FIELDS` thêm `key`** (xem bảng trên), kèm test grounding chấp nhận giá trị lấy theo `x-resource-field: 'key'`.
7. **Bất biến từ khóa của registry** (test trong `packages/tool-schemas` hoặc `packages/planner`):
   - không từ khóa nào (`intentKeywords`, `fallbackIntentKeywords`, `id`, `name`) xuất hiện ở hai service; so sánh **nguyên cụm, không phân biệt hoa thường** (cụm `lên lịch` hợp lệ dù `lịch` bị cấm);
   - **service mới** không được dùng từ trong danh sách cấm: `lịch`, `bảng`, `trang`, `tin nhắn`, `message`, `thông báo`, `báo`, `kênh`, `channel`, `issue`, `issues`, `task`, `tasks`, `chat`, `nhóm`, `page`, `database`, `sprint`, `board`, `list`, `note`, `dòng`, `row`. Từ khóa đang có của Trello, Slack, GitHub được giữ (ghi rõ danh sách ngoại lệ theo service trong test, kèm lý do), không sửa registry cũ.
8. **Bộ câu hồi quy định tuyến** `evaluations/golden-v2/routing.test.ts` (chạy trong `npm run test:eval:v3`):
   - kho câu: mọi `prompt` trong `cases.json`, `cases-freeform.json`, và các câu mẫu của `MissionControlLaunchpad.tsx` (chép vào một file fixture trong `evaluations/`, không import từ `apps/chat-web`);
   - chạy `classifyIntent` với hai cấu hình: (a) catalog chỉ có Trello, Slack, GitHub nhưng registry đủ mọi service đã đăng ký; (b) catalog đủ mọi service;
   - so với file snapshot đã commit. Task thêm service nào làm snapshot đổi phải cập nhật snapshot trong commit riêng và giải thích từng câu đổi trong PR. Ở cấu hình (a), không câu nào của bộ 50 và bộ 18 được chuyển từ "có service" thành `[]`.
9. **Kiểm tra tĩnh chống viết cố định:** test lấy danh sách `id` từ `SERVICE_REGISTRY`, quét `packages/planner/src`, `packages/executor/src`, `apps/chat-api/src/routes`, `apps/chat-api/src/services` (trừ `transports/`), `apps/chat-web/src` (trừ test), và fail nếu gặp:
   - tên tool dạng `'<id>.<tên>'`;
   - chuỗi `'<id>'` đứng riêng;
   - khóa object `<id>:`.

   Ngoại lệ ghi trong một danh sách của test (file + mẫu + lý do): hai ngoại lệ planner ở bảng trên, chuỗi hiển thị trên trang giới thiệu/đăng nhập, và các chỗ W3-00b sẽ gỡ (W3-00b xóa chúng khỏi danh sách ngoại lệ).
10. **Test hợp đồng mở rộng:** trong test, đăng ký một service giả `demo` gồm `demo.list_things` (`listable`, `discovers: 'thing'`) và `demo.create_thing`, cùng transport giả. Chứng minh không cần sửa lõi mà vẫn:
    - hiện trong `GET /api/services`;
    - lưu được credentials và allowlist;
    - router chọn đúng, planner nhận tool, prefetch gọi `demo.list_things`;
    - adapter factory tạo adapter, allowlist chặn tài nguyên ngoài danh sách.

## Không làm trong task này

- Chưa thêm service thật nào.
- Không đổi tên tool, tên biến env hay định dạng dữ liệu đã lưu trong PostgreSQL.
- Không sửa prompt của planner; không đổi chính sách định tuyến.

## Tiêu chí nghiệm thu

- [ ] Toàn bộ test cũ vẫn đạt; test cũ chỉ đổi ở chỗ đổi chữ ký hàm (ghi rõ từng chỗ trong PR).
- [ ] Test mới fail trước khi sửa:
  - bất biến từ khóa;
  - bộ câu hồi quy định tuyến;
  - kiểm tra tĩnh;
  - test hợp đồng `demo`;
  - `assertAllowedScope` chung;
  - `normalizeAllowedScope` dùng `scopePattern`;
  - `KEPT_FIELDS` có `key`.
- [ ] Credentials đã lưu trước task này vẫn đọc được: test trên PostgreSQL thật.
- [ ] `npm run check` exit 0; `npm run test:browser:v3` 8/8.
- [ ] PR có bảng "trước/sau": số file phải sửa để thêm một service.

## Kết quả (agent thi công điền)

- PR: đang chuẩn bị.
- Commit triển khai: `e33177cf781d55ad9cfb77c538738ae937a0ac81` (base `9d262c6`).
- Test đã chạy và kết quả:
  - Baseline `npm run check`: exit 0, 526 test v3 + 66 offline evaluations.
  - RED: core 8 lỗi/14; extension/guards 4 lỗi/32; sandbox/live extraction 2 lỗi/2. Guard từ khóa có 27 fixture sai cho 23 từ cấm và 4 nguồn trùng từ.
  - GREEN: 48/48 test mới; `npm run check` exit 0, 569 test v3 + 71 offline evaluations; typecheck/build/production-secret scan/launcher/local-env đều đạt.
  - `npm run test:browser:v3`: exit 0, 9/9 với PostgreSQL thật và planner/adapter sandbox.
  - SQL: service giả `demo` đi qua HTTP, lưu/đọc credentials mã hóa, catalog, router, planner/prefetch/grounding và factory; scope ngoài allowlist bị chặn. Ba JSON credentials cũ được đọc và dùng để tạo adapter, ciphertext không đổi.
  - Review độc lập e33177c: một lỗi Important (guard dựa vào snapshot cập nhật được); đã sửa tại 08431be85aae5cb1fefcc74b1c76a5a3d56c778e bằng RED 1/2 → GREEN 2/2 và chạy lại toàn bộ check. Reviewer độc lập chạy lại 569 v3 +70 eval và browser 9/9, không phát hiện lỗi production khác. Sau fix check đạt 569 +71; không gọi reviewer lần hai.
- Điều chưa làm hoặc khác với task card:
  - Gate browser hiện có 9 ca sau FE-01; chạy đủ 9 thay cho số 8 cũ trong card.
  - Bất biến từ khóa đã đúng ở baseline; dùng fixture sai để kiểm tra guard, giữ nguyên mọi keyword/pattern cũ.
  - Snapshot 72 câu (50 golden + 18 freeform + 4 launchpad), cả catalog cũ và đầy đủ. Không sửa router, validator, prompt hay nhãn golden; provider/live services NOT_RUN.
  - Test cũ duy nhất sửa: hai lời gọi `assertAllowedScope` trong `crypto-ratelimit.test.ts` đổi `board/channel` → `boards/channels` theo chữ ký mới.
  - Xung đột kế hoạch trước W3-02: rf06 yêu cầu Google Calendar; router hiện trả các service cũ, nhưng sau đăng ký Calendar chưa cấu hình sẽ trả []. Gate item8 sẽ chặn đúng theo card. Cần chốt quy tắc ngoại lệ/label hoặc routing trước W3-02; W3-00 giữ nguyên policy và không tự nới guard.
  - W3-00b, năm service thật, AUTH và FE-02 thuộc task riêng.
