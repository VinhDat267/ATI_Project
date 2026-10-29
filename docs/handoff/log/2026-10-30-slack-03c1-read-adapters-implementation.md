# 30/10/2026 · Hoàn Thành Thi Công Bounded Read Adapters SLACK-03C1 (8 Phương Thức Cốt Lõi)

**Ngày lập:** 30/10/2026 (Asia/Saigon)
**Tác giả:** Antigravity (Gemini 3.8 Flash High) · Integration Implementation Owner
**Ủy quyền:** Coordinator điều phối và giao việc thi công trọn gói phân đoạn SLACK-03C1 (bounded read adapters cho 8 phương thức đọc Slack cá nhân).
**Nhánh làm việc:** `feat/slack-03c1-read-adapters`
**Base commit:** `f67c0b16` (`integration/slack-personal-20261029`).
**PR Đích:** Draft PR to `integration/slack-personal-20261029`.
**Phạm vi sở hữu:** Chỉ sở hữu `packages/tool-schemas/`, `packages/tool-adapters/`, task card `SLACK-03C1-core-read-adapters.md`, kế hoạch `2026-10-29-slack-03c1-core-read-adapters.md`, và **đúng 1 file nhật ký bàn giao mới này**. Tuyệt đối không đụng chạm `apps/`, `db/`, `packages/planner/`, `packages/executor/`, `scripts/`, lockfiles hay `CURRENT-STATE.md`/`ROADMAP.md`.

---

## 1. Thông Qua Cổng Giao Ước Hooks Với Backend (Interface Gate Acceptance)

Trước khi tiến hành thi công adapter, giao ước hooks đã được Backend active 03B1 owner (`ctx_29765fc6b1b7`) và Coordinator chấp thuận chính thức:
- **Thông điệp Backend:** `msg_09bc561a430d` (xác nhận chấp thuận `SlackReadPurpose = Exclude<SlackPolicyPurpose, 'storage'>`, `getAccessToken(binding: SlackBinding): Promise<string>`, và `authorizeRead(input: { binding, purpose, requestedRetentionDays: 0, expectedPolicyReference? })`).
- **Thông điệp Coordinator:** `msg_f333d274f71e` và `msg_2d843e1898ac`.
- **Hợp đồng kỹ thuật chung ghim tại:** `docs/handoff/decisions/2026-10-29-slack-source-ingress-contracts.md` (commit `e9088d5e`).
- **Trách nhiệm Backend Wrapper (Task 03B4 riêng biệt):** Wrapper trong `apps/chat-api` chuyển đổi `SlackTokenManager.getAccessToken(userId, id, identityVersion)` và `SlackPolicyService.resolveSlackModelPolicy` với đối soát đầy đủ 5 trường binding, kiểm tra active user/connection và toàn bộ pending lifecycle/source barriers. Adapter giữ token trong private memory, không lộ ra ngoài DTO.
- **Quan sát Provenance cho 03B1:** DTO kết quả đọc mang `acquisitionPolicyReference` (với retention 0) để 03B1 đối chiếu `sameSlackPolicyEpoch` trước khi lưu vào `SlackSourceStore`.

---

## 2. Chi Tiết Thi Công Mã Nguồn (Implementation Details)

### 2.1. Canonical Declared Registry Trong `packages/tool-schemas`
- **Tệp chỉnh sửa:** `packages/tool-schemas/src/myslack-tools.ts`.
- Mở rộng canonical declared registry cho đúng 8 read methods cốt lõi:
  1. `conversations.list` (`MYSLACK_CONVERSATIONS_LIST_TOOL`) - Tái sử dụng metadata chuẩn hiện có.
  2. `conversations.info` (`MYSLACK_CONVERSATIONS_INFO_TOOL`) - Bổ sung mới (`channels:read, groups:read, im:read, mpim:read`).
  3. `conversations.history` (`MYSLACK_CONVERSATIONS_HISTORY_TOOL`) - Tái sử dụng metadata chuẩn hiện có.
  4. `conversations.replies` (`MYSLACK_CONVERSATIONS_REPLIES_TOOL`) - Bổ sung mới (`channels:history, groups:history, im:history, mpim:history`).
  5. `conversations.members` (`MYSLACK_CONVERSATIONS_MEMBERS_TOOL`) - Bổ sung mới (`channels:read, groups:read, im:read, mpim:read`).
  6. `users.list` (`MYSLACK_USERS_LIST_TOOL`) - Bổ sung mới (`users:read`, `listable: true`).
  7. `users.info` (`MYSLACK_USERS_INFO_TOOL`) - Tái sử dụng metadata chuẩn hiện có.
  8. `chat.getPermalink` (`MYSLACK_CHAT_GET_PERMALINK_TOOL`) - Bổ sung mới (`userScopes: null`, `hasUnknownScopes: true`).
