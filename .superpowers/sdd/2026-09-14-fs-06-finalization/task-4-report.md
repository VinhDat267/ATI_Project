# FS-06 Task 4 — deterministic manifest and source-change register

## Owned outputs

- `scripts/fs06-manifest.mjs`
- `docs/G1-FILESYSTEM-STATUS-2026-09-13.md`
- `docs/task-hub-evidence/batch-02/FS-06/1789386912283-manifest/`
- This report

The status document is the Task 5 handoff. Its machine-readable register block
may be surrounded by additional Task 5 status, rubric, and manual-guide prose,
but it must remain valid JSON for the manifest checker.

## Fresh capture

Executed from `D:\Môn học\ATI\ATI_Project` with the required command:

```powershell
node scripts/capture-command.mjs FS-06 manifest node scripts/fs06-manifest.mjs
```

The capture ran from `2026-09-14T11:55:12.285Z` through
`2026-09-14T11:55:14.196Z`, exited `0`, and recorded `signal: null` and
`spawn_error: null`.

- Command: `docs/task-hub-evidence/batch-02/FS-06/1789386912283-manifest/command.json`
- Output: `docs/task-hub-evidence/batch-02/FS-06/1789386912283-manifest/output.log`
- Manifest: `docs/task-hub-evidence/batch-02/FS-06/1789386912283-manifest/manifest.json`

The generated manifest reports `status: "PASS"` and exactly these top-level
groups, in contract order: `status`, `recorded_at`, `git`, `scope`,
`protected_files`, `migrations`, `runtime`, `catalog`, `dataset`, `evidence`,
`rubric`, and `verdict`.

## Source-register coverage

The manifest recomputes current SHA-256 values for all 56 baseline source
entries and compares them with the authoritative Task 1 audit. It also scans
the current Git working-tree paths for source/config/migration/test additions
that have no baseline source entry. The status document register must match
that derived set exactly.

- Total registered paths: `51`.
- Baseline paths with changed bytes: `17`, all labeled
  `MODIFIED_FROM_BASELINE`.
- Paths added after the baseline: `34`, all labeled
  `ADDED_AFTER_BASELINE`.
- Omitted, duplicated, missing, or falsely unchanged paths: `0`.
- Every row contains nonempty `path`, `reason`, `task`, `evidence`, and
  `status`; every source path and evidence path resolved during capture.

The register includes the Task 4 manifest script itself and the Task 1/Task 3
FS-06 evidence runners. It excludes unchanged paths that Git still reports as
untracked relative to HEAD when their bytes already appear in the handoff
baseline, such as `testdata/dev-hand-plans/th-move.json`.

## Contract checks

- Protected files: `180`; mismatches: `[]`.
- Migrations: exactly five sorted names, with current bytes matching both the
  Task 1 PostgreSQL apply audit and the Task 3 isolated snapshot checksums.
- Final regression gate: command JSON exit `0`; parsed output totals are DSL
  `39/39`, engine unit `92 passed + 1 skipped = 93`, task_hub/DB `64/64`, and
  engine integration `63/63`, for `258 passed + 1 skipped = 259`.
- Runtime snapshot: command JSON exit `0`, status `PASS`, 8 raw task_hub tools,
  14 raw filesystem tools, 10 normalized public tools, and cleanup values
  `db_dropped: true`, `root_removed: true`, `failure: null`.
- Installed bytes: the capture rehashed 7 direct filesystem package files and
  1,643 executable/package metadata files across 102 resolved dependency nodes,
  for `1,650` verified installed fingerprints.
- Catalog: SHA-256 over current `testdata/tools.json`; exactly 10 sorted names
  and separate `task_hub` / `filesystem` server-mode rows.
- Dataset: SHA-256 over current test cases, matching experiment-manifest IDs,
  exactly 6 dev and 4 holdout cases, `holdout_untuned: true`, and experiment
  status `NOT_RUN`.
- Marker boundary: FS-05 evidence records `filesystem_dispatch_markers` and
  `task_hub_receipts` as separate fields; filesystem markers are not presented
  as task_hub receipts.
- Command provenance: every consumed command preserves executable, arguments,
  start/finish UTC timestamps, exit code, signal, spawn error, and computed
  duration. The live npm version is recorded with retrospective timing `null`.

The script also ran negative contract fixtures during the successful capture.
It rejected a missing evidence path, a protected mismatch, a catalog other
than 10 tools, an omitted changed source, a tuned holdout, and `G1_PASS` while
rubric/work inputs remain OPEN.

## Verdict derivation and disclosed gaps

The required FS-05 E01-E14 matrix, Task 1 scope/migration audit, Task 2 clean
install and final gate, and Task 3 isolated snapshot all passed. FS-01's P11
native file-symlink case remains disclosed as one capability-dependent Windows
skip; it is not counted as a failure or hidden from the totals. The FS-06
required-native-safety/fault NOT_RUN list is empty because the required E08 and
E10 fault cases passed.

The authoritative rubric source and representative group-work confirmation are
both `OPEN`. Applying the Task 4 decision table therefore produces:

- Technical: `TECHNICAL_PASS_OVERALL_PARTIAL`
- Overall: `PARTIAL`

No production, dependency, schema, policy, catalog, dated status/history,
`batch-01`, or Git-history file was changed by Task 4.
