import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  G1_DATABASE_URL,
  migrate,
  openDatabase,
  seedDemo,
} from "@wap/db";
import {
  captureFilesystemArtifactDeep,
  loadFilesystemLaunch,
  openLocalGateway,
} from "@wap/engine";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const evidenceDir = process.env.ATI_EVIDENCE_DIR
  ? path.resolve(process.env.ATI_EVIDENCE_DIR)
  : path.join(
      projectRoot,
      "docs",
      "task-hub-evidence",
      "batch-02",
      "FS-06",
      `${Date.now()}-final-snapshot`,
    );
const fixtureText = "Tiến độ ATI\nAPI: Done\n";
const migrationNames = [
  "0001_init.sql",
  "0002_audit_contracts.sql",
  "0003_task_hub_local.sql",
  "0004_task_hub_cards.sql",
  "0005_filesystem_dispatches.sql",
];
const taskHubNames = [
  "append_sheet_rows",
  "create_card",
  "get_card",
  "list_cards",
  "list_members",
  "move_card",
  "read_sheet_range",
  "send_slack_message",
].sort();
const filesystemNames = [
  "create_directory",
  "directory_tree",
  "edit_file",
  "get_file_info",
  "list_allowed_directories",
  "list_directory",
  "list_directory_with_sizes",
  "move_file",
  "read_file",
  "read_media_file",
  "read_multiple_files",
  "read_text_file",
  "search_files",
  "write_file",
].sort();
const normalizedNames = [
  ...taskHubNames.map((name) => `task_hub.${name}`),
  "filesystem.read_file",
  "filesystem.write_file",
].sort();

const snapshot = {
  status: "FAIL",
  recorded_at: null,
  node: {
    version: process.version,
    executable_basename: path.basename(process.execPath),
    platform: process.platform,
    arch: process.arch,
  },
  principal: { user_id: null },
  database: { name: null, server_version: null },
  migrations: [],
  roots: {
    canonical_path: null,
    marker: { format: null, root_id: null, user_id: null },
    stat: { dev: null, ino: null },
  },
  servers: {
    task_hub: { identity: null, command_basename: null, entry_basename: null },
    filesystem: { identity: null, command_basename: null, entry_basename: null },
  },
  raw_discovery: {
    task_hub: { count: 0, names: [], pages: 0, tools: [] },
    filesystem: { count: 0, names: [], pages: 0, tools: [] },
  },
  normalized_catalog: { count: 0, names: [], tools: [] },
  read_oracles: {
    read_sheet_range: null,
    get_card: null,
    list_cards: null,
    list_members: null,
    read_text_file: null,
  },
  dependency_fingerprints: {
    contract_exports: {
      openLocalGateway: typeof openLocalGateway === "function",
      loadFilesystemLaunch: typeof loadFilesystemLaunch === "function",
      isolated_root_strategy: "explicit_filesystem_launch",
    },
    reviewed_contracts: [],
    built_runtime: [],
    migration_files: [],
    filesystem_dependency_closure: null,
  },
  cleanup: {
    gateway_close_error: null,
    task_hub_client_close_error: null,
    task_hub_transport_close_error: null,
    filesystem_client_close_error: null,
    filesystem_transport_close_error: null,
    database_close_error: null,
    admin_close_error: null,
    db_drop_error: null,
    root_remove_error: null,
    db_dropped: false,
    root_removed: false,
    failure: null,
  },
};

const normalizePath = (value) => value.replaceAll("\\", "/");
const sha256 = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const equal = (left, right) =>
  JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const sanitizeText = (value) =>
  String(value)
    .replace(/postgres(?:ql)?:\/\/[^\s/]+/gi, "postgresql://[REDACTED]")
    .replace(
      /(password|token|secret|api[_-]?key)\s*[=:]\s*\S+/gi,
      "$1=[REDACTED]",
    );
const errorRecord = (error) => ({
  name: error instanceof Error ? error.name : "UnknownError",
  code:
    error && typeof error === "object" && "code" in error
      ? sanitizeText(error.code)
      : null,
  message: sanitizeText(error instanceof Error ? error.message : error),
});
const safeClose = async (resource, field) => {
  if (!resource) return;
  try {
    await resource.close();
  } catch (error) {
    snapshot.cleanup[field] = errorRecord(error);
  }
};

