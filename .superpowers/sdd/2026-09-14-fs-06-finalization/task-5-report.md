# FS-06 Task 5 — rubric map, manual guide, and current documentation

## Result and changed documents

Task 5 documents the current conditional verdict without changing runtime,
dependencies, schemas, policies, catalog, historical evidence, or Git history.

- Created `docs/G1-RUBRIC-MAP.md`.
- Updated `docs/G1-FILESYSTEM-STATUS-2026-09-13.md` with the current verdict,
  evidence links, user-authorized manual guide, technical boundaries, and gaps.
- Updated current-status prose in `README.md`, `docs/00-BAT-DAU.md`,
  `docs/BASELINE.md`, `docs/KE-HOACH-6-TUAN.md`,
  `docs/EXECUTION-CONTRACT.md`, `docs/EVALUATION.md`, `db/DATABASE.md`,
  `apps/mcp-task-hub/README.md`, `packages/engine/README.md`, and
  `testdata/TESTDATA.md`.
- Created this report.

The current docs now distinguish the 13 September historical 142-test snapshot
from the current evidence. FS-05 is `TECHNICAL PASS` for E01–E14, the fresh
FS-06 gate is 258 passed/1 skipped, and the composite public catalog is 8
`task_hub` plus 2 `filesystem` tools. The derived verdict remains
`TECHNICAL_PASS_OVERALL_PARTIAL`, overall `PARTIAL`.

## Provenance labels

`docs/G1-RUBRIC-MAP.md` has exactly these seven columns:
`source`, `source_status`, `criterion_quote_or_paraphrase`,
`G1_applicability`, `evidence`, `status`, and `gap/next_batch`.

- `OPEN`: the absent official G1 rubric and representative group work. No
  rubric quote, score, weight, interview, time saved, or user result was
  invented.
- `USER_PROVIDED`: the selected B/local baseline and its planned
  HTTP/session/UI/polling and AI scope.
- `INSPECTED_REPO`: FS-01 through FS-05 technical gates and the FS-06 clean
  gate/snapshot/manifest evidence.

The FS rows are described as repository technical gates, not as official
rubric criteria. FS-01 remains `PARTIAL_P11_CAPABILITY_NOT_RUN`; FS-02 through
FS-04 retain their verified checkpoint boundaries; FS-05 is
`TECHNICAL_PASS`; FS-06 records `TECHNICAL_PASS_OVERALL_PARTIAL`.

## Manual guide boundary

The guide parses `run_id`, `approval.id`, `workflow_version_id`, and
`approval.snapshot_hash` from the nested JSON returned by `prepare`. It sets
`G1_FILESYSTEM_ENABLED='1'`, calls `preview`, stops at an explicit `Read-Host`
approval checkpoint, and only then calls `approve`, `execute`, `trace`, and
`reconcile`. A PowerShell `finally` block removes the environment variable.

The guide says it is for a user-authorized persistent demo and must not run
during evidence capture. It explains:

- root derivation as `runtime/filesystem/<G1_USER_ID>`, with the default demo
  principal UUID when the trusted launcher supplies no override;
- preserving behavior of `fs:demo:setup`, and create/replace behavior of an
  approved `write_file` against an existing parent;
- repeated demos as new approved intents that can overwrite the target;
- filesystem dispatch markers as durable reservations before the MCP packet,
  separate from atomic task_hub receiver receipts;
- filesystem reconciliation as `receipt: not_supported`, without treating
  current bytes as confirmed receiver evidence;
- environment cleanup versus persistent DB/root data, and the absence of an
  automatic rollback, blind retry, or exactly-once promise for arbitrary MCP
  writes.

The manual write demo was `NOT_RUN` in Task 5, as required. Task 5 made no
persistent demo DB or filesystem mutation.

## Command and link self-checks

All checks below were run from `D:\Môn học\ATI\ATI_Project` after the edits.

- `node packages/engine/dist/cli.js --help`: exit 0; documented `prepare`,
  `preview`, `approve`, `execute`, `trace`, and `reconcile` commands are present
  with the documented argument counts.
- Parsed root `package.json`: `build`, `db:up:g1`, `db:migrate:g1`,
  `db:seed:g1`, `fs:demo:setup`, and `engine` scripts all exist.
- Manual-contract scan: 19/19 required checks passed, including nested fields,
  pause, flag, `finally` cleanup, root/overwrite semantics, marker/receipt
  separation, no rollback, and no exactly-once promise.
- Rubric-header scan: 7/7 exact columns; observed provenance labels are exactly
  `OPEN`, `USER_PROVIDED`, and `INSPECTED_REPO`.
- Local Markdown link scan over the 12 created/updated current docs: 63 links
  checked outside fenced code blocks, 0 broken.
- Source-register parse and manifest comparison: 51 rows, 51 unique paths,
  exact row equality with
  `docs/task-hub-evidence/batch-02/FS-06/1789386912283-manifest/manifest.json`.
- Stale current-status scan checked eight known contradictions, including FS-05
  E08/E10/E14, old 254 totals, filesystem-next-batch wording, single-server
  wording, and filesystem `SPEC_ONLY`; 0 current matches remained. The
  explicitly labeled 13 September 142-test historical snapshot remains.

No full runtime suite was rerun for this documentation-only task. The status
uses the Task 2 authoritative fresh gate whose parsed command exited 0 with 258
passed/1 skipped; the guide itself was deliberately not executed.

## Remaining OPEN and NOT_RUN gaps

- `OPEN`: official G1 rubric file/URL/page and the applicable criteria. Until
  provided, there is no authoritative basis for rubric scores or an
  unconditional G1 pass.
- `OPEN`: representative group work with group-confirmed input, expected
  output, and current manual process. The baseline example remains a
  hypothesis; interview evidence and time saved are unknown.
- Capability-dependent `NOT_RUN`: FS-01 P11 native file-symlink case on this
  Windows host. The fresh gate reports it as the single skip; it is outside the
  required FS-05 E01–E14 matrix, whose NOT_RUN list is empty.
- `NOT_RUN`: HTTP run lifecycle and session/auth runtime integration.
- `NOT_RUN`: UI/browser E2E, reconnect behavior, expiry/cancel interaction, and
  2-second polling.
- `NOT_RUN`: AI semantic retrieval, query expansion, planner/repair, local
  replan, provider/model/prompt runs, and dev/holdout evaluation.
- `NOT_RUN by scope`: the persistent user-authorized manual demo during Task 5
  and FS-06 evidence capture. Its future execution must be separately
  user-authorized and recorded as separate evidence.

These gaps keep G1 overall `PARTIAL`. This task does not claim HTTP, session,
UI, polling, LLM, retrieval, replan, scheduler, or BullMQ runtime behavior.

## Preservation

No production source, dependency or lockfile, migration/schema, policy,
catalog, test fixture, dated G1/engine/task_hub report, historical evidence,
`batch-01` artifact, staging area, commit, branch, or other Git history was
changed by Task 5.
