import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { openDatabase, G1_DATABASE_URL, DEMO_USER_ID } from "@wap/db";
import {
  WorkflowEngine,
  openLocalGateway,
  EngineError,
  loadFilesystemLaunch,
  type Gateway,
} from "./index.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const [command, ...args] = process.argv.slice(2);
const help = {
  "prepare-b02":
    "Prepare the checked-in dev hand plan; reads only, returns pending approval",
  "prepare <plan.json> [inputs.json]": "Prepare a hand-written plan",
  "preview|detail|trace|cancel|reconcile <run_id>":
    "Inspect a run, request cancel, or inspect receipts",
  "approve|reject <run_id> <approval_id> <version_id> <snapshot_hash>":
    "Decide the exact saved preview",
  "execute <run_id>": "Claim and run a fresh approved job once",
  "events <run_id> [since_seq]": "Read at most 100 persisted events",
  recover: "Mark orphaned claimed runs; never resume or dispatch tools",
};
if (!command || command === "--help")
  console.log(JSON.stringify(help, null, 2));
else {
  const counts: Record<string, [number, number]> = {
    "prepare-b02": [0, 0],
    prepare: [1, 2],
    preview: [1, 1],
    detail: [1, 1],
    trace: [1, 1],
    cancel: [1, 1],
    reconcile: [1, 1],
    approve: [4, 4],
    reject: [4, 4],
    execute: [1, 1],
    events: [1, 2],
    recover: [0, 0],
  };
  const limits = counts[command];
  if (!limits || args.length < limits[0] || args.length > limits[1]) {
    console.error(
      JSON.stringify({
        code: "USAGE",
        message: "Invalid command/arguments; run with --help",
      }),
    );
    process.exitCode = 1;
  } else {
    const databaseUrl = process.env.G1_DATABASE_URL ?? G1_DATABASE_URL,
      userId = process.env.G1_USER_ID ?? DEMO_USER_ID;
    const db = openDatabase(databaseUrl);
    let gateway: Gateway | undefined;
    try {
      // Read-only inspection/recovery remains available even when MCP cannot start.
      if (
        ["prepare-b02", "prepare", "approve", "reject", "execute"].includes(
          command,
        )
      ) {
        const filesystem = await loadFilesystemLaunch(root, userId);
        gateway = await openLocalGateway({
          root,
          databaseUrl,
          userId,
          ...(filesystem ? { filesystem } : {}),
        });
      }
      const engine = new WorkflowEngine(db, gateway, userId),
        id = args[0]!;
      let result: unknown;
      switch (command) {
        case "prepare-b02": {
          const fixture = JSON.parse(
            readFileSync(path.join(root, "testdata/test-cases.json"), "utf8"),
          ).cases.find(
            (c: { id: string; split: string }) =>
              c.id === "b02" && c.split === "dev",
          );
          result = await engine.prepare(fixture.expected_result.plan);
          break;
        }
        case "prepare":
          result = await engine.prepare(
            JSON.parse(readFileSync(path.resolve(id), "utf8")),
            {
              inputs: args[1]
                ? JSON.parse(readFileSync(path.resolve(args[1]), "utf8"))
                : undefined,
              timeZone: process.env.RUNTIME_TIME_ZONE,
            },
          );
          break;
        case "approve":
        case "reject":
          result = await engine.decide(id, {
            approval_id: args[1],
            workflow_version_id: args[2],
            snapshot_hash: args[3],
            decision: command === "approve" ? "approved" : "rejected",
          });
          break;
        case "execute":
          result = await engine.execute(id);
          break;
        case "preview":
          result = await engine.preview(id);
          break;
        case "detail":
          result = await engine.detail(id);
          break;
        case "trace":
          result = await engine.trace(id);
          break;
        case "events":
          result = await engine.events(
            id,
            args[1] === undefined ? 0 : Number(args[1]),
          );
          break;
        case "cancel":
          result = await engine.cancel(id);
          break;
        case "recover":
          result = await engine.recoverOrphans();
          break;
        case "reconcile":
          result = await engine.reconcile(id);
          break;
      }
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(
        JSON.stringify({
          code: error instanceof EngineError ? error.code : "FAILED",
          message:
            error instanceof EngineError
              ? error.message
              : "Command failed; check local setup and supplied JSON/identifiers",
        }),
      );
      process.exitCode = 1;
    } finally {
      await gateway?.close();
      await db.close();
    }
  }
}
