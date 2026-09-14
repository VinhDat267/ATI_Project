import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = realpathSync(process.cwd());
const evidenceDirValue = process.env.ATI_EVIDENCE_DIR;
if (!evidenceDirValue) {
  throw new Error('ATI_EVIDENCE_DIR is required; run through capture-command.mjs');
}

const evidenceDir = path.resolve(repoRoot, evidenceDirValue);
const evidenceRelative = toRelative(evidenceDir);
if (
  !/^docs\/task-hub-evidence\/batch-02\/FS-06\/\d{13}-manifest$/.test(
    evidenceRelative
  )
) {
  throw new Error(`Unexpected FS-06 manifest evidence directory: ${evidenceRelative}`);
}

const manifestRelative = `${evidenceRelative}/manifest.json`;
const manifestPath = resolveRepoPath(manifestRelative);

const inputPaths = Object.freeze({
  baseline: 'docs/antigravity/filesystem-handoff-baseline.json',
  status: 'docs/G1-FILESYSTEM-STATUS-2026-09-13.md',
  scopeAudit:
    'docs/task-hub-evidence/batch-02/FS-06/1789383831828-scope-audit-fixed6/scope-audit.json',
  scopeCommand:
    'docs/task-hub-evidence/batch-02/FS-06/1789383831828-scope-audit-fixed6/command.json',
  migrationApply:
    'docs/task-hub-evidence/batch-02/FS-06/1789383831828-scope-audit-fixed6/migration-apply.json',
  npmCiCommand:
    'docs/task-hub-evidence/batch-02/FS-06/1789384080436-npm-ci/command.json',
  finalCheckCommand:
    'docs/task-hub-evidence/batch-02/FS-06/1789384630165-final-check/command.json',
  finalCheckOutput:
    'docs/task-hub-evidence/batch-02/FS-06/1789384630165-final-check/output.log',
  finalSnapshotCommand:
    'docs/task-hub-evidence/batch-02/FS-06/1789385689123-final-snapshot/command.json',
  finalSnapshot:
    'docs/task-hub-evidence/batch-02/FS-06/1789385689123-final-snapshot/final-snapshot.json',
  packageJson: 'package.json',
  packageLock: 'package-lock.json',
  enginePackageJson: 'packages/engine/package.json',
  catalog: 'testdata/tools.json',
  testCases: 'testdata/test-cases.json',
  experimentManifest: 'testdata/experiment-manifest.json',
  reviewedFilesystem: 'config/filesystem-reviewed.json',
  presets: 'config/mcp-presets.json',
  candidate: 'config/filesystem-candidate.json',
  receiverPolicy: 'packages/engine/src/receiver-policy.ts',
  launchPolicy: 'packages/engine/src/launch-policy.ts',
  filesystemAuthorization: 'packages/engine/src/filesystem-authorization.ts',
});

const fsReports = Object.freeze({
  fs01: 'docs/task-hub-evidence/batch-02/FS-01/FS-01.md',
  fs02: 'docs/task-hub-evidence/batch-02/FS-02/FS-02.md',
  fs03: 'docs/task-hub-evidence/batch-02/FS-03/FS-03.md',
  fs04: 'docs/task-hub-evidence/batch-02/FS-04/FS-04.md',
  fs05: 'docs/task-hub-evidence/batch-02/FS-05/FS-05.md',
});

const fsCommands = Object.freeze({
  fs01: [
    'docs/task-hub-evidence/batch-02/FS-01/1789363493939-codex-final-unit/command.json',
    'docs/task-hub-evidence/batch-02/FS-01/1789363870921-codex-direct-live-probe/command.json',
    'docs/task-hub-evidence/batch-02/FS-01/1789363872414-codex-direct-artifact/command.json',
  ],
  fs02: [
    'docs/task-hub-evidence/batch-02/FS-02/1789366012289-final-check-2/command.json',
  ],
  fs03: [
    'docs/task-hub-evidence/batch-02/FS-03/1789367141918-final-check/command.json',
  ],
  fs04: [
    'docs/task-hub-evidence/batch-02/FS-04/1789368709477-final-check-r4/command.json',
  ],
  fs05: [
    'docs/task-hub-evidence/batch-02/FS-05/1789377464018-gap-closure-controller/command.json',
    'docs/task-hub-evidence/batch-02/FS-05/1789377566640-gap-closure-check/command.json',
  ],
});

const taskReports = Object.freeze([
  '.superpowers/sdd/2026-09-14-fs-06-finalization/task-1-report.md',
  '.superpowers/sdd/2026-09-14-fs-06-finalization/task-2-report.md',
  '.superpowers/sdd/2026-09-14-fs-06-finalization/task-3-report.md',
]);

function normalizePath(value) {
  return value.replaceAll('\\', '/');
}

