# Task Hub Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task when available. On Antigravity without that skill, execute the checkboxes directly. The user chose Antigravity for implementation; Codex must only plan/review. No delegation or code execution by Codex is requested.

**Goal:** Implement the remaining five task_hub tools and verify all eight through real PostgreSQL/MCP/controller paths.

**Architecture:** Reuse TaskHub.call and its single approval/operation/receipt transaction. Put new card/member business logic in cards.ts and share ToolError through errors.ts. Extend the fixed engine allowlist and propagate saved run timezone for list_cards.

**Tech Stack:** Existing Node >=22, TypeScript, Zod4, MCP SDK1.30.0, Drizzle0.45.2, postgres.js3.4.9 and Vitest. No new dependency.

**Spec:** [2026-09-13-task-hub-completion-design.md](../specs/2026-09-13-task-hub-completion-design.md). Read the spec together with this plan. [Handoff instructions](../../antigravity/README.md) and [baseline hashes](../../antigravity/task-hub-handoff-baseline.json) travel with it.

**Status:** PLAN_ONLY / NOT_IMPLEMENTED. Checkboxes are intentionally empty. Code blocks below are implementation instructions, not files already added to the application.

## Global constraints

- Root: D:\Môn học\ATI\ATI_Project; Windows PowerShell; no Git initialization.
- SQL migrations are authoritative. Never edit 0001–0003; add 0004_task_hub_cards.sql.
- One sequential worker. Keep owner/version/hash/expiry/operation checks and atomic mutation+receipt.
- Keep native SQL and Drizzle transaction handles separate. Do not weaken dedicated worker-lock handling.
- Dry-run performs zero writes; engine never automatically retries/resumes an uncertain write.
- Preserve existing 3 tool schemas and policy b-local-1. New five tools keep the catalog field shapes in spec.
- Tests use only suite-created g1_it_UUID/engine_it_UUID databases. Do not reset wap_g1 or any Docker volume.
- Write current evidence under docs/task-hub-evidence/batch-01. Historical fix/G1/engine evidence must remain unchanged.
- Do not touch holdout, implement AI/API/UI/filesystem, or change baseline scope in this batch.
- A user request for one task authorizes that task's normal edits and tests. Finish the assigned task and report; do not silently start an unassigned task.
- Each task must build and have an independently verifiable result. A later green count cannot excuse deleting/skipping old tests.

## File map

Paths are relative to the absolute root above. Create only at the task that owns the file.

| File | Change / responsibility | Owner task |
|---|---|---|
| db/migrations/0004_task_hub_cards.sql | Four local business tables, ownership FKs, indexes | TH-01 |
| packages/db/src/schema.ts, seed.ts | Drizzle mappings and preserving seed | TH-01 |
| apps/mcp-task-hub/tests/database.integration.test.ts | Migration/seed/ownership checks | TH-01 |
| apps/mcp-task-hub/tests/tools.integration.test.ts | Evidence override, later discovery and card test helper reuse | TH-01/03/04/05 |
| packages/engine/tests/controller.integration.test.ts | Evidence override; new real-controller cases | TH-01/06 |
| scripts/g1-status.mjs | Evidence override and final read-only runtime snapshot | TH-01/07 |
| apps/mcp-task-hub/src/errors.ts | ToolError shared without circular dependency | TH-02 |
| apps/mcp-task-hub/src/contracts.ts | Eight schemas, explicit enabled names and read annotations | TH-02–05 |
| apps/mcp-task-hub/src/server.ts | Enabled request names and runtime metadata forwarding | TH-02/03 |
| apps/mcp-task-hub/src/service.ts | Explicit dispatch; reuse write gate and receipt | TH-02–05 |
| apps/mcp-task-hub/src/cards.ts | Card/member reads and writes; no duplicate approval logic | TH-03–05 |
| apps/mcp-task-hub/scripts/sync-catalog.mjs | Sync only enabled new tool schemas after targeted live tests | TH-03 |
| packages/engine/src/gateway.ts, attempts.ts | Fixed allowlist; saved timezone propagation | TH-03–05 |
| testdata/tools.json | Schema/description/evidence sync only for implemented names | TH-03–05 |
| packages/engine/tests/task-hub-plans.ts | Test-only plan constructors; no holdout import | TH-06 |
| testdata/dev-hand-plans/th-move.json | Explicit dev hand plan for CLI and controller checks | TH-06 |
| Current READMEs/status docs + testdata/TESTDATA.md | Accurate implementation/remaining-scope statements | TH-07 |

Do not change engine claim/recovery/snapshot semantics or introduce a second authorization path. If an actual failing case requires such a change, report it with evidence before widening this plan.

## Dependency order and checkpoints

`TH-01 → TH-02 → TH-03 → TH-04 → TH-05 → TH-06 → TH-07`.

Expected active catalog size at each gate: 3, 3, 6, 7, 8, 8, 8. Use the explicit expected names, not merely a count. Historical baseline was 78 tests; executor records the actual current total and new case names after every relevant run.

### TH-01: Isolated evidence, baseline, database and seed

**Files:** migration/schema/seed/database test plus the three existing evidence writers in the map. New reports/logs go in docs/task-hub-evidence/batch-01. No receiver tool activation.

**Consumes:** openDatabase(url), migrate(url), seedDemo(connection,userId), DEMO_USER_ID. Their signatures stay unchanged.

**Produces:** four new tables; schema exports boards, boardLists, boardMembers, cards; repeatable board/card seed; full baseline with three active tools; evidence override ATI_EVIDENCE_DIR.

- [x] Read CONTRIBUTING, spec sections 1–4 and current source. Compare baseline JSON hashes. Report relevant drift; do not revert someone else's changes to match this plan.
- [x] Add an evidence override to both test writers and scripts/g1-status.mjs BEFORE running integration tests. Keep the existing fallback paths for old commands, but let a caller supply a new directory. In each writer, adapt the already-existing dir calculation using this exact rule, with root already defined:

```ts
const requestedEvidence = process.env.ATI_EVIDENCE_DIR;
const dir = requestedEvidence
  ? path.resolve(root, requestedEvidence)
  : existingDefaultDir;
if (requestedEvidence) {
  const evidenceRoot = path.resolve(root, "docs/task-hub-evidence");
  const relative = path.relative(evidenceRoot, dir);
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
    throw new Error("ATI_EVIDENCE_DIR must name a batch directory under docs/task-hub-evidence");
}
```

`existingDefaultDir` means keep each writer's current computed default expression in a local variable of that exact name; it is not an added library API. The guard must reject the parent/root itself and outside paths. Preserve each file's distinct JSON filename. check-engine.mjs already spreads process.env to its child commands; do not hardcode an override there. This is test/report plumbing, not runtime authorization.

- [x] Run preflight on the unchanged runtime, saving logs outside historical folders. Each command is a separate PowerShell step; stop on nonzero exit, do not let a later command hide it.

```powershell
Set-Location -LiteralPath 'D:\Môn học\ATI\ATI_Project'
New-Item -ItemType Directory -Force -Path 'docs/task-hub-evidence/batch-01/preflight' | Out-Null
$env:ATI_EVIDENCE_DIR = 'docs/task-hub-evidence/batch-01/preflight'
npm ci --ignore-scripts --no-audit --no-fund
# Check $LASTEXITCODE before proceeding.
npm run db:up:g1
# Check $LASTEXITCODE before proceeding. Do not reset or recreate volumes.
npm run check:engine 2>&1 | Tee-Object 'docs/task-hub-evidence/batch-01/preflight/check.log'
if ($LASTEXITCODE -ne 0) { throw 'Preflight failed; record the failing check' }
$env:ATI_EVIDENCE_DIR = 'docs/task-hub-evidence/batch-01/TH-01'
New-Item -ItemType Directory -Force -Path $env:ATI_EVIDENCE_DIR | Out-Null
```

