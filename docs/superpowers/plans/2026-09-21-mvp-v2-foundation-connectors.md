# MVP v2 Foundation — P1a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build independently tested identity, bounded source parsing and resource-policy primitives; do not enable SaaS dispatch in this batch.

**Architecture:** Add three pure modules under the engine pilot namespace. Keep them disconnected from runtime until the separately reviewed P1b/P2 integration plan binds source, approval and durable dispatch together. This plan implements only P1a, not the entire approved spec.

**Tech Stack:** Existing TypeScript, Node crypto and Vitest; no new dependency, service or migration.

**Spec:** [Approved MVP v2](../specs/2026-09-21-workflow-platform-mvp-v2-design.md), [baseline](../../BASELINE.md), [dataset contract](../../MVP-V2-DATASET.md).

Status: READY_FOR_USER_REVIEW / NOT_EXECUTED. This supersedes the earlier intention
to combine P1 and P2 into one implementation batch. Database/engine/adapter work
has separate safety boundaries and is not authorized by approving P1a alone.
Plan finalized: 22/09/2026; filename retains the design session date.

## Global Constraints

- Display name: AI Automation Platform. Preserve `ATI_Project`, `ati-*`, `@wap/*`.
- Google Sheets read-only; one configured source and Trello board per pilot.
- Stable `request_id`; at most 100 source rows, 16,000 characters per request.
- No source revision or run ID in cross-run business intent identity.
- One active run across the shared DB, owner-only runs, TTL 10 minutes.
- One UC2 remote write; no write-output input to downstream steps, no Sheet writeback.
- Unknown never causes blind retry; no automatic resume or exactly-once claim.
- No credentials in browser, prompt, snapshot, trace, git or test artifacts.
- Preserve approved System Design; no UI changes in this plan.
- Use the existing supported Node range from package.json; no dependency upgrades.
- Preserve existing dirty rename edits. At execution start use an isolated worktree
  through the worktree skill, only after the document handoff gate below;
  do not reset or silently copy/stage unrelated edits.
- Before existing-symbol changes run GitNexus impact; UNKNOWN requires source
  confirmation. Before every commit run detect_changes and inspect the exact diff.

## Review Focus

1. Delimiter collisions and reordered rows must not alias requests (Task 1).
2. Duplicate IDs and oversized responses must fail, not pick/truncate (Task 2).
3. Prompt injection and formula-like source text remain inert text (Task 2).
4. Revocation between two checks must deny the second call (Task 3).
5. Identical resource labels must not bypass exact IDs/principal checks (Task 3).

## Source map and boundaries

Source mapping checked at `b4e97b6`, with Codebase Onboarding Engineer read-only
assistance. GitNexus at `59b275d` was three commits behind: navigation only, not
a complete impact certificate. No runtime tests were run while writing this plan.

| Existing boundary | Implication for the next integration batch |
|---|---|
| `packages/engine/src/gateway-types.ts` CallContext has timezone/worker only | Add source/operation binding deliberately; no existing remote receipt callback |
| `packages/dsl/src/contracts.ts` catalog exactly two ordered local servers | New profile must preserve legacy wire compatibility; raw DSL server is already open string |
| `packages/engine/src/ai/local-catalog.ts` exact 8+2 B-local manifest | Separate reviewed pilot manifest, never masquerade as local tools |
| `packages/engine/src/snapshot.ts` strict b-local-preview-1 | Versioned pilot snapshot, backward decode and source binding need integration tests |
| `packages/engine/src/attempts.ts` beforeMutation callback | Not an after-success receipt hook; result and reservation persistence need an explicit transaction design |
| `packages/engine/src/receiver-policy.ts` closed receiver allowlist | Trello must be non-idempotent, not local_transaction |
| `packages/engine/src/recovery.ts` read-only local reconcile | Remote candidate inspection needs a new explicit interface; do not mutate through GET |
| `packages/db/src/migrate.ts` filename/checksum ledger | Add migration, never edit historical SQL; current final file is 0009_oidc_identity.sql |

New files and responsibilities: `pilot/identity.ts` stable key construction;
`pilot/source.ts` bounded untrusted ValueRange parsing; `pilot/policy.ts` exact
resource authorization. Each has a matching unit test in engine/tests.
No barrel exports, API DTO, DB, catalog or runtime wiring are changed in P1a.