function dedicatedAdminAddress(value) {
  const address = new URL(value);
  if (
    address.protocol !== "postgresql:" ||
    !["127.0.0.1", "localhost"].includes(address.hostname) ||
    address.port !== "55532" ||
    address.pathname !== "/wap_g1" ||
    address.search !== "" ||
    address.hash !== ""
  )
    throw new Error("Database configuration rejected");
  return address;
}

function assertIsolationGuards() {
  assert(
    !/^fs06_it_[a-f0-9]{32}$/.test("wap_g1"),
    "Isolation database guard self-check failed",
  );
  const invalidRoot = path.join(os.tmpdir(), "ati-fs-other-unsafe");
  assert(
    !path.basename(invalidRoot).startsWith("ati-fs06-"),
    "Isolation root guard self-check failed",
  );
}

function assertGeneratedDatabaseName(name) {
  assert(
    /^fs06_it_[a-f0-9]{32}$/.test(name),
    "Refusing database outside fs06_it generated scope",
  );
}

function assertGeneratedRoot(root) {
  const resolved = path.resolve(root);
  assert(
    path.dirname(resolved) === path.resolve(os.tmpdir()) &&
      /^ati-fs06-[A-Za-z0-9]+$/.test(path.basename(resolved)),
    "Refusing root outside ati-fs06 generated scope",
  );
}

