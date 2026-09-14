# FS-06 Final Evidence and G1 Verdict Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce an independently reproducible FS-06 evidence package, manual demo guide, rubric map, and conditional G1 verdict without claiming unimplemented API, UI, polling, or AI behavior.

**Architecture:** FS-06 is an evidence and documentation layer over the already verified B/local runtime. Small Node scripts create isolated PostgreSQL/root snapshots, hash the checked-in and installed bytes, validate local Markdown/CLI/plan contracts, and write immutable run artifacts under `docs/task-hub-evidence/batch-02/FS-06/`; no production execution path is changed. The final report derives its verdict from fresh command outputs, the 10-tool catalog, FS-01–FS-05 evidence, rubric provenance, and explicit OPEN/NOT_RUN rows.

**Tech Stack:** Windows PowerShell, Node >=22, npm lockfile, PostgreSQL 16 loopback, MCP SDK 1.30.0, pinned `@modelcontextprotocol/server-filesystem@2026.8.31`, Vitest, SHA-256, `@wap/db`, `@wap/dsl`, and built `@wap/engine`.

**Spec:** `docs/superpowers/specs/2026-09-13-filesystem-g1-design.md`, `docs/BASELINE.md`, `docs/EXECUTION-CONTRACT.md`, `docs/antigravity/filesystem-handoff-baseline.json`, and FS-01–FS-05 reports under `docs/task-hub-evidence/batch-02/`.

## Global Constraints

- Keep the selected B/local scope: local `task_hub` plus the reviewed filesystem adapter; no GitHub, SaaS, HTTP/session/UI, polling, BullMQ, LLM, retrieval, or replan implementation is introduced by FS-06.
- Preserve migrations `0001` through `0004` and every protected hash listed by `filesystem-handoff-baseline.json` (the baseline records 180 protected files); report any mismatch as a failure.
- Do not rewrite dated `docs/G1-STATUS-2026-09-13.md`, `docs/ENGINE-STATUS-2026-09-13.md`, `docs/TASK-HUB-STATUS-2026-09-13.md`, historical `docs/engine-evidence/2026-09-13/`, or any `batch-01` evidence.
- Use only fresh isolated `fs06_it_*` databases and `ati-fs06-*` roots for snapshot/verification; never migrate, seed, write, or reset the persistent `wap_g1` demo while collecting FS-06 evidence.
- Keep dispatch markers separate from `hub_receipts`; preserve `unknown`, `reconciliation_required`, and `not_supported` semantics. Do not infer success from a file hash alone.
- Do not add dependencies, change package versions, alter schemas/policies/catalog contracts, or add a runtime fault-injection switch. Do not expose database URLs, passwords, tokens, or environment contents in logs.
- Work in the existing dirty checkout because it contains the authoritative uncommitted FS-01–FS-05 state; do not create a worktree, stage, commit, reset, checkout, clean, switch branches, or push.
- Run external commands sequentially. Every captured command records its own start/end time, exit code, signal/spawn error, and fresh evidence directory. Retrospective timestamps are marked with their provenance or `null`.
- A missing official rubric or missing representative group-work measurement remains `OPEN`; it cannot be replaced by a self-authored score or technical checklist. The final verdict may be `TECHNICAL_PASS_OVERALL_PARTIAL`, never unconditional `G1_PASS`, when those inputs are absent.

---

### Task 1: Scope, protected hashes, and provenance audit

**Files:**
- Create: `scripts/fs06-scope-audit.mjs`
- Create: `.superpowers/sdd/2026-09-14-fs-06-finalization/task-1-report.md`
- Create: fresh `docs/task-hub-evidence/batch-02/FS-06/<timestamp>-scope-audit/` through `scripts/capture-command.mjs`

**Interfaces:**
- The script reads `docs/antigravity/filesystem-handoff-baseline.json` and writes `scope-audit.json` below `ATI_EVIDENCE_DIR` (or a unique FS-06 directory when run directly).
- Its JSON result has `status`, `recorded_at`, `git_head`, `working_tree_paths`, `source_sha256` with `expected`/`actual`/`changed`, `protected_sha256` with `expected`/`actual`/`mismatches`, `protected_count`, `migration_files`, `migration_checksums`, and `credential_scan`.
- Exit code is `0` only when every protected hash matches, all five migration files `0001`–`0005` parse and hash, and the credential scan finds no secret-looking value in the produced JSON; source drift is reported for later explanation rather than hidden.