## Prerequisite: reproducible document handoff

This gate runs only after the user approves execution. The plan and dataset are
currently untracked; approved scope updates are uncommitted. A worktree made
from the current HEAD would not contain the approved handoff. A plan-edit request
does not itself run this gate or authorize implementation.

- [ ] Inspect `git status --short` and `git diff --cached --name-only`. If the
  index already contains unrelated changes, stop and resolve with the user;
  do not clear their index or include those changes in this commit.
- [ ] Review and stage exactly the following documentation files. Preserve the
  mixed README scope/rename changes and all UI changes in the original worktree;
  they are deliberately excluded. BASELINE and the approved spec are authoritative
  for this handoff, not the older README in the new checkout.

```powershell
$handoffDocs = @(
  'PRODUCT.md',
  'docs/API.md',
  'docs/BASELINE.md',
  'docs/EVALUATION.md',
  'docs/EXECUTION-CONTRACT.md',
  'docs/KE-HOACH-6-TUAN.md',
  'docs/MVP-V2-TRANSITION-PROPOSAL.md',
  'docs/QUYET-DINH.md',
  'docs/functional-requirements.md',
  'docs/MVP-V2-DATASET.md',
  'docs/superpowers/specs/2026-09-21-workflow-platform-mvp-v2-design.md',
  'docs/superpowers/plans/2026-09-21-mvp-v2-foundation-connectors.md'
)
git add -- $handoffDocs
git diff --cached --check
git diff --cached --name-only
git diff --cached
```

- [ ] Require the staged paths to match that allowlist, review their complete
  contents (including previously untracked files), verify local links, and run
  GitNexus change analysis. Do not treat graph results for old/untracked docs
  as proof of completeness. If checks fail, resolve them before committing.
- [ ] Commit only the reviewed docs; record the exact commit SHA in the execution
  report. These commands must each succeed before proceeding:

```powershell
git commit -m "docs: finalize approved MVP v2 foundation handoff"
$handoffCommit = git rev-parse HEAD
git show --stat $handoffCommit
git status --short
```

- [ ] Use the worktree skill to create the execution checkout at that exact
  `$handoffCommit`, not an implicit default branch. Inside it, verify `git rev-parse
  HEAD` matches the recorded SHA, `git status --porcelain` is empty, and every
  `$handoffDocs` path exists. Read the approved spec and corrected plan there.
  The original README/UI edits must remain unchanged in the original checkout.
  If any condition fails, do not begin Task 1.

### Task 1: Stable source and business identity

**Files:** Create `packages/engine/src/pilot/identity.ts`;
Test `packages/engine/tests/pilot-identity.test.ts`.

**Interfaces:** Produces `SourceIdentity`, `sourceKey(identity: SourceIdentity): string`,
`createIntentKey(identity: SourceIdentity, boardId: string): string`.
Consumes only Node crypto. These are identifiers, not authorization or dedupe locks.

- [ ] Write the failing tests, importing the new module:

```ts
import { expect, it } from 'vitest';
import { sourceKey, createIntentKey } from '../src/pilot/identity.js';
const a = { groupId: 'g', spreadsheetId: 's', tabId: 't', requestId: 'r' };
it('is stable and distinguishes requests and boards', () => {
  expect(sourceKey({ ...a })).toBe(sourceKey(a));
  expect(sourceKey({ ...a, requestId: 'r2' })).not.toBe(sourceKey(a));
  expect(createIntentKey(a, 'b')).not.toBe(createIntentKey(a, 'b2'));
});
for (const field of ['groupId', 'spreadsheetId', 'tabId', 'requestId'] as const) {
  it(`isolates both source and create keys by ${field}`, () => {
    const changed = { ...a, [field]: `${a[field]}-other` };
    expect(sourceKey(changed)).not.toBe(sourceKey(a));
    expect(createIntentKey(changed, 'b')).not.toBe(createIntentKey(a, 'b'));
  });
}
it('keeps the create intent stable across runs, operators and source revisions', () => {
  const first = { ...a, runId: 'run-1', operatorId: 'operator-a', sourceRevision: 'v1', rowNumber: 2 };
  const second = { ...a, runId: 'run-2', operatorId: 'operator-b', sourceRevision: 'v2', rowNumber: 9 };
  expect(sourceKey(first)).toBe(sourceKey(second));
  expect(createIntentKey(first, 'b')).toBe(createIntentKey(second, 'b'));
});
it('does not alias delimiter-containing identities', () => {
  expect(sourceKey({ ...a, groupId: 'g|s', spreadsheetId: 'x' }))
    .not.toBe(sourceKey({ ...a, groupId: 'g', spreadsheetId: 's|x' }));
});
it('rejects whitespace-corrupted identifiers without repairing them', () => {
  expect(() => sourceKey({ ...a, requestId: ' r' })).toThrow('INVALID_ID');
});
```