- Giữ nguyên `MYSLACK_CHAT_POST_MESSAGE_TOOL` (sample write metadata) nhưng cấm dispatch write trong adapter.
- Export `MYSLACK_CORE_READ_TOOLS` (8 methods) và `MYSLACK_DECLARED_TOOLS` (9 methods).
- Khởi tạo `CANONICAL_SLACK_TOOL_MAP` bằng frozen deep-clone (`deepFreeze(structuredClone(t))`) để triệt tiêu hoàn toàn rủi ro caller làm suy yếu hoặc giả mạo public definition schemas (`CANONICAL_SLACK_TOOL_MAP` không bị ảnh hưởng khi đối tượng export bên ngoài bị sửa đổi).
- Bổ sung 8 test cases trong `packages/tool-schemas/tests/myslack-tools.test.ts` kiểm tra chặt chẽ metadata, args validation và khả năng kháng giả mạo (tampering resistance).

### 2.2. Injected Hooks & Two-Phase F1 Adapter Trong `packages/tool-adapters`
- **Tệp tạo mới:** `packages/tool-adapters/src/slack/personal-slack-types.ts`:
  - Định nghĩa hooks: `SlackReadPolicyHook`, `SlackTokenProviderHook`, `PersonalSlackReadAdapterConfig`.
  - Định nghĩa DTO quan sát: `SlackObservationProvenance`, `SlackResourceIdentity`, và các typed interfaces cho 8 phương thức.
- **Tệp tạo mới:** `packages/tool-adapters/src/slack/personal-slack-read-adapter.ts`:
  - Kế thừa `BaseAdapter`, `service = 'myslack'`.
  - **Từ chối Ghi (Reject Write):** Chặn đứng mọi lệnh gọi write (`myslack.chat_postMessage`) trước transport (`VALIDATION`, HTTP 400).
  - **Fixed Switch Dispatcher:** Chỉ dispatch đúng 8 methods, không dùng dynamic reflection hay generic `call(method, args)`.
  - **Kiểm thực F1 Hai Pha (Two-Phase Policy Enforcement):**
    - *Pha 1 (Pre-fetch):* Gọi `policy.authorizeRead({ binding, purpose, requestedRetentionDays: 0 })`. Xác thực cấu trúc đủ 8 trường chuẩn tắc của `SlackPolicyReference`. Bắt buộc khớp chính xác 5 trường binding, purpose và retention 0. Lưu giữ `prefetchPolicyRef`.
    - *Re-auth trước mỗi lần xuất request / retry:* Kiểm tra lại với `expectedPolicyReference: prefetchPolicyRef` sau khi await token và trước mỗi outbound HTTP attempt.
    - *Pha 2 (Post-fetch Re-Authorization):* Sau khi nhận response và parse body từ Slack, gọi lại `authorizeRead` đối chiếu với `prefetchPolicyRef`. Nếu consent bị thu hồi, identity version bị bump, provider đổi, hoặc regrant với revision mới -> lập tức giải phóng/xóa bộ nhớ (`parsed = null`), ném `AUTH_ERROR`, không giải phóng plaintext ra ngoài.
  - **Xử lý Rate Limit 429 & Retry An Toàn:** Đọc `Retry-After`, retry tối đa 2 lần với backoff có thể hủy qua `AbortSignal`. Mỗi lần retry bắt buộc phải re-authorize Pha 1 F1. Không bao giờ retry lỗi xác thực (AUTH, scope, ACL).
  - **Giới Hạn Bounded 2MB:** Kiểm tra `Content-Length` và stream reading chunk-by-chunk. Nếu body vượt quá 2MB -> hủy stream và ném `SERVER_ERROR` (502).
  - **Bảo Vệ URL & Redirect:** Chỉ chấp nhận native HTTPS (`https://slack.com/api` hoặc subdomain `*.slack.com`) hoặc explicit loopback (`http://127.0.0.1:<port>`); cấu hình `redirect: 'manual'`, từ chối ngay lập tức mã 3xx.
  - **Bảo Toàn Decimal String:** `ts`, `thread_ts`, và `edited.ts` giữ nguyên vẹn chuỗi số thập phân, không parse sang float để chống sai số IEEE 754.
  - **Làm Sạch Profile Người Dùng:** Loại bỏ hoàn toàn `profile`, `email`, `avatar_hash`, `image_*`, chỉ giữ metadata công khai.
  - **Kiểm Thực Deep Link:** `chat.getPermalink` bắt buộc khớp regex `^https:\/\/[a-z0-9_-]+\.slack\.com\/archives\/[A-Z0-9_]+\/p[0-9]+$`.
  - **Hợp Đồng `conversations.replies`:** Tin nhắn hợp lệ có 0 replies trả về `[root_message]` thành công theo đúng Slack API contract.
  - **Provenance Từng Thực Thể:** Mỗi observation (channel, message, user, member, permalink) gắn kèm `provenance` với danh tính tài nguyên, ISO timestamp, `acquisitionPolicyReference`, native revision (nếu Slack trả về), và digest SHA-256 của clean JSON payload.
  - **Làm Sạch Lỗi (Error Sanitization):** Xóa sạch mọi token bí mật (`xoxp-...`, `Bearer ...`) khỏi message, details và cause của `StepError` trước khi ném ra ngoài.
