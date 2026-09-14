# Filesystem + G1 — Implementation Plan, đợt 2

> **For agentic workers:** Dùng `superpowers:executing-plans` nếu môi trường có skill; Antigravity đọc trực tiếp checklist. Theo yêu cầu người dùng: Gemini 3.8 Flash High, một conversation đã audit repo, một task/lần, không sub-agent. Không tự triển khai chỉ vì đã đọc plan.

**Goal:** Nối filesystem MCP thật vào engine, giữ đúng approval/unknown semantics, kiểm hai server và chuẩn bị đủ evidence để đóng G1 theo rubric có nguồn.

**Architecture:** Composite gateway route theo server + name; task_hub giữ transaction receipt. Filesystem dùng adapter hai tool, root riêng từng demo principal và một dispatch marker PostgreSQL chống gửi lặp, không giả receipt atomic DB/file.

**Tech stack:** Windows/PowerShell, Node >=22 (máy đã quan sát v24.19.0), TypeScript, Zod/Ajv, MCP SDK 1.30.0, upstream filesystem 2026.8.31, PostgreSQL 16, Vitest hiện có. Không cần Redis worker, HTTP hoặc UI.

**Spec:** [Thiết kế đợt 2](../specs/2026-09-13-filesystem-g1-design.md). **Baseline:** [filesystem-handoff-baseline.json](../../antigravity/filesystem-handoff-baseline.json). **Cách giao task:** [FILESYSTEM-G1-HANDOFF](../../antigravity/FILESYSTEM-G1-HANDOFF.md).

## 0. Cách dùng và phạm vi

Execution status (2026-09-14): FS-01, FS-02, FS-03 và FS-04 đã được triển khai và nghiệm thu theo các report trong `docs/task-hub-evidence/batch-02/`; FS-05 đạt technical PASS E01–E14 sau gap-closure controller/full gate mới, FS-06 vẫn là task kế tiếp. G1 overall vẫn PARTIAL vì FS-06/rubric chưa hoàn tất; các ranh giới `SPEC_ONLY`, `NOT_RUN` ngoài FS-05 và điều kiện review bên dưới vẫn có hiệu lực.

| Task | Kết quả review độc lập | Phụ thuộc | Ước lượng thao tác + tự kiểm, chưa gồm chờ review |
|---|---|---|---|
| FS-01 | Package pin có provenance; path/UTF-8 policy qua test; upstream discovery/read thật | TH-07 | 3–5 giờ |
| FS-02 | Gateway route hai khóa + receiver mode; tám tool cũ còn nguyên | FS-01 | 3–5 giờ |
| FS-03 | Adapter read-only + preset/root binding; 9 public tools, 2 MCP processes | FS-02 | 3–5 giờ |
| FS-04 | Filesystem write có approval + durable dispatch marker + đúng certainty | FS-03 | 5–8 giờ |
| FS-05 | Hai-server controller/CLI, snapshot và crash/fault tests; E01–E14 PASS, technical PASS; G1 overall PARTIAL | FS-04 | 4–6 giờ |
| FS-06 | Final manifest/demo/rubric matrix và verdict G1 có điều kiện | FS-05 | 2–4 giờ |

Tổng **20–33 giờ kỹ thuật** là ước lượng chưa đo, không phải cam kết tốc độ AI. Đối chiếu lại quỹ giờ 6 tuần sau FS-02. Không cắt kiểm approval/confinement/unknown để vừa ước lượng. Chỉ review sau từng task; lỗi doc-only không tạo thêm vòng full suite.

### Global constraints

- B/local: một worker, tuần tự; không auto-resume, không auto-retry filesystem write, không DSL read sau write hoặc reference tới write output.
- Root hẹp, dữ liệu demo tổng hợp; threat model và giới hạn TOCTOU theo spec. Không gọi thư mục project/home là sandbox.
- Giữ nguyên public schema + policy của **8 task_hub tools**. Filesystem giữ shape args/output hiện có, policy riêng `b-local-fs-1`.
- Giữ nguyên bytes migration 0001–0004 và 180 file protected trong baseline. Không chạy các script historical verifier có thể ghi đè evidence.
- Lockfile được thay ở FS-01 do dependency mới; đó là thay đổi dự kiến, cần inspect diff. Những task sau không tự nâng version.
- 142 test cũ phải vẫn tồn tại và chạy; migration-count assertions được tăng từ 4 lên 5 ở FS-04 nhưng phải giữ oracle bốn migration cũ. Không sửa expected behavior để che regression.
- Không Git stage/commit/push/reset/clean, không đổi nhánh/worktree làm mất uncommitted TH-03–07. Giữ `.gitignore` buffer của người dùng.
- G1 technical và G1 overall có verdict riêng. Rubric chưa được cung cấp -> overall PARTIAL. Không tự tìm topic list rồi gọi đó là rubric.

### Evidence và command runner chung

Mọi task dùng `docs/task-hub-evidence/batch-02/FS-01` … `FS-06`, tương thích validator `ATI_EVIDENCE_DIR` hiện có. Mỗi lần chạy suite mới dùng **thư mục run mới** dưới task, vì các test đang ghi fixed filenames observations. Lưu cả lần đỏ/lỗi setup, không overwrite log/snapshot bằng lần xanh.

FS-01 tạo `scripts/capture-command.mjs`, executable support cho evidence, không phải product API:

```js
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const [task, label, executable, ...args] = process.argv.slice(2);
if (!/^FS-0[1-6]$/.test(task ?? '') || !/^[a-z0-9-]+$/.test(label ?? '') || !executable)
  throw Error('Usage: capture-command.mjs FS-01 label executable args...');
const dir = path.resolve('docs/task-hub-evidence/batch-02', task,
  `${Date.now()}-${label}`);
mkdirSync(path.dirname(dir), { recursive: true });
mkdirSync(dir, { recursive: false }); // never reuse an existing run directory
const started_at = new Date().toISOString();
const result = spawnSync(executable, args, {
  cwd: process.cwd(), encoding: 'utf8', windowsHide: true,
  env: { ...process.env, ATI_EVIDENCE_DIR: dir }, maxBuffer: 32 * 1024 * 1024,
});
const finished_at = new Date().toISOString();
writeFileSync(path.join(dir, 'output.log'), (result.stdout ?? '') + (result.stderr ?? ''), { flag: 'wx' });
writeFileSync(path.join(dir, 'command.json'), JSON.stringify({
  executable, args, started_at, finished_at, exit_code: result.status,
  signal: result.signal, spawn_error: result.error?.message ?? null,
  evidence_dir: dir, scope: label,
}, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ dir, exit_code: result.status, signal: result.signal }));
process.exitCode = result.error ? 1 : result.status ?? 1;
```

Windows: dùng Node gọi `npm-cli.js`, không spawn `npm.cmd` với shell string. Các task dùng những biến PowerShell sau (đây là executable path, không credential):

```powershell
$nodeExe = (Get-Command node).Source
$npmCli = Join-Path (Split-Path (Get-Command npm.cmd).Source) 'node_modules/npm/bin/npm-cli.js'
if (-not (Test-Path -LiteralPath $npmCli)) { throw 'Locate the installed npm-cli.js beside npm.cmd before running.' }
New-Item -ItemType Directory -Force docs/task-hub-evidence/batch-02/FS-01 | Out-Null
```

