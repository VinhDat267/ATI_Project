# W3-08 · Giới hạn kích thước kết quả đọc và vá các khoảng trống từ audit W3

**Trạng thái:** đã thi công, chờ review · **Nhánh gợi ý:** `fix/w3-08-bounded-read-results` · **Phụ thuộc:** không · **Nên xong trước:** W3-07 (chạy thật) và các phép đo tuần 4

Nguồn: audit độc lập W3 của Claude Code ngày 03/10/2026 trên `main` `247af5f` (xem `log/2026-10-03-claude-code-W3-audit.md`).

## 1. Kết quả đọc không có giới hạn kích thước (trung bình)

**Hiện trạng:**
- `formatSearchResults` (`packages/planner/src/search.ts:136`) đưa nguyên kết quả của tool đọc vào prompt của model.
- Trước W3, tool đọc chỉ trả tên board, list, card. Giờ có tool trả nội dung tự do:
  - `sheets.read_range` chỉ cắt số dòng, không giới hạn số cột và độ dài mỗi ô;
  - `notion.query_database` trả mọi thuộc tính dưới dạng văn bản, không giới hạn độ dài.

**Bằng chứng:** probe dùng chính `SheetsAdapter` và `formatSearchResults`, chỉ giả response của Google. Một lệnh `read_range` hợp lệ (`Tasks!A1:KN10`, `limit: 10`), 10 dòng × 300 cột, mỗi ô 5.000 ký tự, tạo prompt search khoảng **15 triệu ký tự**. Kết quả này còn được lưu vào `output_json` và có thể bị đưa qua `$template` sang bước sau.

**Yêu cầu:**
- `sheets.read_range`: tối đa 26 cột và 500 ký tự mỗi ô. Phần bị cắt có dấu hiệu rõ ràng (ví dụ `…[đã cắt]`), output có cờ `truncated: true`.
- `notion.query_database`: mỗi thuộc tính tối đa 500 ký tự, cùng quy ước cắt.
- `calendar.list_events`: `title` tối đa 200 ký tự.
- **Giới hạn chung trong planner:** mỗi kết quả search khi đưa vào prompt tối đa 20.000 ký tự JSON, quá thì cắt và ghi rõ đã cắt. Đây là lớp bảo vệ cho mọi tool hiện có và về sau.
- Ghi các giới hạn vào mô tả tool (tiếng Việt) để model biết kết quả có thể bị cắt.

## 2. Lỗi 403 của Calendar: thiếu test (thấp)

**Hiện trạng:** mutation "coi mọi 403 là rate limit" (`calendar-adapter.ts:96`) không bị test nào bắt. Khi đó lỗi quyền thật sẽ bị thử lại một lần và báo sai thành `RATE_LIMIT`.

**Yêu cầu:** thêm test cho 403 có `reason: 'forbidden'` (hoặc body không đọc được): kết quả phải là `AUTH_ERROR`, chỉ một request, không chờ. Giữ nguyên test của `rateLimitExceeded`/`userRateLimitExceeded`.

## 3. Phân loại lỗi khi lấy token Google (thấp)

**Hiện trạng:** `google/service-account.ts` trả `AUTH_ERROR` cho mọi lỗi:
- token endpoint trả 429/5xx;
- lỗi mạng;
- tín hiệu hủy trước khi gửi.

Lỗi tạm thời vì vậy bị báo thành lỗi credentials, người dùng dễ đi sửa key không cần thiết.

**Yêu cầu:** 401/400 `invalid_grant` → `AUTH_ERROR`; 429 → `RATE_LIMIT`; 5xx/mạng → `NETWORK`/`SERVER_ERROR`; hủy → `NETWORK`. Vẫn không đưa body, key hay assertion vào thông báo lỗi.

## 4. Lộ email service account trong lỗi rate limiter (thấp)

**Hiện trạng:** Sheets dùng key `'sheets:' + clientEmail` và ném lại nguyên `StepError` của `waitForTransportSlot`, nên thông báo có dạng `sheets:<email> rate limiter timed out`. Email này không phải bí mật, nhưng không cần hiện cho người dùng.

**Yêu cầu:** thay bằng thông báo chung như Calendar/Notion đang làm.

## Không làm trong task này

- Không đổi hành vi mặc định mở của `BaseAdapter.assertAllowedScope`. Hành vi này có test giữ cho adapter cũ (`tests/generic-scope.test.ts`), và mọi adapter mới đều tự từ chối khi allowlist rỗng.
- Không đổi prompt planner.

## Tiêu chí nghiệm thu

- [ ] Test mới fail trước khi sửa cho mục 1–4.
- [ ] Test mục 1:
  - output `read_range` với 10 × 300 ô dài có đúng 26 cột, mỗi ô ≤ 500 ký tự kể cả dấu cắt, có `truncated: true`;
  - `formatSearchResults` với kết quả 1 MB cho ra prompt ≤ 25.000 ký tự và có dấu đã cắt;
  - kết quả nhỏ không đổi gì.