- **Tệp chỉnh sửa:** `packages/tool-adapters/src/slack/index.ts` và `packages/tool-adapters/src/index.ts` để export `PersonalSlackReadAdapter` và hooks interfaces.

### 2.3. HTTP Mock Server & Integration Test Suite
- **Tệp tạo mới:** `packages/tool-adapters/tests/helpers/personal-slack-mock-server.ts`:
  - Mock server cục bộ (`http://127.0.0.1:<port>`) độc lập thuộc `@wap/tool-adapters` (không sửa `scripts/fake-slack-personal.mjs`).
  - Mô phỏng đa actor, đa workspace (`T_WORKSPACE_A`, `T_WORKSPACE_B`, `U_ACTOR_A`, `U_ACTOR_B`, `U_COLLEAGUE`), colliding channel IDs, private channel ACL, delay injection, 429 rate limit injection, 2MB oversize body, và 302 redirect.
- **Tệp tạo mới:** `packages/tool-adapters/tests/slack/personal-slack-read.test.ts`:
  - 34 kịch bản kiểm thử hành vi toàn diện theo Section 5 Task Card và Boundary Review Regressions.

### 2.4. Khắc Phục Toàn Diện 10 Điểm Ranh Giới Từ Coordinator Boundary Review
Sau khi Coordinator chạy bộ rà soát ranh giới độc lập `.superpowers/review-read/review.mts`, 10 điểm đã được gia cố hoàn hảo:
1. **Kiểm tra Boolean Tuyệt Đối:** `decision.allowed === true` và `parsed.ok === true` (chặn đứng mọi giá trị truthy non-boolean như `"yes"`).
2. **Triệt Tiêu Rò Rỉ Plaintext Khi Caller Hủy (Abort):** Nếu `signal.aborted` xảy ra trong hoặc sau await re-auth post-fetch, lập tức đặt `parsed = null` và ném `StepError('NETWORK')`.
3. **Làm Sạch Bí Mật Hook Không Phụ Thuộc Token Regex:** Bọc try/catch quanh `tokens.getAccessToken` và `policy.authorizeRead`; ném generic `StepError('AUTH_ERROR')`, không phản chiếu chuỗi lỗi hoặc nguyên nhân chứa token tùy ý.
4. **Giới Hạn Bounded Budget:** Cắt mảng quan sát trả về (`channels`, `messages`, `members`) về `Math.min(limit, length)` nếu provider trả về vượt quá `limit`.
5. **Cổng Trạng Thái HTTP 2xx:** Kiểm tra `response.status < 200 || response.status >= 300` trước khi đọc `parsed.ok`, chặn đứng việc HTTP 500 trở thành thành công qua cờ JSON `ok: true`.
6. **Kiểm Soát apiBaseUrl Chặt Chẽ:** Chỉ chấp nhận duy nhất native HTTPS `https://slack.com/api` (hoặc trailing slash) hoặc loopback `http://127.0.0.1:<port>` / `http://localhost:<port>`; từ chối tuyệt đối userinfo, query params, hash, hoặc domain khác như `workspace.slack.com/unrelated/path`.
7. **Bảo Vệ Policy Reference Khỏi Đột Biến:** Truyền bản sao `structuredClone` đóng băng `Object.freeze` vào hook; so sánh kết quả trả về với bản sao bất biến nội bộ để phát hiện hook cố tình nhảy epoch.
8. **Hủy Luồng & Giải Phóng Socket:** Gọi `reader.cancel()` khi stream vượt 2MB; hủy/xả body response khi gặp 429 hoặc redirect; thiết lập `AbortSignal` timeout bao trùm toàn bộ lifecycle từ trước khi gọi hook.
9. **Bắt Buộc Định Danh Tài Nguyên Hợp Lệ:** Kiểm tra bắt buộc trường `id` của channel/user và `ts` của message; không chuyển đổi `undefined` thành chuỗi `"undefined"`.
10. **Đối Soát Danh Tính Người Dùng/Kênh Khớp Với Yêu Cầu:** Kiểm tra `users.info` trả về đúng user requested (`user.id === params.user`), không chấp nhận ID lệch.