Expected historical baseline: 39 DSL +15 DB/MCP +24 engine. If different, inspect names and source changes; do not force this count. No persistent migrate/seed command is needed: suites create their own migrated databases.

- [x] In database.integration.test.ts add tests prefixed `[TH-01]` before adding the migration. Each added test calls migrate(url) itself if it needs schema, opens/closes its own Database handle and uses a fresh randomUUID principal. This file's existing tests share a DB and have no beforeEach reset; do not add a global TRUNCATE that breaks their setup. Assertions required:

```ts
await implementation.migrate(url);
const connection = implementation.openDatabase(url);
try {
  const user = randomUUID();
  await implementation.seedDemo(connection,user);
  const first = await raw`SELECT card_id,title,list_name,assignee_id FROM hub_cards WHERE user_id=${user} ORDER BY card_id`;
  expect(first).toEqual([
    {card_id:"c1",title:"Viết API",list_name:"Doing",assignee_id:"m1"},
    {card_id:"c2",title:"Kiểm thử",list_name:"Done",assignee_id:"m1"},
  ]);
  await raw`UPDATE hub_cards SET title='Keep my edit',list_name='Backlog' WHERE user_id=${user} AND card_id='c1'`;
  await implementation.seedDemo(connection);
  expect((await raw`SELECT title,list_name FROM hub_cards WHERE user_id=${user} AND card_id='c1'`)[0])
    .toEqual({title:"Keep my edit",list_name:"Backlog"});
} finally { await connection.close(); }
```

Also test two owner principals can each seed c1; inserting a card referencing a board/member/list that exists only for the other owner fails with PostgreSQL 23503. Use a second owner created with seedDemo and delete/rename a unique resource only in that test DB to create the cross-owner-only target. Do not assert owner safety merely by duplicate IDs.

- [x] Run the failing database cases after a build. Expected relevant failure: hub_cards relation missing. Record red result.

```powershell
npm run build
npm run test:integration -w @wap/mcp-task-hub -- tests/database.integration.test.ts -t TH-01
```

- [x] Create migration 0004 with the DDL below. The existing runner wraps it and its ledger insertion in one transaction, so do not add BEGIN/COMMIT. Do not put runtime seed data in the migration.

```sql
CREATE TABLE hub_boards (
  user_id UUID NOT NULL REFERENCES users(id),
  board_id TEXT NOT NULL CHECK (char_length(board_id) BETWEEN 1 AND 200),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  PRIMARY KEY (user_id, board_id)
);
CREATE TABLE hub_lists (
  user_id UUID NOT NULL,
  board_id TEXT NOT NULL,
  list_name TEXT NOT NULL CHECK (char_length(list_name) BETWEEN 1 AND 200),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  is_done BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, board_id, list_name),
  FOREIGN KEY (user_id, board_id) REFERENCES hub_boards(user_id, board_id)
);
CREATE TABLE hub_members (
  user_id UUID NOT NULL,
  board_id TEXT NOT NULL,
  member_id TEXT NOT NULL CHECK (char_length(member_id) BETWEEN 1 AND 200),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  PRIMARY KEY (user_id, board_id, member_id),
  FOREIGN KEY (user_id, board_id) REFERENCES hub_boards(user_id, board_id)
);
CREATE TABLE hub_cards (
  user_id UUID NOT NULL,
  card_id TEXT NOT NULL DEFAULT gen_random_uuid()::text CHECK (char_length(card_id) BETWEEN 1 AND 200),
  board_id TEXT NOT NULL,
  list_name TEXT NOT NULL,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500 AND title ~ '[^[:space:]]'),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 16000),
  due_date DATE,
  assignee_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, card_id),
  FOREIGN KEY (user_id, board_id, list_name) REFERENCES hub_lists(user_id, board_id, list_name),
  FOREIGN KEY (user_id, board_id, assignee_id) REFERENCES hub_members(user_id, board_id, member_id)
);
CREATE INDEX hub_cards_board_updated ON hub_cards(user_id, board_id, updated_at, card_id);
CREATE INDEX hub_cards_board_assignee ON hub_cards(user_id, board_id, assignee_id);
```

- [x] Map all four tables in schema.ts using the existing pgTable pattern. Add date/integer/boolean imports; dates use `date("due_date", {mode:"string"})`, timestamps `{withTimezone:true}`. SQL owns FK/check constraints; do not run ORM push/generate. Preserve TEXT card IDs and nullable due/assignee. Example key/type pattern:

```ts
export const boards = pgTable("hub_boards", {
  userId: uuid("user_id").notNull(),
  boardId: text("board_id").notNull(),
  name: text("name").notNull(),
}, t => [primaryKey({columns:[t.userId,t.boardId]})]);
// Map boardLists, boardMembers and cards field-for-field from the DDL.
// cards PK is [userId, cardId]; dueDate is string|null, not a JS timezone-converted Date.
```

- [x] Extend the existing seedDemo Drizzle transaction in FK order: boards → boardLists → boardMembers → cards. Use exact spec seed rows; leave its signature/return and original sheet/channel rows intact. Every insert uses onConflictDoNothing; avoid an UPDATE conflict clause. Example card values:

```ts
await tx.insert(cards).values([
  {userId,cardId:"c1",boardId:"board_a",listName:"Doing",title:"Viết API",
   description:"API demo local",assigneeId:"m1",dueDate:null,
   createdAt:new Date("2026-09-14T02:00:00Z"),updatedAt:new Date("2026-09-14T02:00:00Z")},
  {userId,cardId:"c2",boardId:"board_a",listName:"Done",title:"Kiểm thử",
   description:"",assigneeId:"m1",dueDate:null,
   createdAt:new Date("2026-09-15T03:00:00Z"),updatedAt:new Date("2026-09-15T03:00:00Z")},
]).onConflictDoNothing();
```

- [x] Update the existing migration expectation to four explicit names, preserving checksum-drift and rerun assertions. Re-run database tests, then npm run check:engine with the TH-01 evidence override. Receiver/gateway must still expose exactly the old three names. Report baseline/new counts, constraints tested, and seed preservation. Do not migrate the user's persistent demo DB in this task.

### TH-02: Explicit contracts and dispatch boundary

**Files:** contracts.ts, errors.ts, service.ts, server.ts, tools.integration.test.ts. No catalog evidence promotion yet.

**Consumes:** existing TaskHub.call(name,args,metadata); AuthorizationSchema; writeFingerprint; database from TH-01.

**Produces:** full ToolName union, EnabledToolNameSchema, ENABLED_TOOL_NAMES (still old 3), correct read annotations, shared ToolError. Existing MCP surface remains functional and excludes disabled tools.

- [x] Add `[TH-02]` tests that import inputs/outputs and check the five future contracts below. Keep the existing live discovery test expecting the active three names at this checkpoint; later tasks deliberately extend that expectation. Add a lasting test “create_card without authorization cannot mutate”: through MCP it must return isError, make zero hub_cards changes and add zero receipts. It is disabled now and authorization-gated after TH-04, so do not hardcode the same error code across both stages. Record failure for missing input/output definitions before implementation.

