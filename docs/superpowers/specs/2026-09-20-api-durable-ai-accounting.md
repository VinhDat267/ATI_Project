# API durable AI authorization and accounting design

Ngày: 20/09/2026. Scope được user duyệt sau audit P0: thay thế ledger in-memory của API AI mode bằng accounting bền vững trong PostgreSQL và gắn mọi provider call vào run/user thực tế. Đây là readiness/code gate; không cấp quyền gọi API trả phí ngoài cấu hình local hiện có, không mở multi-tenant và không đụng frontend.

## 1. Mục tiêu và bất biến

- Mỗi planning, repair/replan, query-expansion và embedding call của API phải có `campaignId`, `runId`, `userId`, provider, model, purpose, request hash và reservation/settlement durable.
- Authorization chạy trước credential lookup, reservation và network dispatch.
- Authorization chỉ cho phép run thuộc configured principal, đang ở `planning` hoặc `replanning`, còn `claimed_by` và heartbeat hợp lệ; run terminal, chưa claim, sai owner hoặc stale lease phải fail closed.
- Campaign budget phải được kiểm tra atomically dưới PostgreSQL lock; restart process không reset committed/held reservations.
- Provider error/timeout không được coi là free hoặc thành công; settlement `failed`/`ambiguous` giữ lại evidence và giải phóng hoặc giữ reservation theo contract hiện có.
- `dev_fixture`, offline live-evaluation và default-deny path giữ nguyên semantics.
- Không lưu plaintext credentials, prompt raw hoặc response raw trong ledger; chỉ request hash, normalized usage/cost/status/error code.

## 2. Thiết kế được chọn

### 2.1 Durable storage

Migration mới tạo hai bảng:

- `ai_provider_campaigns`: campaign id, user id, integer cap in micros, reserved/committed aggregate, halted flag, created/updated timestamps.
- `ai_provider_calls`: UUID call id, campaign/run/profile/trial identity, provider/purpose/model/request hash/output cap/embedding purpose, estimate, status, reservation held, normalized usage/cost/error, created/settled timestamps.

`ai_provider_calls` có unique identity cho call id và foreign key campaign. `reserve()` locks the campaign row, rejects halted/over-budget campaigns, inserts a reserved call and increments held aggregate in one transaction. `settle()` locks call then campaign, is idempotent only for byte-equivalent settlement, updates committed/held aggregates and marks overrun/halt according to existing accounting semantics.

### 2.2 Runtime context

`createAiRuntime()` keeps a shared immutable durable ledger and exposes planner/replan proxies that construct a request-scoped provider client from `input.runId`. No mutable global context and no `AsyncLocalStorage`. The existing `ProviderCallLedger`, `AuthorizeProviderCall`, `AiProviderCallContext` and model/retriever seams remain intact.

API worker supplies the configured principal and database-backed authorization closure. The provider registry already invokes authorization before credential resolution, reserve and fetch; the new closure queries the run row and campaign row using the reservation identity.

### 2.3 Campaign identity and cap

The API campaign id is explicit and stable for the configured principal (environment override allowed only through validated config; default is a versioned local API campaign namespace). The cap is read from validated provider config and materialized with `INSERT ... ON CONFLICT` without lowering an existing cap silently. There is no automatic reset on process restart; cap rotation is an explicit future operation.

### 2.4 Compatibility

The in-memory ledger remains available for unit/fake transport tests and live-evaluation fixtures. API AI mode no longer constructs it. When durable migration is absent or the database authorization query fails, provider calls are denied before credentials/network and the worker records a normal planning dispatch failure.

## 3. Failure and recovery contract

- Crash after reservation and before response leaves a durable `reserved` call; recovery reports it as unresolved/ambiguous and does not dispatch it again automatically.
- Duplicate settlement with identical normalized content is a no-op; a conflicting second settlement poisons the ledger and denies future calls for the campaign.
- Budget exhaustion returns `BUDGET_EXCEEDED` without credential lookup.
- Missing usage stays `null`; cost is never inferred as zero.
- A stale or missing run claim returns `AI_CALL_UNAUTHORIZED` before reservation.

## 4. Verification boundary

Fake transport tests prove payload/context ordering. PostgreSQL integration tests prove migration, ownership, concurrent reservation, restart persistence, stale claim denial and idempotent/conflicting settlement. A real provider call remains `NOT_RUN` unless separately authorized.

## 5. Explicitly deferred

Multi-tenant auth/session identity, UI budget controls, campaign rotation APIs, provider invoice reconciliation, and automatic recovery of unresolved external calls are outside this slice.
