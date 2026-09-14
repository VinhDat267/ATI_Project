// Test-owned subprocess: replace the raw filesystem write reply after the
// controller durably reserves its dispatch marker and the real write completes.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { openDatabase } from "@wap/db";
import { WorkflowEngine, openLocalGateway } from "../dist/index.js";

const args = process.argv.slice(2);
if (args.length !== 6)
  throw Error("Raw fault harness requires exactly six arguments");
const [mode, databaseUrl, userId, runId, root, allowedRoot] = args;
if (mode !== "is_error" && mode !== "malformed_ack")
  throw Error("Raw fault harness mode must be is_error or malformed_ack");
const name = new URL(databaseUrl).pathname;
if (!/^\/engine_it_[a-f0-9]{32}$/.test(name))
  throw Error("Raw fault harness requires an isolated engine test database");
if (!allowedRoot)
  throw Error("Raw fault harness requires an isolated filesystem root");

const db = openDatabase(databaseUrl);
const originalCallTool = Client.prototype.callTool;
let injectedWriteCalls = 0;
Client.prototype.callTool = async function patchedCallTool(request, ...rest) {
  if (request.name !== "write_file")
    return originalCallTool.call(this, request, ...rest);

  injectedWriteCalls += 1;
  await originalCallTool.call(this, request, ...rest);
  if (mode === "is_error")
    return { isError: true, content: [{ type: "text", text: "BAD_ARGS" }] };
  return {
    structuredContent: { content: "unexpected acknowledgement" },
    content: [{ type: "text", text: "unexpected acknowledgement" }],
  };
};

const launch = {
  presetId: "filesystem-local-v1",
  allowedRoot,
  policyFile: `${root}/config/filesystem-reviewed.json`,
  artifactFile: `${root}/config/filesystem-reviewed.json`,
};
const gateway = await openLocalGateway({
  root,
  databaseUrl,
  userId,
  filesystem: launch,
});
try {
  const engine = new WorkflowEngine(db, gateway, userId);
  let result;
  try {
    result = await engine.execute(runId);
  } catch (error) {
    result = await engine.detail(runId);
    if (result.status !== "reconciliation_required") throw error;
  }
  process.stdout.write(
    JSON.stringify({
      status: result.status,
      injected_write_calls: injectedWriteCalls,
    }) + "\n",
  );
} finally {
  await gateway.close();
  await db.close();
}
