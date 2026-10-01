# Yêu cầu chung cho các task thêm service (W3-01 → W3-05)

Mỗi task card service (Sheets, Calendar, Notion, Telegram, Jira) chỉ ghi phần riêng của service đó. Phần dưới đây áp dụng cho **cả năm task**; reviewer kiểm theo cả hai.

## Trước khi viết code

- W3-00 phải đã merge. Làm trên `main` mới nhất, nhánh riêng, worktree riêng nếu thư mục chính có thay đổi chưa commit.
- **Đọc tài liệu API hiện hành** của service (trang chính thức hoặc context7), không dựa vào trí nhớ: endpoint, phiên bản API, giới hạn request, mã lỗi. Ghi đường dẫn tài liệu và ngày đọc vào file log. Nếu API khác với task card (endpoint đổi, phiên bản mới), làm theo tài liệu hiện hành và ghi rõ khác biệt trong PR.
- **Không thêm dependency** (không SDK của service). Dùng `fetch` có inject được để test, `node:crypto` nếu cần ký.

## Phạm vi một task service

Một PR gồm đủ các phần sau, theo cấu trúc file W3-00 đã tạo:

1. **Tool schema** `packages/tool-schemas/src/<id>.ts` và định nghĩa service `packages/tool-schemas/src/services/<id>.ts`: `scopeKey`, `scopeLabel`, `scopePattern`, `credentialFields`, `intentKeywords`, `fallbackIntentKeywords`, `gatherRules` nếu cần. Mô tả tool bằng tiếng Việt như các tool hiện có. Tham số chỉ tới tài nguyên có `x-resource`.
2. **Adapter** `packages/tool-adapters/src/<id>/`: kế thừa `BaseAdapter`, rate limiter dùng chung, `AbortSignal` cho mọi request.
3. **Transport** `apps/chat-api/src/services/transports/<id>.ts`: `createAdapter`, `checkConnection` (một lệnh đọc nhẹ, không ghi).
4. **Sandbox** `apps/chat-api/src/sandbox/fake-results/<id>.ts` và một kịch bản `SANDBOX_SCENARIO=<id>_slack`: service mới + Slack, có phụ thuộc dữ liệu (output step trước đi vào step sau qua `$ref`/`$template`).
5. **Browser E2E** trong `scripts/test-v3-browser.mjs` cho kịch bản trên.
6. **Chạy thật:** một mục mới trong `evaluations/live-execution/live-services.ts`; tên biến env (không có giá trị) thêm vào `.env.example`.

## Quy tắc an toàn bắt buộc

- **Allowlist kiểm trước khi gọi mạng.** Mọi tool nhận ID tài nguyên phải gọi `assertAllowedScope` trước `fetch`. Tool chỉ nhận ID con (ví dụ page Notion, issue Jira) phải xác định được tài nguyên cha và kiểm cha nằm trong allowlist **trước lệnh ghi**.
- **Tool "liệt kê" dựa trên allowlist**, không duyệt toàn bộ tài khoản: lấy tên từng tài nguyên trong allowlist rồi lọc theo `query`. Tool này có `listable: true` và `discovers`.
- **Phân loại lỗi** theo `StepError`: 401/403 → `AUTH_ERROR`; 404 → `NOT_FOUND`; 429 → `RATE_LIMIT` (tôn trọng `Retry-After`); 4xx dữ liệu sai → `VALIDATION`; 5xx/timeout/mất mạng của **lệnh ghi** → `UNKNOWN` (không tự chạy lại); của lệnh đọc → `SERVER_ERROR`/`NETWORK`.
- **Không lộ bí mật:** không đưa token, key, header `Authorization`, URL có chứa token, hay body response thô vào `message` của lỗi, log hay output của tool. Có test kiểm điều này.
- **Không có tool xóa**, không gửi email hay lời mời tới người ngoài, không đổi quyền chia sẻ.
- **Văn bản người dùng là dữ liệu thuần:** không bật chế độ định dạng/markup của service nếu không cần; giới hạn độ dài theo giới hạn của API.

## Quy tắc từ khóa định tuyến

- Bắt buộc có tên service (`id` và `name`) làm từ khóa. Thêm từ khóa khác chỉ khi nó **chỉ** gợi tới service này.
- Không dùng từ trong danh sách cấm của test bất biến (W3-00). Từ chung chung của lĩnh vực đặt vào `fallbackIntentKeywords` (chỉ dùng khi không service nào khác khớp).
- Test định tuyến bắt buộc, chạy với **tất cả** service đã đăng ký, gồm cả trường hợp service mới **chưa cấu hình**:
  - câu nêu tên service mới → chọn service mới;
  - các câu mẫu của service cũ (lấy từ `MissionControlLaunchpad.tsx` và 5 câu bất kỳ trong golden set 50 câu) → **không** chọn service mới và **không** bị từ chối khi service mới chưa cấu hình;
  - các ca dễ nhầm ghi trong task card của service.

## Tiêu chí nghiệm thu chung

- [ ] Test schema: mọi tool có `inputSchema`/`outputSchema` hợp lệ; tool ghi có `riskLevel`.
- [ ] Test adapter với `fetch` giả cho từng tool: đúng URL, method, header, query, body; output đúng định dạng.
- [ ] Test allowlist: tài nguyên ngoài danh sách bị từ chối với số lần gọi `fetch` = 0; tài nguyên con có cha ngoài danh sách bị từ chối trước lệnh ghi.
- [ ] Test phân loại lỗi từng mã ở trên; timeout của lệnh ghi → `UNKNOWN` bằng `AbortSignal` thật.
- [ ] Test không lộ bí mật trong lỗi.
- [ ] Test `normalizeAllowedScope` với `scopePattern` của service (hợp lệ, sai dạng, rỗng).
- [ ] Test API: lưu credentials, `GET /api/services` trả đúng `credentialFields`/`scopeLabel`, không bao giờ trả lại giá trị bí mật.
- [ ] Test planner: tool của service chỉ có trong catalog khi service đã cấu hình; grounding từ chối ID tài nguyên không có trong kết quả search.
- [ ] Test định tuyến như mục trên.
- [ ] Browser E2E kịch bản `<id>_slack`: duyệt plan → mọi step `succeeded`, giá trị từ step trước có trong step sau (kiểm `output_json` trong PostgreSQL).
- [ ] Toàn bộ kịch bản browser cũ vẫn đạt.
- [ ] Test mới fail trước khi sửa; `npm run check` exit 0; `npm run test:browser:v3` đạt hết.
- [ ] (Không bắt buộc, chỉ khi người dùng đã chuẩn bị tài khoản theo W3-07) một lần chạy thật **chỉ lệnh đọc** (tool liệt kê). Không chạy lệnh ghi thật trong task này; lệnh ghi thật thuộc W3-07.

## Sau khi merge

Không đo lại golden set trong task service; việc đo gom vào W3-06 sau khi đủ năm service để chỉ đo một lần trên catalog cuối cùng.