Nếu vị trí npm khác, xác định từ cài đặt thật một lần và ghi path thực; không chèn wildcard, `npx`, hoặc credentials vào runner. Không dựng timestamps/exit code sau khi process đã chạy mà không có capture. Process interrupted thì lưu null/incomplete cùng signal, không suy thành PASS.

### File map của toàn đợt

| File mới / sửa | Trách nhiệm duy nhất |
|---|---|
| `packages/engine/src/gateway-types.ts` | Gateway/connection/config contracts, target có server |
| `packages/engine/src/gateway-task-hub.ts` | Extract connector task_hub hiện có, không đổi receiver |
| `packages/engine/src/gateway.ts` | Compose, route, assertCurrent, close, re-export API cũ |
| `packages/engine/src/launch-policy.ts` | Preset + package/dependency fingerprint + root binding |
| `packages/engine/src/filesystem-paths.ts` | Lexical policy, canonical containment, bounded UTF-8 validation |
| `packages/engine/src/gateway-filesystem.ts` | Narrow live MCP adapter, normalization, post-write read-back |
| `packages/engine/src/filesystem-authorization.ts` | DB guard và once-only marker, không ghi file |
| `packages/engine/src/receiver-policy.ts` | Closed receiver-mode mapping |
| `snapshot.ts`, `prepare.ts`, `attempts.ts`, `execute.ts`, `recovery.ts`, `cli.ts`, `index.ts` | Những seam cụ thể mô tả ở task, không refactor ngoài scope |
| `db/migrations/0005_filesystem_dispatches.sql`, `packages/db/src/schema.ts` | Durable dispatch marker; không receiver receipt |
| `config/filesystem-reviewed.json`, `config/mcp-presets.json` | Exact reviewed artifact/raw schemas/preset, staged activation |
| `scripts/probe-filesystem-candidate.mjs`, `scripts/prepare-filesystem-demo.mjs` | Isolated read probe; preserving setup root demo |
| `packages/engine/tests/filesystem-*.test.ts`, `gateway-routing.test.ts`, `receiver-policy.test.ts` | Targeted unit/integration/fault tests theo matrix |
| `packages/engine/tests/filesystem-fixture.ts`, `filesystem-crash-worker.mjs` | Resource-owned test setup/cleanup và crash child |
| `testdata/dev-hand-plans/fs-copy-notify.json`, `fs-card-export.json` | Hai plan dev riêng, không sửa 10-case dataset |

## FS-01 — Artifact review và path/UTF-8 policy

**Files:** tạo `filesystem-paths.ts`, `launch-policy.ts` (phần artifact), `filesystem-paths.test.ts`, `vitest.unit.config.ts`, hai script capture/probe; sửa engine package.json, root package-lock, root tsconfig, `scripts/check-engine.mjs`. Chưa sửa approved_presets, chưa bật filesystem qua CLI.

**Consumes:** baseline candidate version/integrity, Node/SDK hiện có. **Produces:** `validateRelativePath(value: string): string`, `inspectFilesystemPath(root: string, relative: string, mode: 'read'|'write', expectedUserId: string): Promise<CheckedFilesystemPath>`, `readBoundedUtf8(absolute: string): Promise<string>`, `validateWriteText(content: string): void`, `captureFilesystemArtifact(projectRoot: string): ArtifactRecord`.

```ts
export type CheckedFilesystemPath = {
  relative: string; absolute: string; canonicalRoot: string;
  rootId: string; rootStat: { dev: number; ino: number };
  expectedReadText?: string; // only from bounded preflight, never returned instead of MCP
};
export type ArtifactRecord = {
  package: '@modelcontextprotocol/server-filesystem'; version: '2026.8.31';
  entryPath: string; nodePath: string; nodeVersion: string;
  files: Array<{ path: string; sha256: string }>;
  dependencyPackages: Array<{ name: string; version: string; root: string }>;
};
```

- [x] **1. Preflight:** đọc spec, TH-07 review, baseline; git status; hash 180 protected files. Ghi FS-01/preflight.json gồm current head, mismatches và lý do source drift nếu có. Mismatch protected -> điều tra trước khi sửa, không update baseline cho xanh.
- [x] **2. Pin dependency, capture ngay từ process:**

```powershell
node scripts/capture-command.mjs FS-01 install $nodeExe $npmCli install --workspace @wap/engine --save-exact @modelcontextprotocol/server-filesystem@2026.8.31 --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Install failed; preserve run evidence.' }
```

Chỉ dependency này được yêu cầu. Inspect package/lock diff và resolved transitive deps; xác nhận top-level MCP SDK vẫn 1.30.0, ghi nested versions nếu npm cần thêm. Hash installed package bytes so với tarball, không coi lock integrity là kiểm installed files. Node entry tìm từ package.json `bin`, không hard-code `.bin` wrapper.

- [x] **3. Thêm runner unit và viết test đỏ trước path implementation.** Engine `test:unit = vitest run --config vitest.unit.config.ts`; include `tests/**/*.test.ts`, exclude `tests/**/*.integration.test.ts`, fileParallelism false. Root tsconfig thêm config mới (src/tests đã có glob). `check-engine.mjs` chạy engine unit sau `npm run check`, trước hai integration suite. Không thay root `npm test` DSL denominator.

Code lexical lõi (kèm test), không dùng nó thay realpath/lstat:

```ts
export function validateRelativePath(value: string): string {
  if (typeof value !== 'string' || !value || value.length > 1024 ||
      value.includes('\\') || value.includes(':') || value.startsWith('/'))
    throw new Error('BAD_PATH');
  const parts = value.split('/');
  for (const part of parts) {
    if (!part || part.startsWith('.') || /[. ]$/.test(part) ||
        !/^[\p{L}\p{N}_-][\p{L}\p{N}_. -]*$/u.test(part) ||
        /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part.normalize('NFKC')))
      throw new Error('BAD_PATH');
  }
  return value; // no URL decoding or normalization of approved args
}
```

```ts
import { it, expect } from 'vitest';
import { validateRelativePath } from '../src/filesystem-paths.js';
it.each(['../x', 'a/../x', '/x', 'C:/x', 'C:x', 'a\\x', '//host/x',
  'a//b', './a', 'a:stream', 'CON.txt', 'COM¹.txt', 'x.', 'x ', '.ati-root.json',
  'a/%2e%2e/x', 'a\u0000b'])('rejects unsafe path %s', value => {
  expect(() => validateRelativePath(value)).toThrow();
});
it('keeps Vietnamese relative paths byte-for-byte', () => {
  expect(validateRelativePath('báo cáo/tiến độ.txt')).toBe('báo cáo/tiến độ.txt');
});
```

- [x] **4. Implement OS checks and bounded text:** canonical root marker/owner; lstat each parent/root/final; reject link/junction, nonregular file and hardlink; path.relative containment checks on real root/real parent; missing leaf allowed only write with existing parent and no differently spelled NFC-equivalent directory entry (upstream has Unicode fallback; do not let new NFD name overwrite existing NFC name). Open/read at most 65,537 bytes, close handle in finally; `TextDecoder('utf-8',{fatal:true,ignoreBOM:true})`; preserve BOM/newlines. For JS write string reject `Buffer.from(s,'utf8').toString('utf8') !== s`, NUL and byte length >65,536. Check regular file nlink before any read and after inspection. No fs write in these helpers.
- [ ] **5. Run boundary matrix below; record raw OS capability failures instead of skipping to green.** Windows junction tests use `fs.symlink(outside, inside, 'junction')` on test-owned directories. (PARTIAL: P11 NOT_RUN do Windows native file symlink UNAVAILABLE / EPERM; không đổi Windows security; confinement gate PARTIAL).

