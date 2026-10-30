# SLACK-DELIVERY-01 · Repair Slack delivery tracking and integration evidence

Authorized by the project owner after review of the SLACK-03/04 delivery workflow. One branch `fix/slack-delivery-workflow`; direct Codex implementation, no CLI implementers. [Plan](../../superpowers/plans/2026-10-30-slack-delivery-workflow-repair.md).

## Scope / acceptance

- One [delivery matrix](../SLACK-DELIVERY.md) maps requirements to owning cards, accepted heads/evidence, integration and native gates. Parent03/04 and the macro plan point to it; historical implementation logs stay historical.
- Remove the false sequential dependency03-all→04 and distinguish bounded source lifecycle acceptance from fullF3 (future06 artifacts). Preserve all agreed feature scope.
- Promote ignored native probes into committed tests discovered by `npm run check`: actual server child, signed HTTP ingress, real PostgreSQL, metadata validation and physical registered-message purge with content flags off, owner isolation, plus purge without any Slack configuration. All traffic stays loopback; no live credentials/model.
- Demonstrate that removing native wiring fails these regressions; restore production source and verify GREEN. Keep exact-head CI/browser and one independent whole-branch review.
- Record inventory snapshot semantics explicitly; do not redefine native acceptance or claim354 methods implemented. No main merge/flag enable.

## Kết quả

In progress. Final validation/review/publication evidence will be recorded in the [log](../log/2026-10-30-slack-delivery-workflow-repair.md).
