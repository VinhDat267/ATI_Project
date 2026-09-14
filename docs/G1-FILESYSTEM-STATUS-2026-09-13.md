# G1 filesystem status and user-authorized manual guide

## Current verdict

FS-05 is **TECHNICAL PASS**: E01–E14 passed against real PostgreSQL 16 and two
MCP stdio processes in isolated fixtures. The authoritative FS-06 fresh gate
reports **258 passed and 1 capability-dependent skipped test**; the skip is the
P11 native file-symlink case on this Windows host, outside E01–E14. The isolated
snapshot reports PASS, exactly 8 public `task_hub` tools plus 2 public
`filesystem` tools, and `db_dropped: true` / `root_removed: true` cleanup.

The derived verdict is `TECHNICAL_PASS_OVERALL_PARTIAL`, overall **PARTIAL**.
The [rubric map](G1-RUBRIC-MAP.md) keeps the official rubric and representative
group work `OPEN`; HTTP/session/UI, 2-second polling and AI evaluation are
`NOT_RUN`. No current evidence proves those layers.

Evidence: [FS-05 report](task-hub-evidence/batch-02/FS-05/FS-05.md), [fresh
FS-06 final gate](task-hub-evidence/batch-02/FS-06/1789384630165-final-check/output.log),
[isolated snapshot](task-hub-evidence/batch-02/FS-06/1789385689123-final-snapshot/final-snapshot.json),
and [deterministic manifest](task-hub-evidence/batch-02/FS-06/1789386912283-manifest/manifest.json).

## Manual demo guide

This guide is only for a **user-authorized** write demo against the persistent
local demo DB/root. Do not run it during FS-06 evidence capture. It changes the
demo filesystem and local `task_hub` data; the evidence captures use isolated
generated DBs/roots and do not use this guide.

Run from the project root in PowerShell. The explicit pause occurs after the
saved preview is displayed and before approval. All four nested identity fields
come from the actual `prepare` JSON; none is flattened or invented.

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run db:up:g1
npm run db:migrate:g1
npm run db:seed:g1
npm run fs:demo:setup