| IDs | Exact oracle |
|---|---|
| P01–P03 | Relative Vietnamese file/subdir accepted; root-relative slash; valid empty file preserved |
| P04–P07 | ../, prefix sibling root-other, absolute/drive/UNC/device/ADS, percent paths rejected; outside sentinel bytes unchanged |
| P08–P10 | reserved names/extensions/superscripts, trailing dot/space, hidden marker rejected |
| P11–P14 | outside symlink, junction, dangling link, file hardlink rejected; no content returned |
| P15–P16 | directory-as-file and missing parent rejected; missing leaf in existing parent accepted only write |
| P17–P20 | UTF-8 Vietnamese + emoji + BOM + CRLF exact; 65,536 bytes accepted, 65,537 rejected; invalid byte sequence/NUL rejected |
| P21–P23 | lone surrogate rejected; root marker wrong principal/root replacement rejected; different-owner root sentinel untouched |
| P24 | Missing leaf with differently spelled NFC/NFD equivalent existing filename rejected; original bytes unchanged |

- [x] **6. Probe exact upstream live read only.** Script owns mkdtemp `ati-fs-it-...`, marker, notes text `Tiến độ ATI\nAPI: Done\n`; launch Node directly at pinned entry with exactly one root, Client without roots capability. Capture server identity + all tools/list pages (duplicate names/cursor loop -> fail), call raw read_text_file, assert structuredContent.content equals fixture text. Capture both schemas/names and launch fields sans secrets. Always close SDK client then remove only owned temp root after realpath containment check. Save cleanup status after cleanup. No raw write for FS-01. Pin probe output to the requested evidence directory and run it through capture-command; the probe code is project-authored and only launches the reviewed installed artifact.
- [x] **7. Record candidate review** in FS-01 evidence: npm integrity, installed bytes, resolved dependencies, actual server info, raw full discovery, selected raw schema hashes, read result, test matrix statuses, root cleanup. Use these observed schemas for `config/filesystem-reviewed.json` at FS-03; do not manually invent live schema JSON.
- [ ] **8. Run unit + full regression, each fresh run dir, then stop.** (PARTIAL: 190 passed, 1 skipped P11; chờ Codex review).

```powershell
node scripts/capture-command.mjs FS-01 unit $nodeExe $npmCli run test:unit -w @wap/engine
node scripts/capture-command.mjs FS-01 check $nodeExe $npmCli run check:engine
```

Expected: existing 142 tests still pass + new path tests; raw discovery/read pass; `config/mcp-presets.json` vẫn deny-all, CLI vẫn 8 tool. Report FS-01.md, including actual counts and native link capabilities. No filesystem write implementation yet.

## FS-02 — Server-qualified gateway và receiver policy

**Files:** tạo gateway-types.ts, gateway-task-hub.ts, receiver-policy.ts, gateway-routing.test.ts, receiver-policy.test.ts; sửa gateway.ts, snapshot.ts, prepare.ts, attempts.ts, execute.ts, recovery.ts, index.ts và current controller test/crash wrapper call sites. Không sửa apps/mcp-task-hub production/contracts.

**Consumes:** current connector, mode column đã có từ migration 0002. **Produces:** interface thống nhất sau; FS-03/04 không được đổi tên tùy ý.

```ts
export type ToolTarget = { server: 'task_hub' | 'filesystem'; name: string };
export interface CallContext {
  timeZone: string;
  worker?: { id: string; assertActive: () => Promise<void> };
}
export interface GatewayResult {
  isError?: boolean; content?: unknown[]; structuredContent?: unknown;
}
export interface Gateway {
  readonly userId: string;
  readonly tools: readonly EngineTool[]; // import type from snapshot.ts
  assertCurrent(): Promise<void>;
  call(target: ToolTarget, args: Record<string, unknown>,
    authorization: Record<string, string> | undefined,
    timeoutMs: number, context?: CallContext): Promise<GatewayResult>;
  close(): Promise<void>;
}
export interface ServerConnection {
  readonly server: ToolTarget['server']; readonly userId: string;
  readonly tools: readonly EngineTool[];
  assertCurrent(): Promise<void>;
  call(name: string, args: Record<string, unknown>,
    authorization: Record<string, string> | undefined,
    timeoutMs: number, context?: CallContext): Promise<GatewayResult>;
  close(): Promise<void>;
}
export interface FilesystemLaunch {
  presetId: 'filesystem-local-v1'; allowedRoot: string;
  policyFile?: string; artifactFile?: string; // trusted test/library config only, not CLI/model input
}
export interface LocalGatewayConfig {
  root: string; databaseUrl: string; userId: string;
  filesystem?: FilesystemLaunch;
}
```

Also define these optional hooks in gateway-types.ts now, using type imports from snapshot.ts and filesystem-paths.ts. They are unused until FS-04; FS-03 can compile its optional connection parameter:

```ts
export interface FilesystemWriteRequest {
  tool: EngineTool; args: { path: string; content: string };
  authorization: { approval_id: string; operation_id: string; snapshot_hash: string };
  checkedPath: CheckedFilesystemPath;
  worker: { id: string; assertActive: () => Promise<void> };
}
export interface FilesystemWriteHooks {
  reserve(request: FilesystemWriteRequest): Promise<void>;
  recheck(request: FilesystemWriteRequest): Promise<void>;
}
```

`gateway.ts` re-exports Gateway/GatewayResult/CallContext/ToolTarget so current imports remain resolvable. Keep `openLocalGateway(config): Promise<Gateway>` and existing config fields. No filesystem config means exactly old eight-tool launch. Trusted library callers/tests may provide isolated policy/root paths; production CLI never exposes these overrides as plan fields or free-form executable arguments.

- [x] **1. Add routing tests before extraction:** two fake ServerConnections with same `name:'read_file'`; `{server:'filesystem',name:'read_file'}` reaches only FS connection. Wrong server/unknown name rejected without call. Test doubles prove routing only, not MCP integration.
- [x] **2. Extract existing task_hub connector verbatim where practical.** Keep server identity/version, eight policies, exact live input/output comparison, direct Node launch, timezone and approval metadata. Include packages/engine/dist routing/receiver-policy bytes in the artifact fingerprint; schema/policy equality is preserved, artifact hash is allowed to change and invalidate old execution previews. Internal connector still receives local name; façade resolves full target and membership first. No silent server fallback or unqualified overload.
- [x] **3. Composite startup/cleanup:** open selected connections; if any fails, close all already opened connections with allSettled. `assertCurrent()` checks every selected connector because saved snapshot includes full registry. `close()` attempts every client, then reports failures; no first-client exception leaving the second running.
- [x] **4. Widen only ToolSchema.server** to `z.enum(['task_hub','filesystem'])`; do not insert default fields or bump snapshot format. Historical task_hub snapshots continue to parse and hash through the unchanged v1 schema; unknown servers are rejected. (A dedicated historical observation test remains documentary rather than writing evidence.)
- [x] **5. Add closed receiver-mode function; persist/validate it:**

