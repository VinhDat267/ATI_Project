import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const evidenceDir =
  process.env.ATI_EVIDENCE_DIR ||
  path.resolve(
    "docs/task-hub-evidence/batch-02/FS-01",
    `${Date.now()}-candidate-probe`
  );
fs.mkdirSync(evidenceDir, { recursive: true });

const projectRoot = process.cwd();

// 1. Derive entry dynamically from package.json bin field
const pkgJsonPath = path.resolve(
  projectRoot,
  "node_modules/@modelcontextprotocol/server-filesystem/package.json"
);
if (!fs.existsSync(pkgJsonPath)) {
  throw new Error(`Package.json not found at ${pkgJsonPath}`);
}
const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
const binEntry =
  typeof pkgJson.bin === "string"
    ? pkgJson.bin
    : pkgJson.bin?.["mcp-server-filesystem"] ||
      (pkgJson.bin && Object.values(pkgJson.bin)[0]);

if (!binEntry || typeof binEntry !== "string") {
  throw new Error(
    "Failed to derive bin entry path from @modelcontextprotocol/server-filesystem/package.json"
  );
}

const entryPath = path.resolve(path.dirname(pkgJsonPath), binEntry);
if (!fs.existsSync(entryPath)) {
  throw new Error(`Upstream server entry not found at derived path: ${entryPath}`);
}

const fixtureContent = "Tiến độ ATI\nAPI: Done\n";

// 2. Create isolated temp root owned by this probe
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ati-fs-it-"));
const canonicalTempRoot = fs.realpathSync(tempRoot);

// Write .ati-root.json marker and notes.txt
const markerData = {
  format: "ati-filesystem-root-1",
  root_id: crypto.randomUUID(),
  user_id: "00000000-0000-4000-8000-000000000001",
};
fs.writeFileSync(
  path.join(canonicalTempRoot, ".ati-root.json"),
  JSON.stringify(markerData, null, 2),
  "utf8"
);
const notesFilePath = path.join(canonicalTempRoot, "notes.txt");
fs.writeFileSync(notesFilePath, fixtureContent, "utf8");

let client = null;
let transport = null;
let serverIdentity = null;
const discoveredTools = [];
let readResult = null;
let probePassed = false;
let cleanupVerified = false;
let probeError = null;
let closeError = null;
let cleanupError = null;

try {
  try {
    // 3. Launch upstream server via StdioClientTransport (Client without roots capability)
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [entryPath, canonicalTempRoot],
      cwd: projectRoot,
      env: { ...process.env },
    });

    client = new Client(
      { name: "ati-probe-client", version: "0.1.0" },
      { capabilities: {} } // no roots capability advertised
    );

    await client.connect(transport);

    serverIdentity = client.getServerVersion() ?? null;

    // 4. List all tools with cursor pagination and loop detection
    const toolNames = new Set();
    const seenCursors = new Set();
    let nextCursor = undefined;

    do {
      const listResp = await client.listTools(
        nextCursor ? { cursor: nextCursor } : undefined
      );
      for (const tool of listResp.tools) {
        if (toolNames.has(tool.name)) {
          throw new Error(`Duplicate tool name discovered: ${tool.name}`);
        }
        toolNames.add(tool.name);
        discoveredTools.push({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
        });
      }

      if (listResp.nextCursor) {
        if (seenCursors.has(listResp.nextCursor)) {
          throw new Error(`Cursor loop detected on cursor ${listResp.nextCursor}`);
        }
        seenCursors.add(listResp.nextCursor);
        nextCursor = listResp.nextCursor;
      } else {
        nextCursor = undefined;
      }
    } while (nextCursor);

    // 5. Raw read_text_file call
    readResult = await client.callTool({
      name: "read_text_file",
      arguments: { path: notesFilePath },
    });

    if (readResult.isError) {
      throw new Error(
        `read_text_file returned isError: true: ${JSON.stringify(readResult)}`
      );
    }

    // Strict oracle verification: both structuredContent and content must exist and match fixture
    if (
      !readResult.structuredContent ||
      typeof readResult.structuredContent !== "object" ||
      typeof readResult.structuredContent.content !== "string"
    ) {
      throw new Error("Missing or invalid structuredContent.content from read_text_file");
    }

    if (readResult.structuredContent.content !== fixtureContent) {
      throw new Error(
        `structuredContent.content mismatch: expected '${fixtureContent}', got '${readResult.structuredContent.content}'`
      );
    }

    if (
      !Array.isArray(readResult.content) ||
      readResult.content.length === 0 ||
      readResult.content[0]?.type !== "text" ||
      readResult.content[0]?.text !== fixtureContent
    ) {
      throw new Error(
        `content[0].text mismatch: expected '${fixtureContent}', got '${readResult.content?.[0]?.text}'`
      );
    }

    probePassed = true;
  } catch (err) {
    probeError = err;
  } finally {
    // 6. Clean up client and owned temp root
    if (client) {
      try {
        await client.close();
      } catch (err) {
        closeError = err;
      }
    }

    // Realpath containment check before removal
    const normalizedTemp = path.resolve(canonicalTempRoot);
    const normalizedTmpDir = path.resolve(os.tmpdir());
    if (
      normalizedTemp.startsWith(normalizedTmpDir) &&
      path.basename(normalizedTemp).startsWith("ati-fs-it-")
    ) {
      try {
        if (fs.existsSync(normalizedTemp)) {
          fs.rmSync(normalizedTemp, { recursive: true, force: true });
        }
        cleanupVerified = !fs.existsSync(normalizedTemp);
      } catch (e) {
        cleanupError = e;
        cleanupVerified = false;
      }
    }
  }
} finally {
  // 7. ALWAYS record evidence artifact in outer finally, even upon error
  const finalVerdict =
    probePassed && cleanupVerified && !closeError && !cleanupError ? "PASS" : "FAIL";

  const probeRecord = {
    recorded_at: new Date().toISOString(),
    task: "FS-01",
    package: "@modelcontextprotocol/server-filesystem",
    version: "2026.8.31",
    server_identity: serverIdentity,
    launch: {
      command: process.execPath.replace(/\\/g, "/"),
      entry: entryPath.replace(/\\/g, "/"),
      bin_entry_derived: binEntry,
      allowed_root_basename: path.basename(canonicalTempRoot),
    },
    discovered_tools_count: discoveredTools.length,
    discovered_tools: discoveredTools,
    read_probe: {
      tool: "read_text_file",
      path: "notes.txt",
      fixture_content: fixtureContent,
      observed_structured_content: readResult?.structuredContent ?? null,
      observed_content: readResult?.content ?? null,
      match: probePassed,
    },
    cleanup: {
      temp_root_removed: cleanupVerified,
      close_error: closeError ? closeError.message : null,
      cleanup_error: cleanupError ? cleanupError.message : null,
    },
    error: probeError ? probeError.message : null,
    verdict: finalVerdict,
  };

  fs.writeFileSync(
    path.join(evidenceDir, "filesystem-candidate-probe.json"),
    JSON.stringify(probeRecord, null, 2) + "\n"
  );

  console.log(
    JSON.stringify({
      probe: finalVerdict,
      server: serverIdentity,
      tools_count: discoveredTools.length,
      cleanup: cleanupVerified,
      close_error: closeError ? closeError.message : null,
      error: probeError ? probeError.message : null,
      evidence: path.join(evidenceDir, "filesystem-candidate-probe.json"),
    })
  );

  if (finalVerdict !== "PASS") {
    process.exitCode = 1;
  }
}