- [ ] Mutation: gỡ giới hạn chung trong planner → test fail; gỡ giới hạn cột của Sheets → test fail.
- [ ] Bộ golden 50, 18 và 44 câu không cần chạy lại model, vì fixtures nằm dưới giới hạn; có test xác nhận không fixture nào bị cắt.
- [ ] `npm run check` exit 0; `npm run test:browser:v3` đạt hết.

## Kết quả (agent thi công điền)

- PR: nhánh `fix/w3-08-bounded-read-results` (số PR ghi trong mô tả PR).
- Commit: `fbab62b` (code + test).
- Test đã chạy và kết quả:
  - RED trước khi sửa: 14 test mới fail (10 trong `bounded-results.test.ts`, 4 trong `search-bounds.test.ts`); các test mới còn lại pass đúng như dự kiến: kết quả nhỏ không đổi; token 400/401/403 vẫn `AUTH_ERROR`; hai ca 403 JSON của Calendar, vốn là test bổ sung chỗ thiếu nên đã đúng với code cũ và được chứng minh bằng mutation.
  - GREEN: `npm run check` exit 0. v3 895 = 47 schema + 317 adapters + 172 planner + 25 executor + 173 API + 161 web; eval 165; typecheck; build; quét bản build PASS.
  - `test-v3-browser.mjs` 14/14 trên PostgreSQL tạm riêng (cổng 55533, xóa sau khi chạy).
  - Mutation (10, trên code đã commit): bỏ giới hạn chung của planner; bỏ giới hạn cột Sheets; bỏ cắt ô Sheets; `clipText` cắt đôi surrogate; bỏ cắt property Notion; bỏ cắt tiêu đề Calendar; mọi 403 Calendar là rate limit (M15 của audit); ném lại lỗi limiter có email; token 5xx thành `AUTH_ERROR`; token lỗi mạng thành `AUTH_ERROR`. Cả 10 đều bị test bắt.
- Điều chưa làm hoặc khác với task card:
  - Giới hạn chung của planner đo bằng chính chuỗi JSON đưa vào prompt (gồm thụt lề và escape). Mảng giữ nguyên các phần tử vừa ngân sách và ghi `truncated.omittedItems`; kết quả khác được thay bằng `resultPreview` có `truncated.originalChars`.
  - `truncated: true` chỉ xuất hiện khi có cắt, nên kết quả nhỏ giữ nguyên.
  - Ba test cũ đổi expectation theo hành vi mới: hủy trước khi lấy token → `NETWORK`; lỗi đổi token (mạng / body hỏng / thiếu trường) → `NETWORK` / `SERVER_ERROR`, riêng 401 vẫn `AUTH_ERROR`; relation Notion dài bị cắt ở 500 ký tự và dấu `…[đã cắt]` thay `[incomplete]`.
  - Mô tả tool `sheets.read_range`, `notion.query_database`, `calendar.list_events` thêm câu về giới hạn, nên prompt của các tool này thay đổi nhẹ. Fixtures golden không bị cắt (14 test mới); chưa chạy lại model thật.

### Sửa hai phát hiện review độc lập (03/10/2026)

- Nguồn: review W3-08 trong PR #44, trên main `b13ca2e`; người dùng yêu cầu sửa cả hai lỗi. Commit code/test `d1bd367`, nhánh `vinhdat/fix-w3-08-review-findings`.
- Planner tính ngân sách cả tool/args/error/result và metadata cắt. Nếu envelope tối thiểu vẫn quá 20.000 ký tự JSON, trả `outcomePreview` kèm cảnh báo rõ phần bị bỏ; prefix không cắt đôi surrogate. Kết quả nhỏ giữ nguyên từng byte, không sửa arguments dùng để thực thi. `SearchOutcome.result` nhận `unknown` để đúng cả kết quả object đã được formatter hỗ trợ.
- Token Google: AbortError/transport failure khi đọc body trả `NETWORK`; SyntaxError khi không bị hủy vẫn `SERVER_ERROR`. Giữ sanitization và không cache token từ response lỗi.
- TDD: bảy regression/control mới; RED **6 fail / 15 pass** (bốn envelope vượt cap, hai native body failures sai category); malformed JSON control pass từ trước. GREEN **21/21**. Native HTTP loopback dùng body đang stream, AbortController/socket thật; kiểm recovery bằng request thứ hai và không lộ body/key/cause.
- `npm run check` exit 0: **955 v3** = 47 schema + 320 adapters + 176 planner + 25 executor + 203 API + 184 web; **165 eval**; typecheck/build/credential scan/launcher1/local-env3 đạt. Strict NodeNext typecheck riêng hai file test exit 0.
- Probe review gốc chạy lại **5/5 đạt**. Probe AIPlanner → SlackAdapter → native HTTP: 2 lượt provider giả lập, 1 HTTP read; JSON **18.275/20.000** ký tự (trước sửa 30.290), có dấu cắt, planner trả clarification. Bộ đếm phụ của probe được cập nhật vì envelope bị cắt không còn trường `result`; không thay tiêu chí cap.
- Browser **20/20**, review độc lập **Đạt**; chi tiết và giới hạn xem [nhật ký bản sửa](../log/2026-10-03-codex-W3-08-review-fixes.md). CI đúng head cuối được xác minh ở PR. Model thật và service thật **NOT_RUN**; không thay template prompt hay gọi provider trả phí.
