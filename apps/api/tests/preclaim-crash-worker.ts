import { openDatabase } from "@wap/db";
import { WorkflowEngine } from "@wap/engine";
import { createPrepareWorker } from "../src/worker.js";

const databaseUrl = process.env.API_RESTART_TEST_DATABASE_URL;
const userId = process.env.API_RESTART_TEST_USER_ID;
const runId = process.env.API_RESTART_TEST_RUN_ID;
if (!databaseUrl || !userId || !runId)
  throw new Error("Missing preclaim worker test configuration");

const db = openDatabase(databaseUrl);
const engine = new WorkflowEngine(db, undefined, userId);
// Construct the real dispatcher but deliberately stop at the process boundary
// immediately before start()/claim. The parent kills this process at that point.
createPrepareWorker({
  db,
  userId,
  engine,
  planner: {
    mode: "dev_fixture",
    async produce() {
      throw new Error("Killed preclaim worker must never invoke the planner");
    },
  },
});
const rows = await db.client`
  SELECT r.claimed_by,o.delivered_at
  FROM runs r JOIN run_outbox o ON o.run_id=r.id
  WHERE r.id=${runId} AND o.job_kind='prepare'`;
if (
  rows.length !== 1 ||
  rows[0]!.claimed_by !== null ||
  rows[0]!.delivered_at !== null
)
  throw new Error("Expected one unclaimed durable prepare job");

process.send?.({ type: "ready-before-claim" });
setInterval(() => {}, 60_000);
