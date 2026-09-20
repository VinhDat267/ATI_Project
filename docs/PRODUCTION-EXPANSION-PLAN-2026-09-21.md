# Kế hoạch mở rộng ATI từ B/local sang production pilot

**Trạng thái:** PROPOSED — chưa thay thế Baseline B/local và chưa phải production approval.

## 1. Điểm xuất phát

### CONFIRMED

- Checkout hiện tại kết thúc ở `6779ffe`; worktree sạch.
- `npm run check:full` đã pass trên commit `6237334`: DSL 43, engine unit 341 (1 skipped), API unit 42, web unit 128; MCP integration 64, engine integration 102, API integration 38; WEB-03 đủ 6 browser/build gates.
- Manifest browser sạch là `docs/web-evidence/WEB-03/20260920181021-a3882fd7-6432-41fa-89bb-7b255b92032b/manifest.json`.
- PostgreSQL demo được migrate additive đến tổng 9 migrations, không reset volume.
- Google probe 6 calls đã pass. Đây là connectivity/protocol evidence, không phải quality evaluation; OpenAI live probe và formal live evaluation chưa chạy.
- Engine đã có preview/approval/reconciliation, durable PostgreSQL outbox và worker tuần tự. Session store vẫn là bộ nhớ tiến trình; filesystem mặc định tắt.

### OPEN / NOT_RUN

Provider quality/cost/latency, fresh sealed holdout, human rubric, independent AI safety review, representative-user acceptance, visual direction/Design System và production identity vẫn chưa được duyệt. Không được suy ra production readiness từ fixture/browser pass hoặc Google probe.

## 2. Kiến trúc đề xuất

**PROPOSED:** production pilot cho một tổ chức, vẫn giữ modular monolith, PostgreSQL outbox và một executor tuần tự. Chưa mở multi-tenant, microservices, worker pool, scheduler hay realtime cho tới khi pilot có tải và nhu cầu được đo.

```text
Browser -- HTTPS --> Ingress/API -- PostgreSQL + pgvector
                         |                 |
                         +------------ durable outbox
                                           |
                                      Worker duy nhất
                                      |          |
                              Provider adapter  Reviewed connector
```

- API và worker dùng chung codebase nhưng entrypoint riêng; deployment không chạy hai executor active.
- DB ở mạng riêng, backup/PITR và restore drill bắt buộc.
- Provider key chỉ ở backend; endpoint phải allowlist; filesystem không được coi đường dẫn Windows local là tài nguyên production.
- Giữ polling ban đầu; chỉ đổi SSE/WebSocket sau khi đo request rate và nhu cầu.
- PostgreSQL vẫn là queue authority; BullMQ/Redis chỉ mở bằng ADR mới có bằng chứng tải.

## 3. Các stage và cổng thoát

### P0 — Chốt scope, owner và evidence ledger

Chốt người dùng pilot, một workflow tạo giá trị, dữ liệu được lưu, operator, hosting, ngân sách và chính sách dữ liệu. Tách ledger thành implementation, technical tests, live provider, user acceptance và operational readiness; giữ nguyên lịch sử B/local. Ghi rõ ngoài phạm vi: editor, scheduler, auto-resume, parallel steps, SaaS multi-tenant.

**Exit:** scope và acceptance criteria có owner; các dòng status lịch sử được phân biệt rõ với evidence hiện hành.

### P1 — Provider và chất lượng AI

Thực hiện independent read-only safety review cho credential boundary, lease/currentness, durable accounting, freeze completeness và evaluator identity. Chọn một provider/profile; xác nhận model, price card và endpoint tại thời điểm chạy. Chốt rubric trước evaluation, tạo holdout mới chưa dùng để tune, rồi chạy theo thứ tự index → freeze → smoke → dev → fresh holdout sau authorization riêng. Báo riêng `all_tools`, `semantic`, `semantic_qe`, K=3/5/10; đo retrieval/provider/repair/replan/execution latency và toàn bộ cost.

**Exit:** report có provenance, rubric và holdout được duyệt; mọi safety invariant pass. Nếu quality fail thì chỉ tune trên dev và tạo freeze/holdout mới.

### P2 — Identity, authorization và dữ liệu

Thay demo principal bằng identity/session bền vững có revocation (OIDC hoặc auth tự quản phải có ADR). Truyền principal từ request vào use case; kiểm owner cho runs, approvals, events, catalog/index, accounting và reconciliation. Thêm role tối thiểu user/operator, secret rotation, redaction, body/login/provider limits và CSRF/SameSite/origin checks nếu dùng cookie.

