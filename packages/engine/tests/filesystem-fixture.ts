import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { WorkflowPlanSchema, type WorkflowPlan } from "@wap/dsl";
import { DEMO_USER_ID, migrate, openDatabase, seedDemo } from "@wap/db";
import type { LocalGatewayConfig } from "../src/gateway-types.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const adminUrl = "postgresql://wap:wap@127.0.0.1:55532/wap_g1";

export async function makeFilesystemFixture(userId = DEMO_USER_ID) {
  const dbName = `engine_it_${randomUUID().replaceAll("-", "")}`;
  const address = new URL(adminUrl);
  address.pathname = `/${dbName}`;
  const databaseUrl = address.href;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ati-fs-it-"));
  const allowedRoot = path.join(base, userId);
  const outsideRoot = path.join(base, "outside");
  fs.mkdirSync(path.join(allowedRoot, "reports"), { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  const marker = {
    format: "ati-filesystem-root-1",
    root_id: randomUUID(),
    user_id: userId,
  };
  fs.writeFileSync(
    path.join(allowedRoot, ".ati-root.json"),
    JSON.stringify(marker),
    { flag: "wx" },
  );
  fs.writeFileSync(
    path.join(allowedRoot, "notes.txt"),
    "Tiến độ ATI\nAPI: Done\n",
    {
      flag: "wx",
    },
  );
  fs.writeFileSync(path.join(outsideRoot, "sentinel.txt"), "OUTSIDE_SENTINEL", {
    flag: "wx",
  });
  await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  await migrate(databaseUrl);
  const db = openDatabase(databaseUrl);
  await seedDemo(db, userId);
  const gatewayConfig: LocalGatewayConfig = {
    root: projectRoot,
    databaseUrl,
    userId,
    filesystem: {
      presetId: "filesystem-local-v1",
      allowedRoot,
      policyFile: path.join(projectRoot, "config", "filesystem-reviewed.json"),
      artifactFile: path.join(
        projectRoot,
        "config",
        "filesystem-reviewed.json",
      ),
    },
  };
  let closed = false;
  return {
    projectRoot,
    databaseUrl,
    userId,
    allowedRoot,
    outsideRoot,
    gatewayConfig,
    db,
    async close() {
      if (closed) return;
      closed = true;
      await db.close();
      await admin.unsafe(`DROP DATABASE "${dbName}" WITH (FORCE)`);
      await admin.end();
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

export function readFilesystemDevPlan(
  name: "fs-copy-notify.json" | "fs-card-export.json",
) {
  const raw = JSON.parse(
    fs.readFileSync(
      path.join(projectRoot, "testdata", "dev-hand-plans", name),
      "utf8",
    ),
  );
  return raw;
}

export function makeFsCopyPlan(): WorkflowPlan {
  return WorkflowPlanSchema.parse(readFilesystemDevPlan("fs-copy-notify.json"));
}

export function makeFsCardExportPlan(): WorkflowPlan {
  return WorkflowPlanSchema.parse(readFilesystemDevPlan("fs-card-export.json"));
}

export function readFixtureFile(
  fixture: { allowedRoot: string },
  relativePath: string,
) {
  return fs.readFileSync(path.join(fixture.allowedRoot, relativePath), "utf8");
}

export function fixtureFileExists(
  fixture: { allowedRoot: string },
  relativePath: string,
) {
  return fs.existsSync(path.join(fixture.allowedRoot, relativePath));
}

export function targetExists(
  fixture: { allowedRoot: string },
  relativePath = "reports/notes-copy.txt",
) {
  try {
    return fs.statSync(path.join(fixture.allowedRoot, relativePath)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function readTargetBytes(
  fixture: { allowedRoot: string },
  relativePath = "reports/notes-copy.txt",
) {
  return fs.readFileSync(path.join(fixture.allowedRoot, relativePath));
}

export async function markersFor(
  fixture: { db: { client: any }; userId: string },
  runId: string,
) {
  return fixture.db
    .client`SELECT * FROM filesystem_dispatches WHERE user_id=${fixture.userId} AND run_id=${runId}`;
}

export async function markerCount(
  fixture: { db: { client: any }; userId: string },
  runId: string,
) {
  return (await markersFor(fixture, runId)).length;
}

export async function localReceiptCount(
  fixture: { db: { client: any }; userId: string },
  runId: string,
) {
  const rows = await fixture.db.client`
    SELECT r.operation_id
    FROM tool_operations o
    JOIN hub_receipts r ON r.user_id=o.user_id AND r.operation_id=o.operation_id
    WHERE o.user_id=${fixture.userId} AND o.run_id=${runId} AND o.tool_server='task_hub'`;
  return rows.length;
}

export async function notificationTexts(
  fixture: { db: { client: any }; userId: string },
  runId: string,
) {
  const rows = await fixture.db.client`
    SELECT r.result->>'text' AS text
    FROM tool_operations o
    JOIN hub_receipts r ON r.user_id=o.user_id AND r.operation_id=o.operation_id
    WHERE o.user_id=${fixture.userId} AND o.run_id=${runId}
      AND o.tool_server='task_hub' AND o.tool_name='send_slack_message'
    ORDER BY r.created_at ASC`;
  return rows.map((row: { text: string }) => row.text);
}