- [ ] **Step 1: Write the failing audit test/fixture**

Create a script-level check that loads the baseline, intentionally exercises the real current checkout, and asserts the output contains the exact protected count, all five migration names, and every current status path. The check must fail if a protected file is absent or mismatched and must not fail merely because an FS-01–FS-05 source file differs from the old baseline.

- [ ] **Step 2: Run the audit and record RED/diagnostic evidence**

Run:

```powershell
node scripts/capture-command.mjs FS-06 scope-audit node scripts/fs06-scope-audit.mjs
```

Record the command JSON, output log, and `scope-audit.json`. If a real protected mismatch appears, stop this task and record the exact path/hash rather than weakening the check.

- [ ] **Step 3: Implement the minimal scope/provenance audit**

Hash files with `createHash("sha256")`, normalize paths to `/`, sort lists deterministically, read `git rev-parse HEAD` and `git status --short`, and scan only the generated JSON for credential patterns. Do not rewrite any baseline or historical artifact.

- [ ] **Step 4: Run GREEN and verify the audit output**

The captured command must exit `0`; `protected_mismatches` must be `[]`, `protected_count` must be `180`, and `migration_files` must contain exactly `0001_init.sql`, `0002_audit_contracts.sql`, `0003_task_hub_local.sql`, `0004_task_hub_cards.sql`, and `0005_filesystem_dispatches.sql`. Save the actual result in the Task 1 report.

- [ ] **Step 5: Self-review provenance boundaries**

Confirm the script never treats a changed baseline source hash as a protected-file failure, never logs credentials, and never mutates repository files other than its new evidence directory.

### Task 2: Fresh clean install and final regression gate

**Files:**
- Create: fresh `docs/task-hub-evidence/batch-02/FS-06/<timestamp>-npm-ci/` and `<timestamp>-final-check/` directories through `scripts/capture-command.mjs`
- Create: `.superpowers/sdd/2026-09-14-fs-06-finalization/task-2-report.md`

**Interfaces:**
- Resolve `node.exe` and `npm-cli.js` from `Get-Command node` / `Get-Command npm` without printing environment secrets.
- Capture `npm ci --ignore-scripts --no-audit --no-fund` first, then capture `npm run check:engine`; do not start the second process until the first exit code is `0`.
- The final report parses counts from the fresh `output.log` and records `npm_ci_exit`, `final_check_exit`, per-suite counts, skip names if printed, and the exact evidence paths. It never copies historical totals.

- [ ] **Step 1: Capture a clean install in the current checkout**

Run through the capture runner:

```powershell
$nodeExe = (Get-Command node).Source
$npmCli = (Get-Command npm).Source
node scripts/capture-command.mjs FS-06 npm-ci $nodeExe $npmCli ci --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Fresh install failed' }
```

The install may replace ignored `node_modules`; it must not rewrite `package-lock.json` or any historical evidence file.

- [ ] **Step 2: Capture the final gate after install succeeds**

```powershell
node scripts/capture-command.mjs FS-06 final-check $nodeExe $npmCli run check:engine
if ($LASTEXITCODE -ne 0) { throw 'Final gate failed' }
```

Record actual `command.json` and `output.log`; do not report “pass” from a prior FS-05 capture.

- [ ] **Step 3: Parse and cross-check the fresh totals**

Extract the DSL, engine unit, task_hub/DB integration, and engine integration summaries from `output.log`. Assert the arithmetic sum of passed/skipped tests equals the printed suite totals and distinguish the capability-dependent P11 symlink skip from failures. Preserve any nonzero result as `TECHNICAL_FAILED`.

- [ ] **Step 4: Self-review install side effects**

Check `git status --short` for unintended tracked changes. If the gate regenerated historical observations, restore only those exact files after recording that the direct command caused them; do not remove user-authored FS-06 evidence.

### Task 3: Isolated two-server runtime snapshot

**Files:**
- Create: `scripts/fs06-final-snapshot.mjs`
- Create: `.superpowers/sdd/2026-09-14-fs-06-finalization/task-3-report.md`
- Create: fresh `docs/task-hub-evidence/batch-02/FS-06/<timestamp>-final-snapshot/` through `scripts/capture-command.mjs`

