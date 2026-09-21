# ATI production-expansion plan — GPT-6 Astra Light

**Status:** DRAFT — based on the current repository and evidence. This does
not approve production deployment or replace `docs/BASELINE.md`.

**Current verdict:** OIDC local technical acceptance is `PASS`; production
OIDC and production pilot readiness remain `OPEN`.

## Verified starting point

- OIDC BFF is the selected identity path and remains feature-gated off by
  default.
- Local E2E passes discovery, authorization-code + PKCE, JWKS/ID-token
  validation, durable identity/session creation, API restart session recovery,
  logout/revocation, and two-user owner isolation. Evidence:
  `docs/auth-evidence/OIDC-01/local-20260921071503494-6321629d-e85e-4efa-9e37-e057ad822183/manifest.json`.
- The release manifest is `technical=PASS` but `overall=OPEN` because no
  authorized provider configuration or live two-user acceptance was supplied:
  `docs/auth-evidence/OIDC-01/20260921071316-825ab795-6bfe-4388-880f-6d73269143f8/manifest.json`.
- The worktree is intentionally dirty with user-owned UI/DesignSystem changes;
  those changes are not silently reverted or treated as design approval.
- The latest `npm run check:full` on HEAD `fb095d1` exited `0`: DSL 44,
  engine unit 341 (+1 skipped), API unit 67, web unit 132, MCP integration 64,
  engine integration 102, API integration 46; WEB-03 passed all 6 gates,
  NFR-03 p95 was 1938 ms and cleanup passed. The generated web manifest is
  `docs/web-evidence/WEB-03/20260921073613-4647b009-c0f2-4b02-850f-008aad3a1439/manifest.json`.
- AI quality, production operations, restore/incident evidence, representative
  user acceptance, and visual direction/Design System approval remain open.

## Ordered expansion stages

| Stage | Deliverables | Required closing evidence |
|---|---|---|
| **P0 Scope/provenance** | One pilot organization, workflow, owner, hosting, budget, data policy; record exact release revision and dirty-state hashes. | Every status claim links to a manifest and revision; no stale “clean worktree” or migration-count claims. |
| **P1 AI quality** | Select provider/model/price card; independent safety review; rubric, thresholds and fresh sealed holdout before tuning. | Authorized index → freeze → smoke → dev → holdout; correctness, retrieval, repair/replan, latency, token and cost reports. |
| **P2 Production identity** | Supply provider contract below; wire per-principal AI campaigns; enforce owner checks for runs, index, accounting and reconciliation; deny-by-default roles and audit events. | Real staging provider, two users, role change, restart/revoke/expiry, CSRF/origin, redaction, JWKS rotation/outage, migration and auth-state restore. |
| **P3 Deployment/recovery** | Reproducible non-root image; separate API/worker entrypoints; additive migration and backup/restore runbooks; RPO/RTO and rollback contract. | Linux/container drain deadline; crash before/after reservation; lease loss/DB disconnect; isolated restore of schema, receipts, approvals, accounting and auth. |
| **P4 One real connector** | One approved SaaS/resource; read-only allowlist first; write certainty matrix and reconciliation runbook. | Sandbox success/reject/timeout/lost-response cases; exact preview/approval owner/version/TTL; no unapproved writes. |
| **P5 Operations** | Correlation IDs across request/run/operation/provider call; dashboards, alert owners, redacted telemetry, budget and provider-write kill switches. | Queue stall, provider outage, budget rejection, unknown write, restore failure and incident drills. |
| **P6 Design/acceptance** | Explicit visual direction and Design System approval; identity/callback/expiry/approval/cancel/uncertainty UX; representative-user script. | Accessibility/browser evidence plus separate user acceptance for correctness, approval comprehension and failure recovery. |
| **P7 Controlled pilot** | Immutable release artifact; production-like staging; user/connector allowlists; read-only then approved writes; operator and rollback owners. | `npm run check:full` and OIDC evidence on the exact release artifact; all P1–P6 gates and a full pilot/SLO window. |

Recommended order: **P0 → P2 plus P1 preparation → P3/P5 → P4 → P6 → P7**.
P1 research and P6 design decisions may run in parallel, but neither can be
silently inferred from fixture or local technical tests.

## Production OIDC input contract

Provide a non-secret configuration record plus secret-manager references for:

- issuer/tenant owner and exact HTTPS `OIDC_ISSUER_URL`;
- confidential `OIDC_CLIENT_ID`, secret reference/version and rotation owner;
- exact HTTPS `OIDC_REDIRECT_URI`, approved `OIDC_WEB_ORIGIN`, ingress and TLS;
- `OIDC_AUDIENCE`, `OIDC_SCOPES`, issuer/client audience and `azp` semantics;
- verified-email policy, role claim, allowlisted role mapping and membership
  revocation owner;
- cookie name, session/transaction TTL, clock skew and idle-timeout policy;
- two independent staging accounts, operator/role-change case, synthetic data
  and resource allowlist;
- secret delivery, redaction, incident owner, RPO/RTO and JWKS rotation plan;
- explicit approval to set `OIDC_ENABLED=1` after the above review.

Do not send client secrets in chat or commit them. The production claim remains
`OIDC local technical PASS; production OIDC OPEN` until live evidence exists.
