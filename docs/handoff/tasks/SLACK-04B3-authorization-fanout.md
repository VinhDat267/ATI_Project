# SLACK-04B3 · Durable authorization fanout and six start watermarks

Status: implementation authorized01/11/2026 as the first M3 card. Base `ec81ebb3`, branch `feat/slack-04b3-authorization-lifecycle`. Backend owner: apps/chat-api and db/v3. One implementer; independent whole-branch reviewer before acceptance.
Spec: ../../superpowers/specs/2026-10-28-slack-personal-oauth-design.md sections4.4,5,9.2. Frozen six-field contract: ../../superpowers/plans/2026-10-29-slack-04a-signed-ingress.md. Plan: ../../superpowers/plans/2026-11-01-slack-m3-lifecycle-write-safety.md.

Deliverable: real signed ingress commits a body-free ordinary receipt; a supervised durable consumer resolves every authorization page with the private app token and creates one private metadata-only triage intent for each currently authorized ATI binding. DM permissions come from the authorization list, never the sender or first entry. No content/model/automatic write processing is added.

Scope:
- Bounded native-pinned/explicit-loopback HTTP authorizations client, actual AbortSignal, no redirects or token in body/log/DTO; all pages validated before publication, cursor cycles and partial/malformed pages fail closed. No event_context means metadata-only discard; no guessed owner fallback.
- Migration0028: fanout lease/retry fields; server-owned per-connection processing controls; app runtime epoch; private triage metadata jobs unique(receipt,connection,generation). Existing receipt retains no body/text/blocks.
- Complete only with SQL lease CAS in the same transaction as jobs. Map exact app/workspace/user to active connection and active ATI owner. Owner/invalidation/authority locks fence reconnect/revoke/policy/delete races; failed/stale worker rolls back all jobs.
- Source event timestamp must be at or after MAX(processing_start,consent_grant,identity_epoch,provider_attestation,config_revision,resume), compared in PostgreSQL with microseconds. Missing controls/consent/provider/current policy deny. A startup/re-enable begins a fresh runtime processing epoch and records an outage boundary; old receipts are not replayed as new work.
- Identity/consent/provider SQL-write timestamps supplement evidence dates after actual row locks; a client Date or backdated attestation cannot admit a receipt from before the authority write. Final app/workspace/actor/owner/generation is rechecked after waits. Cancellation follows the binding captured in the job even if the connection changes owner/app.
- Processing controls are internal server-owned service inputs for later05; defaults are disabled. No new public consent attestation or mode UI. Current policy and barriers are checked when staging jobs; future05 must recheck again before claiming content/model work.
- Native bootstrap starts/stops the supervisor, coalesces ticks, aborts HTTP on shutdown and leaves only expiring metadata leases if SQL finishes late. Flags-off lifecycle/purge remains active while ordinary fanout does no new work.

Acceptance: actual PostgreSQL leases/CAS/races and HTTP pagination/DM/cross-workspace isolation; each of six watermarks tested with exact microseconds; wrong/missing context and partial failures create zero jobs; source/owner/policy changes before commit deny; flags-off and real server bootstrap; fullcheck/browser CI and independent review. No native Slack, flag enable, source payload persistence, rotation recovery04B4, echo/outbox04C, writes03C2 or fullF4 claim.

## Kết quả
Đang thi công.