**Interfaces:**
- The script takes no positional secrets. It uses `G1_DATABASE_URL` or the existing loopback default only to create/drop a fresh database named `fs06_it_<32 lowercase hex>`, and uses a generated principal UUID and `fs.mkdtemp(path.join(os.tmpdir(), "ati-fs06-"))` root.
- It imports `migrate`, `seedDemo`, and `openDatabase` from `@wap/db`; `Client`/`StdioClientTransport` from the MCP SDK; and built `openLocalGateway`/`loadFilesystemLaunch` contracts from `@wap/engine` only where their signatures support an isolated root.
- `final-snapshot.json` contains `status`, `recorded_at`, `node`, `principal`, `database` (name/server version, no password), `migrations` (five names/checksums), `roots` (canonical path, marker root/user IDs, dev/ino when available), `servers` (task_hub/filesystem identities and launch command basename), `raw_discovery` (paginated names/schemas/counts), `normalized_catalog` (exactly 10 reviewed tools), `read_oracles` (four task_hub reads plus raw filesystem `read_text_file` exact content), `dependency_fingerprints`, and `cleanup` (`db_dropped`, `root_removed`, client/gateway close errors).

- [ ] **Step 1: Write failing assertions for isolation and oracles**

Before implementation, assert that the snapshot refuses a non-fresh DB/root, requires exactly five migration rows, requires task_hub raw discovery to contain 8 names and filesystem raw discovery to contain 14 names including `read_text_file`/`write_file`, requires a normalized catalog of 8 `task_hub` + 2 `filesystem` tools, and requires the exact seeded values `Progress!A1:B2 = [["API","Done"],["UI","Doing"]]`, card `c1` title `Viết API`, and filesystem text `Tiến độ ATI\nAPI: Done\n`.

- [ ] **Step 2: Implement isolated DB/root setup and real MCP clients**

Create the database with an admin connection, run the real five migrations and `seedDemo`, create `.ati-root.json`, `notes.txt`, and `reports/` inside the generated root, then launch one direct task_hub MCP client and one direct upstream filesystem MCP client. Paginate `tools/list` with cursor-loop detection and call only the four task_hub reads plus one filesystem read; do not write to either receiver.

- [ ] **Step 3: Capture the reviewed normalized catalog and fingerprints**

Open a trusted composite gateway against the same isolated DB/root, assert `gateway.tools.length === 10`, assert the server/name set exactly equals the eight task_hub contracts plus `filesystem.read_file` and `filesystem.write_file`, and save the full normalized schema objects. Hash the reviewed policy, preset, catalog, built runtime files, five migration files, and installed filesystem dependency closure.

- [ ] **Step 4: Guarantee cleanup and write evidence on failure**

Close clients/transports/gateway and DB handles in nested `finally` blocks, drop only the generated database with `WITH (FORCE)`, remove only the generated temp root after validating its `ati-fs06-` basename, and write a failure JSON with the cleanup booleans before exiting nonzero if any oracle fails.

- [ ] **Step 5: Run GREEN and review raw-vs-normalized boundaries**

Run:

```powershell
node scripts/capture-command.mjs FS-06 final-snapshot node scripts/fs06-final-snapshot.mjs
```

Require exit `0`, `status: "PASS"`, five migrations, two server identities, raw filesystem count `14`, normalized count `10`, all five read oracles, and `cleanup.db_dropped === true` plus `cleanup.root_removed === true`.

### Task 4: Final manifest and source-change register

**Files:**
- Create: `scripts/fs06-manifest.mjs`
- Create: `docs/G1-FILESYSTEM-STATUS-2026-09-13.md` with the source-change register consumed here
- Create: `.superpowers/sdd/2026-09-14-fs-06-finalization/task-4-report.md`
- Create: fresh `docs/task-hub-evidence/batch-02/FS-06/<timestamp>-manifest/manifest.json`

**Interfaces:**
- The manifest reads Task 1–3 artifacts, FS-01–FS-05 reports, `filesystem-handoff-baseline.json`, `package.json`, `package-lock.json`, `testdata/tools.json`, `testdata/test-cases.json`, `testdata/experiment-manifest.json`, config/policy files, and the fresh final-check/snapshot logs.
- `manifest.json` has exactly these top-level groups: `status`, `recorded_at`, `git` (`head`, `working_tree_paths`), `scope` (`profile`, `servers`, `public_tool_count`, `source_change_register`), `protected_files` (`count`, `mismatches`), `migrations` (`names`, `checksums`), `runtime` (`node`, `npm`, `dependencies`, `installed_byte_fingerprints`), `catalog` (`sha256`, `tool_names`, `server_mode_map`), `dataset` (`sha256`, `split`, `holdout_untuned`), `evidence` (`fs01` through `fs06` paths and statuses), `rubric` (`source_status`, `open_items`), and `verdict` (`technical`, `overall`, `reason`), with deterministic sorted arrays.
- The source-change register explains every changed original source/config/test file relative to the baseline with `path`, `reason`, `task`, `evidence`, and `status`; no file may be silently omitted or labeled “unchanged” when its hash differs.