- [ ] Run `npm run test:unit -w @wap/engine -- tests/pilot-identity.test.ts`.
  Expect failure because the module does not exist.
- [ ] Implement the module:

```ts
import { createHash } from 'node:crypto';
export type SourceIdentity = {
  groupId: string; spreadsheetId: string; tabId: string; requestId: string;
};
function key(parts: string[]): string {
  if (parts.some(p => !p || p !== p.trim())) throw new Error('INVALID_ID');
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}
export function sourceKey(i: SourceIdentity): string {
  return key(['pilot-source-1', i.groupId, i.spreadsheetId, i.tabId, i.requestId]);
}
export function createIntentKey(i: SourceIdentity, boardId: string): string {
  return key(['pilot-create-1', sourceKey(i), boardId, 'create_card']);
}
```

- [ ] Re-run the same command; require all eight tests pass. In an in-memory
  mutation probe, removing `sourceKey(i)` from `createIntentKey` must fail the
  new isolation tests; restore the exact intended implementation before commit.
  Row/revision/run/operator metadata does not change identity. Tab uses stable
  configured tab ID, not mutable sheet title.
- [ ] Inspect diff and graph change analysis; stage only these two files and
  commit `feat(pilot): define stable source and create intent keys`.

### Task 2: Bounded source parser without business inference

**Files:** Create `packages/engine/src/pilot/source.ts`;
Test `packages/engine/tests/pilot-source.test.ts`.

**Interfaces:** `parseRequest(values: unknown, requestId: string): SourceRow`;
`SourceRow = Record<SourceColumn, string>` and exported ordered `SOURCE_COLUMNS`
below. Consumes the `values` field of a provider ValueRange, not an HTTP response.
It preserves strings; missing business content remains empty for the later
versioned checklist. Successful parsing is NOT permission to create a card.

- [ ] Write the failing tests:

```ts
import { expect, it } from 'vitest';
import { parseRequest, SOURCE_COLUMNS } from '../src/pilot/source.js';
const row = ['r', 'client', 'web_change', '=ignore approval', 'page', '', '', ''];
it('preserves untrusted text and empty business fields', () => {
  const result = parseRequest([SOURCE_COLUMNS, row], 'r');
  expect(result.raw_request).toBe('=ignore approval');
  expect(result.due_date).toBe('');
});
it('rejects duplicates even if another row would match first', () => {
  expect(() => parseRequest([SOURCE_COLUMNS, row, row], 'r')).toThrow('DUPLICATE_ID');
});
it('rejects oversized input without truncation', () => {
  expect(() => parseRequest([SOURCE_COLUMNS, ...Array(101).fill(row)], 'r')).toThrow('ROW_LIMIT');
  expect(() => parseRequest([SOURCE_COLUMNS, ['r', '', '', 'x'.repeat(16001)]], 'r')).toThrow('TEXT_LIMIT');
});
it('requires exact headers, supported types and unique selected ID', () => {
  expect(() => parseRequest([['request_id'], row], 'r')).toThrow('HEADERS');
  expect(() => parseRequest([SOURCE_COLUMNS, ['r', '', 'other']], 'r')).toThrow('REQUEST_TYPE');
  expect(() => parseRequest([SOURCE_COLUMNS, row], 'absent')).toThrow('NOT_FOUND');
});
it('selects by ID after row reorder and never silently coerces a cell', () => {
  const second = ['s', 'client', 'design_asset'];
  expect(parseRequest([SOURCE_COLUMNS, second, row], 'r').request_id).toBe('r');
  expect(() => parseRequest([SOURCE_COLUMNS, [17]], '17')).toThrow();
});
it('accepts blank rows and missing trailing cells but rejects extra columns', () => {
  expect(parseRequest([SOURCE_COLUMNS, [], ['r', '', 'web_change']], 'r').source_note).toBe('');
  expect(() => parseRequest([SOURCE_COLUMNS, [...row, 'extra']], 'r')).toThrow('EXTRA_COLUMNS');
});
it('counts Unicode code points without truncation', () => {
  expect(() => parseRequest([SOURCE_COLUMNS, ['r', '', 'web_change', '😀'.repeat(16001)]], 'r')).toThrow('TEXT_LIMIT');
});
it('rejects excessive row count before touching malformed data', () => {
  const tooMany: unknown[] = [SOURCE_COLUMNS, ...Array(10000).fill([17])];
  Object.defineProperty(tooMany, 1, { get() { throw new Error('DATA_VISITED'); } });
  expect(() => parseRequest(tooMany, 'r')).toThrow('ROW_LIMIT');
});
it('rejects excessive width before inspecting cells, including a blank row', () => {
  const tooWide: unknown[] = Array(10000).fill('');
  Object.defineProperty(tooWide, 0, { get() { throw new Error('CELL_VISITED'); } });
  expect(() => parseRequest([SOURCE_COLUMNS, tooWide], 'r')).toThrow('EXTRA_COLUMNS');
});
it('rejects excessive text before inspecting later cells', () => {
  const cells = ['r', '', 'web_change', 'x'.repeat(16001), ''];
  Object.defineProperty(cells, 4, { get() { throw new Error('LATER_CELL_VISITED'); } });
  expect(() => parseRequest([SOURCE_COLUMNS, cells], 'r')).toThrow('TEXT_LIMIT');
});
it('accepts exactly 100 rows and 16000 code points per request', () => {
  const rows = Array.from({ length: 100 }, (_, i) => [`r${i}`, '', 'web_change']);
  expect(parseRequest([SOURCE_COLUMNS, ...rows], 'r99').request_id).toBe('r99');
  const content = '😀'.repeat(16000 - 'rweb_change'.length);
  expect(parseRequest([SOURCE_COLUMNS, ['r', '', 'web_change', content]], 'r').raw_request).toBe(content);
  expect(() => parseRequest([SOURCE_COLUMNS, ['r', '', 'web_change', content + 'a']], 'r')).toThrow('TEXT_LIMIT');
});
```

- [ ] Run `npm run test:unit -w @wap/engine -- tests/pilot-source.test.ts`;
  expect missing module failure.
- [ ] Implement the bounded parser; header schema is deliberately strict for
  the single configured pilot source, not a generic Sheets importer:

```ts
export const SOURCE_COLUMNS = ['request_id', 'client_ref', 'request_type',
  'raw_request', 'deliverable', 'due_date', 'decision_status', 'source_note'] as const;
export type SourceColumn = typeof SOURCE_COLUMNS[number];
export type SourceRow = Record<SourceColumn, string>;
export function parseRequest(values: unknown, requestId: string): SourceRow {
  if (!Array.isArray(values)) throw new Error('VALUES_TYPE');
  if (values.length > 101) throw new Error('ROW_LIMIT');
  const header: unknown = values[0];
  if (!Array.isArray(header) || header.length !== SOURCE_COLUMNS.length ||
      !SOURCE_COLUMNS.every((name, index) => header[index] === name)) throw new Error('HEADERS');
  const ids = new Set<string>();
  const parsed: SourceRow[] = [];
  for (let index = 1; index < values.length; index++) {
    const raw: unknown = values[index];
    if (!Array.isArray(raw)) throw new Error('ROW_TYPE');
    if (raw.length > SOURCE_COLUMNS.length) throw new Error('EXTRA_COLUMNS');
    const cells: string[] = [];
    let characters = 0;
    for (const cell of raw as unknown[]) {
      if (typeof cell !== 'string') throw new Error('CELL_TYPE');
      for (const _character of cell) {
        characters += 1;
        if (characters > 16000) throw new Error('TEXT_LIMIT');
      }
      cells.push(cell);
    }
    if (cells.every(c => c === '')) continue;
    const row = Object.fromEntries(SOURCE_COLUMNS.map((c, i) => [c, cells[i] ?? ''])) as SourceRow;
    if (!row.request_id || row.request_id !== row.request_id.trim()) throw new Error('INVALID_ID');
    if (ids.has(row.request_id)) throw new Error('DUPLICATE_ID');
    ids.add(row.request_id);
    if (!['web_change', 'design_asset'].includes(row.request_type)) throw new Error('REQUEST_TYPE');
    parsed.push(row);
  }
  const selected = parsed.find(row => row.request_id === requestId);
  if (!selected) throw new Error('NOT_FOUND');
  return selected;
}
```