**Test gate:** hai user không thể đọc/duyệt/chạy/reconcile tài nguyên của nhau; revoke/restart, cursor owner, membership đổi trước dispatch và secret-log canary đều pass.

### P3 — Deployment, worker lifecycle và migration

Tạo image reproducible, non-root, lockfile/artifact pin và môi trường dev/staging/prod tách biệt. API readiness/liveness phải chịu provider outage; worker stop nhận job mới, drain có deadline và mất lease phải chặn dispatch. Migration dùng expand → backfill → validate → contract; không seed demo vào production; restore vào môi trường cô lập và kiểm receipt/accounting/schema.

**Test gate:** SIGTERM/crash trước-sau reservation/dispatch, DB disconnect, lease loss, migration từ schema trước, rollback app tương thích schema mới và restore rehearsal.

### P4 — Một integration thật có kiểm soát

Chọn đúng một dịch vụ theo workflow P0. Bắt đầu read-only với resource allowlist và OAuth scope tối thiểu; review schema/side effect/output. Chỉ bật write sau preview/approval và sandbox contract test. Lập certainty matrix cho reject, timeout, lost response và observed success; chỉ retry khi adapter có operation identity và bằng chứng đủ, còn lại manual reconciliation.

**Exit:** một workflow thật chạy trên resource pilot được cấp quyền, không có extra write và có quy trình reconcile vận hành được. Không tuyên bố arbitrary MCP exactly-once.

### P5 — Observability, limits và vận hành

Correlation phải xuyên suốt request/run/version/operation/attempt/campaign/provider-call. Đo queue age, lease health, approval expiry, unknown writes, provider latency/error/token/cost và DB saturation; không log raw prompt/output mặc định. Có alert owner cho queue đình trệ, unknown write, cost cap, provider outage và restore fail. Thêm kill switch riêng cho new run, provider call và connector write.

**SLO pilot đề xuất để duyệt trước đo:** API valid-request p99.5 availability 99,5%/30 ngày; metadata API p95 ≤500 ms; event→DOM khi tab active p95 ≤3 giây; RPO ≤15 phút; RTO ≤2 giờ; unapproved/dry-run/duplicate unsafe write = 0. Planner completion SLO và concurrency chỉ chốt sau P1/load test.

**Exit:** dashboard, alert drill, budget rejection, restore drill và incident drill có evidence.

### P6 — UX/design approval và pilot acceptance

Chốt UX cho identity, approval, latency, cancel, uncertainty và reconciliation. Xin quyết định visual direction/Design System trước khi thay visual foundation; browser/accessibility/bundle gate không thay thế design approval. Người dùng đại diện chạy workflow thật, đo correctness, thời gian, hiểu approval và xử lý failure.

**Exit:** design approval và user acceptance được ghi riêng với technical pass.

### P7 — Release pilot và quyết định mở rộng

Chạy `npm run check:full` trên release commit và môi trường cô lập; staging với production-like config; allowlist user/connector, read-only trước rồi write được duyệt. Theo dõi đủ chu kỳ nghiệp vụ và cửa sổ SLO. Rollback khi có unapproved write, sai identity, ledger drift, migration incompatibility hoặc quality vượt ngưỡng; disable new writes và reconcile operation mơ hồ trước, không rollback DB để hoàn tác side effect SaaS.

**Exit:** có owner vận hành, pilot acceptance, SLO/cost evidence và rollback drill. Sau đó mới lập ADR cho tenant isolation, worker pool, scheduler hoặc realtime dựa trên tải đo được.

## 4. Đường găng, rủi ro và nguyên tắc dừng

Đường găng: **P0 → P1 → P2 → P3 → P4 → P5 → P6 → P7**. Một số workstream có thể song song sau khi scope và provider gate được chốt, nhưng không bỏ dependency của release.

Rủi ro lớn nhất là mở internet khi còn demo principal; coi probe là quality pass; áp exactly-once local cho SaaS; chạy hai executor; restore làm lệch accounting/approval; dùng holdout đã exposed; hoặc coi visual test là design approval.

Không hứa lịch tuần trước P0/P1. Mỗi stage chỉ được đánh dấu complete khi exit evidence tồn tại; nếu thiếu provider authorization, rubric, integration choice hoặc UX approval thì giữ `OPEN`, không tự suy đoán.