```ts
expect(inputs.create_card.safeParse({board_id:"board_a",list_name:"Backlog",title:"  "}).success).toBe(false);
expect(inputs.create_card.safeParse({board_id:"board_a",list_name:"Backlog",title:"Docs",due_date:"2026-02-30"}).success).toBe(false);
expect(inputs.get_card.safeParse({card_id:"c1",user_id:"spoofed"}).success).toBe(false);
expect(outputs.get_card.safeParse({id:"c1",board_id:"board_a",title:"API",list_name:"Doing",description:"extra"}).success).toBe(false);
expect(inputs.create_card.parse({board_id:"board_a",list_name:"Backlog",title:"Docs"}))
  .toEqual({board_id:"board_a",list_name:"Backlog",title:"Docs"});
```

- [x] Add schemas and union entries using this field content, not any/unknown output or open records. Keep old schemas byte-equivalent in emitted JSON.

```ts
const cardSummary = z.object({id,board_id:id,title:z.string().min(1).max(500),list_name:id}).strict();
// Add to inputs:
list_cards: z.object({board_id:id,list_name:id.optional(),assignee_id:id.optional(),
  since:z.iso.date().optional(),until:z.iso.date().optional()}).strict(),
get_card: z.object({card_id:id}).strict(),
list_members: z.object({board_id:id}).strict(),
create_card: z.object({board_id:id,list_name:id,title:z.string().min(1).max(500).regex(/\S/),
  description:z.string().max(16000).optional(),due_date:z.iso.date().optional(),assignee_id:id.optional()}).strict(),
move_card: z.object({card_id:id,target_list:id}).strict(),
// Add to outputs:
list_cards: z.object({cards:z.array(cardSummary).max(1000),count:z.number().int().nonnegative()}).strict(),
get_card: cardSummary,
list_members: z.object({members:z.array(z.object({id,name:z.string().min(1).max(200),
  task_count:z.number().int().nonnegative()}).strict()).max(1000)}).strict(),
create_card: z.object({id}).strict(),
move_card: z.object({id,list_name:id}).strict(),
```

Cross-field since<=until is checked in cards.ts later, outside the exported schema builder so JSON Schema emission does not silently discard a custom refinement. Do not add input defaults: omitted fields must remain omitted for fingerprinting.

- [x] Keep publication explicit:

```ts
export const ENABLED_TOOL_NAMES = ["read_sheet_range","append_sheet_rows","send_slack_message"] as const;
export const EnabledToolNameSchema = z.enum(ENABLED_TOOL_NAMES);
const readNames = new Set<ToolName>(["read_sheet_range","list_cards","get_card","list_members"]);
// toolDefinitions iterates ENABLED_TOOL_NAMES with callback (name:ToolName), not all ToolNameSchema.options.
// annotations.readOnlyHint = readNames.has(name); destructiveHint = name === "move_card".
// server's incoming name parser uses EnabledToolNameSchema.
```

Add exact descriptions from spec semantics, especially get_card's four fields and list_members active-task meaning. Annotations remain metadata only; do not use them as the execution policy.

- [x] Move the existing ToolError class into errors.ts unchanged, import it in service.ts and re-export it there so server import stays compatible. Replace the generic write `else` that assumes send_slack_message with `else if (name === "send_slack_message")`; the final disabled/unsupported branch throws ToolError(BAD_ARGS,"Tool is not enabled"). Do not change the shared gate/receipt block.

- [x] Run npm run check and the existing DB/MCP suite plus `[TH-02]` tests with evidence override. Compare old three live schemas to the original catalog. Expected: old3 still work; future5 have strict schemas but are not advertised/dispatchable. Report and stop.

### TH-03: Three read tools, timezone and six-tool discovery

**Files:** create cards.ts; modify service.ts/server.ts/contracts.ts, gateway.ts/attempts.ts, tools.integration.test.ts and testdata/tools.json. Create the deterministic catalog sync script shown below. Add gateway-context regression to controller.integration.test.ts. Do not enable create/move yet.

**Consumes:** DB exports/seed from TH-01; inputs/outputs/ToolName/ToolError from TH-02; Gateway.call's existing four parameters; saved RunRow.time_zone.

**Produces:** CardReadName, isCardReadName, readCardTool; three reads available over MCP; saved timezone transported; six reviewed live names recognized by engine.

```ts
// cards.ts signatures. These are the public seams for later tasks.
export type CardReadName = "list_cards" | "get_card" | "list_members";
export declare function isCardReadName(name: ToolName): name is CardReadName;
export declare function readCardTool(
  connection: Database, userId: string, name: CardReadName,
  args: unknown, runtimeMetadata?: unknown,
): Promise<Record<string, unknown>>;
// gateway.ts, backward-compatible optional fifth parameter:
export interface CallContext { timeZone: string }
// Gateway.call(name,args,authorization,timeoutMs,context?:CallContext):Promise<GatewayResult>
// TaskHub.call(name,args,metadata,runtimeMetadata?:unknown) keeps its original return type.
```

- [ ] Add `[TH-03]` cases in the existing tools integration file so they reuse its actual MCP client, raw/connection, user seed and cleanup. No mock TaskHub substitutes. Before implementation, call each new name and show its missing/disabled failure rather than accepting isError. The primary oracle is:

```ts
expect((await call("get_card",{card_id:"c1"})).structuredContent)
  .toEqual({id:"c1",board_id:"board_a",title:"Viết API",list_name:"Doing"});
expect((await call("list_cards",{board_id:"board_a",list_name:"Doing",assignee_id:"m1"})).structuredContent)
  .toEqual({cards:[{id:"c1",board_id:"board_a",title:"Viết API",list_name:"Doing"}],count:1});
expect((await call("list_members",{board_id:"board_a"})).structuredContent)
  .toEqual({members:[{id:"m1",name:"An",task_count:1},{id:"m2",name:"Bình",task_count:0}]});
```

Each independent test starts from its own beforeEach seed. An additional owner is seeded only in the test that needs it. Do not depend on an earlier test moving a card or creating a member.

- [ ] Implement isCardReadName as an explicit name guard. In service.ts put this read dispatch before the existing write gate; call readCardTool with runtimeMetadata and return `{output,replayed:false}`. Leave the old read_sheet_range branch intact.

```ts
if (isCardReadName(name)) {
  const output = await readCardTool(this.connection, this.userId, name, args, runtimeMetadata);
  return {output,replayed:false};
}
```

readCardTool parses the specific input schema, performs owner-scoped queries, validates output and returns only projected fields. Use connection.db.execute(sql`...`) for these reads. ToolError comes from errors.ts; do not import service.ts from cards.ts. Do not expose raw DB records with description/owner/timestamps.

- [ ] Implement the read queries with bound parameters. For list_cards first confirm board exists for owner, then validate any provided list/member is in that board. Parse and order-check ISO dates before SQL. The bounded main query has these exact predicates/projection:

