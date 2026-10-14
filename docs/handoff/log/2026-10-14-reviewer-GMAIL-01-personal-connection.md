# 14/10/2026 · GMAIL-01 · Kết nối Gmail riêng của từng người (backend)

- Task: [GMAIL-01](../tasks/GMAIL-01-personal-connection.md), nhóm trưởng giao reviewer thi công ngày 14/10. Quy tắc chung: [GMAIL-common](../tasks/GMAIL-common.md).
- Nhánh: `feat/gmail-01-personal-connection`, base `ebc192d`. PR: [#140](https://github.com/VinhDat267/ATI_Project/pull/140).
- Cờ `GMAIL_ENABLED` mặc định `off`. Gmail không vào `ALL_TOOLS`, `TOOL_MAP` hay `SERVICE_REGISTRY`.

## Đã làm

| Phần | File chính |
|---|---|
| 10 tool schema, `GMAIL_SERVICE`, kiểu `observedFields`, `connection`, `PlanConnections` | `packages/tool-schemas/src/gmail.ts`, `registry/gmail.ts`, `types.ts` |
| `isWriteTool` biết tool Gmail khi cờ tắt | `packages/executor/src/runner.ts` |
| `GMAIL_ENABLED` và `GMAIL_OAUTH_*`; endpoint giả chỉ ngoài live | `apps/chat-api/src/config/env.ts`, `.env.example` |
| Migration 0009 | `db/v3/0009_gmail_personal_connections.sql` |
| Đọc kết nối riêng, đổi trạng thái, lưu/ngắt có khoá; state `connect_gmail` tách luồng | `credential-repo.ts`, `google-auth-repo.ts`, `gmail-connection-repo.ts` |
| Client OAuth (không theo redirect, có `AbortSignal`), quản lý token | `services/gmail/oauth-client.ts`, `token-manager.ts`; interface ở `packages/tool-adapters/src/gmail/token-provider.ts` |
| Route `start`/`callback`/`DELETE` | `routes/connections/gmail.ts`, `app.ts` |
| `GET /api/services` có `connection` và hàng Gmail của chính người gọi; ba route quản trị từ chối Gmail; `/api/health` | `routes/services-routes.ts`, `app.ts` |
| `actor` qua planner; factory theo người và kiểm `credentialId`; executor lấy chủ hội thoại từ DB | `packages/planner/src/planner.ts`, `adapter-factory.ts`, `execution-service.ts`, `execution-recovery.ts`, `runtime-policy.ts`, `registered-services.ts`, `server.ts` |
| Kế hoạch gắn kết nối trước khi băm; không có kết nối thì từ chối | `chat-service.ts`, `services/gmail/connection-reference.ts` |
| Máy chủ Google giả (authorize, token, revoke, profile) | `scripts/fake-google-gmail.mjs` + `.d.mts` |

`server.ts` gọi `getToolCatalogFor(..., { gmailEnabled: false })` và không truyền `createGmailAdapter`, đúng task card: Gmail chưa vào catalog của planner cho tới GMAIL-02.

## RED → GREEN

Mỗi nhóm test viết trước, chạy thấy fail đúng lý do, rồi mới cài đặt. Chạy trên PostgreSQL 16 tmpfs riêng ở `127.0.0.1:55533`, mỗi file test có schema riêng.

| Nhóm | RED | GREEN |
|---|---|---|
| Tool schema (`tool-schemas/tests/gmail.test.ts`, `registry-invariants`) | 15 fail / 29 pass | tool-schemas 63/63 |
| Executor `isWriteTool` | 5 fail / 11 pass | executor 36/36 |
| Cấu hình `GMAIL_ENABLED` | 11/11 fail | 31/31 (gồm các test cấu hình cũ) |
| Migration 0009 | thiếu file, 4 ca không chạy được | 27/27 (gồm test Google và migration cũ) |
| Repository | thiếu module | 68/68 (gồm các test Google cũ) |
| Quản lý token | thiếu module | 8/8 |
| Route kết nối | 15/15 fail | 15/15 |
| `GET /api/services`, route quản trị | 3 fail / 1 pass (ca giữ hành vi cũ) | 34/34 (gồm các test dịch vụ cũ) |
| `actor` trong planner | 2 fail / 1 pass | planner 240/240 |
| Hai người A/B, factory, executor, khôi phục | 8/8 fail | 8/8 |
| `createRuntimeAdapterFactory` chuyển context | 2/2 fail | 2/2 |
| `ChatService` gắn kết nối | 4 fail / 1 pass (ca lịch sử, kiểm bằng đột biến X1) | 5/5 |
| Tự rà toàn nhánh: CORS của đường dẫn Gmail đổi khi cờ tắt | 1 fail | 15/15 |
| Tự rà toàn nhánh: `config` Gmail hỏng thành lỗi mạng (bước ghi sẽ `unknown`) | 1 fail | 9/9 |

Ca "lịch sử không kèm connections" đạt sẵn trước khi sửa vì lúc đó chưa có gì ghi `connections`; đột biến X1 dưới đây chứng minh test bắt được khi bỏ phần lọc.

## Đột biến (đặc tả mục 6.3, phần 1)

Script đổi từng chỗ trong mã, chạy file test liên quan, rồi khôi phục (`git status` sạch sau khi chạy). Tất cả bị bắt, mỗi lần exit 1.

| Đột biến | Kết quả | Test bắt |
|---|---|---|
| M1 bỏ kiểm người/phiên trong state | 2 fail | repo: chỉ chủ và phiên của state dùng được; route: state của người khác/phiên khác |
| M2 bỏ kiểm `mode` của state | 3 fail | repo: state `connect_gmail` không thấy ở luồng login/link, state `login` không vào luồng Gmail; route: hai luồng tách nhau |
| M3 Gmail rơi về khoá chung | 1 fail | repo: bản ghi `user_id` NULL không bao giờ được trả, kể cả khi tạm bỏ CHECK |
| M4 cache adapter theo tên dịch vụ | 1 fail | A/B: `clearPersonal` chỉ xoá một người |
| M5 bỏ so `credentialId` trước bước Gmail | 4 fail | A/B: kiểm kết nối đã xem trước; kết nối lại bằng tài khoản khác và bằng đúng địa chỉ cũ |
| M6 giữ `connections` model tự viết | 2 fail | ChatService: bỏ `connections` của model; lịch sử không kèm `connections` |
| M7 bỏ kiểm quyền `gmail.modify` | 1 fail | route: thiếu quyền thì không lưu và thu hồi |
| M8 bỏ `GMAIL_TOOLS` khỏi catalog `isWriteTool` | 5 fail | executor: `gmail.reply`… là tool ghi; `gmail.reply` hết giờ thành `unknown` |
| M9 Gmail bật khi cờ không đặt | 2 fail | cấu hình: mặc định tắt; cờ rỗng như không đặt |
| M9b gắn route khi cờ tắt | 1 fail | route: cờ tắt trả 404 và `/api/health` giữ nguyên |
| X1 lịch sử giữ `connections` | 1 fail | ChatService: lịch sử không kèm `connections` |
| X2 không dùng chung lượt làm mới | 2 fail | token: hai yêu cầu đồng thời một lượt làm mới; người gọi huỷ không huỷ lượt chung |
| X3 lưu kết nối từ callback muộn | 4 fail | repo/route: callback sau khi ngắt kết nối hoặc đăng xuất không lưu |

## Gate toàn repo

Worktree riêng, `npm ci`, PostgreSQL 16 tmpfs riêng ở 55533 (đã chạy `npm run db:migrate:v3`, gồm 0009), `RUNTIME_MODE=sandbox`, không có `.env`.

Số dưới đây chạy trên head cuối `3ed608d` (sau hai lần sửa khi tự rà nhánh):
- `npm run check`: **exit 0**. **1.796 v3** = 63 schema + 340 adapter + 240 planner + 36 executor + 438 API + 679 web; **173 eval** (gồm routing offline 116 câu, không đổi); typecheck, build, quét bản build `PASS`, launcher 1/1, env/OIDC 10/10.
- So với `main` `ebc192d` (1.699 v3): thêm 97 test (schema +16, planner +3, executor +11, API +67). Không sửa assertion nào của test cũ.
- `npm run test:browser:v3` (sau `npm run admin:provision:v3`): **exit 0**, **101 pass, 1 skip có chủ đích, 11 nhóm** (default 83). Lượt trước đó trên `d65bd36`, trước hai lần sửa, cũng 101 pass/1 skip, exit 0.

## Khác với task card

- Mô tả tool viết tiếng Việt như các tool hiện có; task card ghi tiếng Anh.
- `gmail.list_labels` giữ trường mặc định (`id`, `name`) trong bộ nhớ làm việc. Hai tool đọc thư (`search_threads`, `get_thread`) dùng `observedFields: ['id', 'participants']`. Tên nhãn là của chính người dùng, không do người gửi đặt, và model cần nó để biết id nhãn.
- `/api/health` chỉ có `gmailEnabled` khi cờ bật; cờ tắt thì phản hồi giữ nguyên như cũ (ba test cũ so khớp chính xác vẫn đạt không sửa). Đã sửa GMAIL-common mục 4.2.
- Hàng Gmail trong `GET /api/services` và chặn ba route quản trị chỉ có khi Gmail dùng được (cờ bật, đủ OAuth, có PostgreSQL), không chỉ khi cờ bật. Đã sửa GMAIL-common mục 4.2.
- Callback sau khi phiên đã đăng xuất bị middleware xác thực trả `401 INVALID_SESSION`, không phải `GMAIL_STATE_INVALID`. Không bản ghi nào được lưu trong cả hai trường hợp.
- Máy chủ Google giả không có test riêng; nó được dùng trong test token và test route.
- "Câu Gmail của B bị từ chối" ở tầng router cần `GMAIL_SERVICE` trong danh sách dịch vụ của planner, thuộc GMAIL-02. GMAIL-01 kiểm phần từ chối ở `ChatService` khi không có kết nối.

## Lưu ý cho GMAIL-02

- Executor đổi `NETWORK`/`SERVER_ERROR` của tool ghi thành `unknown`. Token manager ném đúng các loại này khi làm mới lỗi (đặc tả mục 3.5). Nếu adapter để lỗi đó lộ ra từ `execute`, bước ghi thành "chưa rõ kết quả" dù Gmail chưa nhận gì. Nhóm trưởng chốt ngày 14/10: lỗi trước khi request đi mang `details.requestSent === false`, executor coi là `failed`; GMAIL-02 làm cả hai phía. Đã ghi vào đặc tả mục 11, GMAIL-common mục 4.4 và task card GMAIL-02.
- Ở sandbox, `createRuntimeAdapterFactory` chuyển context nhưng `createSandboxAdapter` chưa biết Gmail.

## Chưa làm

- Không gọi Google thật, không dùng model.
- Chưa có review độc lập.
