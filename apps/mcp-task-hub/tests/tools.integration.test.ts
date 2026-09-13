import {
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  expect,
  it,
  vi,
} from "vitest";
import postgres from "postgres";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { migrate, openDatabase, seedDemo, DEMO_USER_ID } from "@wap/db";
import {
  WorkflowPlanSchema,
  validateGraph,
  resolveArgs,
  buildRuntime,
} from "@wap/dsl";
import { inputs, outputs } from "../src/contracts.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const serverPath = path.join(root, "apps/mcp-task-hub/dist/server.js");
const dbName = "g1_it_" + randomUUID().replaceAll("-", "");
const adminUrl =
  process.env.G1_TEST_ADMIN_URL ??
  "postgresql://wap:wap@127.0.0.1:55432/wap_g1";
const address = new URL(adminUrl);
if (
  !["localhost", "127.0.0.1"].includes(address.hostname) ||
  address.pathname !== "/wap_g1"
)
  throw new Error("Dedicated local wap_g1 database required");
address.pathname = "/" + dbName;
const url = address.href;
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
let raw: ReturnType<typeof postgres>;
let connection: ReturnType<typeof openDatabase>;
let client: Client | undefined;
const activeClients: Client[] = [];
const evidence: Record<string, unknown> = {
  kind: "REAL_MCP_STDIO_AND_POSTGRESQL",
  approval_controller: "SYNTHETIC_TEST_FIXTURE",
  tools: [],
  scenarios: [],
};
const canon = (v: any): any =>
  Array.isArray(v)
    ? v.map(canon)
    : v !== null && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canon(v[k])]),
        )
      : v;
const fingerprint = (name: string, args: unknown) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        canon({
          server: "task_hub",
          tool: name,
          policy_version: "b-local-1",
          args,
        }),
      ),
    )
    .digest("hex");

async function startClient(userId = DEMO_USER_ID) {
  if (!existsSync(serverPath)) return undefined;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: root,
    env: { G1_DATABASE_URL: url, G1_USER_ID: userId },
    stderr: "pipe",
  });
  const c = new Client({ name: "ati-g1-integration", version: "1.0.0" });
  await c.connect(transport);
  activeClients.push(c);
  return c;
}
async function call(
  name: string,
  args: Record<string, unknown>,
  authorization?: Record<string, string>,
  c = client,
) {
  expect(c, "MCP server implementation must be running").toBeDefined();
  return c!.callTool({
    name,
    arguments: args,
    ...(authorization ? { _meta: { "ati/authorization": authorization } } : {}),
  });
}
/** Fixture controller: authorization is set up explicitly, never inferred from model args. */
async function grant(
  name: string,
  args: Record<string, unknown>,
  opts: { approved?: boolean; expired?: boolean; userId?: string } = {},
) {
  const userId = opts.userId ?? DEMO_USER_ID;
  const workflowId = randomUUID(),
    versionId = randomUUID(),
    runId = randomUUID(),
    approvalId = randomUUID(),
    operationId = randomUUID();
  const plan = WorkflowPlanSchema.parse({
    version: "1.0",
    name: "G1 fixture",
    source_prompt: "G1 receiver test",
    steps: [
      {
        id: "write",
        description: name,
        tool: { server: "task_hub", name, args },
        side_effect: "write",
        idempotency_key: operationId,
      },
    ],
  });
  const jsonArgs = plan.steps[0]!.tool.args;
  const hash = fingerprint(name, jsonArgs);
  const action = {
    step_id: "write",
    operation_id: operationId,
    server: "task_hub",
    tool: name,
    policy_version: "b-local-1",
    resolved_args: jsonArgs,
    payload_hash: hash,
  };
  const snapshot = createHash("sha256")
    .update(
      JSON.stringify(canon({ runId, versionId, userId, actions: [action] })),
    )
    .digest("hex");
  await raw.begin(async (tx) => {
    await tx`INSERT INTO workflows(id,user_id,name,source_prompt) VALUES (${workflowId},${userId},'G1 test','G1 test')`;
    await tx`INSERT INTO workflow_versions(id,workflow_id,version_no,plan) VALUES (${versionId},${workflowId},1,${tx.json(plan)})`;
    await tx`INSERT INTO runs(id,user_id,workflow_id,workflow_version_id,source_prompt,status) VALUES (${runId},${userId},${workflowId},${versionId},'G1 test',${opts.approved === false ? "awaiting_approval" : "running"})`;
    await tx`INSERT INTO approvals(id,run_id,workflow_version_id,snapshot_hash,preview,decision,expires_at) VALUES (${approvalId},${runId},${versionId},${snapshot},${tx.json({ actions: [action] })},${opts.approved === false ? "pending" : "approved"},${new Date(Date.now() + (opts.expired ? -60000 : 600000))})`;
    await tx`INSERT INTO tool_operations(operation_id,user_id,run_id,workflow_version_id,step_id,tool_server,tool_name,policy_version,intent_key,payload_hash,resolved_args,state,receiver_mode)
      VALUES (${operationId},${userId},${runId},${versionId},'write','task_hub',${name},'b-local-1',${operationId},${hash},${tx.json(jsonArgs)},'in_flight','local_transaction')`;
  });
  return {
    approval_id: approvalId,
    operation_id: operationId,
    snapshot_hash: snapshot,
  };
}
beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  await migrate(url);
  raw = postgres(url, { max: 5, onnotice: () => {} });
  connection = openDatabase(url);
  await seedDemo(connection);
});
beforeEach(async () => {
  await raw`DELETE FROM hub_receipts`;
  await raw`DELETE FROM hub_messages`;
  await raw`UPDATE hub_sheets SET cells='[]'::jsonb WHERE workbook_id='dest'`;
  client = await startClient();
});
afterEach(async () => {
  for (const c of activeClients.splice(0)) await c.close();
  client = undefined;
});
afterAll(async () => {
  await connection?.close();
  await raw?.end();
  await admin.unsafe(`DROP DATABASE "${dbName}" WITH (FORCE)`);
  await admin.end();
  if (
    (evidence.tools as unknown[]).length &&
    (evidence.scenarios as unknown[]).length
  ) {
    const existingDefaultDir = path.join(
      root,
      process.env.ATI_TEST_EVIDENCE_PROFILE === "engine"
        ? "docs/engine-evidence/2026-09-13"
        : "docs/g1-evidence/2026-09-13",
    );
    const requestedEvidence = process.env.ATI_EVIDENCE_DIR;
    const dir = requestedEvidence
      ? path.resolve(root, requestedEvidence)
      : existingDefaultDir;
    if (requestedEvidence) {
      const evidenceRoot = path.resolve(root, "docs/task-hub-evidence");
      const relative = path.relative(evidenceRoot, dir);
      if (
        !relative ||
        relative === ".." ||
        relative.startsWith(".." + path.sep) ||
        path.isAbsolute(relative)
      )
        throw new Error(
          "ATI_EVIDENCE_DIR must name a batch directory under docs/task-hub-evidence",
        );
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "mcp-observations.json"),
      JSON.stringify(
        { ...evidence, recorded_at: new Date().toISOString() },
        null,
        2,
      ) + "\n",
    );
  }
});