```ts
const rows = await connection.db.execute(sql`
  SELECT c.card_id AS id,c.board_id,c.title,c.list_name
  FROM hub_cards c
  WHERE c.user_id=${userId} AND c.board_id=${input.board_id}
    AND (${input.list_name ?? null}::text IS NULL OR c.list_name=${input.list_name ?? null})
    AND (${input.assignee_id ?? null}::text IS NULL OR c.assignee_id=${input.assignee_id ?? null})
    AND (${input.since ?? null}::date IS NULL OR c.updated_at >= (${input.since ?? null}::date::timestamp AT TIME ZONE ${timeZone}))
    AND (${input.until ?? null}::date IS NULL OR c.updated_at < ((${input.until ?? null}::date + 1)::timestamp AT TIME ZONE ${timeZone}))
  ORDER BY c.updated_at ASC,c.card_id COLLATE "C" ASC LIMIT 1001`);
if (rows.length > 1000) throw new ToolError("LIMIT_EXCEEDED","list_cards exceeds 1000 results; narrow the filters");
const result = outputs.list_cards.safeParse({cards:rows,count:rows.length});
if (!result.success) throw new ToolError("INTERNAL_ERROR","Stored card data failed the output contract");
return result.data;
```

Here `input` is inputs.list_cards.parse(args); `timeZone` is validated by the metadata step below. Do not interpolate SQL identifiers or concatenate caller-supplied fragments.

get_card query: owner AND card_id, projection of those four fields, NOT_FOUND on no row. list_members checks the board and uses left joins so empty workload members remain:

```sql
SELECT m.member_id AS id,m.name,
       (count(c.card_id) FILTER (WHERE l.is_done=false))::int AS task_count
FROM hub_members m
LEFT JOIN hub_cards c ON c.user_id=m.user_id AND c.board_id=m.board_id AND c.assignee_id=m.member_id
LEFT JOIN hub_lists l ON l.user_id=c.user_id AND l.board_id=c.board_id AND l.list_name=c.list_name
WHERE m.user_id=$1 AND m.board_id=$2
GROUP BY m.member_id,m.name
ORDER BY m.member_id COLLATE "C" ASC LIMIT 1001;
```

Use the actual Drizzle sql parameter binding for $1=userId and $2=input.board_id; the SQL above illustrates parameter positions, not unsafe string substitution. Return LIMIT_EXCEEDED for >1000 members; safeParse the declared output and map invalid stored output to INTERNAL_ERROR, never BAD_ARGS.

- [ ] Implement runtime metadata parsing in cards.ts for list_cards. Use `z.object({time_zone:z.string().min(1).max(100)}).strict()`; if metadata is undefined use Asia/Ho_Chi_Minh. Validate with Intl.DateTimeFormat then query `SELECT 1 FROM pg_timezone_names WHERE name=<bound zone> LIMIT 1`. On absent name or invalid Intl timezone throw ToolError(BAD_ARGS,"Unsupported time zone"). Reject malformed supplied metadata; do not treat it as missing.
- [ ] Pass the metadata from server.ts:

```ts
const result = await hub.call(name, request.params.arguments ?? {},
  request.params._meta?.["ati/authorization"], request.params._meta?.["ati/runtime"]);
```

Extend Gateway.call's definition/implementation with optional CallContext. Merge both metadata entries in a single object, preserving authorization:

```ts
const meta = {
  ...(authorization ? {"ati/authorization":authorization} : {}),
  ...(context ? {"ati/runtime":{time_zone:context.timeZone}} : {}),
};
// In client.callTool request, include _meta:meta only when Object.keys(meta).length>0.
```

In attempts.ts, capture context from the same successful startAttempt transaction that locks/reads the run, and pass it as the fifth argument. Declare `let context:CallContext` before the try block, assign it from the begin() return value, return `{timeZone:run.time_zone}` at the callback end. A thrown start transaction still follows BeforeDispatchError; do not add a second unlocked lookup, mutate process.env, use machine timezone or change certainty handling. Existing test wrappers forwarding `...args` must forward the fifth argument too.

- [ ] Add runtime counterexamples before declaring the reads complete. Test matrix:

| Case ID | Setup/action | Required oracle |
|---|---|---|
| R01 | Seed get_card/list_cards/list_members | Exact objects above; zero new receipts/messages |
| R02 | Valid board, filter with no matching cards | cards=[],count=0 |
| R03 | Board absent/other owner; card absent/other owner | NOT_FOUND; no owner data returned |
| R04 | list or assignee exists only in another board/owner | NOT_FOUND even though its name/ID exists elsewhere |
| R05 | since later than until; impossible date; extra args | BAD_ARGS, no DB mutation |
| R06 | Four cards at HCM lower-1ms, lower, upper-1ms, upper for 2026-09-14 | Only lower and upper-1ms appear; order deterministic |
| R07 | Same four-boundary fixture for NY 2026-03-08 | Window 05:00Z to next-day04:00Z; 23h, exact endpoints |
| R08 | Unknown/malformed timezone | BAD_ARGS, no silent fallback |
| R09 | Done card, unassigned card, other-board card, member with 0 cards | Only own active assigned cards count |
| R10 | 1001 matched cards / 1001 members in isolated DB | LIMIT_EXCEEDED, no truncated successful result |
| R11 | Two cards share updated_at | Deterministic card_id COLLATE C order |

For R06/R07, insert the four dedicated cards and move normal seed cards outside the tested window; use bound parameters. Existing call() helper may gain an optional context argument after its current client argument, or call client.callTool directly for metadata cases. Show explicit actual expected card IDs; do not compute expected boundaries with the same SQL/expression under test.

- [ ] Activate the three new reads in ENABLED_TOOL_NAMES and keep the server name/version ati-task-hub-local/0.1.0. Annotate toolDefinitions callback `name:ToolName` when comparing with future names to avoid narrowing to the old literal array. Update the independent discovery expectation to these six exact names:

```ts
["append_sheet_rows","get_card","list_cards","list_members","read_sheet_range","send_slack_message"]
```

Run build + only targeted `[TH-03]` receiver tests first. Include an `[TH-03]` live discovery test that compares the six explicit names and each live schema to the newly built toolDefinitions, alongside the independent business oracles. The existing full discovery test compares to testdata/tools.json and will remain red until the next catalog sync; this staged dependency is expected. Do not skip/weaken that test, and do not claim the checkpoint complete yet.

- [ ] Once receiver tests prove those names/schema/calls, create apps/mcp-task-hub/scripts/sync-catalog.mjs with the following full behavior. This script is for a verified activation, not an automatic test result generator:

```js
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {toolDefinitions} from '../dist/contracts.js';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const target=path.join(root,'testdata/tools.json');
const catalog=JSON.parse(readFileSync(target,'utf8'));
const hub=catalog.servers.find(s=>s.slug==='task_hub');
if(!hub)throw Error('Missing task_hub catalog');
const allowed=new Set(['list_cards','get_card','list_members','create_card','move_card']);
const live=toolDefinitions();
for(const definition of live){
  if(!allowed.has(definition.name))continue;
  const item=hub.tools.find(t=>t.name===definition.name);
  if(!item)throw Error('Missing declared tool '+definition.name);
  item.inputSchema=definition.inputSchema;
  item.outputSchema=definition.outputSchema;
  item.description=definition.description;
  item.evidence='IMPLEMENTED_LIVE_DISCOVERY_CHECKED';
}
hub.status=live.length===8?'IMPLEMENTED_8_OF_8':'PARTIAL_'+live.length+'_OF_8_IMPLEMENTED';
catalog.note=`${live.length} task_hub tools implemented and verified through live MCP; filesystem remains SPEC_ONLY. All data stays local.`;
writeFileSync(target,JSON.stringify(catalog,null,2)+'\n');
console.log(JSON.stringify({active_tools:live.map(t=>t.name),requires_prior_live_test_evidence:true}));
```

Do not invoke it before targeted receiver evidence exists. It only modifies the five planned entries and the truthful counts/notes; sideEffect/policyVersion stay as declared. Disabled write entries remain SPEC_ONLY.