---

## 3. Bằng Chứng Kiểm Thử Toàn Diện (Evidence Gates)

Tất cả các lệnh kiểm thử thực tế đã chạy trên môi trường sandbox:

| Hạng mục kiểm tra | Lệnh thực hiện | Kết quả thực tế | Trạng thái |
|---|---|---|---|
| Whitespace & Cú Pháp | `git diff --check` | Hoàn toàn sạch, exit code 0 | **PASS** |
| Typecheck Toàn Hệ Thống | `npm run typecheck:v3` | 0 lỗi TypeScript ở cả `apps/chat-api` và `apps/chat-web`, exit code 0 | **PASS** |
| Coordinator Boundary Review | `npx tsx .superpowers/review-read/review.mts` | **11/11 tests PASS (Exit code 0)** | **PASS** |
| Package Tool-Schemas Tests | `npx vitest run packages/tool-schemas` | 15 test files, **274 tests PASS** (30 tests myslack-tools) | **PASS** |
| Package Tool-Adapters Tests | `npx vitest run packages/tool-adapters` | 19 test files, **477 tests PASS** (34 tests personal-slack-read) | **PASS** |
| Web Build & Security Check | `npm run build:v3 && node scripts/test-v3-web-build-security.mjs` | Build thành công, exclusion sentinels đạt | **PASS** |
| Full Workspace Suite | `npm run test:v3` | 251 test files, **2,818 tests PASS** (schemas 274, adapters 477, planner 381, executor 42, API 753, Web 901) | **PASS** |
| Evaluation Tests | `npm run test:eval:v3` | 25 test files, **406 tests PASS** | **PASS** |
| Script Unit & Launcher Tests | `node --test scripts/start-v3.test.mjs ...` | **67 tests PASS** (1 launcher + 66 Node script tests) | **PASS** |
| **Tổng Cộng Toàn Bộ Kiểm Thử** | Tổng hợp các bộ test | **3,301 tests PASS (Exit code 0)** | **PASS** |

---

## 4. Tuyên Bố Ranh Giới & Các Hạng Mục Chưa Nghiệm Thu

1. **Live Native Slack API:** Được ghi nhận rõ ràng là **NOT_RUN** (chưa cấp quyền thực hiện cuộc gọi tới Slack API thật).
2. **Joint DB / TokenManager Concurrency Trên PostgreSQL:** Được ghi nhận là **NOT_RUN** trong card này (phụ thuộc vào task Backend wrapper 03B4 kết nối `TokenManager.getAccessToken` và `PolicyService.resolveSlackModelPolicy` với database pool thật).
3. **Write Dispatch & Ingress/Cascade:** Giữ nguyên phạm vi READ ONLY (retention 0, transient). Các thao tác write (`chat.postMessage`), ingress events và cascade F3 vẫn tiếp tục mở ở các tasks SLACK-03C2, SLACK-04.
4. **Trạng Thái Method Inventory:** Giữ nguyên 343 snapshot rows (97 excluded / 246 probe_required), không tự ý thăng cấp bất kỳ row nào thành native support.
5. **Cờ Tính Năng:** `MYSLACK_ENABLED` vẫn giữ nguyên trạng thái tắt, không đăng ký vào `ALL_TOOLS` hay `SERVICE_REGISTRY`.

---

## 5. Bàn Giao & Bước Tiếp Theo

1. Commit các tệp thuộc sở hữu:
   - `packages/tool-schemas/src/myslack-tools.ts`
   - `packages/tool-schemas/tests/myslack-tools.test.ts`
   - `packages/tool-adapters/src/slack/personal-slack-types.ts`
   - `packages/tool-adapters/src/slack/personal-slack-read-adapter.ts`
   - `packages/tool-adapters/src/slack/index.ts`
   - `packages/tool-adapters/tests/helpers/personal-slack-mock-server.ts`
   - `packages/tool-adapters/tests/slack/personal-slack-read.test.ts`
   - `docs/handoff/tasks/SLACK-03C1-core-read-adapters.md`
   - `docs/superpowers/plans/2026-10-29-slack-03c1-core-read-adapters.md`
   - `docs/handoff/log/2026-10-30-slack-03c1-read-adapters-implementation.md` (file này).
