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
import { createGatewayManager } from "./gateway-manager.js";

const config = loadConfig();
const databaseUrl = process.env.G1_DATABASE_URL;
if (!databaseUrl)
  throw new Error("Missing required configuration G1_DATABASE_URL");
const db = openDatabase(databaseUrl);
const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const gateway = createGatewayManager(config.userId, async () => {
  const filesystem = await loadFilesystemLaunch(root, config.userId);
  return openLocalGateway({
    root,
    databaseUrl,
    userId: config.userId,
    ...(filesystem ? { filesystem } : {}),
  });
});
const engine = new WorkflowEngine(db, gateway, config.userId, {
  secrets: [
    config.passwordHash,
    config.cursorKey.toString("base64"),
    config.cursorKey.toString("hex"),
    databaseUrl,
    decodeURIComponent(new URL(databaseUrl).password),
  ].filter(Boolean),
});
const planner =
  config.plannerMode === "dev_fixture" ? loadDevPlanner(root) : undefined;
const worker = createPrepareWorker({
  db,
  userId: config.userId,
  engine,
  planner,
  onError: (code) =>
    console.error(JSON.stringify({ event: "worker_deferred", code })),
});
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