```ts
export function receiverModeFor(tool: EngineTool): 'local_transaction' | 'non_idempotent' {
  if (tool.sideEffect === 'write' && tool.server === 'task_hub' &&
      tool.policyVersion === 'b-local-1' &&
      ['append_sheet_rows','send_slack_message','create_card','move_card'].includes(tool.name))
    return 'local_transaction';
  if (tool.sideEffect === 'write' && tool.server === 'filesystem' &&
      tool.name === 'write_file' && tool.policyVersion === 'b-local-fs-1')
    return 'non_idempotent';
  throw new EngineError('REGISTRY_CHANGED', 'No reviewed receiver mode for this write');
}
```

In prepare replace hard-coded SQL `'local_transaction'` with `receiverModeFor(toolFromSavedRegistry)`. In execute compare op.receiver_mode before claim to trusted mapping. Do not accept receiver_mode from tool arguments, extra DSL fields or annotation. Read mode function calls must fail.

- [x] **6. Change callStep target and worker context:**

```ts
const response = await gateway.call(
  { server: tool.server, name: tool.name }, args, auth, step.timeout_ms,
  { timeZone: context!.timeZone,
    worker: { id: store.workerId, assertActive: () => store.assertWorker() } },
);
```

Connector forwards only `_meta['ati/runtime']={time_zone:context.timeZone}` plus task_hub authorization. Worker callback/id are trusted in-process data, never MCP payload, never model fields, never JSON-cloned into snapshot.

- [x] **7. Correct certainty seam:** gateway pre-dispatch validation errors become BeforeDispatchError; errors after handing request to transport remain generic/unknown. In attempts only `error instanceof BeforeDispatchError` produces before_dispatch; task_hub knownToolError mapping remains scoped to task_hub. `isWrite && outcome.ok && receiverModeFor(tool)==='local_transaction'` retains exact existing receipt+operation+output verification; FS branch cannot fabricate receipt. Writes still max_attempts=1.
- [x] **8. Make reconcile mode-aware:** join receipts only when o.tool_server='task_hub' and o.receiver_mode='local_transaction'. For FS mode return `receipt:'not_supported', result:null, receiver_mode:'non_idempotent'`; marker info will be added FS-04. For unexpected server/mode return conflict without receipt inference. Do not change any persisted trace/state. Existing task_hub result fields/meaning remain compatible.
- [x] **9. Update current test wrappers only where signature changed:** existing wrappers forward the new target/context tuple without inspecting an unqualified name; crash-worker and timezone forwarding remain compatible. Historical scripts in docs are untouched. Same-name routing and closed receiver-policy tests are included; filesystem write remains unadvertised until FS-04.
- [x] **10. Run typecheck, engine unit, full check:engine using runner FS-02; report then stop.** Fresh evidence: typecheck exit 0; engine unit 82 passed, 1 skipped; full check includes 39 DSL, 82 engine unit (1 skipped), 63 MCP/DB integration and 40 engine integration tests, all passing. Non-idempotent logic at this checkpoint is code/unit evidence only; live filesystem write remains NOT_RUN.

## FS-03 — Approved launch và filesystem read adapter

**Files:** tạo gateway-filesystem.ts, filesystem-fixture.ts, filesystem-read.integration.test.ts, scripts/prepare-filesystem-demo.mjs, config/filesystem-reviewed.json; hoàn thiện launch-policy.ts; sửa gateway.ts, cli.ts, config/mcp-presets.json, testdata/tools.json, engine README. Thêm `fs:demo:setup` npm script. Không public write_file ở checkpoint này.

**Consumes:** FS-01 artifact/discovery và path helpers; FS-02 interfaces. **Produces:** `openFilesystemConnection(config: LocalGatewayConfig, launch: FilesystemLaunch, hooks?: FilesystemWriteHooks): Promise<ServerConnection>` (read only until FS-04); `loadFilesystemLaunch(projectRoot: string,userId: string): Promise<FilesystemLaunch|undefined>` for CLI.

- [x] **1. Write integration fixture with owned resources.** `makeFilesystemFixture()` returns `{projectRoot, databaseUrl, userId, allowedRoot, outsideRoot, gatewayConfig, db, close}`. Own DB `engine_it_${randomUUID().replaceAll('-','')}`; userId = randomUUID(), seedDemo(db,userId) explicitly; own temp container root `ati-fs-it-${uuid}` with allowed and outside sibling directories, root marker and files. Migrate/seed only own DB. Copy reviewed policy to fixture config paths if testing drift; never edit real config/lock/dist during a test. Client child uses installed pinned executable; root mapping is temporary. Cleanup closes all gateways/DB, drops exact generated DB, removes only owned temp container after canonical path checks; write DB/root cleanup status after finally.
- [x] **2. Write exact preset and artifact review file from evidence.** Approved entry has `id:filesystem-local-v1`, server filesystem, package/version/integrity, entry `dist/index.js`, server identity `secure-filesystem-server/0.2.0`, policy `b-local-fs-1`, root strategy `project-runtime-principal`, enabled tools `[read_file]`, max_bytes 65536. `filesystem-reviewed.json` contains observed raw schemas for read_text_file/write_file, full raw discovery names, per-file/package dependency fingerprints and provenance to FS-01 evidence. Do not pin timestamps or temp root strings as production identity.
- [x] **3. Enforce preset and artifact before launch and call:** reject missing/duplicate/unknown preset; no allow if approved_presets empty; reject package/version/installed bytes/dependency hash changes; no remote shell/download at runtime. Fingerprint includes files actually resolved by dependencies (walk resolved dependencies plus installed optional/peer dependencies with createRequire from each package root, dedupe real roots; if package exports hides package.json, resolve entry then walk to matching package metadata without executing package code; include executable .js/.mjs/.cjs/.json/.node files and package.json). Fail unsupported runtime artifact types instead of omitting executable bytes. Compare installed package against reviewed tarball hashes. Hash cwd/args/root binding and Node executable. Use paths only from trusted loader, not read tool output.
- [x] **4. Setup script creates only synthetic demo fixtures:** root `runtime/filesystem/DEMO_USER_UUID`, `.ati-root.json`, `notes.txt = 'Tiến độ ATI\nAPI: Done\n'`, `reports/`. Marker strict JSON is `{format:"ati-filesystem-root-1",root_id:randomUUID(),user_id:principal}`; inspectFilesystemPath validates user_id against expectedUserId from trusted launcher. Use mkdir then exclusive `wx`; rerun preserves existing content/marker/root_id. Wrong owner/invalid marker is an error, not overwrite. `runtime/` is already ignored; test `git check-ignore` for root file. CLI enable flag without valid setup -> CONFIG.
- [x] **5. Discover raw server and map only read:** paginate safely; exact selected raw schemas and identity compared to reviewed file; unexpected selected schema => REGISTRY_CHANGED. Extra raw tools remain invisible and cannot be reached by user tool target. No capability roots, root notifications, dynamic relaunch or server auto-discovery.
- [x] **6. Normalize output only inside reviewed adapter:**

