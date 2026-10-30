# SLACK-04B2 · Native validation runtime

Parent: [SLACK-04](SLACK-04-ingress-lifecycle-and-execution-safety.md), accepted private [04B1](SLACK-04B1-lifecycle-validation.md). Backend owner, direct implementation on `feat/slack-04b2-validation-runtime`, base `99edecf1`. [Plan](../../superpowers/plans/2026-10-30-slack-04b2-validation-runtime.md).

Connect04B1 to native server startup/shutdown independently of content flags. Reuse the existing bounded auth.test transport through a metadata-only identity client that needs no OAuth client secret/redirect. Native transport stays pinned; sandbox requires literal HTTP loopback. Drain durable validation jobs with no overlapping ticks, abort probes on stop, bound this runner's shutdown wait and observe late rejection. Do not imply immediate PostgreSQL cancellation: after a blocked claim settles late it may retain a body-free lease, which expires normally. Abort checks reject further authority processing before COMMIT dispatch; an already dispatched COMMIT may finish and is not undone by stopping the supervisor.

Scope: OAuth metadata extraction preserving existing API, lifecycle endpoint resolver, runner/factory, native server wiring and real PG/HTTP tests. No rotating-token recovery, authorization fanout, content/model processing, other queue consumers, flag enable or fullF4 closure. Required ingress configuration remains retained while Slack subscriptions exist.

## Kết quả

Implemented private native supervisor/factory and server hooks. Baseline04B1 repository/worker29PASS; post-review targeted54PASS plus actual-server sandbox bootstrap1PASS, exit0. Independent review found oneP2 malformed URL retaining credential-bearing `.input` in bootstrap logs;3 regressions were RED then GREEN after fixed configuration errors replace parse failures without cause/input. Fullcheck after the direct fix pass3,570PASS, typecheck/build/securityPASS, exit0. Exact-head CI remains required before staging integration. No fullF4/native Slack acceptance. [Log](../log/2026-10-30-slack-04b2-validation-runtime.md).
