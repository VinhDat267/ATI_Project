# SLACK-04B4 · Captured rotating-credential recovery

Base8cdfdf47 (04B3 PR225 pending exact-head CI); branch feat/slack-04b4-rotation-recovery. One Backend card, scoped apps/chat-api plus setup/handoff. Main/live/default flags unchanged. User authorized M3.

## Contract and plan
Keep existing metadata-only lifecycle worker. A private optional refresh client needs retained OAuth client ID/secret and pinned lifecycle endpoint even when content/OAuth-start flags are off. Missing retained credentials leaves conservative 04B1 behavior. No new public API or content access.

Under the existing owner session advisory lock, verify exact receipt/lease/barrier/binding/config and active owner in a short guarded transaction, then commit refresh_in_flight BEFORE the single-use exchange. Never hold a database transaction over HTTP. Refresh is allowed for an expired rotating credential or a hard-auth failure, not for transient auth.test failures.

A confirmed refresh may be persisted only under the same live lease, old encrypted config, current app/workspace/actor/owner/generation and active owner. In one transaction store encrypted fresh credentials, clear checkpoint, and transfer matching pending provisional barriers/jobs for that same captured credential and binding to its new fingerprint. This transfer changes credential correlation, never releases a barrier. Reload claimed payload from DB so another claimed sibling follows the confirmed transition. Fresh auth.test resolves only its own captured barrier under existing final CAS; other barriers remain until independently checked.

Unknown/aborted exchange, crash checkpoint or expired lease never reuses the old refresh token, never guesses grant revocation and never purges. Keep reconnect_required/read block; manual reconnect/disconnect wins. Transient fresh auth.test retains confirmed new credentials and retries without repeating refresh.

Files: oauth-client.ts exports reusable metadata/refresh transport; lifecycle worker adds private guarded checkpoint/persist; runtime wires retained optional credentials; new real PG/HTTP rotation test; setup docs, this result and one new log.

TDD: expired/revoked rotation, transient non-refresh, confirmed refresh then transient identity probe/retry, sibling barriers, lost-response AbortSignal then restart, stale checkpoint, lease expiry during HTTP and real row-lock wait, manual disconnect/reconnect races. Run existing validation/runtime/token/native tests, fullcheck and browser. One independent whole-branch reviewer; fix Important findings RED→GREEN once; exact-head CI check/browser before dependency acceptance.

Review Focus: single-use exchange uncertainty; lease expiry after lock waits; no config writes across current binding/app changes; sibling fingerprint transition cannot clear unrelated barriers; flags-off retained lifecycle and no secret in public/log/model. Native provider acceptance and later04C/write/05 remain open.

## Kết quả
Đang thi công.