function toRelative(absolutePath) {
  const relative = normalizePath(path.relative(repoRoot, absolutePath));
  if (!relative || relative === '..' || relative.startsWith('../')) {
    throw new Error(`Path is outside repository: ${absolutePath}`);
  }
  return relative;
}

function resolveRepoPath(relativePath) {
  const normalized = normalizePath(relativePath);
  if (path.isAbsolute(normalized)) {
    throw new Error(`Expected repository-relative path: ${relativePath}`);
  }
  const absolute = path.resolve(repoRoot, normalized);
  const back = normalizePath(path.relative(repoRoot, absolute));
  if (!back || back === '..' || back.startsWith('../')) {
    throw new Error(`Path escapes repository: ${relativePath}`);
  }
  return absolute;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readText(relativePath) {
  return readFileSync(resolveRepoPath(relativePath), 'utf8');
}

function readJson(relativePath) {
  try {
    return JSON.parse(readText(relativePath));
  } catch (error) {
    throw new Error(`Cannot parse JSON ${relativePath}: ${error.message}`);
  }
}

function sha256File(relativePath) {
  return createHash('sha256')
    .update(readFileSync(resolveRepoPath(relativePath)))
    .digest('hex');
}

function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'en'));
}

function sortBy(values, selector) {
  return [...values].sort((a, b) =>
    selector(a).localeCompare(selector(b), 'en')
  );
}

function runChecked(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  assert(!result.error, `${executable} failed to spawn: ${result.error?.message}`);
  assert(
    result.status === 0,
    `${executable} ${args.join(' ')} exited ${result.status}: ${result.stderr}`
  );
  return result.stdout;
}

function gitWorkingTreePaths() {
  const output = runChecked('git', [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ]);
  const paths = [];
  for (const line of output.split(/\r?\n/u)) {
    if (!line) continue;
    assert(line.length >= 4, `Malformed git status line: ${line}`);
    let entry = line.slice(3);
    const arrow = entry.lastIndexOf(' -> ');
    if (arrow >= 0) entry = entry.slice(arrow + 4);
    if (entry.startsWith('"') && entry.endsWith('"')) {
      throw new Error(`Quoted Git path is unsupported by this manifest: ${entry}`);
    }
    paths.push(normalizePath(entry));
  }
  return sortedUnique(paths);
}

function commandSummary(relativePath) {
  const command = readJson(relativePath);
  assert(Number.isInteger(command.exit_code), `${relativePath} lacks exit_code`);
  assert(typeof command.started_at === 'string', `${relativePath} lacks started_at`);
  assert(typeof command.finished_at === 'string', `${relativePath} lacks finished_at`);
  assert(Array.isArray(command.args), `${relativePath} lacks args`);
  const started = Date.parse(command.started_at);
  const finished = Date.parse(command.finished_at);
  const duration =
    Number.isFinite(started) && Number.isFinite(finished) && finished >= started
      ? finished - started
      : null;
  return {
    path: relativePath,
    executable: command.executable,
    args: [...command.args],
    started_at: command.started_at,
    finished_at: command.finished_at,
    exit_code: command.exit_code,
    signal: command.signal ?? null,
    spawn_error: command.spawn_error ?? null,
    duration_ms: duration,
  };
}

function requireSuccessfulCommand(relativePath) {
  const summary = commandSummary(relativePath);
  assert(summary.exit_code === 0, `${relativePath} did not exit 0`);
  assert(summary.signal === null, `${relativePath} recorded a signal`);
  assert(summary.spawn_error === null, `${relativePath} recorded a spawn error`);
  return summary;
}

