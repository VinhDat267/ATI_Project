import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WorkflowPlanSchema, validatePlanTools } from "@wap/dsl";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const evidenceDir = process.env.ATI_EVIDENCE_DIR
  ? path.resolve(process.env.ATI_EVIDENCE_DIR)
  : path.join(root, "docs", "task-hub-evidence", "batch-02", "FS-06", `${Date.now()}-docs-check-direct`);

const normalize = (value) => value.replaceAll("\\", "/");
const relative = (value) => normalize(path.relative(root, value));
const readJson = (value) => JSON.parse(readFileSync(value, "utf8"));

const currentMarkdownPaths = [
  "README.md",
  "docs/00-BAT-DAU.md",
  "docs/BASELINE.md",
  "docs/KE-HOACH-6-TUAN.md",
  "docs/EXECUTION-CONTRACT.md",
  "docs/EVALUATION.md",
  "db/DATABASE.md",
  "apps/mcp-task-hub/README.md",
  "packages/engine/README.md",
  "testdata/TESTDATA.md",
  "docs/G1-RUBRIC-MAP.md",
  "docs/G1-FILESYSTEM-STATUS-2026-09-13.md",
  "docs/task-hub-evidence/batch-02/FS-06/FS-06.md",
  "docs/superpowers/plans/2026-09-13-filesystem-g1-completion.md",
  "docs/superpowers/plans/2026-09-14-fs-06-finalization.md",
];

function splitMarkdown(text) {
  const outside = [];
  const fences = [];
  let current = [];
  let fence = null;
  for (const line of text.split(/\r?\n/)) {
    const opening = !fence && line.match(/^\s*(`{3,}|~{3,})\s*([^\s`]*)?.*$/);
    if (opening) {
      if (current.length) outside.push(current.join("\n"));
      current = [];
      fence = { marker: opening[1][0], length: opening[1].length, language: (opening[2] ?? "").toLowerCase(), lines: [] };
      continue;
    }
    if (fence && new RegExp(`^\\s*${fence.marker}{${fence.length},}\\s*$`).test(line)) {
      fences.push({ language: fence.language, text: fence.lines.join("\n") });
      fence = null;
      continue;
    }
    if (fence) fence.lines.push(line);
    else current.push(line);
  }
  if (fence) fences.push({ language: fence.language, text: fence.lines.join("\n") });
  else if (current.length) outside.push(current.join("\n"));
  return { outside: outside.join("\n"), fences };
}

function markdownLinks(text) {
  const found = [];
  const inline = /!?\[[^\]]*\]\(([^)]+)\)/g;
  const reference = /^\s*\[[^\]]+\]:\s*(\S+)/gm;
  for (const regex of [inline, reference]) {
    for (const match of text.matchAll(regex)) found.push(match[1].trim().replace(/^<|>$/g, ""));
  }
  return found;
}

