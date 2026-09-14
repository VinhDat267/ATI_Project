import { openDatabase } from "@wap/db";
import { createApi } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const databaseUrl = process.env.G1_DATABASE_URL;
if (!databaseUrl)
  throw new Error("Missing required configuration G1_DATABASE_URL");
const db = openDatabase(databaseUrl);
const api = createApi({ db, config });
const url = await api.listen();
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
  await db.close();
}
process.once("SIGINT", () => {
  void stop().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void stop().finally(() => process.exit(0));
});