try {
  $env:G1_FILESYSTEM_ENABLED = '1'

  $raw = node packages/engine/dist/cli.js prepare testdata/dev-hand-plans/fs-copy-notify.json
  if ($LASTEXITCODE -ne 0) { throw 'Prepare failed; do not approve.' }
  $prep = ($raw -join "`n") | ConvertFrom-Json
  $runId = $prep.run_id
  $approvalId = $prep.approval.id
  $versionId = $prep.workflow_version_id
  $snapshotHash = $prep.approval.snapshot_hash

  node packages/engine/dist/cli.js preview $runId
  if ($LASTEXITCODE -ne 0) { throw 'Preview failed; do not approve.' }
  $decision = Read-Host 'PAUSE: inspect reports/notes-copy.txt, exact content, and #team action in the preview. Type APPROVE to continue'
  if ($decision -cne 'APPROVE') { throw 'Approval was not granted.' }

  node packages/engine/dist/cli.js approve $runId $approvalId $versionId $snapshotHash
  if ($LASTEXITCODE -ne 0) { throw 'Approval failed.' }
  node packages/engine/dist/cli.js execute $runId
  if ($LASTEXITCODE -ne 0) { throw 'Execution failed; inspect trace and reconcile.' }
  node packages/engine/dist/cli.js trace $runId
  node packages/engine/dist/cli.js reconcile $runId
} finally {
  Remove-Item Env:G1_FILESYSTEM_ENABLED -ErrorAction SilentlyContinue
}
```

With the default demo principal, the trusted root is derived as
`<project-root>/runtime/filesystem/00000000-0000-4000-8000-000000000001`.
When a trusted launcher supplies `G1_USER_ID`, the final segment is that UUID;
the plan cannot override the principal, root or server executable.
`fs:demo:setup` preserves an existing valid `.ati-root.json`, `notes.txt` and
`reports/`, and creates only missing entries. `filesystem.write_file` creates
or replaces the approved regular file with the approved UTF-8 bytes; its parent
must already exist. It does not compare the previous file contents, and a
repeated demo is a new approved run/operation that may overwrite the file.

Before an upstream filesystem write packet, PostgreSQL stores a durable
`filesystem_dispatches` marker. That marker is a reservation boundary, not a
receipt and not proof that bytes reached disk. `task_hub` receipts are separate
and are committed atomically with their local receiver mutations. Filesystem
reconciliation therefore reports marker presence with receipt `not_supported`
and does not infer confirmed success from current file bytes. A timeout, lost
response or crash after dispatch can remain `unknown` /
`reconciliation_required`; there is no automatic rollback, blind retry, or
exactly-once promise for arbitrary MCP writes.

The `finally` block removes only the process environment switch. It does not
delete the persistent root, undo a file write, reset seeded data or stop the
database. Seed and root setup preserve existing demo edits. The isolated FS-06
snapshot, separately, created and removed only its generated DB/root and
recorded successful cleanup in its evidence.

## Source-change register relative to the filesystem handoff baseline

The register covers every original source, configuration, migration, and test
path whose bytes differ from, or whose path was added after,
`docs/antigravity/filesystem-handoff-baseline.json`. Paths are sorted. `MODIFIED_FROM_BASELINE`
means the baseline recorded an older SHA-256; `ADDED_AFTER_BASELINE` means the
baseline had no source-hash entry for the path. No row is labeled unchanged.

<!-- SOURCE_CHANGE_REGISTER_BEGIN -->
```json
[
  {
    "path": "apps/mcp-task-hub/tests/database.integration.test.ts",
    "reason": "Extends database integration coverage for the fifth filesystem-dispatch migration.",
    "task": "FS-04",
    "evidence": "docs/task-hub-evidence/batch-02/FS-04/FS-04.md",
    "status": "MODIFIED_FROM_BASELINE"
  },
  {
    "path": "config/filesystem-reviewed.json",
    "reason": "Records the reviewed pinned filesystem artifact, raw schemas, and dependency fingerprints.",
    "task": "FS-03",
    "evidence": "docs/task-hub-evidence/batch-02/FS-03/FS-03.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "config/mcp-presets.json",
    "reason": "Adds the approved local filesystem launch preset and two reviewed public tools.",
    "task": "FS-03 / FS-04",
    "evidence": "docs/task-hub-evidence/batch-02/FS-04/FS-04.md",
    "status": "MODIFIED_FROM_BASELINE"
  },
  {
    "path": "db/migrations/0005_filesystem_dispatches.sql",
    "reason": "Adds the durable filesystem dispatch-reservation ledger used before non-idempotent writes.",
    "task": "FS-04",
    "evidence": "docs/task-hub-evidence/batch-02/FS-04/FS-04.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "package-lock.json",
    "reason": "Pins the reviewed filesystem server and its resolved dependency closure.",
    "task": "FS-01",
    "evidence": "docs/task-hub-evidence/batch-02/FS-01/FS-01.md",
    "status": "MODIFIED_FROM_BASELINE"
  },
  {
    "path": "package.json",
    "reason": "Adds the preserving filesystem demo-root setup command to the workspace scripts.",
    "task": "FS-03",
    "evidence": "docs/task-hub-evidence/batch-02/FS-03/FS-03.md",
    "status": "MODIFIED_FROM_BASELINE"
  },
  {
    "path": "packages/db/src/schema.ts",
    "reason": "Maps the filesystem dispatch-reservation table added by migration 0005.",
    "task": "FS-04",
    "evidence": "docs/task-hub-evidence/batch-02/FS-04/FS-04.md",
    "status": "MODIFIED_FROM_BASELINE"
  },
  {
    "path": "packages/engine/package.json",
    "reason": "Declares the pinned filesystem MCP server runtime dependency and unit-suite command.",
    "task": "FS-01",
    "evidence": "docs/task-hub-evidence/batch-02/FS-01/FS-01.md",
    "status": "MODIFIED_FROM_BASELINE"
  },
  {
    "path": "packages/engine/src/attempts.ts",
    "reason": "Separates before-dispatch failures from unknown outcomes after filesystem dispatch.",
    "task": "FS-02 / FS-04",
    "evidence": "docs/task-hub-evidence/batch-02/FS-04/FS-04.md",
    "status": "MODIFIED_FROM_BASELINE"
  },
  {
    "path": "packages/engine/src/cli.ts",
    "reason": "Supports the reviewed two-server controller flow and filesystem-enabled CLI operations.",
    "task": "FS-05",
    "evidence": "docs/task-hub-evidence/batch-02/FS-05/FS-05.md",
    "status": "MODIFIED_FROM_BASELINE"
  },
  {
    "path": "packages/engine/src/execute.ts",
    "reason": "Rechecks trusted receiver mode and filesystem authorization before execution.",
    "task": "FS-02 / FS-04",
    "evidence": "docs/task-hub-evidence/batch-02/FS-04/FS-04.md",
    "status": "MODIFIED_FROM_BASELINE"
  },
  {
    "path": "packages/engine/src/filesystem-authorization.ts",
    "reason": "Implements approval, operation, worker-lease, payload, and dispatch-marker authorization for filesystem writes.",
    "task": "FS-03 / FS-04",
    "evidence": "docs/task-hub-evidence/batch-02/FS-04/FS-04.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "packages/engine/src/filesystem-paths.ts",
    "reason": "Implements root confinement, marker validation, bounded UTF-8 reads, and link protections.",
    "task": "FS-01",
    "evidence": "docs/task-hub-evidence/batch-02/FS-01/FS-01.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "packages/engine/src/gateway-filesystem.ts",
    "reason": "Adds the reviewed filesystem MCP adapter, response normalization, and two public tool mappings.",
    "task": "FS-03 / FS-04",
    "evidence": "docs/task-hub-evidence/batch-02/FS-04/FS-04.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "packages/engine/src/gateway-task-hub.ts",
    "reason": "Extracts the existing task_hub connector behind the server-qualified gateway contract.",
    "task": "FS-02",
    "evidence": "docs/task-hub-evidence/batch-02/FS-02/FS-02.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "packages/engine/src/gateway-types.ts",
    "reason": "Defines server-qualified gateway targets and internal worker call context.",
    "task": "FS-02",
    "evidence": "docs/task-hub-evidence/batch-02/FS-02/FS-02.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "packages/engine/src/gateway.ts",
    "reason": "Composes task_hub and filesystem connections with fail-closed routing and all-settled cleanup.",
    "task": "FS-02 / FS-03 / FS-04",
    "evidence": "docs/task-hub-evidence/batch-02/FS-04/FS-04.md",
    "status": "MODIFIED_FROM_BASELINE"
  },
  {
    "path": "packages/engine/src/index.ts",
    "reason": "Exports the server-qualified gateway, filesystem launch, and authorization contracts.",
    "task": "FS-02 / FS-03 / FS-04",
    "evidence": "docs/task-hub-evidence/batch-02/FS-04/FS-04.md",
    "status": "MODIFIED_FROM_BASELINE"
  },
  {
    "path": "packages/engine/src/launch-policy.ts",
    "reason": "Validates pinned artifact bytes and derives the approved principal filesystem root.",
    "task": "FS-01 / FS-03",
    "evidence": "docs/task-hub-evidence/batch-02/FS-03/FS-03.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "packages/engine/src/prepare.ts",
    "reason": "Captures trusted receiver modes and filesystem authorization inputs in the approved snapshot.",
    "task": "FS-02 / FS-04",
    "evidence": "docs/task-hub-evidence/batch-02/FS-04/FS-04.md",
    "status": "MODIFIED_FROM_BASELINE"
  },
  {
    "path": "packages/engine/src/receiver-policy.ts",
    "reason": "Defines the closed receiver-mode mapping for task_hub and filesystem tools.",
    "task": "FS-02",
    "evidence": "docs/task-hub-evidence/batch-02/FS-02/FS-02.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "packages/engine/src/recovery.ts",
    "reason": "Reconciles filesystem dispatch markers separately from task_hub receipts without replaying unknown writes.",
    "task": "FS-02 / FS-04",
    "evidence": "docs/task-hub-evidence/batch-02/FS-04/FS-04.md",
    "status": "MODIFIED_FROM_BASELINE"
  },
  {
    "path": "packages/engine/src/snapshot.ts",
    "reason": "Preserves snapshot-v1 compatibility while validating server-qualified tool and receiver metadata.",
    "task": "FS-02",
    "evidence": "docs/task-hub-evidence/batch-02/FS-02/FS-02.md",
    "status": "MODIFIED_FROM_BASELINE"
  },
  {
    "path": "packages/engine/tests/artifact-validation.test.ts",
    "reason": "Tests exact artifact file sets, hashes, probe provenance, and required raw schemas.",
    "task": "FS-01",
    "evidence": "docs/task-hub-evidence/batch-02/FS-01/FS-01.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "packages/engine/tests/filesystem-adapter.test.ts",
    "reason": "Tests strict filesystem MCP response normalization and fail-closed adapter behavior.",
    "task": "FS-03 / FS-04",
    "evidence": "docs/task-hub-evidence/batch-02/FS-04/FS-04.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "packages/engine/tests/filesystem-controller.integration.test.ts",
    "reason": "Covers the E01-E14 two-server controller and post-dispatch fault matrix.",
    "task": "FS-05",
    "evidence": "docs/task-hub-evidence/batch-02/FS-05/FS-05.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "packages/engine/tests/filesystem-crash-worker.mjs",
    "reason": "Provides the child-process crash-after-filesystem-write fixture for E07.",
    "task": "FS-05",
    "evidence": "docs/task-hub-evidence/batch-02/FS-05/FS-05.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "packages/engine/tests/filesystem-fixture.ts",
    "reason": "Creates and cleans isolated filesystem roots and two-server integration fixtures.",
    "task": "FS-03 / FS-04 / FS-05",
    "evidence": "docs/task-hub-evidence/batch-02/FS-05/FS-05.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "packages/engine/tests/filesystem-launch-policy.test.ts",
    "reason": "Tests reviewed preset, artifact, flag, root, and marker launch-policy failures.",
    "task": "FS-03",
    "evidence": "docs/task-hub-evidence/batch-02/FS-03/FS-03.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "packages/engine/tests/filesystem-marker-crash-worker.mjs",
    "reason": "Provides the crash-after-durable-marker and before-upstream-write fixture for E08.",
    "task": "FS-05",
    "evidence": "docs/task-hub-evidence/batch-02/FS-05/FS-05.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "packages/engine/tests/filesystem-paths.test.ts",
    "reason": "Tests traversal, links, root markers, payload limits, and strict UTF-8 confinement rules.",
    "task": "FS-01",
    "evidence": "docs/task-hub-evidence/batch-02/FS-01/FS-01.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "packages/engine/tests/filesystem-raw-fault-worker.mjs",
    "reason": "Injects post-dispatch raw error and malformed acknowledgement responses for E10.",
    "task": "FS-05",
    "evidence": "docs/task-hub-evidence/batch-02/FS-05/FS-05.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "packages/engine/tests/filesystem-read.integration.test.ts",
    "reason": "Runs real two-server read integration with exact UTF-8 and confinement oracles.",
    "task": "FS-03",
    "evidence": "docs/task-hub-evidence/batch-02/FS-03/FS-03.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "packages/engine/tests/filesystem-write.integration.test.ts",
    "reason": "Runs real approved filesystem writes, dispatch reservations, and read-back checks.",
    "task": "FS-04",
    "evidence": "docs/task-hub-evidence/batch-02/FS-04/FS-04.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "packages/engine/tests/gateway-routing.test.ts",
    "reason": "Tests exact server-qualified routing, duplicate names, and multi-connection cleanup.",
    "task": "FS-02",
    "evidence": "docs/task-hub-evidence/batch-02/FS-02/FS-02.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "packages/engine/tests/receiver-policy.test.ts",
    "reason": "Tests the closed trusted receiver-mode map and fail-closed policy drift handling.",
    "task": "FS-02",
    "evidence": "docs/task-hub-evidence/batch-02/FS-02/FS-02.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "packages/engine/tests/snapshot-compatibility.test.ts",
    "reason": "Proves protected task_hub-only snapshots remain readable and hash-stable.",
    "task": "FS-02 / FS-05",
    "evidence": "docs/task-hub-evidence/batch-02/FS-05/FS-05.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "packages/engine/vitest.unit.config.ts",
    "reason": "Defines the independent engine unit suite used by the FS gates.",
    "task": "FS-01",
    "evidence": "docs/task-hub-evidence/batch-02/FS-01/FS-01.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "scripts/capture-command.mjs",
    "reason": "Captures immutable command arguments, UTC timestamps, exit code, signal, output, and evidence directory.",
    "task": "FS-01",
    "evidence": "docs/task-hub-evidence/batch-02/FS-01/FS-01.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "scripts/check-engine.mjs",
    "reason": "Adds the independent engine unit suite to the full regression gate.",
    "task": "FS-01",
    "evidence": "docs/task-hub-evidence/batch-02/FS-01/FS-01.md",
    "status": "MODIFIED_FROM_BASELINE"
  },
  {
    "path": "scripts/emit-candidate-artifact.d.mts",
    "reason": "Declares the candidate-artifact validation helper contract for typed tests.",
    "task": "FS-01",
    "evidence": "docs/task-hub-evidence/batch-02/FS-01/FS-01.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "scripts/emit-candidate-artifact.mjs",
    "reason": "Builds the reviewed candidate artifact from an explicit fresh probe with exact-set validation.",
    "task": "FS-01",
    "evidence": "docs/task-hub-evidence/batch-02/FS-01/FS-01.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "scripts/fs06-final-snapshot.mjs",
    "reason": "Captures the isolated two-server runtime, read oracles, fingerprints, and cleanup result.",
    "task": "FS-06 Task 3",
    "evidence": ".superpowers/sdd/2026-09-14-fs-06-finalization/task-3-report.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "scripts/fs06-manifest.mjs",
    "reason": "Assembles and validates the deterministic FS-06 manifest and conditional verdict.",
    "task": "FS-06 Task 4",
    "evidence": ".superpowers/sdd/2026-09-14-fs-06-finalization/task-4-brief.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "scripts/fs06-scope-audit.mjs",
    "reason": "Audits protected bytes, source drift, migration checksums, PostgreSQL apply, and credential findings.",
    "task": "FS-06 Task 1",
    "evidence": ".superpowers/sdd/2026-09-14-fs-06-finalization/task-1-report.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "scripts/prepare-filesystem-demo.mjs",
    "reason": "Creates the approved principal root and preserves its marker and fixture on rerun.",
    "task": "FS-03",
    "evidence": "docs/task-hub-evidence/batch-02/FS-03/FS-03.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "scripts/probe-filesystem-candidate.mjs",
    "reason": "Performs fresh raw filesystem MCP discovery, schema checks, UTF-8 read, and cleanup.",
    "task": "FS-01",
    "evidence": "docs/task-hub-evidence/batch-02/FS-01/FS-01.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "testdata/dev-hand-plans/fs-card-export.json",
    "reason": "Adds the reviewed task_hub-card to filesystem export and local notification controller plan.",
    "task": "FS-05",
    "evidence": "docs/task-hub-evidence/batch-02/FS-05/FS-05.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "testdata/dev-hand-plans/fs-copy-notify.json",
    "reason": "Adds the reviewed filesystem read/write plus task_hub notification controller plan.",
    "task": "FS-05",
    "evidence": "docs/task-hub-evidence/batch-02/FS-05/FS-05.md",
    "status": "ADDED_AFTER_BASELINE"
  },
  {
    "path": "testdata/tools.json",
    "reason": "Promotes the two reviewed filesystem mappings into the 10-tool B/local catalog.",
    "task": "FS-03 / FS-04",
    "evidence": "docs/task-hub-evidence/batch-02/FS-04/FS-04.md",
    "status": "MODIFIED_FROM_BASELINE"
  },
  {
    "path": "tsconfig.json",
    "reason": "Includes the FS support scripts and declarations in workspace type checking.",
    "task": "FS-01",
    "evidence": "docs/task-hub-evidence/batch-02/FS-01/FS-01.md",
    "status": "MODIFIED_FROM_BASELINE"
  }
]
```
<!-- SOURCE_CHANGE_REGISTER_END -->

## Remaining gaps

- `OPEN`: official G1 rubric source and its applicable criteria.
- `OPEN`: representative group work confirmed with real input, expected output
  and current manual process.
- `NOT_RUN`: HTTP/session/UI and browser evidence, including 2-second polling.
- `NOT_RUN`: AI retrieval, query expansion, planner and replan evaluation.
- Capability-dependent skip: P11 native file-symlink case could not create its
  fixture on this Windows host; it is disclosed separately from E01–E14.

The machine-readable source-change register above remains the 51-row Task 4
register consumed by `scripts/fs06-manifest.mjs`; no row was removed or relabeled
by this documentation update.
