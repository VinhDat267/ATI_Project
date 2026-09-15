import { openDatabase } from "@wap/db";
import {
  WorkflowEngine,
  loadFilesystemLaunch,
  openLocalGateway,
} from "@wap/engine";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createApi } from "./app.js";
import { loadConfig } from "./config.js";
import { loadDevPlanner } from "./dev-planner.js";
import { createPrepareWorker } from "./worker.js";
import { createExpiryMaintenance } from "./maintenance.js";

const config = loadConfig();
const databaseUrl = process.env.G1_DATABASE_URL;
if (!databaseUrl)
  throw new Error("Missing required configuration G1_DATABASE_URL");
const db = openDatabase(databaseUrl);
const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const filesystem =
  config.plannerMode === "dev_fixture"
    ? await loadFilesystemLaunch(root, config.userId)
    : undefined;
const gateway =
  config.plannerMode === "dev_fixture"
    ? await openLocalGateway({
        root,
        databaseUrl,
        userId: config.userId,
        ...(filesystem ? { filesystem } : {}),
      })
    : undefined;
const engine = new WorkflowEngine(db, gateway, config.userId);
const planner =
  config.plannerMode === "dev_fixture" ? loadDevPlanner(root) : undefined;
const worker =
  planner && gateway
    ? createPrepareWorker({ db, userId: config.userId, engine, planner })
    : undefined;
if (!worker) await engine.recoverOrphans().catch(() => undefined);
const maintenance = createExpiryMaintenance({ engine });
const api = createApi({ db, config, engine, worker, maintenance });
const url = await api.listen();
worker?.start();
maintenance.start();
console.log(
  JSON.stringify({
    event: "api_listening",
    url,
    planner_mode: config.plannerMode,
  }),
);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await api.close();
  await gateway?.close();
  await db.close();
}
process.once("SIGINT", () => {
  void stop().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void stop().finally(() => process.exit(0));
});