function fingerprintFiles(relativePaths) {
  return relativePaths
    .map((relativePath) => {
      const absolute = path.join(projectRoot, relativePath);
      assert(fs.statSync(absolute).isFile(), `Fingerprint target is not a file: ${relativePath}`);
      return { path: normalizePath(relativePath), sha256: sha256(absolute) };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function discoverAllTools(client, label) {
  const tools = [];
  const names = new Set();
  const seenCursors = new Set();
  let cursor;
  let pages = 0;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    pages += 1;
    assert(Array.isArray(page.tools), `${label} tools/list did not return tools`);
    for (const tool of page.tools) {
      assert(typeof tool.name === "string", `${label} returned a nameless tool`);
      assert(!names.has(tool.name), `${label} returned duplicate tool ${tool.name}`);
      names.add(tool.name);
      tools.push({
        name: tool.name,
        description: tool.description ?? null,
        inputSchema: tool.inputSchema ?? null,
        outputSchema: tool.outputSchema ?? null,
      });
    }
    const next = page.nextCursor;
    if (next) {
      assert(!seenCursors.has(next), `${label} tools/list cursor loop`);
      seenCursors.add(next);
    }
    cursor = next;
  } while (cursor);
  tools.sort((left, right) => left.name.localeCompare(right.name));
  return { count: tools.length, names: [...names].sort(), pages, tools };
}

async function callRead(client, name, args, expected) {
  const result = await client.callTool({ name, arguments: args });
  assert(result.isError !== true, `${name} returned isError`);
  assert(
    equal(result.structuredContent, expected),
    `${name} structuredContent differed from its exact seed oracle`,
  );
  return {
    tool: name,
    arguments: args,
    expected,
    observed: result.structuredContent,
    match: true,
  };
}

function closureFingerprint() {
  const artifact = captureFilesystemArtifactDeep(projectRoot);
  return {
    package: artifact.package,
    version: artifact.version,
    entry: normalizePath(path.relative(projectRoot, artifact.entryPath)),
    node: {
      executable_basename: path.basename(artifact.nodePath),
      version: artifact.nodeVersion,
    },
    package_files: artifact.files,
    dependency_packages: artifact.dependencyPackages,
    dependency_files: artifact.dependencyFiles,
  };
}

assertIsolationGuards();
fs.mkdirSync(evidenceDir, { recursive: true });

const principal = randomUUID();
const databaseName = `fs06_it_${randomUUID().replaceAll("-", "")}`;
assertGeneratedDatabaseName(databaseName);
snapshot.principal.user_id = principal;
snapshot.database.name = databaseName;

let admin;
let database;
let gateway;
let taskHubClient;
let taskHubTransport;
let filesystemClient;
let filesystemTransport;
let generatedRoot;
let databaseCreated = false;
let requirementsPassed = false;
let failure;

try {
  const adminAddress = dedicatedAdminAddress(
    process.env.G1_DATABASE_URL ?? G1_DATABASE_URL,
  );
  const isolatedAddress = new URL(adminAddress);
  isolatedAddress.pathname = `/${databaseName}`;
  isolatedAddress.search = "";
  isolatedAddress.hash = "";
  assert(
    isolatedAddress.pathname === `/${databaseName}`,
    "Generated database URL path changed",
  );

  admin = postgres(adminAddress.href, {
    max: 1,
    connect_timeout: 5,
    onnotice: () => {},
  });
  const preexisting = await admin`
    SELECT datname FROM pg_database WHERE datname = ${databaseName}
  `;
  assert(preexisting.length === 0, "Generated database name was not fresh");
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;

  const migrationRun = await migrate(isolatedAddress.href);
  assert(migrationRun.total === 5, "migrate did not report exactly five migrations");
  database = openDatabase(isolatedAddress.href);
  await seedDemo(database, principal);
  const migrationRows = await database.client`
    SELECT name, checksum FROM schema_migrations ORDER BY name
  `;
  const serverVersionRows = await database.client`SHOW server_version`;
  const expectedMigrationFingerprints = fingerprintFiles(
    migrationNames.map((name) => `db/migrations/${name}`),
  );
  const expectedMigrationMap = new Map(
    expectedMigrationFingerprints.map((item) => [path.basename(item.path), item.sha256]),
  );
  snapshot.migrations = migrationRows.map(({ name, checksum }) => ({ name, checksum }));
  snapshot.database.server_version = serverVersionRows[0]?.server_version ?? null;
  assert(snapshot.migrations.length === 5, "schema_migrations did not contain five rows");
  assert(
    equal(
      snapshot.migrations.map(({ name }) => name),
      migrationNames,
    ),
    "schema_migrations names differed from the five reviewed migrations",
  );
  assert(
    snapshot.migrations.every(
      ({ name, checksum }) => expectedMigrationMap.get(name) === checksum,
    ),
    "schema_migrations checksum differed from checked-in migration bytes",
  );

  generatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ati-fs06-"));
  assertGeneratedRoot(generatedRoot);
  const canonicalRoot = fs.realpathSync(generatedRoot);
  assertGeneratedRoot(canonicalRoot);
  const marker = {
    format: "ati-filesystem-root-1",
    root_id: randomUUID(),
    user_id: principal,
  };
  fs.writeFileSync(
    path.join(canonicalRoot, ".ati-root.json"),
    `${JSON.stringify(marker, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  fs.writeFileSync(path.join(canonicalRoot, "notes.txt"), fixtureText, {
    encoding: "utf8",
    flag: "wx",
  });
  fs.mkdirSync(path.join(canonicalRoot, "reports"), { recursive: false });
  const rootStat = fs.statSync(canonicalRoot, { bigint: true });
  snapshot.roots = {
    canonical_path: normalizePath(canonicalRoot),
    marker,
    stat: {
      dev: rootStat.dev === undefined ? null : rootStat.dev.toString(),
      ino: rootStat.ino === undefined ? null : rootStat.ino.toString(),
    },
  };

  const taskHubEntry = path.join(
    projectRoot,
    "apps",
    "mcp-task-hub",
    "dist",
    "server.js",
  );
  taskHubTransport = new StdioClientTransport({
    command: process.execPath,
    args: [taskHubEntry],
    cwd: projectRoot,
    env: { G1_DATABASE_URL: isolatedAddress.href, G1_USER_ID: principal },
    stderr: "pipe",
  });
  taskHubClient = new Client({ name: "ati-fs06-task-hub", version: "1.0.0" });
  await taskHubClient.connect(taskHubTransport);
  snapshot.servers.task_hub = {
    identity: taskHubClient.getServerVersion() ?? null,
    command_basename: path.basename(process.execPath),
    entry_basename: path.basename(taskHubEntry),
  };
  snapshot.raw_discovery.task_hub = await discoverAllTools(
    taskHubClient,
    "task_hub",
  );
  assert(
    equal(snapshot.raw_discovery.task_hub.names, taskHubNames),
    "task_hub raw discovery was not exactly the reviewed eight tools",
  );

  snapshot.read_oracles.read_sheet_range = await callRead(
    taskHubClient,
    "read_sheet_range",
    { spreadsheet_id: "source", range: "Progress!A1:B2" },
    { values: [["API", "Done"], ["UI", "Doing"]], row_count: 2 },
  );
  snapshot.read_oracles.get_card = await callRead(
    taskHubClient,
    "get_card",
    { card_id: "c1" },
    { id: "c1", board_id: "board_a", title: "Viết API", list_name: "Doing" },
  );
  snapshot.read_oracles.list_cards = await callRead(
    taskHubClient,
    "list_cards",
    { board_id: "board_a", list_name: "Doing", assignee_id: "m1" },
    {
      cards: [
        { id: "c1", board_id: "board_a", title: "Viết API", list_name: "Doing" },
      ],
      count: 1,
    },
  );
  snapshot.read_oracles.list_members = await callRead(
    taskHubClient,
    "list_members",
    { board_id: "board_a" },
    {
      members: [
        { id: "m1", name: "An", task_count: 1 },
        { id: "m2", name: "Bình", task_count: 0 },
      ],
    },
  );

  const filesystemPackage = path.join(
    projectRoot,
    "node_modules",
    "@modelcontextprotocol",
    "server-filesystem",
  );
  const filesystemPackageJson = JSON.parse(
    fs.readFileSync(path.join(filesystemPackage, "package.json"), "utf8"),
  );
  const filesystemBin =
    typeof filesystemPackageJson.bin === "string"
      ? filesystemPackageJson.bin
      : filesystemPackageJson.bin?.["mcp-server-filesystem"];
  assert(typeof filesystemBin === "string", "Filesystem package bin is unavailable");
  const filesystemEntry = path.resolve(filesystemPackage, filesystemBin);
  filesystemTransport = new StdioClientTransport({
    command: process.execPath,
    args: [filesystemEntry, canonicalRoot],
    cwd: projectRoot,
    env: { NODE_ENV: "production" },
    stderr: "pipe",
  });
  filesystemClient = new Client(
    { name: "ati-fs06-filesystem", version: "1.0.0" },
    { capabilities: {} },
  );
  await filesystemClient.connect(filesystemTransport);
  snapshot.servers.filesystem = {
    identity: filesystemClient.getServerVersion() ?? null,
    command_basename: path.basename(process.execPath),
    entry_basename: path.basename(filesystemEntry),
  };
  snapshot.raw_discovery.filesystem = await discoverAllTools(
    filesystemClient,
    "filesystem",
  );
  assert(
    equal(snapshot.raw_discovery.filesystem.names, filesystemNames),
    "filesystem raw discovery was not exactly the reviewed fourteen tools",
  );
  assert(
    snapshot.raw_discovery.filesystem.names.includes("read_text_file") &&
      snapshot.raw_discovery.filesystem.names.includes("write_file"),
    "filesystem raw discovery missed a reviewed raw tool",
  );
  const rawFilesystemRead = await filesystemClient.callTool({
    name: "read_text_file",
    arguments: { path: path.join(canonicalRoot, "notes.txt") },
  });
  assert(rawFilesystemRead.isError !== true, "read_text_file returned isError");
  assert(
    rawFilesystemRead.structuredContent?.content === fixtureText &&
      rawFilesystemRead.content?.length === 1 &&
      rawFilesystemRead.content[0]?.type === "text" &&
      rawFilesystemRead.content[0]?.text === fixtureText,
    "read_text_file did not return the exact UTF-8 oracle in both MCP fields",
  );
  snapshot.read_oracles.read_text_file = {
    tool: "read_text_file",
    arguments: { path: "notes.txt" },
    expected: fixtureText,
    observed: {
      structuredContent: rawFilesystemRead.structuredContent,
      content: rawFilesystemRead.content,
    },
    match: true,
  };

  gateway = await openLocalGateway({
    root: projectRoot,
    databaseUrl: isolatedAddress.href,
    userId: principal,
    filesystem: {
      presetId: "filesystem-local-v1",
      allowedRoot: canonicalRoot,
      policyFile: path.join(projectRoot, "config", "filesystem-reviewed.json"),
      artifactFile: path.join(projectRoot, "config", "filesystem-reviewed.json"),
    },
  });
  await gateway.assertCurrent();
  const normalizedTools = [...gateway.tools].sort((left, right) =>
    `${left.server}.${left.name}`.localeCompare(`${right.server}.${right.name}`),
  );
  const actualNormalizedNames = normalizedTools.map(
    ({ server, name }) => `${server}.${name}`,
  );
  snapshot.normalized_catalog = {
    count: normalizedTools.length,
    names: actualNormalizedNames,
    tools: normalizedTools,
  };
  assert(normalizedTools.length === 10, "Gateway catalog did not contain ten tools");
  assert(
    equal(actualNormalizedNames, normalizedNames),
    "Gateway catalog was not exactly eight task_hub plus two filesystem tools",
  );

  snapshot.dependency_fingerprints.reviewed_contracts = fingerprintFiles([
    "config/filesystem-reviewed.json",
    "config/mcp-presets.json",
    "package-lock.json",
    "testdata/tools.json",
  ]);
  snapshot.dependency_fingerprints.built_runtime = fingerprintFiles([
    "apps/mcp-task-hub/dist/cards.js",
    "apps/mcp-task-hub/dist/contracts.js",
    "apps/mcp-task-hub/dist/server.js",
    "apps/mcp-task-hub/dist/service.js",
    "packages/db/dist/connection.js",
    "packages/db/dist/migrate.js",
    "packages/db/dist/seed.js",
    "packages/engine/dist/gateway-filesystem.js",
    "packages/engine/dist/gateway-task-hub.js",
    "packages/engine/dist/gateway.js",
    "packages/engine/dist/index.js",
    "packages/engine/dist/launch-policy.js",
  ]);
  snapshot.dependency_fingerprints.migration_files =
    expectedMigrationFingerprints;
  snapshot.dependency_fingerprints.filesystem_dependency_closure =
    closureFingerprint();
  assert(
    snapshot.dependency_fingerprints.contract_exports.openLocalGateway &&
      snapshot.dependency_fingerprints.contract_exports.loadFilesystemLaunch,
    "Built engine contract exports were unavailable",
  );
  requirementsPassed = true;
} catch (error) {
  failure = error;
} finally {
  try {
    await safeClose(gateway, "gateway_close_error");
  } finally {
    try {
      await safeClose(filesystemClient, "filesystem_client_close_error");
      await safeClose(filesystemTransport, "filesystem_transport_close_error");
    } finally {
      try {
        await safeClose(taskHubClient, "task_hub_client_close_error");
        await safeClose(taskHubTransport, "task_hub_transport_close_error");
      } finally {
        try {
          await safeClose(database, "database_close_error");
        } finally {
          try {
            if (databaseCreated) {
              assertGeneratedDatabaseName(databaseName);
              await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
              const remaining = await admin`
                SELECT datname FROM pg_database WHERE datname = ${databaseName}
              `;
              assert(remaining.length === 0, "Generated database remained after drop");
              snapshot.cleanup.db_dropped = true;
            }
          } catch (error) {
            snapshot.cleanup.db_drop_error = errorRecord(error);
          } finally {
            try {
              if (generatedRoot) {
                assertGeneratedRoot(generatedRoot);
                fs.rmSync(generatedRoot, { recursive: true, force: true });
                snapshot.cleanup.root_removed = !fs.existsSync(generatedRoot);
              }
            } catch (error) {
              snapshot.cleanup.root_remove_error = errorRecord(error);
            } finally {
              if (admin) {
                try {
                  await admin.end({ timeout: 5 });
                } catch (error) {
                  snapshot.cleanup.admin_close_error = errorRecord(error);
                }
              }
            }
          }
        }
      }
    }
  }
}

const closeFields = [
  "gateway_close_error",
  "task_hub_client_close_error",
  "task_hub_transport_close_error",
  "filesystem_client_close_error",
  "filesystem_transport_close_error",
  "database_close_error",
  "admin_close_error",
  "db_drop_error",
  "root_remove_error",
];
const cleanupPassed =
  snapshot.cleanup.db_dropped &&
  snapshot.cleanup.root_removed &&
  closeFields.every((field) => snapshot.cleanup[field] == null);
snapshot.cleanup.failure = failure ? errorRecord(failure) : null;
snapshot.status = requirementsPassed && cleanupPassed && !failure ? "PASS" : "FAIL";
snapshot.recorded_at = new Date().toISOString();

fs.writeFileSync(
  path.join(evidenceDir, "final-snapshot.json"),
  `${JSON.stringify(snapshot, null, 2)}\n`,
  { flag: "wx" },
);
console.log(
  JSON.stringify(
    {
      status: snapshot.status,
      database: snapshot.database.name,
      migrations: snapshot.migrations.length,
      raw_task_hub: snapshot.raw_discovery.task_hub.count,
      raw_filesystem: snapshot.raw_discovery.filesystem.count,
      normalized: snapshot.normalized_catalog.count,
      oracles: Object.values(snapshot.read_oracles).filter(
        (oracle) => oracle?.match === true,
      ).length,
      cleanup: {
        db_dropped: snapshot.cleanup.db_dropped,
        root_removed: snapshot.cleanup.root_removed,
      },
      evidence: normalizePath(path.join(evidenceDir, "final-snapshot.json")),
    },
    null,
    2,
  ),
);
process.exitCode = snapshot.status === "PASS" ? 0 : 1;
