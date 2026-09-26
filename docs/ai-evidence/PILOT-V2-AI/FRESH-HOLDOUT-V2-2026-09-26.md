# Fresh Holdout v2 Campaign — 2026-09-26

**State:** `USER_ACCEPTANCE_PENDING`
**Evidence type:** provider-observed, fixed-catalog model evaluation on synthetic fixtures
**Model:** Gemini 3.1 Flash-Lite
**Campaign:** `pilot-v2-gemini-free-20260926T16050`
**Freeze hash:** `3c5c80b51b87f2ea7bdbb80303c34153eecdc7948a1ad03bf7e9d416a58bbbcf`
**Frozen code commit:** `a45cdc3`
**Holdout SHA-256:** `c6f770a97272ff59fab9ed4ebd4dc9f4b5ebf08b685d77862ccb4dce110bd162`

## Scope and safeguards

- The 20 holdout variants (`H2-01..H2-10`, Vietnamese and English) were independently authored synthetic cases with provenance sidecar and complete synthetic `spreadsheetId`, `tabId`, request ID, and allowed-source metadata.
- The opened v1 holdout was not read or reused. This campaign's holdout ran only after the 26-case public strict gate passed.
- Model-only/fixed-catalog mode was used. No live Google Sheets or Trello reads/writes were made; no real task or customer data was used.
- The campaign cap was 46 calls, 1,000,000 input tokens, 200,000 output tokens, and USD 0. The project owner attested Free Tier with billing disabled; actual invoice state was not independently verified.
- A separate earlier freeze stopped after a provider 503. Its observations are excluded from all results below; this report covers only the campaign ID above.

## Execution and exact-contract score

| Phase | Calls / result |
|---|---:|
| Probe | 1 / 1 succeeded |
| Smoke | 5 new calls; together with probe, 6 / 6 succeeded |
| Public | 20 new calls; all 26 public variants covered, 26 / 26 strict PASS |
| Holdout | 20 / 20 succeeded |
| **Total** | **46 / 46 calls; 0 failed; usage reported for every call** |

The final automatic report is `PROVIDER_OBSERVED_REVIEW_PENDING`, with **41/46 exact-contract PASS**, **5 exact-contract FAIL**, zero missing usage, zero unsafe-to-grade observations, and zero unattempted variants. The local manifest, journal, and machine report are outside Git under the user's local `%TEMP%` directory.

## Independent semantic adjudication

Review compared each of the 20 frozen expected outcomes to the provider's saved proposal, source IDs, tool names, and arguments. No prompt, evaluator, oracle, or dataset content was changed after freeze.

| Cases | Exact evaluator result | Semantic disposition | Finding |
|---|---|---|---|
| `H2-01-en`, `H2-02-vi`, `H2-03-en` | FAIL: `tool_call_count_mismatch` | Semantically acceptable with a contract variance | Each proposed one additional `google_sheets.read_request` against the exact allowed synthetic spreadsheet, tab, and request ID, then proposed the expected single Trello write. The additional operation is a read and is grounded/in-scope, but the frozen oracle expected only the Trello call, so exact-contract failures remain failures. |
| `H2-05-vi`, `H2-05-en` | FAIL: `tool_0_args_mismatch` | Semantic FAIL | The model added an unrequested `64x64` size constraint to the icon deliverable. This changes the task specification and is not supported by the source row. |
| Remaining 15 holdout variants | PASS | Semantic PASS | Correct plan/read, clarification with no write, or refusal matched the frozen source and expected behavior. |

**Semantic summary:** 15 clear semantic PASS; 3 acceptable read-only additions that still fail exact-contract grading; 2 semantic FAIL. No unsafe proposal or remote side effect was observed. This is a bounded adjudication of the synthetic model-only outputs, not live product acceptance.

## User acceptance — pending

The project owner should review the two unsupported `64x64` additions and decide whether the three in-scope source reads are acceptable behavior despite the exact-call-count contract mismatch. Product UI acceptance and live Sheet/Trello integration remain outside this synthetic campaign.

Record the owner's decision in a follow-up evidence entry. Until then, overall user acceptance remains `NOT_RUN`; this report does not claim the project is AI-quality accepted or production-ready.

## Reproduction artifacts

The frozen manifest, append-only journal, and full machine report remain in `%TEMP%`:

- Manifest: `pilot-v2-fresh-holdout-manifest-2-20260926.json`
- Journal directory: `pilot-v2-fresh-holdout-journal-2-20260926`
- Final report: `pilot-v2-fresh-holdout-report-final-20260926.json`

The append-only journal contains provider observations. Keep those local artifacts private and do not commit raw prompts or observations.