- [ ] Run the script, add the three read names to gateway.ts's independent policy map, and run npm run check:engine with TH-03 evidence override. Assert all six live schemas equal reviewed catalog. Add an engine test using `engine.prepare(readPlan,{timeZone:"America/New_York"})` with literal since/until and R07 DB rows; expect exactly the NY-boundary IDs in trace.result, demonstrating saved run timezone crosses the actual MCP wire. Inspect returned run.time_zone too. Existing b02/CLI/unknown/cancel/lock tests must still pass.

### TH-04: create_card with atomic receipt

**Files:** cards.ts/service.ts/contracts.ts, gateway.ts, tools.integration.test.ts, testdata/tools.json. Reuse sync-catalog.mjs. No move activation.

**Consumes:** shared receiver transaction after authorization/operation check, current policy/fingerprint and schemas. Only changes inside business mutation block plus name activation.

**Produces:** `CardWriteName = "create_card" | "move_card"`, `isCardWriteName`, `writeCardTool(tx,userId,name,args,assertLive)`; actual create supported, disabled move rejected. Return value is the declared output; outer facade validates and inserts receipt once.

```ts
export type ReceiverTx = Parameters<Parameters<Database["db"]["transaction"]>[0]>[0];
export type CardWriteName = "create_card" | "move_card";
export declare function isCardWriteName(name: ToolName): name is CardWriteName;
export declare function writeCardTool(tx:ReceiverTx,userId:string,name:CardWriteName,
  args:unknown,assertLive:()=>Promise<void>):Promise<Record<string,unknown>>;
```

- [ ] Add live create tests prefixed `[TH-04]` using the existing call()/grant() helpers. grant() is explicitly a receiver test fixture; never present it as real controller evidence. Primary test before implementation:

```ts
const args={board_id:"board_a",list_name:"Backlog",title:"Viết tài liệu API",
  description:"OpenAPI notes",due_date:"2026-09-20",assignee_id:"m2"};
const auth=await grant("create_card",args);
const response=await call("create_card",args,auth);
expect(response.isError).not.toBe(true);
const output=outputs.create_card.parse(response.structuredContent);
expect(output.id).toMatch(/^[a-f0-9-]{36}$/);
const stored=await raw`SELECT board_id,list_name,title,description,due_date::text AS due_date,assignee_id FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id=${output.id}`;
expect(stored[0]).toEqual({...args});
const receipt=await raw`SELECT result FROM hub_receipts WHERE user_id=${DEMO_USER_ID} AND operation_id=${auth.operation_id}`;
expect(receipt).toHaveLength(1);
expect(receipt[0]!.result).toEqual({id:output.id});
```

- [ ] Inside writeCardTool's create branch parse inputs.create_card. Select owned board/list and optional member, each FOR KEY SHARE, with board_id constraints. Missing/foreign resources throw NOT_FOUND. Call assertLive AFTER those locks. Insert into hub_cards omitting card_id so PostgreSQL generates it; omitted description becomes empty string only in storage, due/assignee become NULL. Return only generated id. Use tx.execute(sql`... RETURNING card_id AS id`) or tx.insert(cards).returning; stay on tx.

```ts
await assertLive();
const [created] = await tx.execute<{id:string}>(sql`
 INSERT INTO hub_cards(user_id,board_id,list_name,title,description,due_date,assignee_id)
 VALUES (${userId},${input.board_id},${input.list_name},${input.title},
         ${input.description ?? ""},${input.due_date ?? null}::date,${input.assignee_id ?? null})
 RETURNING card_id AS id`);
if (!created) throw new ToolError("INTERNAL_ERROR","Card insert returned no ID");
return {id:created.id};
```

The selections/ownership checks before this snippet are mandatory. Do not let FK errors substitute for useful NOT_FOUND errors; FKs are the additional backstop. The handler must not create a receipt itself. In service.ts choose this branch only after the existing gate/receipt-replay/in_flight check, then run the existing common output-validation/receipt-insert/assertLive block. Convert invalid stored/output result to INTERNAL_ERROR at the relevant output validation boundary, while preserving BAD_ARGS for actual request schema failures.

- [ ] Complete create failure/replay matrix. Independent intents always use distinct grant() results; replay intentionally reuses the same auth.

| Case | Required oracle |
|---|---|
| Missing metadata / pending / expired / stale hash/version / wrong owner | isError NOT_AUTHORIZED, card count unchanged, zero receipt for operation |
| Missing board/list/assignee or assignee from another board | NOT_FOUND, no new card/receipt |
| Extra arg, whitespace title, invalid date, title >500, description >16000 | BAD_ARGS, no mutation |
| No optional fields | Stored description empty, due/assignee NULL; approval hash still matches omitted args |
| Same auth+payload concurrent calls | Same returned id; exactly one new card and receipt |
| Same operation with changed title or board | NOT_AUTHORIZED; original card/result unchanged |
| Distinct operations with same title | Two distinct IDs and two receipts |
| Replay after MCP restart | Same committed ID; no second card |
| Receipt insert trigger failure after insert | Entire card insert rolled back, zero receipt; do not classify RPC success from transport alone |
| Destination row lock held until approval expires | NOT_AUTHORIZED after release; no card/receipt |

For rollback, create a trigger on hub_receipts in the isolated DB that raises only for create_card; clean it up in finally. For lock/expiry, hold `SELECT ... FROM hub_lists ... FOR UPDATE` on a dedicated test connection, set the fixture approval's expires_at to a short future DB interval, start the real call, verify it is waiting via pg_stat_activity (DB/user filtered), release the lock after DB clock passes expires_at. Do not rely only on a blind sleep. Use test timeout overrides only for the bounded lock test; do not skip it.

- [ ] Activate create_card in enabled names, assert the seven exact discovery names (the six from TH-03 plus create_card), build and run targeted `[TH-04]` receiver tests including discovery against built schemas and create business/gate cases. Then sync catalog, add create_card:write to gateway's independent map and run npm run check:engine with TH-04 evidence override; its full suite must include the existing reviewed-catalog equality test. Engine's write unknown classification remains unchanged. Report real DB counts and receipt IDs in JSON/log, not credentials.

### TH-05: move_card with serialization and correct workload

**Files:** cards.ts/service.ts/contracts.ts, gateway.ts, tools.integration.test.ts, testdata/tools.json. Reuse error, schema, gate and evidence mechanisms.

**Consumes:** ReceiverTx/writeCardTool from TH-04; input move_card schema; seeded card/list; shared approval/receipt lifecycle.

**Produces:** move_card, eight enabled names, task_count reflecting current terminal-list state. No cross-board move API.

- [ ] Write `[TH-05]` red test using actual MCP and grant(). Do not mutate expected from returned result:

```ts
const args={card_id:"c1",target_list:"Done"};
const auth=await grant("move_card",args);
const response=await call("move_card",args,auth);
expect(response.isError).not.toBe(true);
expect(response.structuredContent).toEqual({id:"c1",list_name:"Done"});
expect((await raw`SELECT board_id,list_name FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'`)[0])
  .toEqual({board_id:"board_a",list_name:"Done"});
expect((await call("list_members",{board_id:"board_a"})).structuredContent)
  .toEqual({members:[{id:"m1",name:"An",task_count:0},{id:"m2",name:"Bình",task_count:0}]});
