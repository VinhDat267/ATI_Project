# FS-06 Task 2 — clean install and final regression gate

## Owned files

- `docs/task-hub-evidence/batch-02/FS-06/1789384080436-npm-ci/`
- `docs/task-hub-evidence/batch-02/FS-06/1789384630165-final-check/`
- This report

## Command provenance and sequencing

PowerShell resolved `node.exe` with `(Get-Command node).Source` and the `npm`
command shim with `(Get-Command npm).Source`. The shim's installed sibling
`node_modules/npm/bin/npm-cli.js` was used as the Node argument. No environment
contents or credentials were printed.

The clean install completed before the authoritative final gate began:

| Capture | Start (UTC) | Finish (UTC) | Exit | Signal / spawn error | Evidence |
| --- | --- | --- | ---: | --- | --- |
| `npm-ci` | `2026-09-14T11:08:00.439Z` | `2026-09-14T11:08:13.455Z` | 0 | `null` / `null` | [command](../../../docs/task-hub-evidence/batch-02/FS-06/1789384080436-npm-ci/command.json), [output](../../../docs/task-hub-evidence/batch-02/FS-06/1789384080436-npm-ci/output.log) |
| `final-check` | `2026-09-14T11:17:10.165Z` | `2026-09-14T11:23:17.385Z` | 0 | `null` / `null` | [command](../../../docs/task-hub-evidence/batch-02/FS-06/1789384630165-final-check/command.json), [output](../../../docs/task-hub-evidence/batch-02/FS-06/1789384630165-final-check/output.log) |

The captured install command was `node.exe npm-cli.js ci --ignore-scripts
--no-audit --no-fund`; its fresh output says `added 185 packages in 12s`. The
authoritative final command was `node.exe npm-cli.js run check:engine`.

## Fresh final-gate totals

The table is parsed from the four `Tests ...` summaries in the authoritative
fresh `output.log`, rather than copied from prior FS evidence.

| Suite | Passed | Skipped | Printed total | Arithmetic |
| --- | ---: | ---: | ---: | --- |
| DSL | 39 | 0 | 39 | `39 + 0 = 39` |
| engine unit | 92 | 1 | 93 | `92 + 1 = 93` |
| task_hub / DB integration | 64 | 0 | 64 | `64 + 0 = 64` |
| engine integration | 63 | 0 | 63 | `63 + 0 = 63` |
| **All suites** | **258** | **1** | **259** | `258 + 1 = 259` |

The log excerpts are `Tests 39 passed (39)`, `Tests 92 passed | 1 skipped
(93)`, `Tests 64 passed (64)`, and `Tests 63 passed (63)`. Each per-suite
equation and the aggregate equation were asserted during parsing.

The fresh log identifies the single skipped unit-file result as
`tests/filesystem-paths.test.ts (53 tests | 1 skipped)`. Vitest does not print
the individual skipped-test name. The source's conditional skip is P11,
`P11: rejects outside symlink`, when native file-symlink creation is unavailable;
it is capability-dependent and is recorded as a skip, not a failure.

## Side-effect review

`git status --porcelain` found no newly modified path below
`docs/engine-evidence/2026-09-13` or `docs/task-hub-evidence/batch-01`, so no
historical observation was restored. The successful final capture wrote its
controller, filesystem-controller, and MCP observations only below its own fresh
FS-06 directory. `package-lock.json` retained the pre-existing `112` added-line
working-tree diff and current SHA-256
`A3ECE75957E5129CF6CCBE52A0EA743EE923AEFA1E04CF13517CD908A202085F`; this task
did not change it. `git diff --check` reports only the two pre-existing EOF
whitespace warnings in the user-modified test files.

An earlier `final-check` capture at
`docs/task-hub-evidence/batch-02/FS-06/1789384101511-final-check/` finished with
exit 0 but overlapped a later accidental duplicate. The duplicate was stopped
after it had written only `controller-observations.json` and
`mcp-observations.json` under
`docs/task-hub-evidence/batch-02/FS-06/1789384162885-final-check/`; it has no
`command.json` or `output.log` and is not used for totals or verdicts. Both
directories are preserved. The non-overlapping authoritative capture above was
run afterward and is the only final-gate evidence consumed by later tasks.

## Task 2 result

`npm_ci_exit = 0` and `final_check_exit = 0`. This task's fresh technical gate
is `PASS`; it does not determine the separate overall G1 verdict.