function parseFinalCheck(relativePath) {
  const plain = readText(relativePath).replace(/\u001b\[[0-9;]*m/gu, '');
  const summaries = [...plain.matchAll(/Tests\s+(\d+)\s+passed(?:\s*\|\s*(\d+)\s+skipped)?\s*\((\d+)\)/gu)].map(
    (match) => ({
      passed: Number(match[1]),
      skipped: Number(match[2] ?? 0),
      total: Number(match[3]),
    })
  );
  assert(summaries.length === 4, `Expected four Tests summaries in ${relativePath}`);
  const names = [
    'dsl',
    'engine_unit',
    'task_hub_db_integration',
    'engine_integration',
  ];
  const suites = summaries.map((summary, index) => {
    assert(
      summary.passed + summary.skipped === summary.total,
      `${names[index]} test arithmetic does not match printed total`
    );
    return { name: names[index], ...summary };
  });
  const aggregate = suites.reduce(
    (sum, suite) => ({
      passed: sum.passed + suite.passed,
      skipped: sum.skipped + suite.skipped,
      total: sum.total + suite.total,
    }),
    { passed: 0, skipped: 0, total: 0 }
  );
  assert(
    aggregate.passed === 258 &&
      aggregate.skipped === 1 &&
      aggregate.total === 259,
    `Unexpected final-check aggregate: ${JSON.stringify(aggregate)}`
  );
  assert(
    JSON.stringify(suites.map(({ passed, skipped, total }) => [passed, skipped, total])) ===
      JSON.stringify([
        [39, 0, 39],
        [92, 1, 93],
        [64, 0, 64],
        [63, 0, 63],
      ]),
    'Final-check suite totals differ from the authoritative FS-06 matrix'
  );
  assert(
    plain.includes('tests/filesystem-paths.test.ts (53 tests | 1 skipped)'),
    'Final check does not identify the capability-dependent filesystem-paths skip'
  );
  return { path: relativePath, suites, aggregate };
}

function parseSourceRegister(relativePath) {
  const markdown = readText(relativePath);
  const match = markdown.match(
    /<!-- SOURCE_CHANGE_REGISTER_BEGIN -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- SOURCE_CHANGE_REGISTER_END -->/u
  );
  assert(match, `${relativePath} lacks the machine-readable source register`);
  let rows;
  try {
    rows = JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`Invalid source register JSON: ${error.message}`);
  }
  assert(Array.isArray(rows), 'Source register must be an array');
  const allowedKeys = ['evidence', 'path', 'reason', 'status', 'task'];
  for (const row of rows) {
    assert(row && typeof row === 'object' && !Array.isArray(row), 'Invalid source register row');
    assert(
      JSON.stringify(Object.keys(row).sort()) === JSON.stringify(allowedKeys),
      `Unexpected source register fields for ${row.path ?? '<unknown>'}`
    );
    for (const key of allowedKeys) {
      assert(typeof row[key] === 'string' && row[key].length > 0, `Empty ${key} in source register`);
    }
    assert(
      row.status === 'MODIFIED_FROM_BASELINE' || row.status === 'ADDED_AFTER_BASELINE',
      `Invalid source status for ${row.path}`
    );
  }
  const sorted = sortBy(rows, (row) => row.path);
  assert(
    JSON.stringify(rows) === JSON.stringify(sorted),
    'Source register is not sorted by path'
  );
  assert(new Set(rows.map((row) => row.path)).size === rows.length, 'Duplicate source register path');
  return rows;
}

function isRegisterSourcePath(relativePath) {
  return (
    /^(package(?:-lock)?\.json|tsconfig\.json)$/u.test(relativePath) ||
    /^config\/.+\.json$/u.test(relativePath) ||
    /^db\/migrations\/.+\.sql$/u.test(relativePath) ||
    /^(?:apps|packages)\/.+\/(?:src|tests|scripts)\//u.test(relativePath) ||
    /^packages\/.+\/(?:package\.json|tsconfig\.json|vitest\..+\.ts)$/u.test(relativePath) ||
    /^scripts\/.+\.(?:mjs|mts|js|ts)$/u.test(relativePath) ||
    /^testdata\/.+\.json$/u.test(relativePath)
  );
}

function validateReport(relativePath, requiredFragments) {
  const text = readText(relativePath);
  for (const fragment of requiredFragments) {
    assert(text.includes(fragment), `${relativePath} lacks required report fragment: ${fragment}`);
  }
  return relativePath;
}

function normalizeFingerprintList(entries) {
  return sortBy(
    entries.map((entry) => ({ path: normalizePath(entry.path), sha256: entry.sha256 })),
    (entry) => entry.path
  );
}

function verifyFingerprint(relativePath, expected) {
  assert(existsSync(resolveRepoPath(relativePath)), `Fingerprint path is missing: ${relativePath}`);
  assert(sha256File(relativePath) === expected, `Fingerprint drift: ${relativePath}`);
}