```ts
// after path preflight; timeout budget is remaining monotonic deadline
const raw = await client.callTool({
  name: 'read_text_file', arguments: { path: checked.absolute },
}, undefined, { timeout: remainingMs });
if (raw.isError) return { isError: true, content: raw.content };
const body = z.object({ content: z.string() }).strict().parse(raw.structuredContent);
if (raw.content.length !== 1 || raw.content[0]?.type !== 'text' ||
    raw.content[0].text !== body.content || body.content !== checked.expectedReadText)
  throw new Error('Read output differs from reviewed UTF-8 content');
validateWriteText(body.content); // byte/NUL/surrogate policy is shared
return { structuredContent: { text: body.content } };
```

`remainingMs` is recomputed as Math.ceil(deadline - performance.now()) immediately before dispatch, where deadline = performance.now() + timeoutMs at adapter entry. If <=0, reject before packet; do not reset the budget. Preflight exceptions are wrapped as BeforeDispatchError, whereas errors after the SDK call starts are never wrapped that way. `normalizeToolResult` in DSL stays unchanged and validates normalized schema afterwards. No global text-to-JSON fallback. Check deadline before SDK dispatch; an elapsed timeout during preflight cannot start a fresh full timeout. Async preflight IO is bounded by bytes and checked at every stage, not assumed abortable on all OS APIs.
- [x] **7. Wire CLI optional configuration:** `loadFilesystemLaunch` reads G1_FILESYSTEM_ENABLED only as on/off; derive root from validated userId and project path. Pass optional filesystem config to openLocalGateway in existing prepare/approve/reject/execute branches. Read-only detail/preview/trace/reconcile/recover remain available without starting either MCP, including when candidate unavailable.
- [x] **8. Publish only filesystem read_file in gateway tools and mark that catalog item IMPLEMENTED_LIVE_DISCOVERY_CHECKED; keep write SPEC_ONLY and unadvertised.** Task_hub eight objects equal baseline, filesystem schema shape equal prior draft, policy explicit. Total public **9**, upstream two processes. Do not claim final 10 yet.

| IDs | Required live oracle |
|---|---|
| R01–R03 | read_file normalized exact Vietnamese/BOM/CRLF/empty text via actual upstream; no private fields |
| R04–R05 | raw selected schema/identity tampering rejected, even if tool name present; unexpected raw tool cannot route |
| R06–R08 | enabled flag + missing root/preset -> CONFIG; owner B cannot read owner A root; roots capability absent |
| R09–R11 | live junction/traversal/ADS requests rejected before raw dispatch, outside sentinel unchanged; size/encoding rejects do not call raw read |
| R12–R14 | input unknown field rejected; malformed structured output/text-only output rejected; source change between preflight and MCP result fails read |
| R15–R17 | root marker/config/package artifact change detected; no credential in logs; failed second-server startup closes first |
| R18 | CLI off -> 8; CLI on -> 9; write_file target rejected, no marker/file write |

- [x] **9. Run FS-03 targeted read integration, all engine unit, full check:engine.** Record which cases use a controlled bad-response double (normalizer tests) and which use two live MCP processes. Report counts, nine public names, actual raw names and cleanup; stop for Codex review.

## FS-04 — Non-idempotent write, approval và marker

**Files:** tạo filesystem-authorization.ts, filesystem-write.integration.test.ts, 0005 migration; sửa gateway-filesystem.ts, gateway.ts (authorization dependency), receiver/recovery seams, packages/db/src/schema.ts, current database migration assertions, filesystem preset/catalog. Không sửa task_hub receiver gate hoặc bốn migration trước.

**Consumes:** path/launch checks; engine worker capability, Store/verifyPreview, op in_flight. **Produces:** `reserveFilesystemDispatch(context): Promise<void>` và guarded write_file; total public 10.

```ts
export interface FilesystemDispatchContext {
  store: Store; gateway: Gateway; tool: EngineTool;
  args: { path: string; content: string };
  authorization: { approval_id: string; operation_id: string; snapshot_hash: string };
  checkedPath: CheckedFilesystemPath;
  worker: { id: string; assertActive: () => Promise<void> };
}
// Error deliberately NOT BeforeDispatchError: an existing marker is uncertain.
export class FilesystemAlreadyDispatchedError extends Error {}
```

FS-03 never calls these hooks or publishes write. FS-04 wires reserve to reserveFilesystemDispatch and recheck to recheckFilesystemDispatch, both accepting FilesystemDispatchContext. In gateway.ts, hook closures capture a composite Gateway variable assigned before openLocalGateway returns; reject if unset. No new setter on ServerConnection and no independent mutation of a live registry.

Gateway owns a DB handle/Store for guard queries and closes it. Store used for guard is not a worker owner: use the worker capability passed by callStep for advisory-lock liveness and compare its id to run.claimed_by; do not call a new Store's unrelated assertWorker(). Gateway reference for verifyPreview must be composite (all saved tools), not the filesystem-only connector. Pass hook closures during filesystem connection creation; their composite reference is assigned before any caller can dispatch. Absent hooks mean write disabled, never bypass.

- [x] **1. Write migration + migration tests:**

```sql
CREATE TABLE filesystem_dispatches (
  operation_id UUID PRIMARY KEY REFERENCES tool_operations(operation_id),
  user_id UUID NOT NULL REFERENCES users(id),
  run_id UUID NOT NULL REFERENCES runs(id),
  relative_path TEXT NOT NULL CHECK (char_length(relative_path) BETWEEN 1 AND 1024),
  content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  launch_hash TEXT NOT NULL CHECK (launch_hash ~ '^[a-f0-9]{64}$'),
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX filesystem_dispatches_run ON filesystem_dispatches(user_id, run_id);
COMMENT ON TABLE filesystem_dispatches IS
  'Committed dispatch reservation, NOT proof a filesystem write happened, NOT a receipt.';
```

`dispatched_at` denotes reservation boundary, not observed filesystem commit time; expose that wording in docs. Bind owner/run to actual operation in guard transaction, not user args. Add Drizzle table mapping using existing style. Runner discovers migration automatically. Existing test oracle adds 0005 while still asserting hashes of 0001–0004; rerun idempotent, checksum drift rejected, marker duplicate rejected. No seed changes needed for this table.

- [x] **2. Implement guard transaction using actual source seams:** parse strict authorization UUID/hash, worker.id UUID; find operation by auth.operation_id + store.userId to learn runId; inside transaction lock run via store.run(tx,runId,true), approval via store.approval(tx,runId,true), then operation FOR UPDATE. Re-read all values under locks. Require all checks in spec and `approval.id===auth.approval_id`, `approval.snapshot_hash===auth.snapshot_hash`, `run.claimed_by===worker.id`. Call verifyPreview(store,tx,run,approval,compositeGateway), find matching saved action/tool, require payloadHash and canonical args equality, correct non_idempotent mode, and op.state in_flight. Require DB expires_at > clock_timestamp after locks and before INSERT. Existing marker => FilesystemAlreadyDispatchedError; otherwise INSERT exact owner/run/relative path/content hash/tool.artifactHash, then commit. No ON CONFLICT success/replay path.
- [x] **3. Refuse unavailable worker capability or approval before packet.** Await worker.assertActive before transaction and again after it. Implement recheckFilesystemDispatch(context): recheck run claimed_by/status/cancel, approved/hash/version/TTL, matching committed marker, operation in_flight/mode/payload, plus current root/artifact immediately before raw call. Failure after reserve but before SDK invocation is known before_dispatch (except already-existing-marker ambiguity); marker stays. Never release a marker automatically for retry. Document race boundary: cannot undo a file already written after expiry/cancel.
- [x] **4. Add raw write + output/read-back normalization in a separate post-dispatch try block:**