- [ ] **Step 1: Write the manifest contract check**

Create a fixture that rejects missing evidence paths, protected mismatches, a tool catalog other than 10, an unlisted changed baseline file, a dataset holdout marked tuned, or a verdict that says `G1_PASS` while rubric source or representative work is `OPEN`.

- [ ] **Step 2: Implement deterministic manifest assembly**

Hash bytes with SHA-256, parse command JSON rather than trusting prose, preserve each command’s `exit_code`/timestamps/signal, parse suite totals from the final output, and record `null` for timing that cannot be measured retrospectively. Keep filesystem markers and task_hub receipts in separate evidence fields.

- [ ] **Step 3: Derive the conditional verdict**

Use this exact decision table:

| Technical matrix | Rubric/work input | Manifest verdict |
|---|---|---|
| Required case failed | any | `TECHNICAL_FAILED`, overall `PARTIAL` |
| Required native safety/fault case not run | any | `TECHNICAL_PARTIAL`, overall `PARTIAL` |
| All required checks pass | rubric source or representative work missing | `TECHNICAL_PASS_OVERALL_PARTIAL`, overall `PARTIAL` |
| All checks pass | authoritative rubric reviewed and representative work confirmed | `G1_PASS` |
| All checks pass | applicable rubric criterion unresolved | `PARTIAL_WITH_GAPS` |

- [ ] **Step 4: Run GREEN and inspect every manifest group**

The manifest command must exit `0`; every evidence path must resolve; protected mismatches must be empty; catalog must list 10 tools; dataset split must remain 6 dev / 4 holdout; and the report must disclose all OPEN/NOT_RUN items.

### Task 5: Status, rubric map, manual guide, and current documentation

**Files:**
- Create: `docs/G1-RUBRIC-MAP.md`
- Modify: `docs/G1-FILESYSTEM-STATUS-2026-09-13.md` created by Task 4
- Modify: current `README.md`, `docs/00-BAT-DAU.md`, `docs/BASELINE.md`, `docs/KE-HOACH-6-TUAN.md`, `docs/EXECUTION-CONTRACT.md`, `docs/EVALUATION.md`, `db/DATABASE.md`, `apps/mcp-task-hub/README.md`, `packages/engine/README.md`, and `testdata/TESTDATA.md` only where current status contradicts verified FS-05/FS-06 evidence
- Create: `.superpowers/sdd/2026-09-14-fs-06-finalization/task-5-report.md`

**Interfaces:**
- `docs/G1-RUBRIC-MAP.md` must use columns `source`, `source_status`, `criterion_quote_or_paraphrase`, `G1_applicability`, `evidence`, `status`, and `gap/next_batch`.
- The manual guide must parse nested `prepare` fields (`run_id`, `approval.id`, `workflow_version_id`, `approval.snapshot_hash`), pause before approval, use `G1_FILESYSTEM_ENABLED=1`, call `preview`, `approve`, `execute`, `trace`, and `reconcile`, and remove the environment variable in a `finally`-equivalent cleanup block. It must say the guide is user-authorized and must not be run during evidence capture.
- The current docs must say FS-05 is technical PASS with 258 passed/1 skipped fresh gate, filesystem is two public tools, and G1 overall is conditional/partial because rubric, representative work, HTTP/UI/polling, and AI evaluation are not proven. Dated historical reports remain untouched.

- [ ] **Step 1: Write the rubric map with provenance labels**

Add rows for the absent official rubric (`source_status: OPEN`, no invented quote), the user-selected B/local baseline (`USER_PROVIDED`), each technical FS-01–FS-05 gate (`INSPECTED_REPO`), and representative group work (`OPEN`). Every row names evidence paths and a next batch or action.

- [ ] **Step 2: Write the status and executable manual guide**

