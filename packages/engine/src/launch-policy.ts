import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { inspectFilesystemPath } from "./filesystem-paths.js";
import { EngineError } from "./snapshot.js";
import type { FilesystemLaunch } from "./gateway-types.js";

export type ArtifactRecord = {
  package: "@modelcontextprotocol/server-filesystem";
  version: "2026.8.31";
  entryPath: string;
  nodePath: string;
  nodeVersion: string;
  files: Array<{ path: string; sha256: string }>;
  dependencyPackages: Array<{ name: string; version: string; root: string }>;
};

export type DeepArtifactRecord = ArtifactRecord & {
  dependencyFiles: Array<{
    name: string;
    version: string;
    root: string;
    files: Array<{ path: string; sha256: string }>;
  }>;
};

function walkDir(dir: string): string[] {
  let results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walkDir(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

export function captureFilesystemArtifact(projectRoot: string): ArtifactRecord {
  const pkgDir = path.resolve(
    projectRoot,
    "node_modules/@modelcontextprotocol/server-filesystem"
  );
  if (!fs.existsSync(pkgDir)) {
    throw new Error(
      `Package @modelcontextprotocol/server-filesystem not found at ${pkgDir}`
    );
  }

  const pkgJsonPath = path.join(pkgDir, "package.json");
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));

  if (
    pkgJson.name !== "@modelcontextprotocol/server-filesystem" ||
    pkgJson.version !== "2026.8.31"
  ) {
    throw new Error(
      `Unexpected package metadata: name=${pkgJson.name}, version=${pkgJson.version}`
    );
  }

  const binRelative =
    typeof pkgJson.bin === "string"
      ? pkgJson.bin
      : pkgJson.bin?.["mcp-server-filesystem"] || "dist/index.js";
  const entryPath = path.resolve(pkgDir, binRelative);
  if (!fs.existsSync(entryPath)) {
    throw new Error(`Server filesystem entry path does not exist: ${entryPath}`);
  }

  const allFiles = walkDir(pkgDir);
  const files: Array<{ path: string; sha256: string }> = [];

  for (const f of allFiles) {
    const rel = path.relative(pkgDir, f).replace(/\\/g, "/");
    const buf = fs.readFileSync(f);
    const hash = crypto.createHash("sha256").update(buf).digest("hex");
    files.push({ path: rel, sha256: hash });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  // Resolved dependency packages
  const dependencyPackages: Array<{
    name: string;
    version: string;
    root: string;
  }> = [];

  if (pkgJson.dependencies && typeof pkgJson.dependencies === "object") {
    for (const [depName, depVersion] of Object.entries(pkgJson.dependencies)) {
      // Find where dep is installed (nested or root node_modules)
      const nestedPath = path.join(pkgDir, "node_modules", depName);
      const rootDepPath = path.join(projectRoot, "node_modules", depName);
      let depRoot = "";
      let actualVersion = String(depVersion);

      if (fs.existsSync(nestedPath)) {
        depRoot = nestedPath;
        try {
          const depPkg = JSON.parse(
            fs.readFileSync(path.join(nestedPath, "package.json"), "utf8")
          );
          actualVersion = depPkg.version ?? actualVersion;
        } catch {}
      } else if (fs.existsSync(rootDepPath)) {
        depRoot = rootDepPath;
        try {
          const depPkg = JSON.parse(
            fs.readFileSync(path.join(rootDepPath, "package.json"), "utf8")
          );
          actualVersion = depPkg.version ?? actualVersion;
        } catch {}
      }

      dependencyPackages.push({
        name: depName,
        version: actualVersion,
        root: depRoot ? path.relative(projectRoot, depRoot).replace(/\\/g, "/") : "",
      });
    }
  }

  dependencyPackages.sort((a, b) => a.name.localeCompare(b.name));

  return {
    package: "@modelcontextprotocol/server-filesystem",
    version: "2026.8.31",
    entryPath: entryPath.replace(/\\/g, "/"),
    nodePath: process.execPath.replace(/\\/g, "/"),
    nodeVersion: process.version,
    files,
    dependencyPackages,
  };
}

const EXECUTABLE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".json", ".node"]);

function walkExecutableFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) result.push(...walkExecutableFiles(full));
    else if (entry.isFile() && (entry.name === "package.json" || EXECUTABLE_EXTENSIONS.has(path.extname(entry.name))))
      result.push(full);
  }
  return result;
}

function packageRootFromResolved(resolved: string): string {
  let current = path.dirname(resolved);
  while (true) {
    if (fs.existsSync(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`PACKAGE_METADATA_NOT_FOUND: ${resolved}`);
    current = parent;
  }
}

function packageDependencies(
  pkg: Record<string, unknown>,
  fields = ["dependencies", "optionalDependencies", "peerDependencies"],
): string[] {
  const names = new Set<string>();
  for (const field of fields) {
    const value = pkg[field];
    if (value && typeof value === "object")
      for (const name of Object.keys(value as Record<string, unknown>)) names.add(name);
  }
  return [...names].sort();
}

/** Capture installed executable bytes for the package and resolved dependency graph. */
export function captureFilesystemArtifactDeep(projectRoot: string): DeepArtifactRecord {
  const base = captureFilesystemArtifact(projectRoot);
  const rootPackage = path.resolve(projectRoot, "node_modules/@modelcontextprotocol/server-filesystem");
  const visited = new Set<string>();
  const dependencyFiles: DeepArtifactRecord["dependencyFiles"] = [];
  const queue: Array<{ name: string; root: string }> = [];
  const enqueue = (name: string, fromRoot: string, required: boolean) => {
    let root: string | undefined;
    let current = fromRoot;
    while (true) {
      const candidate = path.join(current, "node_modules", name);
      if (fs.existsSync(path.join(candidate, "package.json"))) {
        root = fs.realpathSync(candidate);
        break;
      }
      const parent = path.dirname(current);
      if (parent === current || !path.resolve(parent).startsWith(path.resolve(projectRoot))) break;
      current = parent;
    }
    if (!root) {
      const rootCandidate = path.join(projectRoot, "node_modules", name);
      if (fs.existsSync(path.join(rootCandidate, "package.json"))) root = fs.realpathSync(rootCandidate);
    }
    if (!root) {
      if (required) throw new Error(`DEPENDENCY_NOT_RESOLVED: ${name} from ${fromRoot}`);
      return;
    }
    if (!visited.has(root)) queue.push({ name, root });
  };
  visited.add(fs.realpathSync(rootPackage));
  const rootMetadata = JSON.parse(fs.readFileSync(path.join(rootPackage, "package.json"), "utf8"));
  for (const name of packageDependencies(rootMetadata, ["dependencies"])) enqueue(name, rootPackage, true);
  for (const name of packageDependencies(rootMetadata, ["optionalDependencies", "peerDependencies"])) enqueue(name, rootPackage, false);
  while (queue.length) {
    const item = queue.shift()!;
    const realRoot = fs.realpathSync(item.root);
    if (visited.has(realRoot)) continue;
    visited.add(realRoot);
    const metadata = JSON.parse(fs.readFileSync(path.join(realRoot, "package.json"), "utf8"));
    const files = walkExecutableFiles(realRoot)
      .map((file) => ({
        path: path.relative(realRoot, file).replace(/\\/g, "/"),
        sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
    dependencyFiles.push({
      name: metadata.name ?? item.name,
      version: metadata.version ?? "",
      root: path.relative(projectRoot, realRoot).replace(/\\/g, "/"),
      files,
    });
    for (const name of packageDependencies(metadata, ["dependencies"])) enqueue(name, realRoot, true);
    for (const name of packageDependencies(metadata, ["optionalDependencies", "peerDependencies"])) enqueue(name, realRoot, false);
  }
  dependencyFiles.sort((a, b) => a.name.localeCompare(b.name) || a.root.localeCompare(b.root));
  return { ...base, dependencyFiles };
}

export function verifyFilesystemArtifact(
  projectRoot: string,
  reviewed: DeepArtifactRecord,
): DeepArtifactRecord {
  const actual = captureFilesystemArtifactDeep(projectRoot);
  const normalize = (value: DeepArtifactRecord) => ({
    package: value.package,
    version: value.version,
    entryPath: path.isAbsolute(value.entryPath)
      ? path.relative(path.resolve(projectRoot, "node_modules/@modelcontextprotocol/server-filesystem"), value.entryPath).replace(/\\/g, "/")
      : value.entryPath.replace(/\\/g, "/"),
    nodePath: value.nodePath,
    nodeVersion: value.nodeVersion,
    files: value.files,
    dependencyPackages: value.dependencyPackages,
    dependencyFiles: value.dependencyFiles,
  });
  if (JSON.stringify(normalize(actual)) !== JSON.stringify(normalize(reviewed)))
    throw new Error("FILESYSTEM_ARTIFACT_CHANGED");
  return actual;
}

export async function loadFilesystemLaunch(
  projectRoot: string,
  userId: string,
): Promise<FilesystemLaunch | undefined> {
  const flag = process.env.G1_FILESYSTEM_ENABLED;
  if (flag === undefined || ["0", "false", "off"].includes(flag.toLowerCase())) return undefined;
  if (!["1", "true", "on"].includes(flag.toLowerCase()))
    throw new EngineError("CONFIG", "G1_FILESYSTEM_ENABLED must be an explicit on/off value");
  const root = path.resolve(projectRoot);
  const userPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!userPattern.test(userId)) throw new EngineError("CONFIG", "Filesystem principal must be a UUID");
  const presetPath = path.join(root, "config", "mcp-presets.json");
  const policyFile = path.join(root, "config", "filesystem-reviewed.json");
  let presets: any, review: any;
  try {
    presets = JSON.parse(fs.readFileSync(presetPath, "utf8"));
    review = JSON.parse(fs.readFileSync(policyFile, "utf8"));
  } catch (error) {
    throw new EngineError("CONFIG", `Filesystem preset/review is unavailable: ${(error as Error).message}`);
  }
  const preset = presets.approved_presets?.find((item: any) => item.id === "filesystem-local-v1");
  if (!preset) throw new EngineError("CONFIG", "filesystem-local-v1 is not approved");
  for (const [key, expected] of Object.entries({
    server: "filesystem",
    package: "@modelcontextprotocol/server-filesystem",
    version: "2026.8.31",
    integrity: "sha512-kKaFkyAh6oipvc9+EAbJ552JafnMnOq5nzmzWkp1jJdBhTAAGpmIpWihUG1+rfNhmEFM98gUZDdCHCDD4v6a7Q==",
    entry: "dist/index.js",
    policy_version: "b-local-fs-1",
    root_strategy: "project-runtime-principal",
  }))
    if (preset[key] !== expected) throw new EngineError("REGISTRY_CHANGED", `Filesystem preset drift: ${key}`);
  if (
    review.package !== "@modelcontextprotocol/server-filesystem" ||
    review.version !== "2026.8.31" ||
    review.entry !== "dist/index.js" ||
    review.policyVersion !== "b-local-fs-1" ||
    review.rootStrategy !== "project-runtime-principal"
  ) throw new EngineError("REGISTRY_CHANGED", "Filesystem reviewed policy drifted");
  if (
    review.id !== "filesystem-local-v1" ||
    review.policyVersion !== "b-local-fs-1" ||
    JSON.stringify(preset.enabled_tools) !== JSON.stringify(["read_file", "write_file"]) ||
    JSON.stringify(review.enabledTools) !== JSON.stringify(["read_file", "write_file"]) ||
    review.maxBytes !== 65536
  )
    throw new EngineError("REGISTRY_CHANGED", "Filesystem reviewed policy drifted");
  try {
    verifyFilesystemArtifact(root, review.artifact as DeepArtifactRecord);
  } catch (error) {
    throw new EngineError("REGISTRY_CHANGED", error instanceof Error ? error.message : "Filesystem artifact changed");
  }
  const allowedRoot = path.resolve(root, "runtime", "filesystem", userId);
  try {
    await inspectFilesystemPath(allowedRoot, "notes.txt", "read", userId);
  } catch (error) {
    throw new EngineError("CONFIG", error instanceof Error ? error.message : "Filesystem demo root is invalid");
  }
  return { presetId: "filesystem-local-v1", allowedRoot, policyFile, artifactFile: policyFile };
}
