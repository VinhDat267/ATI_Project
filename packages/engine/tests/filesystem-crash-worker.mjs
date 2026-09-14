// Test-owned subprocess: the real filesystem receiver commits bytes, then the
// controller process exits before persisting its MCP reply.
import { openDatabase } from "@wap/db";
import { WorkflowEngine, openLocalGateway } from "../dist/index.js";

const [databaseUrl, userId, runId, root, allowedRoot] = process.argv.slice(2);
const name = new URL(databaseUrl).pathname;
if (!/^\/engine_it_[a-f0-9]{32}$/.test(name))
  throw Error("Crash harness requires an isolated engine test database");
if (!allowedRoot)
  throw Error("Crash harness requires an isolated filesystem root");
const db = openDatabase(databaseUrl);
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
  const crashGateway = {
    ...gateway,
    async call(...args) {
      const response = await gateway.call(...args);
      if (
        args[2] &&
        args[0]?.server === "filesystem" &&
        args[0]?.name === "write_file"
      )
        process.exit(86);
      return response;
    },
  };
  await new WorkflowEngine(db, crashGateway, userId).execute(runId);
} finally {
  await gateway.close();
  await db.close();
}
