// Test-owned subprocess: after reserving a durable filesystem dispatch marker,
// exit before the real MCP client sends the filesystem write request.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { openDatabase } from "@wap/db";
import { WorkflowEngine, openLocalGateway } from "../dist/index.js";

const args = process.argv.slice(2);
if (args.length !== 5)
  throw Error("Marker crash harness requires exactly five arguments");
const [databaseUrl, userId, runId, root, allowedRoot] = args;
const name = new URL(databaseUrl).pathname;
if (!/^\/engine_it_[a-f0-9]{32}$/.test(name))
  throw Error("Marker crash harness requires an isolated engine test database");
if (!allowedRoot)
  throw Error("Marker crash harness requires an isolated filesystem root");

const db = openDatabase(databaseUrl);
const originalCallTool = Client.prototype.callTool;
Client.prototype.callTool = async function patchedCallTool(request, ...rest) {
  if (request.name === "write_file") {
    const marker = await db.client`
      SELECT 1 FROM filesystem_dispatches
      WHERE user_id=${userId} AND run_id=${runId}`;
    if (marker.length !== 1)
      throw Error("Expected committed filesystem dispatch marker");
    process.exit(87);
  }
  return originalCallTool.call(this, request, ...rest);
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
  await new WorkflowEngine(db, gateway, userId).execute(runId);
} finally {
  await gateway.close();
  await db.close();
}