function normalizeAndVerifyInstalledFingerprints(snapshot) {
  const dependencies = snapshot.dependency_fingerprints;
  assert(dependencies && typeof dependencies === 'object', 'Snapshot lacks dependency_fingerprints');

  const reviewedContracts = normalizeFingerprintList(dependencies.reviewed_contracts);
  const builtRuntime = normalizeFingerprintList(dependencies.built_runtime);
  for (const entry of [...reviewedContracts, ...builtRuntime]) {
    verifyFingerprint(entry.path, entry.sha256);
  }

  const closure = dependencies.filesystem_dependency_closure;
  assert(closure.package === '@modelcontextprotocol/server-filesystem', 'Unexpected filesystem package');
  assert(closure.version === '2026.8.31', 'Unexpected filesystem package version');
  const packageRoot = 'node_modules/@modelcontextprotocol/server-filesystem';
  const packageFiles = normalizeFingerprintList(closure.package_files);
  for (const entry of packageFiles) {
    verifyFingerprint(`${packageRoot}/${entry.path}`, entry.sha256);
  }

  const dependencyPackages = sortBy(
    closure.dependency_packages.map((entry) => ({
      name: entry.name,
      version: entry.version,
      root: normalizePath(entry.root),
    })),
    (entry) => `${entry.name}\u0000${entry.root}`
  );
  const dependencyFiles = sortBy(
    closure.dependency_files.map((entry) => ({
      name: entry.name,
      version: entry.version,
      root: normalizePath(entry.root),
      files: normalizeFingerprintList(entry.files),
    })),
    (entry) => `${entry.name}\u0000${entry.root}`
  );

  const flattened = [];
  for (const entry of packageFiles) {
    flattened.push({ path: `${packageRoot}/${entry.path}`, sha256: entry.sha256 });
  }
  for (const dependency of dependencyFiles) {
    for (const entry of dependency.files) {
      const relativePath = `${dependency.root}/${entry.path}`;
      verifyFingerprint(relativePath, entry.sha256);
      flattened.push({ path: relativePath, sha256: entry.sha256 });
    }
  }
  flattened.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  assert(packageFiles.length === 7, 'Expected seven direct filesystem package fingerprints');
  assert(dependencyPackages.length === 4, 'Expected four direct filesystem dependencies');
  assert(dependencyFiles.length === 102, 'Expected 102 resolved dependency nodes');
  assert(flattened.length === 1650, `Expected 1650 installed fingerprints, got ${flattened.length}`);

  return {
    source_snapshot: inputPaths.finalSnapshot,
    reviewed_contracts: reviewedContracts,
    built_runtime: builtRuntime,
    filesystem_dependency_closure: {
      package: closure.package,
      version: closure.version,
      entry: normalizePath(closure.entry),
      node: closure.node,
      package_files: packageFiles,
      dependency_packages: dependencyPackages,
      dependency_files: dependencyFiles,
      resolved_dependency_count: dependencyFiles.length,
      fingerprint_count: flattened.length,
      aggregate_sha256: sha256Text(
        flattened.map((entry) => `${entry.path}\u0000${entry.sha256}`).join('\n')
      ),
    },
  };
}

function collectDependencies(packageJson, enginePackage, packageLock) {
  const rows = [];
  const add = (scope, dependencies) => {
    for (const [name, requested] of Object.entries(dependencies ?? {})) {
      const lockKey = name.startsWith('@wap/')
        ? name === '@wap/db'
          ? 'packages/db'
          : name === '@wap/dsl'
            ? 'packages/dsl'
            : null
        : `node_modules/${name}`;
      const installed = lockKey ? packageLock.packages?.[lockKey]?.version ?? null : null;
      rows.push({ scope, name, requested, installed });
    }
  };
  add('workspace.devDependencies', packageJson.devDependencies);
  add('@wap/engine.dependencies', enginePackage.dependencies);
  return sortBy(rows, (entry) => `${entry.scope}\u0000${entry.name}`);
}

function validateEvidencePaths(manifest) {
  for (const row of manifest.scope.source_change_register) {
    assert(existsSync(resolveRepoPath(row.path)), `Registered source is missing: ${row.path}`);
    assert(existsSync(resolveRepoPath(row.evidence)), `Registered evidence is missing: ${row.evidence}`);
  }

  const visit = (value, key = '') => {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
      return;
    }
    if (
      typeof value === 'string' &&
      ['artifact', 'command', 'output', 'path', 'report', 'snapshot'].includes(key)
    ) {
      if (value === manifestRelative) return;
      assert(existsSync(resolveRepoPath(value)), `Manifest evidence path is missing: ${value}`);
    }
  };
  visit(manifest.evidence);
  assert(
    existsSync(resolveRepoPath(manifest.runtime.installed_byte_fingerprints.source_snapshot)),
    'Installed-fingerprint source snapshot is missing'
  );
}

function assertSortedStrings(values, label) {
  assert(
    JSON.stringify(values) === JSON.stringify(sortedUnique(values)),
    `${label} must be sorted and unique`
  );
}

