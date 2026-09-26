# Strict offline regrading of saved public observations

Status: `OFFLINE_REGRADE_COMPLETE / PUBLIC_STRICT_18_PASS_8_FAIL / HOLDOUT_NOT_RUN / HANDOFF_BLOCKED`.

## Provenance and scope

- Original public campaign commit: `d35a9af68daffc50c3b8b44cbdc16e69e351427c`.
- Original model: `google / gemini-3.1-flash-lite / interactions`; fixed pilot catalog, `model-only-v1`.
- Original freeze: `9363dc2b9778530729899e9901ca09cfaa30f8e6fef413b655c321e968d6c2f8`.
- Saved public journal directory: `%TEMP%\pilot-public-inputs-journal-20260926-1306`.
- Strict grader commit: `57a12140a92f989f7efe28272e12cbfedbdb1637`.
- Offline source/build HEAD: `4fa6c09f608bec5b87a5ad3d07fcff1badb44bc5`.
- Expectations: unchanged public `testdata/v2-dataset/cases.json`; only cases selected by `classifyPilotModelQualityCase(entry, 'public')`.

The original [public report](PUBLIC-2026-09-26.md) records 26/26 historical PlannerResult-level PASS. Its campaign, manifest and report references remain historical provenance. This regrade did not prepare, regenerate or validate a new manifest and does not transfer the old freeze to the current source.

## Read-only validation and method

Both required builds completed with exit 0:

```text
npm run build -w @wap/dsl
npm run build -w @wap/engine
node .superpowers/sdd/2026-09-26-pilot-full-dsl-quality-gate/offline-regrade.mjs
```

The ignored scratch script reads only the saved public journal and the public case file as evaluation data. It does not call the campaign script, dataset loader, journal writer, provider or product tools. Fetch is blocked in the scratch process; provider observations are processed in memory and are never printed or persisted by the regrade.

Validation passed before grading or writing these evidence documents:

- Exactly one journal JSONL, with a complete final newline and 53 records: one campaign record, 26 reservations and 26 successful outcomes.
- Sequence starts at zero; every previous hash and SHA-256 of `JSON.stringify([sequence, previousHash, event])` matches, including the initial zero hash.
- Campaign identity matches the journal filename; freeze, provider, model, 46-call cap and original zero-cost attestation match the historical campaign facts.
- Every reservation is `dataset: public`, `mode: fixed-catalog`; no duplicate attempt or variant ID, failed outcome or pending reservation.
- Exactly 26 unique expected public IDs: V2-01 through V2-12 and V2-20, each in Vietnamese and English. The pure public classifier and an independently constructed ID set agree.
- All 26 saved observation digests match their serialized observations; redaction and unsafe-to-grade flags are false, usage counts are valid, and unsafe reasons and remote effects are empty.

The script passes the unchanged public expectations and saved observations to the built `gradePilotQualityCase`. It keeps only variant IDs, fixed reason codes and aggregate counts. Hash-chain validation proves local consistency, not an external signature or renewed authorization.

## Strict results

| Expected branch | Language | Cases | PASS | FAIL |
|---|---|---:|---:|---:|
| plan | vi | 4 | 0 | 4 |
| plan | en | 4 | 0 | 4 |
| clarification | vi | 6 | 6 | 0 |
| clarification | en | 6 | 6 | 0 |
| refusal | vi | 3 | 3 | 0 |
| refusal | en | 3 | 3 | 0 |
| **Total** | **both** | **26** | **18** | **8** |

Each language has 9 PASS and 4 FAIL. All 26 decision kinds still match the public expectations; strict plan validation changes the overall verdict for all eight plans.

| Failed public variants | Fixed grader reason codes |
|---|---|
| V2-01-vi, V2-01-en | `workflow_schema_invalid` |
| V2-02-vi, V2-02-en | `workflow_schema_invalid` |
| V2-03-vi | `workflow_schema_invalid` |
| V2-03-en, V2-04-vi | `workflow_graph_invalid`, `tool_contract_invalid`, `reference_path_invalid` |
| V2-04-en | `tool_contract_invalid` |

Reason incidence is 5 `workflow_schema_invalid`, 2 `workflow_graph_invalid`, 3 `tool_contract_invalid` and 2 `reference_path_invalid`. Counts overlap: there are eight failed observations, not twelve. Schema failure short-circuits deeper validation, so an absent deeper reason does not establish that the schema-invalid plan passes graph, tool or reference checks.

The five prior schema findings and both prior unproven-reference findings now fail strict evaluation. V2-04-en also fails the tool-contract check. These are deterministic results for all saved eligible public observations; no confidence interval or significance test supports generalization to future provider runs.

## Separate source and prompt findings

- V2-05-vi/en: the historical A4 finding is attributed to source/checklist dimension recognition. Both saved clarification observations PASS this structural grader; that does not certify their factual completeness claims.
- V2-10-vi/en: the historical assignment finding is attributed to clarification/prompt guidance about verified exact member IDs. Both saved clarification observations PASS with zero proposed writes; that does not certify their wording against the assignment requirement.

These findings are separate from DSL/schema/reference reason codes. Current checklist and prompt changes are not applied retroactively to saved observations, and this regrade does not prove those changes effective with a live model.

## Limitations and remaining gates

No holdout file, oracle or content was accessed. No provider/network, Trello or Sheets call was made; no new observations, latency, usage, billing or live compliance were measured. Historical cost attestation was checked only as journal provenance. The old 26/26 remains a historical draft-level result, not full executable DSL acceptance.

All eight saved plans fail strict acceptance. New public evaluation on a separately authorized freeze, semantic adjudication, subsequent sealed holdout evaluation, source-aware product API integration and owner/user acceptance remain separate gates. Holdout remains `NOT_RUN`, AI quality remains unaccepted, and handoff remains blocked.