```ts
const raw = await client.callTool({
  name: 'write_file', arguments: { path: checked.absolute, content: input.content },
}, undefined, { timeout: remainingMs });
if (raw.isError) return { isError: true, content: raw.content };
const body = z.object({ content: z.string() }).strict().parse(raw.structuredContent);
const expectedAck = `Successfully wrote to ${checked.absolute}`;
if (body.content !== expectedAck || raw.content.length !== 1 ||
    raw.content[0]?.type !== 'text' || raw.content[0].text !== expectedAck)
  throw new Error('Filesystem acknowledgement invalid after dispatch');
const written = await readBoundedUtf8(checked.absolute);
if (written !== input.content) throw new Error('Write read-back differs after dispatch');
return { structuredContent: { path: input.path } };
```

Recheck path/root/link restrictions for read-back, not just open the old path. Post-dispatch thrown errors stay generic -> unknown. Never convert raw error text that happens to contain `BAD_ARGS` or `NOT_FOUND` to known_not_applied. SDK annotation idempotentHint is ignored by receiver policy. Direct OS read-back is adapter verification; the mutation itself must be the real MCP write, not fs.writeFile fallback.
- [x] **5. Enable filesystem write_file only after guard tests exist.** Preset enabled tools becomes `[read_file,write_file]`; catalog write evidence becomes live-checked only after live tests succeed. No new public argument or result field, eight task_hub schema objects unchanged.
- [x] **6. Extend reconcile with dispatch marker query:** for FS return `dispatch_marker:'present'|'absent'`, `receipt:'not_supported'`, mode, current operation state, result null. Marker absence does not prove rollback. Ignore counterfeit hub_receipts for FS. Confirmed file content must not rewrite unknown trace. Task_hub receipt logic unchanged.

| IDs | Required oracle; all writes confined to owned temp root |
|---|---|
| W01–W03 | create exact UTF-8 bytes, replace own existing file, empty string; normalized path equals approved relative path; one marker, zero FS hub_receipts |
| W04–W09 | missing/forged auth, other owner, wrong hash/version/operation/payload, rejected/expired/cancelled run: zero raw write and unchanged sentinel |
| W10 | one approval covers two writes with different operation IDs; marker count matches each dispatched FS operation |
| W11 | same operation reaches adapter twice/concurrently: at most one raw call; second marker conflict never success/replay |
| W12–W14 | wait on DB run/op lock beyond expiry => no raw call; injected DB reserve failure => no file write; after-reserve expiry/cancel => no raw call, marker retained |
| W15–W17 | raw isError, raw ack mismatch, write/read-back mismatch after dispatch => unknown, no retry; even error content with JSON code BAD_ARGS |
| W18–W20 | oversize/invalid text/path rejected before marker; target junction/hardlink/static escape rejected; missing parent not created |
| W21–W23 | root/package/policy drift after preview -> no write; FS op mode forged local_transaction rejected; fake hub receipt never confirms FS |
| W24 | task_hub append/send/create/move still requires valid receiver receipt, including rollback and reply-loss checks |

- [x] **7. Run DB+targeted FS-write tests then full check:engine, fresh run dirs.** Record 5 migration checksums, 10 public tool schemas, guard denial packet counts, markers vs receipts, bytes before/after and teardown. Existing test count may include new migration checks; do not rename new tests as part of original 142. Stop for review before fault/demo batch.

## FS-05 — Hai-server controller, CLI và lỗi không rõ kết quả

**Files:** tạo filesystem-controller.integration.test.ts, filesystem-crash-worker.mjs, two dev plan JSONs; hoàn thiện filesystem-fixture.ts và engine tests. Chỉ sửa production khi test tái hiện bug thuộc scope đã chọn; báo rõ trước/after và rerun affected checks. Không thêm test hook thông qua production environment variables.

**Consumes:** ten-tool real gateway and marker. **Produces:** hai plan tay chạy CLI thật, fault evidence, backward-compatibility evidence. Fixture exports `makeFsCopyPlan()` and `makeFsCardExportPlan()` as parsed checked-in JSON; không phát minh các method trên engine.

- [x] **1. Create exact `testdata/dev-hand-plans/fs-copy-notify.json`:**

```json
{
  "version":"1.0","name":"Copy approved notes and notify",
  "source_prompt":"Đọc notes.txt, ghi nguyên nội dung vào reports/notes-copy.txt và báo #team.",
  "steps":[
    {"id":"read","description":"Read approved demo notes","tool":{"server":"filesystem","name":"read_file","args":{"path":"notes.txt"}},"side_effect":"read","depends_on":[]},
    {"id":"save","description":"Write exact captured text","tool":{"server":"filesystem","name":"write_file","args":{"path":"reports/notes-copy.txt","content":"${steps.read.output.text}"}},"side_effect":"write","depends_on":["read"],"idempotency_key":"${runtime.run_id}_save"},
    {"id":"notify","description":"Notify after file write","tool":{"server":"task_hub","name":"send_slack_message","args":{"channel":"#team","text":"Đã lưu bản sao notes.txt."}},"side_effect":"write","depends_on":["save"],"idempotency_key":"${runtime.run_id}_notify"}
  ],"outputs":{}
}
```

- [x] **2. Create exact `testdata/dev-hand-plans/fs-card-export.json`:**

```json
{
  "version":"1.0","name":"Export captured card title and notify",
  "source_prompt":"Đọc c1, ghi tiêu đề vào reports/card-title.txt và báo #team.",
  "steps":[
    {"id":"card","description":"Read local card","tool":{"server":"task_hub","name":"get_card","args":{"card_id":"c1"}},"side_effect":"read","depends_on":[]},
    {"id":"save","description":"Export approved title","tool":{"server":"filesystem","name":"write_file","args":{"path":"reports/card-title.txt","content":"${steps.card.output.title}"}},"side_effect":"write","depends_on":["card"],"idempotency_key":"${runtime.run_id}_save"},
    {"id":"notify","description":"Report captured title","tool":{"server":"task_hub","name":"send_slack_message","args":{"channel":"#team","text":"Đã xuất: ${steps.card.output.title}"}},"side_effect":"write","depends_on":["save"],"idempotency_key":"${runtime.run_id}_notify"}
  ],"outputs":{}
}
```

No outputs from write referenced anywhere. Read-after-write file verification belongs to test/adapter, not an extra forbidden DSL read step. Use a separate new read-only run if demonstrating file inspection through CLI.

- [x] **3. Implement actual controller happy-path test with exact oracle:**