function targetPath(sourceFile, rawTarget) {
  const withoutTitle = rawTarget.replace(/\s+["'][^"']*["']\s*$/, "");
  const target = withoutTitle.split("#", 1)[0].replace(/(:\d+(?:\|\d+)?)$/, "");
  if (!target) return sourceFile;
  if (/^https?:\/\//i.test(target)) return null;
  if (/^file:\/\//i.test(target)) return fileURLToPath(target);
  let decoded;
  try { decoded = decodeURIComponent(target); }
  catch { return Symbol.for("invalid-uri"); }
  return decoded.startsWith("/") ? path.resolve(root, `.${decoded}`) : path.resolve(path.dirname(sourceFile), decoded);
}

function checkMarkdownFile(file) {
  const parsed = splitMarkdown(readFileSync(file, "utf8"));
  const links = markdownLinks(parsed.outside);
  const broken = [];
  let checked = 0;
  let external = 0;
  for (const target of links) {
    if (/^https?:\/\//i.test(target)) { external += 1; continue; }
    checked += 1;
    let resolved;
    try { resolved = targetPath(file, target); }
    catch { resolved = Symbol.for("invalid-uri"); }
    if (typeof resolved !== "string" || !existsSync(resolved)) {
      broken.push({ file: relative(file), target, resolved: typeof resolved === "string" ? relative(resolved) : null, reason: "LOCAL_TARGET_NOT_FOUND" });
    }
  }
  return {
    parsed,
    summary: { path: relative(file), local_links_checked: checked, external_http_links_ignored: external, fenced_blocks: parsed.fences.length },
    broken,
  };
}

function parseCliContract(source) {
  const countsBlock = source.match(/const counts:[\s\S]*?=\s*\{([\s\S]*?)\n\s*\};/);
  if (!countsBlock) throw new Error("Cannot parse CLI command counts");
  const counts = {};
  const entry = /^\s*(?:"([^"]+)"|([A-Za-z][\w-]*)):\s*\[(\d+),\s*(\d+)\],?\s*$/gm;
  for (const match of countsBlock[1].matchAll(entry)) counts[match[1] ?? match[2]] = [Number(match[3]), Number(match[4])];
  const cases = new Set([...source.matchAll(/case\s+"([^"]+)"\s*:/g)].map((match) => match[1]));
  const missingCases = Object.keys(counts).filter((command) => !cases.has(command));
  if (missingCases.length) throw new Error(`CLI count entries without switch cases: ${missingCases.join(", ")}`);
  return counts;
}

function commandTokens(rest) {
  return rest.trim().split(/\s+/).filter(Boolean).filter((token) => !/^(?:2?>&1|\||;|&&|\|\||#)/.test(token));
}

function extractPowerShellCommands(markdownResults) {
  const blocks = [];
  for (const result of markdownResults) {
    result.parsed.fences.forEach((fence, index) => {
      if (["powershell", "pwsh", "ps1"].includes(fence.language)) blocks.push({ file: result.summary.path, block: index + 1, text: fence.text });
    });
  }
  return blocks;
}

function packageScripts() {
  const manifests = [path.join(root, "package.json")];
  for (const parent of ["packages", "apps"]) {
    const directory = path.join(root, parent);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const manifest = path.join(directory, entry.name, "package.json");
      if (entry.isDirectory() && existsSync(manifest)) manifests.push(manifest);
    }
  }
  return manifests.map((manifest) => ({ path: relative(manifest), ...readJson(manifest) }));
}

function checkNpmScripts(blocks, manifests) {
  const checks = [];
  for (const block of blocks) {
    block.text.split(/\r?\n/).forEach((line, index) => {
      for (const match of line.matchAll(/\bnpm\s+run\s+([A-Za-z0-9:_-]+)/g)) {
        const tail = line.slice(match.index + match[0].length);
        const workspace = tail.match(/(?:^|\s)(?:-w|--workspace)\s+([^\s]+)/)?.[1] ?? null;
        const manifest = workspace
          ? manifests.find((entry) => entry.name === workspace)
          : manifests.find((entry) => entry.path === "package.json");
        checks.push({ file: block.file, block: block.block, line: index + 1, script: match[1], workspace, package_file: manifest?.path ?? null, ok: Boolean(manifest && Object.hasOwn(manifest.scripts ?? {}, match[1])) });
      }
    });
  }
  return checks;
}

function checkCliCommands(blocks, contract) {
  const checks = [];
  for (const block of blocks) {
    block.text.split(/\r?\n/).forEach((line, index) => {
      const patterns = [
        /\bnode(?:\.exe)?\s+packages[\\/]engine[\\/]dist[\\/]cli\.js\s+([A-Za-z0-9-]+)([^\r\n]*)/,
        /\bnpm\s+run\s+engine\s+--\s+([A-Za-z0-9-]+)([^\r\n]*)/,
      ];
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (!match) continue;
        const args = commandTokens(match[2]);
        const limits = contract[match[1]];
        checks.push({
          file: block.file,
          block: block.block,
          line: index + 1,
          command: match[1],
          argument_count: args.length,
          expected_min: limits?.[0] ?? null,
          expected_max: limits?.[1] ?? null,
          ok: Boolean(limits && args.length >= limits[0] && args.length <= limits[1]),
        });
        break;
      }
    });
  }
  return checks;
}

function trustedTools() {
  const registry = readJson(path.join(root, "testdata", "tools.json"));
  return registry.servers.flatMap((server) => server.tools.map((tool) => ({
    server: server.slug,
    name: tool.name,
    sideEffect: tool.sideEffect,
    policyVersion: tool.policyVersion,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
  })));
}

function validatePlans(registry) {
  const directory = path.join(root, "testdata", "dev-hand-plans");
  return readdirSync(directory).filter((name) => name.endsWith(".json")).sort().map((name) => {
    const file = path.join(directory, name);
    const parsed = WorkflowPlanSchema.safeParse(readJson(file));
    if (!parsed.success) return { path: relative(file), schema_ok: false, policy_ok: false, ok: false, issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) };
    const checked = validatePlanTools(parsed.data, registry);
    return { path: relative(file), schema_ok: true, policy_ok: checked.ok, ok: checked.ok, issues: checked.issues, deferred_step_ids: checked.deferredStepIds };
  });
}

function collectManifestPaths(value, key = "", paths = []) {
  if (Array.isArray(value)) value.forEach((item) => collectManifestPaths(item, key, paths));
  else if (value && typeof value === "object") Object.entries(value).forEach(([childKey, child]) => collectManifestPaths(child, childKey, paths));
  else if (typeof value === "string" && ["path", "report", "output", "artifact", "migration_apply", "snapshot", "evidence"].includes(key) && /^(?:docs\/|\.superpowers\/|scripts\/|packages\/|apps\/|config\/|db\/|testdata\/|package(?:-lock)?\.json$|tsconfig\.json$)/.test(value)) paths.push(value);
  return paths;
}

function checkManifestLinks() {
  const manifestPath = path.join(root, "docs", "task-hub-evidence", "batch-02", "FS-06", "1789386912283-manifest", "manifest.json");
  const manifest = readJson(manifestPath);
  const required = [
    "docs/task-hub-evidence/batch-02/FS-06/1789383831828-scope-audit-fixed6/command.json",
    "docs/task-hub-evidence/batch-02/FS-06/1789383831828-scope-audit-fixed6/scope-audit.json",
    "docs/task-hub-evidence/batch-02/FS-06/1789384080436-npm-ci/command.json",
    "docs/task-hub-evidence/batch-02/FS-06/1789384630165-final-check/command.json",
    "docs/task-hub-evidence/batch-02/FS-06/1789384630165-final-check/output.log",
    "docs/task-hub-evidence/batch-02/FS-06/1789385689123-final-snapshot/command.json",
    "docs/task-hub-evidence/batch-02/FS-06/1789385689123-final-snapshot/final-snapshot.json",
    "docs/task-hub-evidence/batch-02/FS-06/1789386912283-manifest/command.json",
    "docs/task-hub-evidence/batch-02/FS-06/1789386912283-manifest/manifest.json",
    ...[1, 2, 3, 4, 5].map((number) => `docs/task-hub-evidence/batch-02/FS-0${number}/FS-0${number}.md`),
    "docs/G1-RUBRIC-MAP.md",
    "docs/G1-FILESYSTEM-STATUS-2026-09-13.md",
  ];
  const candidates = [...new Set([...collectManifestPaths(manifest), ...required])].sort();
  return candidates.map((entry) => ({ path: normalize(entry), ok: existsSync(path.resolve(root, entry)) }));
}

function negativeFixtures(manifests, cliContract, registry) {
  const fakeMarkdownPath = path.join(root, "__fs06_missing_fixture__.md");
  const missingLink = checkMarkdownFileFromText(fakeMarkdownPath, "[missing](definitely-missing.md)");
  const fakeBlock = [{ file: "fixture.md", block: 1, text: "npm run definitely-missing-script\nnode packages/engine/dist/cli.js definitely-invalid" }];
  const unknownScript = checkNpmScripts(fakeBlock, manifests);
  const invalidCli = checkCliCommands(fakeBlock, cliContract);
  const validPlan = WorkflowPlanSchema.parse(readJson(path.join(root, "testdata", "dev-hand-plans", "th-move.json")));
  validPlan.steps[0].tool = { ...validPlan.steps[0].tool, server: "untrusted", name: "missing" };
  const untrusted = validatePlanTools(validPlan, registry);
  const results = {
    broken_link: { expected: "LOCAL_TARGET_NOT_FOUND", observed: missingLink.broken[0]?.reason ?? null, ok: missingLink.broken.length === 1 },
    unknown_script: { expected: false, observed: unknownScript[0]?.ok ?? null, ok: unknownScript.length === 1 && !unknownScript[0].ok },
    invalid_cli: { expected: false, observed: invalidCli[0]?.ok ?? null, ok: invalidCli.length === 1 && !invalidCli[0].ok },
    untrusted_plan: { expected: false, observed: untrusted.ok, issues: untrusted.issues, ok: !untrusted.ok && untrusted.issues.some((issue) => issue.message.includes("tool missing reviewed policy")) },
  };
  if (Object.values(results).some((fixture) => !fixture.ok)) throw new Error("One or more negative checker fixtures did not fail as expected");
  return results;
}

function checkMarkdownFileFromText(file, text) {
  const parsed = splitMarkdown(text);
  const broken = [];
  for (const target of markdownLinks(parsed.outside)) {
    const resolved = targetPath(file, target);
    if (resolved && !existsSync(resolved)) broken.push({ file: relative(file), target, resolved: relative(resolved), reason: "LOCAL_TARGET_NOT_FOUND" });
  }
  return { parsed, broken };
}

async function main() {
  const markdown = currentMarkdownPaths.map((entry) => path.join(root, entry)).filter(existsSync).sort().map(checkMarkdownFile);
  const manifests = packageScripts();
  const cliContract = parseCliContract(readFileSync(path.join(root, "packages", "engine", "src", "cli.ts"), "utf8"));
  const blocks = extractPowerShellCommands(markdown);
  const npmChecks = checkNpmScripts(blocks, manifests);
  const cliChecks = checkCliCommands(blocks, cliContract);
  const registry = trustedTools();
  const plans = validatePlans(registry);
  const manifestChecks = checkManifestLinks();
  const fixtures = negativeFixtures(manifests, cliContract, registry);
  const broken = markdown.flatMap((entry) => entry.broken);
  const failedNpm = npmChecks.filter((entry) => !entry.ok);
  const failedCli = cliChecks.filter((entry) => !entry.ok);
  const failedPlans = plans.filter((entry) => !entry.ok);
  const missingManifest = manifestChecks.filter((entry) => !entry.ok);
  const failures = broken.length + failedNpm.length + failedCli.length + failedPlans.length + missingManifest.length;
  const result = {
    status: failures === 0 ? "PASS" : "FAIL",
    recorded_at: new Date().toISOString(),
    markdown_files: { count: markdown.length, local_links_checked: markdown.reduce((sum, entry) => sum + entry.summary.local_links_checked, 0), external_http_links_ignored: markdown.reduce((sum, entry) => sum + entry.summary.external_http_links_ignored, 0), files: markdown.map((entry) => entry.summary) },
    broken_local_links: broken,
    fenced_link_exclusions: { blocks: markdown.reduce((sum, entry) => sum + entry.parsed.fences.length, 0), link_syntax_occurrences: markdown.reduce((sum, entry) => sum + entry.parsed.fences.reduce((inner, fence) => inner + markdownLinks(fence.text).length, 0), 0) },
    powerShell_commands: { blocks: blocks.length, locations: blocks.map(({ file, block }) => ({ file, block })) },
    npm_script_checks: { checked: npmChecks.length, valid: npmChecks.length - failedNpm.length, unknown: failedNpm, checks: npmChecks, negative_fixture: fixtures.unknown_script },
    cli_argument_checks: { available_commands: Object.fromEntries(Object.entries(cliContract).sort()), checked: cliChecks.length, valid: cliChecks.length - failedCli.length, invalid: failedCli, checks: cliChecks, negative_fixture: fixtures.invalid_cli },
    plan_validation: { trusted_tool_count: registry.length, plans_checked: plans.length, valid: plans.length - failedPlans.length, failures: failedPlans, plans, negative_fixture: fixtures.untrusted_plan },
    manifest_links: { checked: manifestChecks.length, resolved: manifestChecks.length - missingManifest.length, missing: missingManifest, checks: manifestChecks, negative_fixture: fixtures.broken_link },
  };
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(path.join(evidenceDir, "docs-check.json"), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, evidence_dir: relative(evidenceDir), markdown_files: result.markdown_files.count, local_links_checked: result.markdown_files.local_links_checked, npm_scripts_checked: result.npm_script_checks.checked, cli_commands_checked: result.cli_argument_checks.checked, plans_checked: result.plan_validation.plans_checked, manifest_links_checked: result.manifest_links.checked, failures }, null, 2));
  process.exitCode = result.status === "PASS" ? 0 : 1;
}

await main();