it("discovers exactly the implemented tools with output schemas, then reads an A1 range", async () => {
  expect(client).toBeDefined();
  const list = await client!.listTools();
  evidence.tools = list.tools;
  expect(list.tools.map((t) => t.name).sort()).toEqual([
    "append_sheet_rows",
    "read_sheet_range",
    "send_slack_message",
  ]);
  const catalog = JSON.parse(
    readFileSync(path.join(root, "testdata/tools.json"), "utf8"),
  ).servers.find((s: any) => s.slug === "task_hub");
  for (const t of list.tools) {
    const reviewed = catalog.tools.find(
      (candidate: any) => candidate.name === t.name,
    );
    expect(t.inputSchema).toEqual(reviewed.inputSchema);
    expect(t.outputSchema).toEqual(reviewed.outputSchema);
  }
  expect(
    (
      await call("read_sheet_range", {
        spreadsheet_id: "source",
        range: "Progress!A1:B2",
      })
    ).structuredContent,
  ).toEqual({
    values: [
      ["API", "Done"],
      ["UI", "Doing"],
    ],
    row_count: 2,
  });
  expect(
    (
      await call("read_sheet_range", {
        spreadsheet_id: "source",
        range: "Progress!B2:C3",
      })
    ).structuredContent,
  ).toEqual({ values: [["Doing", ""]], row_count: 1 });
  expect(
    (
      await call("read_sheet_range", {
        spreadsheet_id: "source",
        range: "Progress!A0:B2",
      })
    ).isError,
  ).toBe(true);
});
it("denies missing/pending/expired/stale approvals and performs no mutation", async () => {
  const args = { channel: "#team", text: "must not send" };
  expect((await call("send_slack_message", args)).isError).toBe(true);
  expect(
    (
      await call(
        "send_slack_message",
        args,
        await grant("send_slack_message", args, { approved: false }),
      )
    ).isError,
  ).toBe(true);
  expect(
    (
      await call(
        "send_slack_message",
        args,
        await grant("send_slack_message", args, { expired: true }),
      )
    ).isError,
  ).toBe(true);
  const valid = await grant("send_slack_message", args);
  expect(
    (
      await call("send_slack_message", args, {
        ...valid,
        snapshot_hash: "0".repeat(64),
      })
    ).isError,
  ).toBe(true);
  expect((await raw`SELECT count(*)::int AS n FROM hub_messages`)[0]!.n).toBe(
    0,
  );
});
it("prevents another principal from using an approved operation or reading owner data", async () => {
  const other = randomUUID();
  await seedDemo(connection, other);
  await raw`UPDATE hub_sheets SET cells='[["private"]]'::jsonb WHERE user_id=${other} AND workbook_id='source'`;
  const args = { channel: "#team", text: "private" };
  const auth = await grant("send_slack_message", args, { userId: other });
  expect((await call("send_slack_message", args, auth)).isError).toBe(true);
  expect(
    (
      await call("read_sheet_range", {
        spreadsheet_id: "source",
        range: "Progress!A1:A1",
      })
    ).structuredContent,
  ).toEqual({ values: [["API"]], row_count: 1 });
});
it("writes a local message once under concurrent duplicate calls and rejects changed args", async () => {
  const args = { channel: "#team", text: "Hello" };
  const auth = await grant("send_slack_message", args);
  const replies = await Promise.all(
    Array.from({ length: 5 }, () => call("send_slack_message", args, auth)),
  );
  expect(replies.every((r) => !r.isError)).toBe(true);
  expect(
    new Set(replies.map((r) => (r.structuredContent as any).id)).size,
  ).toBe(1);
  expect(await raw`SELECT text FROM hub_messages`).toHaveLength(1);
  expect(
    (await call("send_slack_message", { ...args, text: "changed" }, auth))
      .isError,
  ).toBe(true);
  expect((await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n).toBe(
    1,
  );
});
it("appends different operations concurrently without losing rows", async () => {
  const a = { spreadsheet_id: "dest", sheet_name: "Report", rows: [["A"]] };
  const b = { spreadsheet_id: "dest", sheet_name: "Report", rows: [["B"]] };
  const authA = await grant("append_sheet_rows", a),
    authB = await grant("append_sheet_rows", b);
  const c2 = await startClient();
  const results = await Promise.all([
    call("append_sheet_rows", a, authA),
    call("append_sheet_rows", b, authB, c2),
  ]);
  expect(results.every((r) => !r.isError)).toBe(true);
  const [sheet] =
    await raw`SELECT cells FROM hub_sheets WHERE user_id=${DEMO_USER_ID} AND workbook_id='dest'`;
  expect(sheet!.cells.flat().sort()).toEqual(["A", "B"]);
});
it("returns no receipt when the requested destination is missing", async () => {
  const args = {
    spreadsheet_id: "missing",
    sheet_name: "Report",
    rows: [["A"]],
  };
  const auth = await grant("append_sheet_rows", args);
  expect((await call("append_sheet_rows", args, auth)).isError).toBe(true);
  expect(
    (
      await raw`SELECT count(*)::int AS n FROM hub_receipts WHERE operation_id=${auth.operation_id}`
    )[0]!.n,
  ).toBe(0);
});
it("rolls back appended rows when receipt persistence fails after the mutation", async () => {
  const args = {
    spreadsheet_id: "dest",
    sheet_name: "Report",
    rows: [["rollback me"]],
  };
  const auth = await grant("append_sheet_rows", args);
  await raw.unsafe(
    `CREATE FUNCTION fail_test_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected receipt failure'; END $$`,
  );
  await raw.unsafe(
    "CREATE TRIGGER fail_receipt BEFORE INSERT ON hub_receipts FOR EACH ROW EXECUTE FUNCTION fail_test_receipt()",
  );
  try {
    expect((await call("append_sheet_rows", args, auth)).isError).toBe(true);
    const [sheet] =
      await raw`SELECT cells FROM hub_sheets WHERE user_id=${DEMO_USER_ID} AND workbook_id='dest'`;
    expect(sheet!.cells).toEqual([]);
    expect((await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n).toBe(
      0,
    );
  } finally {
    await raw.unsafe("DROP TRIGGER fail_receipt ON hub_receipts");
    await raw.unsafe("DROP FUNCTION fail_test_receipt()");
  }
});
it("denies an append whose approval expires while waiting for the destination lock", async () => {
  const args = {
    spreadsheet_id: "dest",
    sheet_name: "Report",
    rows: [["too late"]],
  };
  const auth = await grant("append_sheet_rows", args);
  let pending: ReturnType<typeof call>;
  await raw.begin(async (blocker) => {
    await blocker`SELECT * FROM hub_sheets WHERE user_id=${DEMO_USER_ID} AND workbook_id='dest' FOR UPDATE`;
    await raw`UPDATE approvals SET expires_at=clock_timestamp()+interval '2 seconds' WHERE id=${auth.approval_id}`;
    pending = call("append_sheet_rows", args, auth);
    await vi.waitFor(
      async () => {
        const [waiting] =
          await raw`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=${dbName} AND wait_event_type='Lock' AND query ILIKE '%hub_sheets%'`;
        expect(waiting!.n).toBeGreaterThan(0);
      },
      { timeout: 1500, interval: 25 },
    );
    await raw`SELECT pg_sleep(2.1)`;
  });
  expect((await pending!).isError).toBe(true);
  expect(
    (
      await raw`SELECT cells FROM hub_sheets WHERE user_id=${DEMO_USER_ID} AND workbook_id='dest'`
    )[0]!.cells,
  ).toEqual([]);
  expect((await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n).toBe(
    0,
  );
});
it("replays a committed receipt after restarting the MCP process", async () => {
  const args = { channel: "#team", text: "survives restart" };
  const auth = await grant("send_slack_message", args);
  const first = await call("send_slack_message", args, auth);
  expect(first.isError).not.toBe(true);
  await client!.close();
  client = await startClient();
  const second = await call("send_slack_message", args, auth);
  expect(second.structuredContent).toEqual(first.structuredContent);
  expect((await raw`SELECT count(*)::int AS n FROM hub_messages`)[0]!.n).toBe(
    1,
  );
});
it("moves the b02 hand-plan data through real MCP and verifies resulting rows and message", async () => {
  const fixture = JSON.parse(
    readFileSync(path.join(root, "testdata/test-cases.json"), "utf8"),
  ).cases.find((c: any) => c.id === "b02");
  const plan = WorkflowPlanSchema.parse(fixture.expected_result.plan);
  const ctx = {
    inputs: {},
    runtime: buildRuntime({ runId: randomUUID(), userId: DEMO_USER_ID }),
    stepOutputs: {} as Record<string, unknown>,
  };
  for (const id of validateGraph(plan).layers.flat()) {
    const step = plan.steps.find((s) => s.id === id)!;
    const args = resolveArgs(step.tool.args, ctx);
    const auth =
      step.side_effect === "write"
        ? await grant(step.tool.name, args)
        : undefined;
    const result = await call(step.tool.name, args, auth);
    expect(result.isError).not.toBe(true);
    ctx.stepOutputs[id] = result.structuredContent;
  }
  const [sheet] =
    await raw`SELECT cells FROM hub_sheets WHERE user_id=${DEMO_USER_ID} AND workbook_id='dest'`;
  expect(sheet!.cells).toEqual([
    ["API", "Done"],
    ["UI", "Doing"],
  ]);
  const [message] = await raw`SELECT channel,text FROM hub_messages`;
  expect(message).toMatchObject({ channel: "#team", text: "Đã chép 2 dòng." });
  evidence.scenarios = [
    {
      case: "b02",
      actual_rows: sheet!.cells,
      actual_message: message,
      controller:
        "synthetic per-step approval fixtures; not a production workflow engine",
    },
  ];
});

it("[TH-02] contracts define strict schemas for the five future tools", () => {
  expect(
    (inputs as any).create_card.safeParse({
      board_id: "board_a",
      list_name: "Backlog",
      title: "  ",
    }).success,
  ).toBe(false);
  expect(
    (inputs as any).create_card.safeParse({
      board_id: "board_a",
      list_name: "Backlog",
      title: "Docs",
      due_date: "2026-02-30",
    }).success,
  ).toBe(false);
  expect(
    (inputs as any).get_card.safeParse({
      card_id: "c1",
      user_id: "spoofed",
    }).success,
  ).toBe(false);
  expect(
    (outputs as any).get_card.safeParse({
      id: "c1",
      board_id: "board_a",
      title: "API",
      list_name: "Doing",
      description: "extra",
    }).success,
  ).toBe(false);
  expect(
    (inputs as any).create_card.parse({
      board_id: "board_a",
      list_name: "Backlog",
      title: "Docs",
    }),
  ).toEqual({ board_id: "board_a", list_name: "Backlog", title: "Docs" });
});

it("[TH-02] create_card without authorization cannot mutate hub_cards or add receipts", async () => {
  const cardsBefore = await raw`SELECT count(*)::int AS n FROM hub_cards`;
  const receiptsBefore = await raw`SELECT count(*)::int AS n FROM hub_receipts`;

  const result = await call("create_card", {
    board_id: "board_a",
    list_name: "Backlog",
    title: "Unapproved Card",
  });

  expect(result.isError).toBe(true);

  const cardsAfter = await raw`SELECT count(*)::int AS n FROM hub_cards`;
  const receiptsAfter = await raw`SELECT count(*)::int AS n FROM hub_receipts`;

  expect(cardsAfter[0]!.n).toBe(cardsBefore[0]!.n);
  expect(receiptsAfter[0]!.n).toBe(receiptsBefore[0]!.n);
});