```ts
const prepared = await engine.prepare(makeFsCopyPlan());
expect(prepared.status).toBe('awaiting_approval');
expect(prepared.approval!.actions).toHaveLength(2);
expect(await targetExists()).toBe(false);
expect(await markersFor(prepared.run_id)).toHaveLength(0);
await engine.decide(prepared.run_id, {
  approval_id: prepared.approval!.id,
  workflow_version_id: prepared.workflow_version_id!,
  snapshot_hash: prepared.approval!.snapshot_hash,
  decision: 'approved',
});
await engine.execute(prepared.run_id);
expect((await engine.detail(prepared.run_id)).status).toBe('succeeded');
expect(await readTargetBytes()).toEqual(Buffer.from('Tiến độ ATI\nAPI: Done\n','utf8'));
expect(await markerCount(prepared.run_id)).toBe(1);
expect(await localReceiptCount(prepared.run_id)).toBe(1); // notify only
expect(await notificationTexts(prepared.run_id)).toEqual(['Đã lưu bản sao notes.txt.']);
expect((await engine.trace(prepared.run_id)).attempts.map(a=>a.outcome_certainty))
  .toEqual(['confirmed','confirmed','confirmed']);
```

Fixture helper definitions: targetExists uses stat on own `reports/notes-copy.txt` and catches ENOENT only; readTargetBytes reads that file; markersFor/count queries filesystem_dispatches WHERE run_id and user_id; localReceiptCount joins tool_operations/hub_receipts scoped to run/user and task_hub; notificationTexts selects hub_messages via confirmed send receipt IDs for that run, not every message in DB. These helpers are required in filesystem-fixture.ts, never raw SQL to forge controller success.

- [x] **4. Implement matrix E01–E14 with real DB/clients:**

| ID | Trigger | Required result |
|---|---|---|
| E01 | fs-copy-notify normal | Exact UTF-8 copy + one local notification; 1 marker + 1 receipt; one approval |
| E02 | card-export normal | Exact bytes `Viết API` + `Đã xuất: Viết API`; real read from task_hub and write on filesystem |
| E03 | Change notes/card after preview, before approve | Written text/notify use saved read values; source is not reread for payload |
| E04 | Change root/preset/package artifact after preview | Approval or execution rejected before first write; no silent relaunch |
| E05 | Double execute from two gateway processes | One wins, other BUSY/CONFLICT as actual engine permits; one FS marker, one notification |
| E06 | Lose response after actual filesystem write + read-back | File has bytes, operation/attempt unknown; run reconciliation_required; notify not dispatched |
| E07 | Real controller child exits 86 after actual FS write, before engine persists result | Recover closes attempts; FS marker present; no notify; reconcile not_supported and trace unknown |
| E08 | Crash after marker before upstream packet via test-only transport factory | File absent; operation still uncertain, no retry/release marker; conservative result documented |
| E09 | Cancel/expire between save and notify | File may already exist; no notify; no rollback claim; historical FS attempt remains actual result |
| E10 | Raw write isError/malformed acknowledgement | No follow-up notify or automatic retry; unknown even with suggestive BAD_ARGS text |
| E11 | Read-only filesystem plan | succeeded directly, approval null, zero FS markers/receipts/messages |
| E12 | New run intentionally repeats plan | Requires new approval, distinct operations; overwrite allowed inside own root and one new notification; not replay |
| E13 | Real CLI processes prepare/preview/approve/execute/trace/reconcile | Parse actual JSON, use nested approval fields; output/source oracles and server-count match |
| E14 | Old task_hub-only persisted snapshot/trace, filesystem disabled/unavailable | detail/trace/reconcile readable; old confirmed receipts preserved; stale artifact execute refused, not rewritten |

Test E06 wrapping pattern (auth index remains 2):

```ts
const lostReplyGateway = {
  ...gateway,
  async call(...args: Parameters<Gateway['call']>) {
    const response = await gateway.call(...args);
    if (args[0].server === 'filesystem' && args[0].name === 'write_file' && !response.isError)
      throw new Error('Injected lost reply after actual filesystem write');
    return response;
  },
};
```

Crash worker mirrors current crash-worker.mjs but selects filesystem target only, validates `/engine_it_[a-f0-9]{32}` and own `ati-fs-it-*` root, passes exact trusted root config, then `process.exit(86)` after real gateway write reply. E08 uses a test-only dependency factory around a real raw MCP transport: at write invocation entry after reserve resolves, child exits; no production fault env variable or fake server counted as integration. Parent records exit code and cleans only owned child/database/root. Preserve raw trace and marker rows before cleanup.
- [x] **5. Verify reconcile after fault without mutation:** call twice after expiry/cancel, compare JSON trace before/after deeply; marker/notification/file unchanged. Output receipt not_supported; manually checking matching file content must not change unknown. Assert execute again refuses. (E06/E07)
- [x] **6. CLI integration uses execFile Node directly**, not npm banners. Child arguments positional: `prepare file`, `preview id`, `approve run approval version hash`, `execute id`, `trace id`, `reconcile id`. Use an extra fresh UUID principal seeded into the suite-owned engine_it database. Create only its derived root `<project>/runtime/filesystem/<fresh-user-uuid>` (must not exist beforehand), marker and synthetic notes/reports. Launch the actual `packages/engine/dist/cli.js` with G1_DATABASE_URL for the temporary DB, G1_USER_ID for that UUID, and G1_FILESYSTEM_ENABLED=1. Thus the real production root resolver and preset are exercised without a fake CLI or env root override. Clean only that UUID root after closing children; preserve other principals and runtime parents. Artifact-drift tests use the separate trusted programmatic fixture config from FS-03, never mutate real preset/lock/dist. No production test hooks or extra CLI dispatcher API is needed.
- [x] **7. Run targeted FS controller/fault suite then full check:engine, fresh directories.** Record test names/counts, real child exits 86/87, actual file hashes/messages/receipt counts, timestamps and cleanup. Gap-closure evidence: focused controller 14/14; full gate 258 passed, 1 skipped; E01–E14 PASS. Report FS-05 and keep G1 overall PARTIAL pending FS-06/rubric.

## FS-06 — Final evidence, manual demo và verdict G1

**Execution status (2026-09-14):** FS-06 technical evidence and documentation freeze are complete. Derived technical verdict is `TECHNICAL_PASS_OVERALL_PARTIAL`; overall remains `PARTIAL` because the official rubric and representative group work are `OPEN`.

**Files:** tạo `docs/G1-FILESYSTEM-STATUS-2026-09-13.md`, `docs/G1-RUBRIC-MAP.md`, batch-02/FS-06/final manifest/report/scripts; update current README, docs/BASELINE, docs/00-BAT-DAU, docs/KE-HOACH-6-TUAN, docs/EXECUTION-CONTRACT, docs/EVALUATION progress only, db/DATABASE, both component READMEs, testdata/TESTDATA. Không sửa dated G1/ENGINE/TASK-HUB reports hoặc batch-01 evidence.

**Consumes:** all FS-01–05 reports, baseline, live tests, rubric source if actually provided. **Produces:** independent final evidence and overall verdict, not a claim API/UI/AI is complete.

- [x] **1. Final scope/source inspection:** diff allowlist; compare all eight task_hub schemas/policies with baseline; migration 0001–0004 and 180 protected hashes unchanged. Explain every changed original source file; no skipped/deleted old tests. Snapshot format remains v1; receiver mode mapping fail-closed; only two filesystem tools public. Build/runtime dependencies covered by installed-byte fingerprints.
- [x] **2. Fresh clean install + final gate, sequential and captured:**