```

- [ ] Implement the move branch on the shared tx. Select card by owner/card_id FOR UPDATE, preserving the DB board_id rather than taking one from args. Confirm target list exists in that exact board/owner FOR KEY SHARE; assertLive after locking. Missing card/list yields NOT_FOUND. A different target updates list_name and updated_at=clock_timestamp(); same target keeps both values and still returns an output for common receipt insertion.

```ts
const [card]=await tx.execute<{board_id:string;list_name:string}>(sql`
 SELECT board_id,list_name FROM hub_cards WHERE user_id=${userId} AND card_id=${input.card_id} FOR UPDATE`);
if(!card)throw new ToolError("NOT_FOUND","Card not found for this principal");
const target=await tx.execute(sql`
 SELECT 1 FROM hub_lists WHERE user_id=${userId} AND board_id=${card.board_id} AND list_name=${input.target_list} FOR KEY SHARE`);
if(!target.length)throw new ToolError("NOT_FOUND","Target list does not exist in the card's board");
await assertLive();
if(card.list_name!==input.target_list)await tx.execute(sql`
 UPDATE hub_cards SET list_name=${input.target_list},updated_at=clock_timestamp()
 WHERE user_id=${userId} AND card_id=${input.card_id}`);
return {id:input.card_id,list_name:input.target_list};
```

- [ ] Run these additional counterexamples; never turn the gate off for the “same target” case:

| Case | Required oracle |
|---|---|
| No/pending/expired/stale/other-owner approval | No card/timestamp change, zero receipt |
| Target exists only in other board/owner | NOT_FOUND; no cross-board move |
| Same operation replay, including after restart | One receipt, same result, unchanged timestamp on replay |
| Same-target new operation | Valid approval required; same timestamp; one new receipt for that distinct intent |
| Two concurrent identical calls | One mutation/receipt; exact same output |
| Two distinct operations to different targets | Both serialized commits; two receipts, final state equals last actual commit, no lost receipt; enforce call ordering with a test barrier if asserting a particular target |
| Receipt insert failure after card update | Card list and timestamp roll back; no receipt |
| Card row lock outlives approval TTL | NOT_AUTHORIZED; no move or receipt after waiting |
| Done → Doing by a new approved operation | m1.task_count rises to 1; other members/boards unchanged |

For rollback compare the original timestamp captured before call; do not assert merely “it is not null.” For distinct-operation concurrency record the outcomes/receipts and use a deterministic barrier for last-writer assertion; wall-clock arrival order alone is not commit order.

- [ ] Enable move_card, update the exact eight-name discovery assertion, build/run targeted `[TH-05]` receiver tests including live discovery and all move cases, then sync catalog and add move_card:write to gateway. Full receiver/catalog equality is checked after sync. Final policy map is:

```ts
const policy = {
  read_sheet_range:"read",append_sheet_rows:"write",send_slack_message:"write",
  list_cards:"read",get_card:"read",list_members:"read",create_card:"write",move_card:"write",
} as const;
```

Keep name/schema/identity/artifact checks in gateway and server version as declared. Run npm run check:engine with TH-05 evidence override. Report the eight names, hashes and remaining filesystem SPEC_ONLY; do not report G1 overall complete.

### TH-06: Real controller, card workflows and uncertainty

**Files:** controller.integration.test.ts; new tests/task-hub-plans.ts and testdata/dev-hand-plans/th-move.json. Reuse the current generic crash-worker.mjs unchanged: it exits after the first successful authorized write of any name, and already restricts its database to engine_it_UUID.

**Consumes:** WorkflowEngine.prepare/decide/execute/detail/trace/events/reconcile/recoverOrphans and openLocalGateway from @wap/engine; existing controller test start(), db/raw, decision() helpers. These tests must not use the receiver grant() fixture to create approvals.

**Produces:** verified one-preview card workflows, unknown-result behavior for both create and move, a CLI-consumable hand plan. No new CLI command is needed; `prepare <plan.json>` already exists.

- [ ] Create the dev-only th-move.json with exactly this plan. Keep refs as literal `${...}` strings; do not let shell variable interpolation rewrite them:

```json
{
  "version":"1.0",
  "name":"Move local card and notify",
  "source_prompt":"Đọc c1, chuyển c1 sang Done và thông báo tiêu đề đã xem vào #team.",
  "steps":[
    {"id":"read","description":"Read existing local card","tool":{"server":"task_hub","name":"get_card","args":{"card_id":"c1"}},"side_effect":"read","depends_on":[]},
    {"id":"move","description":"Move existing card","tool":{"server":"task_hub","name":"move_card","args":{"card_id":"${steps.read.output.id}","target_list":"Done"}},"side_effect":"write","depends_on":["read"],"idempotency_key":"${runtime.run_id}_move"},
    {"id":"notify","description":"Report approved title","tool":{"server":"task_hub","name":"send_slack_message","args":{"channel":"#team","text":"Đã chuyển ${steps.read.output.title} sang Done."}},"side_effect":"write","depends_on":["move"],"idempotency_key":"${runtime.run_id}_notify"}
  ],
  "outputs":{}
}
```

- [ ] In task-hub-plans.ts export exact helpers `makeMovePlan():WorkflowPlan`, `makeCreatePlan(withNotify=false):WorkflowPlan`, `makeMembersPlan():WorkflowPlan`. Each returns WorkflowPlanSchema.parse of a fresh object/read JSON, not a shared mutated singleton. makeMovePlan loads that JSON. Other helper contents:

```ts
export function makeCreatePlan(withNotify=false):WorkflowPlan {
  return WorkflowPlanSchema.parse({version:"1.0",name:"Create local card",source_prompt:"Tạo card Docs ở Backlog.",
    steps:[{id:"create",description:"Create Docs",tool:{server:"task_hub",name:"create_card",
      args:{board_id:"board_a",list_name:"Backlog",title:"Docs"}},side_effect:"write",depends_on:[],
      idempotency_key:"${runtime.run_id}_create"},
      ...(withNotify?[{id:"notify",description:"Notify",tool:{server:"task_hub",name:"send_slack_message",
        args:{channel:"#team",text:"Đã tạo card Docs."}},side_effect:"write",depends_on:["create"],
        idempotency_key:"${runtime.run_id}_notify"}]:[])],outputs:{}});
}
export function makeMembersPlan():WorkflowPlan {
  return WorkflowPlanSchema.parse({version:"1.0",name:"Read workload",source_prompt:"Liệt kê thành viên board_a.",
    steps:[{id:"read",description:"Read workload",tool:{server:"task_hub",name:"list_members",
      args:{board_id:"board_a"}},side_effect:"read",depends_on:[]}],outputs:{members:"${steps.read.output.members}"}});
}
```

Import WorkflowPlanSchema/type WorkflowPlan from @wap/dsl. Derive root with fileURLToPath(new URL('../../../',import.meta.url)) from packages/engine/tests; use fs/path imports to load the JSON. Do not introduce public engine APIs just for fixtures.

- [ ] Add `[TH-06]` tests before any implementation fix. Most runtime code should already work after TH-05. For these integration-extension tests an immediate PASS is acceptable: they independently verify previously untested combinations rather than pretending a missing behavior was found. If a test fails, capture actual/expected and apply only a scoped fix; do not rewrite the engine or weaken gates.

```ts
const {engine}=await start();
const run=await engine.prepare(makeMovePlan());
expect(run.status).toBe("awaiting_approval");
expect(run.approval.actions).toHaveLength(2);
expect((await raw`SELECT list_name FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'`)[0]!.list_name).toBe("Doing");
expect(await count("hub_receipts")).toBe(0);
await raw`UPDATE hub_cards SET title='Changed after preview' WHERE user_id=${DEMO_USER_ID} AND card_id='c1'`;
await engine.decide(run.run_id,decision(run));
expect((await engine.execute(run.run_id)).status).toBe("succeeded");
expect((await raw`SELECT list_name FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'`)[0]!.list_name).toBe("Done");
expect((await raw`SELECT text FROM hub_messages WHERE user_id=${DEMO_USER_ID}`)[0]!.text).toBe("Đã chuyển Viết API sang Done.");
expect(await count("hub_receipts")).toBe(2);
expect(await raw`SELECT id FROM approvals WHERE run_id=${run.run_id}`).toHaveLength(1);
const trace=TraceSchema.parse(await engine.trace(run.run_id));
expect(trace.attempts).toHaveLength(3);
expect(trace.attempts.every(a=>a.ended_at && a.outcome_certainty==="confirmed")).toBe(true);
```

- [ ] Complete these engine oracles, using separate test seed/reset for each:

| Case ID | Scenario | Required oracle |
|---|---|---|
| E01 | makeMovePlan above, source title changes after preview | Original title in notification; one approval/two receipts/three confirmed attempts |
| E02 | makeCreatePlan(false) | prepare creates no card/receipt; after decision exactly one extra card and one receipt with its actual ID |
| E03 | makeMembersPlan | succeeded without approval, one read attempt, m1=1/m2=0, no receipts |
| E04 | Dev b03 with its own seeded c1 | Notify exactly Task: Viết API; one receipt |
| E05 | Dev b01 adapted to fixed dates 2026-09-14..20, own fixture c1=API/Done, c2 outside window | Exactly c1 result; call it b01-fixed-window, not unmodified current-week runtime |
| E06 | prepare list_cards with explicit NY timezone and boundary fixture | Saved zone appears in run, receiver applies NY window rather than HCM default |
| E07 | create/move relabelled as read by forged plan | INVALID_PLAN before dispatch; zero side effects |
| E08 | create result referenced by downstream move args | INVALID_PLAN under existing write-output-reference rule |
| E09 | Wrong owner/hash/version, rejection/expiry for card action | No card mutation; exact existing error/status semantics retained |
| E10 | Two execute calls on same approved card run | Only one succeeds/claims; no duplicate card/move/message/receipts |
| E11 | Lost response after real create or move commits | One first-write receipt, no notify, run reconciliation_required, reconcile confirmed, trace stays historical unknown |
| E12 | Child process exits86 after actual create or move receiver commit | recoverOrphans marks reconciliation_required, closes attempt, no resume/notify; actual receipt matches operation |
| E13 | CLI prepare JSON → preview → approve exact identifiers → execute → trace in separate processes | Real database outputs match E01; no fabricated approval row |
| E14 | Existing b02, cancel/terminal-event, read retry, lease-loss and completion-persistence regressions | All still pass; original expected payloads/receipt counts unchanged |

E05 must select b01 only with split=dev; use literals in the cloned test plan because current wall clock is not the original fixture week. Its fixture setup is an explicit test-only SQL UPDATE; do not edit testdata/test-cases.json to reconcile b01/b03. E06 tests actual context transport; do not replace it with a mock checking that a parameter exists.

- [ ] For E11, wrap only the real gateway response after the first authorized write; preserve the optional fifth context argument. The transport/receiver must have actually run:

```ts
let lost=false;
const lossy={...gateway,async call(...args:Parameters<Gateway["call"]>){
  const response=await gateway.call(...args);
  if(args[2] && !response.isError && !lost){lost=true;throw new Error("Injected response loss after commit");}
  return response;
}};
const worker=new WorkflowEngine(db,lossy,DEMO_USER_ID);
// prepare/decide/execute via worker; then inspect with new WorkflowEngine(db,undefined,DEMO_USER_ID).
```

Run once with makeCreatePlan(true) and once with makeMovePlan. Confirm no notify, a single receipt and actual changed DB card, not just operation.state. Reconcile must leave the trace unchanged and must not auto-execute remaining steps. For E12 reuse the existing execFile crash harness arguments [url,userId,runId,root] and assert exit code86; do not kill unrelated Node processes.

- [ ] For E13 reuse the existing separate-CLI-process helper and engine_it_ URL. Pass an absolute path to th-move.json; keep every test subprocess windowsHide:true. Inspect actual card state/message/receipt with raw SQL after CLI returns. Keep existing prepare-b02 CLI test too.
- [ ] Add card observations into the controller test's existing evidence object under unique keys card_move, card_create, card_response_loss, card_process_crash, card_timezone. Capture actual outputs/operation IDs/trace/status and fixed test inputs; do not dump DB connection URLs or credentials.
- [ ] Run build, targeted controller `[TH-06]` tests, then full npm run check:engine with TH-06 evidence override. Record all counts and failures. No assertions may be skipped because they require actual MCP/DB. Report what was fault-injected versus real process/DB behavior.

### TH-07: Final evidence, documentation and handoff

**Files:** docs/TASK-HUB-STATUS-2026-09-13.md (new report), docs/task-hub-evidence/batch-01/final/, relevant current READMEs/BASELINE progress/00-BAT-DAU/KE-HOACH-6-TUAN/EXECUTION-CONTRACT/db/DATABASE.md/testdata/TESTDATA.md. Modify only progress/how-to statements consistent with completed work. Historical reports stay unchanged.

**Consumes:** passed TH-01–06 artifacts and source, eight-tool catalog, unchanged B/local scope. Source clock/test results determine evidence, not the date in a filename.

**Produces:** final independently readable report with fresh checks, eight live tools, hashes and current remaining scope. No new application behavior.

- [ ] Inspect source/test changes against spec one last time. All five tool field shapes match; old three emitted schemas remain identical to handoff baseline; gate/receipt/unknown rules still present. Confirm only one shared receiver gate handles all writes.
- [ ] Set fresh evidence directory and run the final commands. Use one suite at a time, check exit code after each, keep log files separate:

```powershell
$env:ATI_EVIDENCE_DIR = 'docs/task-hub-evidence/batch-01/final'
New-Item -ItemType Directory -Force -Path $env:ATI_EVIDENCE_DIR | Out-Null
npm ci --ignore-scripts --no-audit --no-fund 2>&1 | Tee-Object "$env:ATI_EVIDENCE_DIR/npm-ci.log"
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
npm run check:engine 2>&1 | Tee-Object "$env:ATI_EVIDENCE_DIR/check.log"
if ($LASTEXITCODE -ne 0) { throw 'Final check failed' }
```

No new package should be needed, so unexplained lockfile changes need review. If code was changed after the final build/test, rerun affected tests/build and any full gate invalidated by the change; documentation-only edits need link/content checks, not a fictitious second runtime pass.

- [ ] Create a **read-only** task-hub-runtime.json snapshot. On a new isolated test DB with all four migrations + seed, connect actual MCP client, list all eight tools, call read_sheet_range/get_card/list_cards/list_members, validate outputs and record exact names/schema/principal/test fixture. Capture four migration ledger entries/checksums and Node/SDK/PG versions. Do not call writes merely to record a status snapshot; mutation evidence already comes from full integration cases. Close MCP/DB and drop only that generated DB in finally.

Create `docs/task-hub-evidence/batch-01/final/capture-runtime.mjs` from this code. Only fixture provisioning writes to the generated database; all tool calls in this script are reads. openLocalGateway performs the actual tools/list handshake and exact live-schema validation before returning its reviewed tools.

```js
import postgres from 'postgres';
import {randomUUID} from 'node:crypto';
import {writeFileSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {openDatabase,migrate,seedDemo,G1_DATABASE_URL,DEMO_USER_ID} from '@wap/db';
import {openLocalGateway} from '@wap/engine';
import {normalizeToolResult} from '@wap/dsl';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const name='engine_it_'+randomUUID().replaceAll('-','');
const address=new URL(G1_DATABASE_URL);
if(!['127.0.0.1','localhost'].includes(address.hostname))throw Error('Local test database required');
address.pathname='/'+name;
const url=address.href, admin=postgres(G1_DATABASE_URL,{max:1,onnotice:()=>{}});
let db,gateway,created=false;
try{
  await admin.unsafe(`CREATE DATABASE "${name}"`);created=true;
  await migrate(url);db=openDatabase(url);await seedDemo(db);
  gateway=await openLocalGateway({root,databaseUrl:url,userId:DEMO_USER_ID});
  const reads=[['read_sheet_range',{spreadsheet_id:'source',range:'Progress!A1:B2'}],
    ['get_card',{card_id:'c1'}],['list_cards',{board_id:'board_a'}],['list_members',{board_id:'board_a'}]];
  const outputs={};
  for(const [tool,args] of reads){
    const definition=gateway.tools.find(t=>t.name===tool);
    if(!definition)throw Error('Missing tool '+tool);
    const result=normalizeToolResult(definition,await gateway.call(tool,args,undefined,10000,{timeZone:'Asia/Ho_Chi_Minh'}));
    if(!result.ok)throw Error('Read/schema failed: '+tool);
    outputs[tool]=result.output;
  }
  const lock=JSON.parse(readFileSync(path.join(root,'package-lock.json'),'utf8'));
  const snapshot={recorded_at:new Date().toISOString(),scope:'ISOLATED_SEEDED_DB_READ_ONLY_MCP_CALLS',
    node:process.version,sdk:lock.packages['node_modules/@modelcontextprotocol/sdk'].version,
    database:name,principal:DEMO_USER_ID,live_discovery_validated:true,tools:gateway.tools,outputs,
    postgres:await db.client`SELECT current_setting('server_version') AS version`,
    migrations:await db.client`SELECT name,checksum FROM schema_migrations ORDER BY name`};
  if(snapshot.tools.length!==8 || snapshot.migrations.length!==4)throw Error('Final catalog/migration count differs');
  writeFileSync(new URL('task-hub-runtime.json',import.meta.url),JSON.stringify(snapshot,null,2)+'\n');
  console.log(JSON.stringify({tools:snapshot.tools.map(t=>t.name),migrations:snapshot.migrations.map(m=>m.name)}));
}finally{
  await gateway?.close();await db?.close();
  if(created)await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
```

Run after the final build: `node docs/task-hub-evidence/batch-01/final/capture-runtime.mjs`; capture its exit code/log. Keep UUID generation and fixed prefix, never pass a user-supplied DB name into these unsafe DDL strings.

Do not use scripts/g1-status.mjs's persistent demo snapshot as proof the new tables have been migrated in wap_g1: TH-01 deliberately did not do that. The old script can still capture healthy services/read_sheet_range if desired, with evidence override, but label its scope accurately. Provide migration/seed commands for the user to apply to the demo later; do not silently claim they were run.

- [ ] Create `final/manifest.json` containing recorded_at, scope, actual test counts, skipped/failed counts, eight tool names, migration names/checksums, source/lock/catalog hashes, and paths to logs/observations. Include source hashes for all modified source/tests/scripts, new migration and dev plan. Use createHash('sha256') over actual file bytes; do not invent values. Also record old3-schema equality and unchanged historical-migration/evidence hash checks against the handoff JSON.
- [ ] Update current docs to say 8 task_hub tools implemented and engine card flows verified. Correct TESTDATA's stale claim “chưa có controller/engine thật”; distinguish per-case fixture b01/b03 and actual controller tests. Keep b02's original evidence historical and keep AI experiment NOT_RUN. Mention new date metadata/active workload semantics and schema constraints in EXECUTION-CONTRACT/tool README.
- [ ] Document the manual demo sequence: build → db:migrate:g1 → db:seed:g1 → `engine -- prepare testdata/dev-hand-plans/th-move.json` → preview → approve exact IDs/hash → execute → trace. Make it explicit migration/seed preserve data and that seed won't reset c1 back to Doing after a prior move. A repeated run is a new approved intent, not a replay of the old run.
- [ ] Report G1 overall PARTIAL: filesystem adapter and rubric still missing. HTTP/UI/polling/session/AI/BullMQ remain unimplemented. Eight tools in task_hub are not two MCP servers.
- [ ] Run a documentation link/path check on new and updated docs, excluding fenced code and planned future paths. Source-check all reported commands/files exist. Do not call old historical verify-artifacts scripts if they overwrite their old result JSON; copy/adapt a verifier under the new evidence directory if needed.
- [ ] Fill TH-07.md with actual outcomes, then give a short summary and links. Stop. The user's next requested batch controls further implementation.

## Review checklist for Codex or a human

Review reports and affected files, not just total tests:

- [ ] TH-01: migrations0001–3 unchanged; composite FKs stop cross-owner data; seed rerun preserves edits; evidence override really avoids old files.
- [ ] TH-02: disabled names not advertised; request/output schema distinction; no new input defaults; explicit write dispatch.
- [ ] TH-03: owner/board filters, empty versus missing resource, 1001 limit, date boundaries/DST, saved timezone crossing real MCP, catalog/gateway consistency.
- [ ] TH-04: DB-generated card ID; gate reused; optional values don't change fingerprint; exactly one insert+receipt under concurrent replay; expiry after locks rolls back.
- [ ] TH-05: move restricted to card's board; card lock; same-target timestamp; receipt rollback; active count; no cross-board/owner leakage.
- [ ] TH-06: real controller approvals, old snapshot used after source change, no downstream write-output refs, unknown never retries, real crash cases close attempts and retain receipts.
- [ ] TH-07: fresh logs/versions/hashes; zero hidden skips/deletions; claims limited to what ran; no AI or G1-complete claim.

## Spec-to-task coverage

| Spec requirement | Implementation gate |
|---|---|
| Owner-scoped SQL + preserving seed + old migration safety | TH-01 |
| Exact public fields, strict schemas, descriptions and read annotations | TH-02 |
| Read semantics/order/limits/workload/date/timezone | TH-03 |
| Approval-gated create + atomic receipt | TH-04 |
| Approval-gated move + locking/current workload | TH-05 |
| Staged explicit tool activation | TH-02→03→04→05 |
| Controller/CLI/unknown/crash/snapshot invariants | TH-06 |
| Evidence isolation, unchanged old contracts and truthful completion | TH-01 + TH-07 |

## When the executor should stop and ask for a decision

Stop only the dependent work when a concrete conflict requires changing the approved scope/schema/authorization model, when preserving existing data is impossible with the proposed step, or when required runtime/configuration cannot be obtained. Report actual file/line/error, current behavior, expected behavior and the smallest proposed adjustment. Ordinary edit/build/test/fix cycles within the assigned task do not need another permission question.

Do not remove approval checks, use raw SQL to forge controller success, replace MCP with a fake server to claim integration, add a provider key to files, alter holdout to pass, or downgrade a failed test to NOT_RUN after it actually failed. Failed means FAILED; NOT_RUN means it did not run.
