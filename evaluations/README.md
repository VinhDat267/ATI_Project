# Planner evaluation evidence

`runEvaluations({ useMock: true })` is an offline harness diagnostic. It builds
responses from each golden prompt's expected kind and tools, so its scores are
not independent evidence of model quality. Its result is labelled
`evidence: "offline_fixture"` and `qualityGate: "not_run"`.

`runEvaluations({ useMock: false, provider })` requires a non-mock provider and
reports `evidence: "provider_observed"`. The live campaign has not been run as
part of this remediation. A provider run still reports `qualityGate:
"incomplete"`: the current golden set has expected response kinds and tool
names but no independently labelled argument values or user acceptance data.
Consequently `argumentQualityRate` and `usablePlanRate` remain `null`.

The 50 prompts, mock fixtures, and scoring logic are retained for regression
diagnostics. Before claiming the v3 AI quality gate, collect provider identity
and run evidence, label expected arguments, assess those arguments independently,
and measure user acceptance on held-out requests.