Document confirmed runtime facts, technical limits, marker/receipt distinction, P11 skip, cleanup behavior, and the exact PowerShell command sequence from the FS-G1 plan. Include root path derivation and overwrite behavior; do not promise rollback or exactly-once arbitrary MCP writes.

- [ ] **Step 3: Update only current status prose**

Use the source-change register to update stale statements such as “filesystem SPEC_ONLY,” “E08 NOT_RUN,” and the old 142/254 totals in current docs. Preserve statements that are explicitly historical or outside FS-06 scope. Do not claim HTTP/session/UI/LLM/polling exists.

- [ ] **Step 4: Self-review manual commands and links**

Check each command against actual package scripts/CLI usage and ensure links target existing current or evidence files. Keep external source links labeled as references, not local verification.

### Task 6: Documentation/plan validation checker and final FS-06 report

**Files:**
- Create: `scripts/fs06-docs-check.mjs`
- Create: `docs/task-hub-evidence/batch-02/FS-06/FS-06.md`
- Modify: FS-06 checkbox/status section of `docs/superpowers/plans/2026-09-13-filesystem-g1-completion.md`
- Create: `.superpowers/sdd/2026-09-14-fs-06-finalization/task-6-report.md`
- Create: fresh `docs/task-hub-evidence/batch-02/FS-06/<timestamp>-docs-check/` through `scripts/capture-command.mjs`

**Interfaces:**
- `scripts/fs06-docs-check.mjs` writes `docs-check.json` with `status`, `recorded_at`, `markdown_files`, `broken_local_links`, `fenced_link_exclusions`, `powerShell_commands`, `npm_script_checks`, `cli_argument_checks`, `plan_validation`, and `manifest_links`.
- Markdown link checking ignores only fenced code blocks and external `http(s)` links; a broken local link is a failure. PowerShell checks verify every `npm run <script>` exists in `package.json`, and CLI checks verify every documented engine command is in `packages/engine/src/cli.ts` help/counts.
- Plan validation loads all `testdata/dev-hand-plans/*.json`, parses each with `WorkflowPlanSchema`, and calls `validatePlanTools` with the 10 trusted tools from `testdata/tools.json`; all must return `ok: true` without mutating files or data.
- `FS-06.md` links the scope audit, npm-ci/final-check, snapshot, manifest, docs-check, FS-01–FS-05 reports, rubric map, and manual guide, and reports technical/overall verdicts separately.

- [ ] **Step 1: Write failing checker cases**

Create fixtures for a missing local Markdown link, an unknown npm script, an invalid CLI command, and a plan with a tool absent from the 10-tool registry; each must produce a structured failure rather than silently pass.

- [ ] **Step 2: Implement read-only checker and run it**

```powershell
node scripts/capture-command.mjs FS-06 docs-check node scripts/fs06-docs-check.mjs
```

Require exit `0`, zero broken current local links, zero unknown documented scripts/CLI commands, all dev hand plans valid against the 10-tool catalog, and every manifest/evidence link resolvable.

- [ ] **Step 3: Write the final FS-06 report and update plan checkboxes**

Record actual command paths, counts, hashes, snapshot cleanup, protected-file result, rubric `OPEN` rows, manual-demo boundary, and the exact conditional verdict. Tick only FS-06 steps backed by evidence; leave future API/UI/AI work outside this completion.

- [ ] **Step 4: Freeze and self-review**

Run scoped `git diff --check`, parse every JSON artifact, verify all relative links, compare the final manifest’s verdict with `FS-06.md`, and confirm no dated report/batch-01 file changed. Stop after the report; do not start another batch or commit.

## Self-Review

- Spec coverage: Tasks 1–3 provide source/migration/install/runtime proof; Task 4 provides byte/process manifest and verdict derivation; Task 5 provides provenance-aware rubric/manual/current docs; Task 6 validates links/contracts and freezes the final report.
- Placeholder scan: no `TBD`, `TODO`, or deferred implementation instruction is used as a substitute for a required action; missing rubric/work evidence is represented explicitly as `OPEN`.
- Interface consistency: `ATI_EVIDENCE_DIR`, `scope-audit.json`, `final-snapshot.json`, `manifest.json`, and `docs-check.json` are the named handoff artifacts consumed by later tasks; the normalized catalog has exactly 10 tools and the five migration names are fixed in Tasks 1 and 3.
- Preservation check: the plan names every dated/batch-01 path that must remain untouched and requires the final task to check that claim against Git state.