function validateManifest(manifest, expectedChangedPaths) {
  const expectedTopLevel = [
    'status',
    'recorded_at',
    'git',
    'scope',
    'protected_files',
    'migrations',
    'runtime',
    'catalog',
    'dataset',
    'evidence',
    'rubric',
    'verdict',
  ];
  assert(
    JSON.stringify(Object.keys(manifest)) === JSON.stringify(expectedTopLevel),
    'Manifest top-level groups differ from the FS-06 contract'
  );
  assert(manifest.status === 'PASS', 'Manifest contract status must be PASS');
  assertSortedStrings(manifest.git.working_tree_paths, 'git.working_tree_paths');
  assert(manifest.protected_files.count === 180, 'Protected-file count must be 180');
  assert(manifest.protected_files.mismatches.length === 0, 'Protected mismatches must be empty');
  assert(manifest.migrations.names.length === 5, 'Exactly five migrations are required');
  assertSortedStrings(manifest.migrations.names, 'migrations.names');
  assert(manifest.catalog.tool_names.length === 10, 'Catalog must contain exactly 10 tools');
  assertSortedStrings(manifest.catalog.tool_names, 'catalog.tool_names');
  assert(manifest.scope.public_tool_count === 10, 'Scope public_tool_count must be 10');
  assert(manifest.dataset.split.dev.length === 6, 'Dataset must contain six dev cases');
  assert(manifest.dataset.split.holdout.length === 4, 'Dataset must contain four holdout cases');
  assert(manifest.dataset.holdout_untuned === true, 'Dataset holdout must remain untuned');
  assertSortedStrings(manifest.dataset.split.dev, 'dataset.split.dev');
  assertSortedStrings(manifest.dataset.split.holdout, 'dataset.split.holdout');

  const registered = manifest.scope.source_change_register.map((row) => row.path);
  assertSortedStrings(registered, 'scope.source_change_register paths');
  assert(
    JSON.stringify(registered) === JSON.stringify(expectedChangedPaths),
    `Source register mismatch; expected ${expectedChangedPaths.length}, got ${registered.length}`
  );
  for (const row of manifest.scope.source_change_register) {
    assert(row.status !== 'UNCHANGED', `Changed path is falsely labeled unchanged: ${row.path}`);
  }

  validateEvidencePaths(manifest);
  for (const fsId of ['fs01', 'fs02', 'fs03', 'fs04', 'fs05', 'fs06']) {
    assert(manifest.evidence[fsId], `Missing ${fsId} evidence group`);
  }
  assert(
    manifest.evidence.fs06.final_check.command.exit_code === 0 &&
      manifest.evidence.fs06.final_snapshot.command.exit_code === 0 &&
      manifest.evidence.fs06.scope_audit.command.exit_code === 0,
    'Required FS-06 commands must exit 0'
  );

  const rubricOpen =
    manifest.rubric.source_status === 'OPEN' || manifest.rubric.open_items.length > 0;
  if (manifest.verdict.technical === 'G1_PASS' || manifest.verdict.overall === 'G1_PASS') {
    assert(!rubricOpen, 'G1_PASS is forbidden while rubric/work remains OPEN');
  }
  assert(
    manifest.verdict.technical === 'TECHNICAL_PASS_OVERALL_PARTIAL' &&
      manifest.verdict.overall === 'PARTIAL',
    'Current evidence requires TECHNICAL_PASS_OVERALL_PARTIAL / PARTIAL'
  );
}

function expectContractRejection(name, manifest, expectedChangedPaths, mutate) {
  const fixture = structuredClone(manifest);
  mutate(fixture);
  let rejected = false;
  try {
    validateManifest(fixture, expectedChangedPaths);
  } catch {
    rejected = true;
  }
  assert(rejected, `Contract fixture was not rejected: ${name}`);
}

const baseline = readJson(inputPaths.baseline);
const scopeAudit = readJson(inputPaths.scopeAudit);
const migrationApply = readJson(inputPaths.migrationApply);
const finalSnapshot = readJson(inputPaths.finalSnapshot);
const packageJson = readJson(inputPaths.packageJson);
const packageLock = readJson(inputPaths.packageLock);
const enginePackage = readJson(inputPaths.enginePackageJson);
const catalogJson = readJson(inputPaths.catalog);
const testCasesJson = readJson(inputPaths.testCases);
const experimentManifest = readJson(inputPaths.experimentManifest);
const reviewedFilesystem = readJson(inputPaths.reviewedFilesystem);
const presets = readJson(inputPaths.presets);
const candidate = readJson(inputPaths.candidate);
const sourceChangeRegister = parseSourceRegister(inputPaths.status);

// Read the policy sources as explicit Task 4 inputs and require their core boundaries.
const receiverPolicyText = readText(inputPaths.receiverPolicy);
const launchPolicyText = readText(inputPaths.launchPolicy);
const filesystemAuthorizationText = readText(inputPaths.filesystemAuthorization);
assert(receiverPolicyText.includes('non_idempotent'), 'Receiver policy lacks filesystem mode');
assert(launchPolicyText.includes('filesystem-reviewed.json'), 'Launch policy lacks reviewed artifact');
assert(filesystemAuthorizationText.includes('reserveFilesystemDispatch'), 'Authorization lacks dispatch guard');

