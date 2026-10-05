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

- **Thi công và review mã đạt tại ngày 05/10/2026; chờ PR/CI đúng head và review phần bàn giao.** Nhánh `vinhdat/feat-ui-api-01`, base `0d279a9d0d8a4c3d9a4b3e57ad4f1c12c740d7df`, head mã đã kiểm thử `43616da50c8717acb22136aa46e62c5e51dadcc3`. Ba commit mã: schema/planner `b239ebb`, backend `2716783`, transport `43616da`.
- **Hành vi:** router đưa danh sách dịch vụ thật vào `unavailableServices`; validator bỏ trường này nếu model tự sinh. Metadata lịch sử và payload SSE có `reason`, `suggestion`, danh sách tuỳ chọn cùng correlation; nội dung văn bản cũ giữ nguyên. `PUT /api/services/:service/scope` nhận `{ allowedScope }`, trả 200 `{ success: true, message }`; admin đổi scope đã chuẩn hoá mà giữ toàn bộ khoá/thuộc tính khác. Member 403, chưa có credentials 409, scope rỗng/sai 400; lưu thành công xoá kết quả kiểm tra cũ, tăng generation và gọi `onCredentialsChanged`. `apiClient.saveServiceScope` dùng transport xác thực hiện có, nhận cả array và scope object.
- **File mã/test đã sửa:** `packages/tool-schemas/src/types.ts`; `packages/planner/src/{planner,validator}.ts`, `packages/planner/tests/structured-refusal.test.ts`; `apps/chat-api/src/db/repositories/credential-repo.ts`, `apps/chat-api/src/routes/services-routes.ts`, `apps/chat-api/src/services/chat-service.ts`, `apps/chat-api/tests/services/structured-refusal.test.ts`, `apps/chat-api/tests/integration/service-scope-save.test.ts`; `apps/chat-web/src/services/api-client.ts`, `apps/chat-web/tests/services/api-client.test.ts`. Bàn giao trong card này và [nhật ký UI-API-01](../log/2026-10-05-codex-UI-API-01.md); không đổi `CURRENT-STATE.md`, `ROADMAP.md` hoặc giao diện FE-06/FE-07.
- **RED/GREEN quan sát trước/sau sửa, RED exit 1 / GREEN exit 0:** planner focused `node node_modules/vitest/vitest.mjs run packages/planner/tests/structured-refusal.test.ts`: 2 fail/4 pass → 6 pass, thêm ca model giả danh dịch vụ 2 fail/6 pass → 8 pass; schema+planner cuối 243/243. Backend `npm test -w @wap/chat-api -- tests/services/structured-refusal.test.ts tests/integration/service-scope-save.test.ts`: 17 fail/1 pass → 18/18. Transport `npm test --workspace=@wap/chat-web -- tests/services/api-client.test.ts`: 7 fail/11 pass → 18/18; toàn web 321/321.
- **Bằng chứng PostgreSQL thật:** DB sandbox riêng ở loopback 55533, không dùng DB dev 15433. Transaction đổi scope dùng đúng advisory lock của thao tác thay khoá; test giữ transaction thay credentials chưa commit, quan sát một waiter thật trong `pg_stat_activity`, rồi commit và giải mã xác nhận khoá mới/thuộc tính phụ được giữ cùng scope mới. Test kiểm 403/409/400, trạng thái `unchecked`, connection check về muộn không phục hồi trạng thái cũ, và bắt console log/info/warn/error/debug trên các nhánh thành công/lỗi của route mới để kiểm không lộ khoá fixtures.
- **Gate cuối trên đúng head mã `43616da`:** `npm run check` exit 0: **1.278 v3 = 47 schema + 340 adapters + 196 planner + 25 executor + 349 API + 321 web**, **165/165 offline eval**, typecheck/build/quét credential sentinel đạt, launcher 1/1 và guards 8/8. `npm run test:browser:v3` exit 0: **32/32** qua **11 nhóm**, số ca `16+2+5+1+2+1+1+1+1+1+1`. Reviewer độc lập chạy lại hai gate trên head này, **0 finding**; `git diff --check 0d279a9..43616da` exit 0. Lần check root trước đó lỗi khi transport còn ở RED không được tính là bằng chứng đạt; kết quả trên là lần chạy mới sau khi đóng băng mã/test.
- **Giới hạn:** sandbox/fixtures và OIDC giả; model live, golden với model thật và provider live **NOT_RUN**, chưa chứng nhận production readiness. PR/CI remote và review delta tài liệu còn chờ. Commit DB xảy ra trước callback giống route credentials hiện có; callback lỗi không bảo đảm rollback dữ liệu đã lưu. Không bổ sung bảo đảm hủy thao tác đang chạy. Output đầy đủ/bằng chứng scratch giữ riêng, không đưa lên PR.