```powershell
New-Item -ItemType Directory -Force docs/task-hub-evidence/batch-02/FS-06 | Out-Null
node scripts/capture-command.mjs FS-06 npm-ci $nodeExe $npmCli ci --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Fresh install failed' }
node scripts/capture-command.mjs FS-06 final-check $nodeExe $npmCli run check:engine
if ($LASTEXITCODE -ne 0) { throw 'Final gate failed' }
```

No suite in parallel, no npm dependency update during final ci. New source changes invalidate relevant build/tests; doc-only corrections require doc verification, not another full gate.
- [x] **3. Fresh isolated final snapshot**: own DB with 5 migrations + seed, own root fixtures + both real MCP connections. Save two server identities, raw selected schemas/full discovery and normalized 10-tool catalog; call four task_hub reads plus filesystem read with exact seed oracles. Writes already covered in full gate; do not write to demo solely for snapshot. Snapshot script records DB/root/process cleanup in finally after completed cleanup. Pin Node/SDK/upstream/dependency versions and all five migration checksums.
- [x] **4. Build manifest from bytes/process results:** current head + source diff scope, source/test/config/lock/plan hashes, protected hash map, installed dependency closure, launch/root binding (synthetic root only), ten tool names, mode mapping, actual per-suite counts/pass/fail/skip, matrix IDs + their evidence paths, failures/retries, process start/end/null provenance, precise scopes and limitations. Record dispatch markers separately from receipts; do not call marker timestamp file commit time. Final G1 verdict derived from matrix, not an unconditional string.
- [x] **5. Add executable manual guide** with default demo principal and migration/seed preservation:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run db:up:g1
npm run db:migrate:g1
npm run db:seed:g1
npm run fs:demo:setup
$env:G1_FILESYSTEM_ENABLED = '1'
$raw = node packages/engine/dist/cli.js prepare testdata/dev-hand-plans/fs-copy-notify.json
if ($LASTEXITCODE -ne 0) { throw 'Prepare failed' }
$prep = ($raw -join "`n") | ConvertFrom-Json
$runId = $prep.run_id
$approvalId = $prep.approval.id
$versionId = $prep.workflow_version_id
$snapshotHash = $prep.approval.snapshot_hash
node packages/engine/dist/cli.js preview $runId
# Pause here: inspect target reports/notes-copy.txt, exact content and #team message.
# Only after the preview is accepted:
node packages/engine/dist/cli.js approve $runId $approvalId $versionId $snapshotHash
node packages/engine/dist/cli.js execute $runId
node packages/engine/dist/cli.js trace $runId
node packages/engine/dist/cli.js reconcile $runId
Remove-Item Env:G1_FILESYSTEM_ENABLED
```

Document root location and create/overwrite behavior. `fs:demo:setup` and db seed preserve edits; repeated demo is a new approved intent, not idempotent replay. Do not run the manual write guide against persistent demo as part of doc verification. If user later explicitly asks to execute it, record actual evidence separately. Capture all IDs/hash from actual JSON, never invent flags or flattened approval fields.
- [x] **6. Rubric/source and representative-work mapping:** `docs/G1-RUBRIC-MAP.md` has columns `source`, `source_status`, `criterion_quote_or_paraphrase`, `G1_applicability`, `evidence`, `status`, `gap/next_batch`. Source requires actual file/URL/page or explicit user-provided text; mark USER_PROVIDED vs inspected authoritative source. Missing source entry is OPEN, not replaced by technical checklist. Obtain one real group work example (input, expected output, current manual process) or record OPEN without inventing interview/time saved.
- [x] **7. Derive explicit gate result:**

| Runtime/technical matrix | Rubric/work input | Verdict |
|---|---|---|
| Required case failed | any | TECHNICAL_FAILED, overall PARTIAL |
| Required native safety/fault case NOT_RUN | any | TECHNICAL_PARTIAL, overall PARTIAL |
| All required checks PASS | source missing | TECHNICAL_PASS_OVERALL_PARTIAL |
| All checks PASS | authoritative source reviewed, applicable G1 criteria covered, representative input confirmed | G1_PASS |
| All checks PASS | source has applicable unresolved criterion | PARTIAL_WITH_GAPS |

AI metrics/provider prompts, API/session/UI/polling/BullMQ stay NOT_IMPLEMENTED/NOT_RUN in every row. Do not require unrelated future rubric criteria to be implemented here; map them honestly to later batches. Do not call this finished coursework.
- [x] **8. Docs verification:** check current/new local Markdown links outside code fences; label planned paths, do not suppress broken current links. Parse PowerShell blocks; check npm scripts and CLI args against actual code/help. Validate fixture JSON through WorkflowPlanSchema and validatePlanTools with ten trusted tools; do not mutate dataset manifest/holdout. Capture checker script/log/exit/timestamps, including honest null timing for any retrospective entry.
- [x] **9. Write FS-06 and final report; freeze evidence; stop.** Link command logs, runtime snapshot, rubric map, unknown traces, marker-vs-receipt proof, source preservation and manual guide. All task checkboxes tick only when actual. No next batch, commit or push unless separately requested.

## Review gates cho Codex

- **FS-01:** installed bytes/version khác published metadata không bị bỏ qua; path checks có real junction/hardlink/UTF-8 boundaries, scope TOCTOU không bị thổi phồng.
- **FS-02:** every call site routes server+name; server can’t be selected by name collision; old schema/snapshot canonical hash preserved; unknown errors not relabeled before_dispatch.
- **FS-03:** empty preset denies; principal root bound into snapshot; raw extra tools hidden; two real SDK connections; malformed text not auto-parsed globally.
- **FS-04:** marker insert precedes packet, duplicate marker stops packet, no fake receipt, expiry semantics honest, raw write errors stay unknown, task_hub receipt checks still mandatory.
- **FS-05:** at least one actual filesystem write + task_hub receipt in one approved run, real crash exit86, saved-read immutability, unknown never resumes and trace never rewritten.
- **FS-06:** current installed/runtime/log evidence vs historical evidence separated; actual counts; no hidden skip; five migration checksums; overall G1 not upgraded when rubric or required test missing.

## Spec-to-task coverage

| Spec section | Task(s) |
|---|---|
| Current single-server assumptions | FS-02 |
| Exact artifact + real discovery | FS-01, FS-03, FS-06 |
| Path/bytes/encoding/root threat model | FS-01, FS-03, FS-04 |
| Public contracts/preset/principal/artifact binding | FS-02, FS-03 |
| Approval + non-idempotent marker | FS-04 |
| Certainty/reconcile/backward compatibility | FS-02, FS-04, FS-05 |
| Real two-server flow/crash/CLI | FS-05 |
| G1/rubric/remaining scope and preservation | Every task; final verdict FS-06 |

## Khi nào dừng để xin quyết định

Chỉ dừng việc phụ thuộc nếu cần đổi scope/schema/authorization model; package pin không lấy được hoặc artifact không khớp; confinement không đạt trên filesystem hiện tại; rubric đòi kiến trúc khác; hoặc phải tác động dữ liệu thật ngoài root/DB đã giao. Report bằng chứng cụ thể và đề xuất nhỏ nhất. Lỗi implementation/test/doc nằm trong task thì sửa và kiểm trong scope, không hỏi lại mỗi bước. Không chạy đối thủ local/race thử trên thư mục người dùng thật.