validateReport(fsReports.fs01, ['FS-01', 'PARTIAL', 'P11']);
validateReport(fsReports.fs02, ['FS-02', 'VERIFIED', 'filesystem live write NOT_RUN by scope']);
validateReport(fsReports.fs03, ['FS-03', 'VERIFIED', 'Filesystem write remains deliberately SPEC_ONLY']);
validateReport(fsReports.fs04, ['FS-04', 'VERIFIED', '10 tools']);
validateReport(fsReports.fs05, ['FS-05', 'E01–E14', 'TECHNICAL PASS', '258 passed, 1 skipped']);
validateReport(taskReports[0], ['Task 1', 'Protected baseline count: `180`', 'status: "PASS"']);
validateReport(taskReports[1], ['Task 2', '**258**', 'final_check_exit = 0']);
validateReport(taskReports[2], ['Task 3', 'status: "PASS"', 'root_removed: true']);

assert(scopeAudit.status === 'PASS', 'Authoritative scope audit did not pass');
assert(scopeAudit.protected_count === 180, 'Scope audit protected count drifted');
assert(scopeAudit.protected_sha256.mismatches.length === 0, 'Protected bytes mismatch');
assert(migrationApply.status === 'PASS', 'PostgreSQL migration apply did not pass');
assert(finalSnapshot.status === 'PASS', 'Authoritative final snapshot did not pass');
assert(finalSnapshot.cleanup.db_dropped === true, 'Snapshot database was not dropped');
assert(finalSnapshot.cleanup.root_removed === true, 'Snapshot root was not removed');
assert(finalSnapshot.cleanup.failure === null, 'Snapshot recorded a cleanup failure');

const scopeCommand = requireSuccessfulCommand(inputPaths.scopeCommand);
const npmCiCommand = requireSuccessfulCommand(inputPaths.npmCiCommand);
const finalCheckCommand = requireSuccessfulCommand(inputPaths.finalCheckCommand);
const finalSnapshotCommand = requireSuccessfulCommand(inputPaths.finalSnapshotCommand);
const finalCheck = parseFinalCheck(inputPaths.finalCheckOutput);
assert(scopeCommand.args.includes('scripts/fs06-scope-audit.mjs'), 'Wrong scope-audit command');
assert(finalCheckCommand.args.includes('check:engine'), 'Wrong authoritative final-check command');
assert(finalSnapshotCommand.args.includes('scripts/fs06-final-snapshot.mjs'), 'Wrong snapshot command');

const gitHead = runChecked('git', ['rev-parse', 'HEAD']).trim();
assert(gitHead === baseline.git_head, 'Git HEAD differs from the handoff baseline');
assert(gitHead === scopeAudit.git_head, 'Git HEAD differs from the scope audit');
const workingTreePaths = gitWorkingTreePaths();

const baselineSourcePaths = Object.keys(baseline.source_sha256).map(normalizePath);
const baselineSourceSet = new Set(baselineSourcePaths);
const changedBaselinePaths = baselineSourcePaths
  .filter((relativePath) => {
    assert(existsSync(resolveRepoPath(relativePath)), `Baseline source is missing: ${relativePath}`);
    return sha256File(relativePath) !== baseline.source_sha256[relativePath];
  })
  .sort((a, b) => a.localeCompare(b, 'en'));
assert(
  JSON.stringify(changedBaselinePaths) === JSON.stringify(scopeAudit.source_sha256.changed),
  'Current changed-baseline paths differ from the authoritative scope audit'
);
const addedSourcePaths = workingTreePaths.filter(
  (relativePath) => isRegisterSourcePath(relativePath) && !baselineSourceSet.has(relativePath)
);
const expectedChangedPaths = sortedUnique([...changedBaselinePaths, ...addedSourcePaths]);
assert(expectedChangedPaths.length === 51, `Expected 51 registered source changes, got ${expectedChangedPaths.length}`);
for (const row of sourceChangeRegister) {
  const expectedStatus = baselineSourceSet.has(row.path)
    ? 'MODIFIED_FROM_BASELINE'
    : 'ADDED_AFTER_BASELINE';
  assert(row.status === expectedStatus, `Wrong register status for ${row.path}`);
}

const expectedMigrationNames = [
  '0001_init.sql',
  '0002_audit_contracts.sql',
  '0003_task_hub_local.sql',
  '0004_task_hub_cards.sql',
  '0005_filesystem_dispatches.sql',
];
assert(
  JSON.stringify(scopeAudit.migration_files) === JSON.stringify(expectedMigrationNames),
  'Scope-audit migration names differ'
);
const migrations = sortBy(
  finalSnapshot.migrations.map((entry) => ({
    name: entry.name,
    sha256: entry.checksum,
  })),
  (entry) => entry.name
);
assert(
  JSON.stringify(migrations.map((entry) => entry.name)) === JSON.stringify(expectedMigrationNames),
  'Snapshot migration names differ'
);
for (const entry of migrations) {
  const relativePath = `db/migrations/${entry.name}`;
  assert(scopeAudit.migration_checksums[relativePath] === entry.sha256, `Migration audit mismatch: ${entry.name}`);
  verifyFingerprint(relativePath, entry.sha256);
}