- [ ] Re-run targeted tests, require all eleven tests pass.
  This parser requires text-formatted IDs; numeric cells are rejected, not guessed.
  Limit precedence is outer row count, header shape, per-row width, then bounded
  cell type/text checks; no full-array schema parse or full-string `Array.from`.
  The 16,000-code-point budget covers all supplied cells in one data row.
  The adapter must separately bound HTTP bytes before JSON decoding in P2;
  this already-decoded parser does not bound network/body allocation.
- [ ] Inspect diff/graph analysis, stage only module/test and commit
  `feat(pilot): parse bounded request source without inference`.

### Task 3: Exact resource authorization primitive

**Files:** Create `packages/engine/src/pilot/policy.ts`;
Test `packages/engine/tests/pilot-policy.test.ts`.

**Interfaces:** Produces `PilotPolicy`, `ResourceTarget`, and
`assertPilotAccess(policy: PilotPolicy, principalId: string, target: ResourceTarget): void`.
No token inputs or network calls. Runtime must load current policy on each check;
this function cannot establish freshness or authority of a caller-supplied object.

- [ ] Write failing tests:

```ts
import { expect, it } from 'vitest';
import { assertPilotAccess, type PilotPolicy } from '../src/pilot/policy.js';
const policy: PilotPolicy = { enabled: true, principals: ['operator-a'],
  spreadsheetId: 'sheet-id', tabId: 'tab-id', boardId: 'board-id' };
it('allows exact source and board only', () => {
  expect(() => assertPilotAccess(policy, 'operator-a', { kind: 'board', boardId: 'board-id' })).not.toThrow();
  expect(() => assertPilotAccess(policy, 'operator-a', { kind: 'source', spreadsheetId: 'sheet-id', tabId: 'tab-id' })).not.toThrow();
});
it('denies labels, another principal and revoked policy', () => {
  expect(() => assertPilotAccess(policy, 'operator-b', { kind: 'board', boardId: 'board-id' })).toThrow('ACCESS_DENIED');
  expect(() => assertPilotAccess(policy, 'operator-a', { kind: 'board', boardId: 'Board name' })).toThrow('ACCESS_DENIED');
  expect(() => assertPilotAccess({ ...policy, enabled: false }, 'operator-a', { kind: 'board', boardId: 'board-id' })).toThrow('ACCESS_DENIED');
});
it('checks the tab, not just the spreadsheet', () => {
  expect(() => assertPilotAccess(policy, 'operator-a', { kind: 'source', spreadsheetId: 'sheet-id', tabId: 'other' })).toThrow('ACCESS_DENIED');
});
```

- [ ] Run `npm run test:unit -w @wap/engine -- tests/pilot-policy.test.ts`;
  expect missing module failure.
- [ ] Implement:

```ts
export type PilotPolicy = { enabled: boolean; principals: readonly string[];
  spreadsheetId: string; tabId: string; boardId: string };
export type ResourceTarget =
  | { kind: 'source'; spreadsheetId: string; tabId: string }
  | { kind: 'board'; boardId: string };
export function assertPilotAccess(p: PilotPolicy, principalId: string, t: ResourceTarget): void {
  const allowed = t.kind === 'source'
    ? t.spreadsheetId === p.spreadsheetId && t.tabId === p.tabId
    : t.boardId === p.boardId;
  if (!p.enabled || !principalId || !p.principals.includes(principalId) || !allowed)
    throw new Error('ACCESS_DENIED');
}
```

