import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const stamp = new Date().toISOString().replaceAll(/[-:.TZ]/g, "").slice(0, 14);
const evidenceDir = path.join(
  root,
  "docs",
  "api-evidence",
  "batch-03",
  "API-05",
  `${stamp}-${randomUUID()}`,
);
mkdirSync(evidenceDir, { recursive: true });

const sensitive = /(password|token|secret|authorization|api[_-]?key|cookie)(\s*[=:]\s*)([^\s,}"']+)/gi;
function sanitize(value) {
  return value
    .replace(sensitive, "$1$2[REDACTED]")
    .replaceAll(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}

const commands = [
  ["check", "npm", ["run", "check"]],
  ["api-unit", "npm", ["run", "test:unit", "-w", "@wap/api"]],
  ["api-integration", "npm", ["run", "test:integration", "-w", "@wap/api"]],
  ["db-integration", "npm", ["run", "test:integration", "-w", "@wap/mcp-task-hub"]],
  ["engine-integration", "npm", ["run", "test:integration", "-w", "@wap/engine"]],
];
const results = [];
for (const [id, executable, args] of commands) {
  const command = [executable, ...args].join(" ");
  const startedAt = new Date().toISOString();
  const spawnFile = process.platform === "win32" ? "cmd.exe" : executable;
  const spawnArgs = process.platform === "win32" ? ["/d", "/s", "/c", executable, ...args] : args;
  const result = spawnSync(
    spawnFile,
    spawnArgs,
    {
      cwd: root,
      encoding: "utf8",
      timeout: id === "engine-integration" ? 360_000 : 180_000,
      windowsHide: true,
    },
  );
  const stdout = sanitize(result.stdout ?? "");
  const stderr = sanitize(result.stderr ?? "");
  const exitCode = result.status ?? 1;
  results.push({ id, command, started_at: startedAt, exit_code: exitCode });
  writeFileSync(
    path.join(evidenceDir, `${id}.json`),
    JSON.stringify(
      {
        id,
        command,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        exit_code: exitCode,
        timed_out: result.error?.code === "ETIMEDOUT",
        error: result.error?.message ?? null,
        stdout,
        stderr,
      },
      null,
      2,
    ) + "\n",
  );
  if (exitCode !== 0) break;
}

let commit = "unknown";
try {
  const git = spawnSync(
    process.platform === "win32" ? "git.exe" : "git",
    ["rev-parse", "HEAD"],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  commit = git.stdout?.trim() || commit;
} catch {
  // Keep the evidence explicit when git is unavailable.
}
const sourceFiles = ["apps/api/src/app.ts", "apps/api/src/worker.ts", "apps/api/src/maintenance.ts"];
const sourceHashes = Object.fromEntries(
  sourceFiles.map((file) => [
    file,
    createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex"),
  ]),
);
writeFileSync(
  path.join(evidenceDir, "manifest.json"),
  JSON.stringify(
    {
      task: "API-05",
      created_at: new Date().toISOString(),
      commit,
      node: process.version,
      cwd: root,
      commands: results,
      source_sha256: sourceHashes,
      planner: "DEV_FIXTURE",
      browser_e2e: "NOT_RUN",
      ai_evaluation: "NOT_RUN",
      rubric: "OPEN",
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ task: "API-05", evidence_dir: path.relative(root, evidenceDir), results }, null, 2));
if (results.some((result) => result.exit_code !== 0)) process.exitCode = 1;