assert(catalogJson.profile === 'B-local-v1', 'Unexpected catalog profile');
const catalogTools = [];
const serverModeMap = [];
for (const server of catalogJson.servers) {
  const names = server.tools.map((tool) => `${server.slug}.${tool.name}`);
  catalogTools.push(...names);
  serverModeMap.push({
    server: server.slug,
    mode: server.mode,
    receiver_mode: server.receiver_mode,
    public_tools: sortedUnique(names),
  });
}
const catalogNames = sortedUnique(catalogTools);
assert(catalogNames.length === 10, 'Current catalog does not have 10 unique tools');
assert(
  JSON.stringify(catalogNames) === JSON.stringify(finalSnapshot.normalized_catalog.names),
  'Catalog names differ from the authoritative runtime snapshot'
);
assert(reviewedFilesystem.version === '2026.8.31', 'Reviewed filesystem version drifted');
assert(presets.approved_presets?.length === 1, 'Expected one reviewed MCP preset');
assert(candidate.package === '@modelcontextprotocol/server-filesystem', 'Candidate package drifted');

const caseIdsBySplit = { dev: [], holdout: [] };
for (const testCase of testCasesJson.cases) {
  assert(testCase.split === 'dev' || testCase.split === 'holdout', `Invalid split for ${testCase.id}`);
  caseIdsBySplit[testCase.split].push(testCase.id);
}
caseIdsBySplit.dev = sortedUnique(caseIdsBySplit.dev);
caseIdsBySplit.holdout = sortedUnique(caseIdsBySplit.holdout);
const experimentDev = sortedUnique(experimentManifest.split.dev);
const experimentHoldout = sortedUnique(experimentManifest.split.holdout);
assert(JSON.stringify(caseIdsBySplit.dev) === JSON.stringify(experimentDev), 'Dev split drifted');
assert(JSON.stringify(caseIdsBySplit.holdout) === JSON.stringify(experimentHoldout), 'Holdout split drifted');
assert(caseIdsBySplit.dev.length === 6 && caseIdsBySplit.holdout.length === 4, 'Expected 6/4 dataset split');
assert(experimentManifest.status === 'NOT_RUN', 'Experiment manifest is no longer NOT_RUN');
assert(
  testCasesJson.evidence === 'HAND_AUTHORED_EXECUTABILITY_FIXTURES_NOT_MODEL_RESULTS',
  'Dataset provenance no longer proves an untuned holdout'
);

const installedByteFingerprints = normalizeAndVerifyInstalledFingerprints(finalSnapshot);
const npmPackagePath = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'package.json');
assert(existsSync(npmPackagePath), `Cannot locate npm package metadata: ${npmPackagePath}`);
const npmPackage = JSON.parse(readFileSync(npmPackagePath, 'utf8'));
assert(typeof npmPackage.version === 'string', 'npm package metadata lacks version');
assert(finalSnapshot.node.version === process.version, 'Node version differs from final snapshot');

const evidence = {
  fs01: {
    status: 'PARTIAL_P11_CAPABILITY_NOT_RUN',
    report: fsReports.fs01,
    commands: fsCommands.fs01.map(requireSuccessfulCommand),
  },
  fs02: {
    status: 'VERIFIED',
    report: fsReports.fs02,
    commands: fsCommands.fs02.map(requireSuccessfulCommand),
  },
  fs03: {
    status: 'VERIFIED_READ_CHECKPOINT',
    report: fsReports.fs03,
    commands: fsCommands.fs03.map(requireSuccessfulCommand),
  },
  fs04: {
    status: 'VERIFIED_WRITE_CHECKPOINT',
    report: fsReports.fs04,
    commands: fsCommands.fs04.map(requireSuccessfulCommand),
  },
  fs05: {
    status: 'TECHNICAL_PASS',
    report: fsReports.fs05,
    commands: fsCommands.fs05.map(requireSuccessfulCommand),
    filesystem_dispatch_markers: {
      path: 'docs/task-hub-evidence/batch-02/FS-05/1789377566640-gap-closure-check/filesystem-controller-observations.json',
      status: 'PASS_SEPARATE_FROM_RECEIPTS',
    },
    task_hub_receipts: {
      path: 'docs/task-hub-evidence/batch-02/FS-05/1789377566640-gap-closure-check/controller-observations.json',
      status: 'PASS_SEPARATE_FROM_FILESYSTEM_MARKERS',
    },
    required_matrix: {
      cases: Array.from({ length: 14 }, (_, index) => `E${String(index + 1).padStart(2, '0')}`),
      status: 'PASS',
    },
  },
  fs06: {
    status: 'PASS',
    task_reports: taskReports.map((report) => ({ report, status: 'PASS' })),
    scope_audit: {
      command: scopeCommand,
      artifact: inputPaths.scopeAudit,
      migration_apply: inputPaths.migrationApply,
      status: scopeAudit.status,
    },
    npm_ci: { command: npmCiCommand, status: 'PASS' },
    final_check: {
      command: finalCheckCommand,
      output: finalCheck.path,
      suites: finalCheck.suites,
      aggregate: finalCheck.aggregate,
      status: 'PASS',
    },
    final_snapshot: {
      command: finalSnapshotCommand,
      snapshot: inputPaths.finalSnapshot,
      status: finalSnapshot.status,
      cleanup: finalSnapshot.cleanup,
    },
    manifest: { path: manifestRelative, status: 'PASS' },
    required_failures: [],
    required_native_safety_or_fault_not_run: [],
    capability_dependent_not_run: [
      'P11 native file-symlink case skipped because the Windows host cannot create the fixture symlink',
    ],
  },
};