- [ ] Re-run targeted tests; require pass. Verify error messages contain neither
  policy data nor credentials. This is a typed internal primitive: untrusted
  config/HTTP input must be parsed at the future adapter boundary before use.
- [ ] Run `npm run test:unit -w @wap/engine` and `npm run typecheck`.
  No DB/live calls are needed; report any pre-existing unrelated failures separately.
- [ ] Inspect diff/graph analysis; stage only module/test and commit
  `feat(pilot): enforce exact source and board policy checks`.

## Exit gate and remaining spec coverage

P1a is done only after red/green tests, complete engine unit/typecheck results,
and independent code review. It is a tested library batch, not a working user
feature or a completed P1 phase. Do not enable a pilot launch mode at this gate.

| Subsequent plan | Required deliverable and gate; outside this execution scope |
|---|---|
| P1b — durable safety and contracts | Versioned checklist/evidence/source revision; pilot snapshot/profile; migration with unique group/source/board create intent; atomic claim/outcome persistence and orphan unknown handling; races tested on isolated DB |
| P2 — adapter/manual vertical slice | Reviewed `google_sheets.read_request`, `trello.list_lists`, `trello.list_members`, `trello.get_card`, `trello.create_card`; strict args/output, auth mode verified from official API docs, child IDs checked against board, current-policy recheck before dispatch; hand-plan preview/approve/receipt/unknown integration |
| P3 — source-aware AI | Pre-planning source snapshot, no mixed revisions, provenance/checklist prompt, clarification/new run, bounded planning/replan, revised retrieval manifest and quality/cost experiment |
| P4 — interaction/browser | User-approved interaction delta with existing Design System; request selection, mode, frozen-source age, real link, error/re-login, two principals with owner isolation |
| P5 — acceptance/report | Full V2-01..20, separate holdout, manual/script/AI comparison and semantic/QE evidence; live permissions/budget gate |

P1b must account for both initial prepare and replan operation insertion.
Reservation key construction is Task 1; uniqueness/transaction correctness is
NOT implemented by hashing. Unknown reservations are retained; cancel/expiry may
release only with proof of no dispatch. HTTP success with malformed output is
not known-not-applied. Existing recovery has no remote confirmation capability.

For P2, credentials stay server-side and OAuth consent belongs to the user.
OIDC is platform login only. Missing setup blocks live, not mock development.
Adapter/manual execution must not precede P1b safety gate. Approval of this P1a
plan does not authorize resource creation, paid evaluation, or live card writes.

## Plan self-review and handoff

- Coverage: P1a covers identity/source parsing/resource comparison only;
  the table above assigns all remaining spec subsystems to separate plans.
- Type consistency: task types/functions are defined in their producing task;
  no existing runtime hook is assumed to supply source or remote receipt context.
- Review Focus: all five risks have explicit tests assigned above.
- Test commands are existing workspace scripts; commands in this plan have NOT_RUN status.
- No UI, generated OpenAPI, old datasets, secrets or historical migrations are edited.

### Review corrections verified — 22/09/2026

- Parser guards now run before whole-input validation; Unicode counting stops
  at the first code point over the budget without allocating a character array.
- Identity tests distinguish all four source dimensions and board, and preserve
  the key across run/operator/revision changes.
- The document commit/pinned-worktree prerequisite resolves the missing handoff;
  Codebase Onboarding Engineer rechecked this section with no unresolved finding.
  The prerequisite itself has not been executed.
- Extracted TypeScript examples passed 22 test cases in an in-memory Node assert
  harness (8 identity, 11 parser, 3 policy) and strict TypeScript checking with
  `noUncheckedIndexedAccess`; no files were generated for those checks.
- Mutation checks rejected omission of the source from the create key (four
  failing isolation tests) and full-array parsing before guards (three failing
  early-limit tests). These checks validate the plan examples, not engine runtime.
- Workspace Vitest/regression, DB, browser and SaaS checks remain NOT_RUN for
  P1a implementation because the product modules have not been created.

Ask the user to review this bounded plan and choose Native or Subagent-driven
execution. Recommend Native for three small related modules, followed by an
independent review. Do not begin implementation before that handoff is answered.
