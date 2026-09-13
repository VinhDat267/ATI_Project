// Test-owned subprocess: real receiver commits, then this controller process exits before recording its reply.
import { openDatabase } from "@wap/db";
import { WorkflowEngine, openLocalGateway } from "../dist/index.js";
const [databaseUrl, userId, runId, root] = process.argv.slice(2);
const name = new URL(databaseUrl).pathname;
if (!/^\/engine_it_[a-f0-9]{32}$/.test(name))
  throw Error("Crash harness requires an isolated engine test database");
const db = openDatabase(databaseUrl),
  gateway = await openLocalGateway({ root, databaseUrl, userId });
try {
  const crashGateway = {
    ...gateway,
    async call(...args) {
      const response = await gateway.call(...args);
      if (args[2] && !response.isError) process.exit(86);
      return response;
    },
  };
  await new WorkflowEngine(db, crashGateway, userId).execute(runId);
} finally {
  await gateway.close();
  await db.close();
}