const manifest = {
  status: 'PASS',
  recorded_at: new Date().toISOString(),
  git: {
    head: gitHead,
    working_tree_paths: workingTreePaths,
  },
  scope: {
    profile: catalogJson.profile,
    servers: sortBy(
      Object.entries(finalSnapshot.servers).map(([server, details]) => ({
        server,
        identity: `${details.identity.name}/${details.identity.version}`,
        command_basename: details.command_basename,
        entry_basename: details.entry_basename,
      })),
      (entry) => entry.server
    ),
    public_tool_count: catalogNames.length,
    source_change_register: sourceChangeRegister,
  },
  protected_files: {
    count: scopeAudit.protected_count,
    mismatches: [...scopeAudit.protected_sha256.mismatches].sort(),
  },
  migrations: {
    names: migrations.map((entry) => entry.name),
    checksums: migrations,
  },
  runtime: {
    node: {
      version: process.version,
      executable_basename: path.basename(process.execPath),
      platform: process.platform,
      arch: process.arch,
    },
    npm: {
      version: npmPackage.version,
      measured_at: new Date().toISOString(),
      timing_ms: null,
    },
    dependencies: collectDependencies(packageJson, enginePackage, packageLock),
    installed_byte_fingerprints: installedByteFingerprints,
  },
  catalog: {
    sha256: sha256File(inputPaths.catalog),
    tool_names: catalogNames,
    server_mode_map: sortBy(serverModeMap, (entry) => entry.server),
  },
  dataset: {
    sha256: sha256File(inputPaths.testCases),
    experiment_manifest_sha256: sha256File(inputPaths.experimentManifest),
    split: caseIdsBySplit,
    holdout_untuned: true,
  },
  evidence,
  rubric: {
    source_status: baseline.rubric.status,
    open_items: ['official_g1_rubric', 'representative_group_work'],
  },
  verdict: {
    technical: 'TECHNICAL_PASS_OVERALL_PARTIAL',
    overall: 'PARTIAL',
    reason:
      'All required FS-05 E01-E14 and FS-06 technical checks pass. The capability-dependent P11 host case remains disclosed as skipped; the official G1 rubric and representative group-work evidence are OPEN.',
  },
};

validateManifest(manifest, expectedChangedPaths);
expectContractRejection('missing evidence path', manifest, expectedChangedPaths, (fixture) => {
  fixture.scope.source_change_register[0].evidence = 'missing-evidence-file';
});
expectContractRejection('protected mismatch', manifest, expectedChangedPaths, (fixture) => {
  fixture.protected_files.mismatches.push({ path: 'protected', reason: 'fixture' });
});
expectContractRejection('catalog other than 10', manifest, expectedChangedPaths, (fixture) => {
  fixture.catalog.tool_names.pop();
});
expectContractRejection('unlisted changed source', manifest, expectedChangedPaths, (fixture) => {
  fixture.scope.source_change_register.pop();
});
expectContractRejection('tuned holdout', manifest, expectedChangedPaths, (fixture) => {
  fixture.dataset.holdout_untuned = false;
});
expectContractRejection('G1 pass with open rubric', manifest, expectedChangedPaths, (fixture) => {
  fixture.verdict.technical = 'G1_PASS';
  fixture.verdict.overall = 'G1_PASS';
});

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
console.log(
  JSON.stringify({
    status: manifest.status,
    manifest: manifestRelative,
    top_level_groups: Object.keys(manifest),
    source_change_count: sourceChangeRegister.length,
    protected_count: manifest.protected_files.count,
    migration_count: manifest.migrations.names.length,
    catalog_count: manifest.catalog.tool_names.length,
    dataset_split: {
      dev: manifest.dataset.split.dev.length,
      holdout: manifest.dataset.split.holdout.length,
    },
    installed_fingerprint_count:
      manifest.runtime.installed_byte_fingerprints.filesystem_dependency_closure.fingerprint_count,
    verdict: manifest.verdict,
  })
);