2. Push lên nhánh `feat/slack-03c1-read-adapters` và cập nhật Draft PR tới `integration/slack-personal-20261029`.
3. Kiểm tra hòm thư điều phối `orca orchestration check`.
4. Gửi báo cáo `worker_done` tới Coordinator qua `orca orchestration send --type worker_done`.

---

## 6. Bổ Sung Vòng r2 — Khắc Phục Review Ranh Giới (30/10/2026)

Review vòng 2 tại head `2a761553` chạy `.superpowers/review-read/review-r2.mts` đạt **0/8 PASS** (raw log `.superpowers/review-read/red-r2.log`). Đã khắc phục trong adapter, giữ nguyên 19 assertion vòng 1:

1. **Abort/deadline:** `awaitWithAbort` bọc hook policy, hook token, fetch, đọc stream và backoff 429; listener được gỡ khi settle; không phát transport/nội dung sau khi hủy; validate `requestTimeoutMs` trong constructor.
2. **Sanitize lỗi:** reason code/message cố định cho provider, hook, network, parse, constructor, baseURL, cause, details; không echo token/cursor/URL thô.
3. **Ngân sách đầu ra:** default/wire limit từng list method ≤ 100; provider trả vượt -> `SERVER_ERROR` (không `.slice` im lặng); body 2MB, cursor/id/text có trần; hủy body khi oversize/429/redirect; backoff hủy được, tối đa 2 retry cùng epoch policy.
4. **Provider shape chặt:** kiểm tra kiểu đủ 8 method, fail-closed; `ts`/`edited.ts` exact decimal; cursor chỉ string; Boolean không truthy; identity/permalink khớp request; DTO whitelist.
5. **Binding/ref bất biến:** frozen clone 5-field binding + canonical 8-field reference qua mọi callback/retry; provenance đúng revision/ref; retention 0.

**Bảng bằng chứng hiện hành (thay thế số liệu §3):**

| Hạng Mục | Lệnh | Kết Quả | Trạng Thái |
|---|---|---|---|
| Root review vòng 1 | `node --import tsx .superpowers/review-read/review.mts` | **11/11 PASS (exit 0)** | **PASS** |
| Root review vòng 2 | `node --import tsx .superpowers/review-read/review-r2.mts` | **8/8 PASS (exit 0)** | **PASS** |
| Boundary suite mới | `npx vitest run packages/tool-adapters/tests/slack/personal-slack-boundaries.test.ts` | **42/42 PASS** (RED 25 failed/17 passed) | **PASS** |
| Package Tool-Schemas | `npx vitest run packages/tool-schemas` | 15 files, **274 tests PASS** | **PASS** |
| Package Tool-Adapters | `npx vitest run packages/tool-adapters` | 20 files, **519 tests PASS** (76 test Slack, gồm 42 boundary) | **PASS** |
| Typecheck v3 | `npm run typecheck:v3` | **exit 0** | **PASS** |
| Full check | `npm run check` (DATABASE_URL sandbox `127.0.0.1:55533/ati_v3`) | `test:v3` 252 files / **2,870**; eval **406**; scripts **67**; tổng **3,343 tests PASS**, exit 0 | **PASS** |
| Diff whitespace | `git diff --check` | **exit 0** | **PASS** |

**Ranh giới chưa nghiệm thu:** Live Native Slack API **NOT_RUN**; Joint DB/Concurrency PostgreSQL thật với `TokenManager`/`PolicyService` **NOT_RUN** (chờ 03B4 và F3 03B2/03B3). Các test trên chỉ chứng minh ranh giới adapter với HTTP fixture, không phải nghiệm thu native/PG.

**Tệp sở hữu của vòng r2:** `packages/tool-adapters/src/slack/personal-slack-read-adapter.ts`, `packages/tool-adapters/tests/helpers/personal-slack-mock-server.ts`, `packages/tool-adapters/tests/slack/personal-slack-read.test.ts`, `packages/tool-adapters/tests/slack/personal-slack-boundaries.test.ts` (mới), cùng task card, plan và log này. Số liệu 467/477 adapters và 2,818/3,301 tổng ở §3 là của vòng trước, nay được thay bằng bảng trên.
