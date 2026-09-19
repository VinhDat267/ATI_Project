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
import { inputs, outputs, toolDefinitions } from "../src/contracts.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const serverPath = path.join(root, "apps/mcp-task-hub/dist/server.js");
const dbName = "g1_it_" + randomUUID().replaceAll("-", "");
const adminUrl =
  process.env.G1_TEST_ADMIN_URL ??
  "postgresql://wap:wap@127.0.0.1:55532/wap_g1";
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
  runtimeMetadata?: Record<string, unknown>,
) {
  expect(c, "MCP server implementation must be running").toBeDefined();
  const meta: Record<string, unknown> = {
    ...(authorization ? { "ati/authorization": authorization } : {}),
    ...(runtimeMetadata ? { "ati/runtime": runtimeMetadata } : {}),
  };
  return c!.callTool({
    name,
    arguments: args,
    ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
  });
}
function errorCode(res: any): string | undefined {
  try {
    const text = res?.content?.[0]?.text;
    return text ? JSON.parse(text).code : undefined;
  } catch {
    return undefined;
  }
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
  await raw`DELETE FROM hub_cards`;
  await raw`DELETE FROM hub_members`;
  await raw`DELETE FROM hub_lists`;
  await raw`DELETE FROM hub_boards`;
  await seedDemo(connection);
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
    // Dated evidence carries baseline SHA-256 hashes; unattended runs must not rewrite it.
    const defaultDir = path.join(
      root,
      "runtime/test-evidence",
      process.env.ATI_TEST_EVIDENCE_PROFILE === "engine" ? "engine" : "g1",
    );
    const requestedEvidence = process.env.ATI_EVIDENCE_DIR;
    const dir = requestedEvidence
      ? path.resolve(root, requestedEvidence)
      : defaultDir;
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

it("discovers exactly the active tools with output schemas, then reads an A1 range", async () => {
  expect(client).toBeDefined();
  const list = await client!.listTools();
  evidence.tools = list.tools;
  expect(list.tools.map((t) => t.name).sort()).toEqual([
    "append_sheet_rows",
    "create_card",
    "get_card",
    "list_cards",
    "list_members",
    "move_card",
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

it("[TH-03] [R01] seeds and reads get_card, list_cards and list_members over live MCP with zero mutation or receipts", async () => {
  const receiptsBefore = await raw`SELECT count(*)::int AS n FROM hub_receipts`;
  const messagesBefore = await raw`SELECT count(*)::int AS n FROM hub_messages`;

  const getRes = await call("get_card", { card_id: "c1" });
  expect(getRes.isError).not.toBe(true);
  expect(getRes.structuredContent).toEqual({
    id: "c1",
    board_id: "board_a",
    title: "Viết API",
    list_name: "Doing",
  });

  const listRes = await call("list_cards", {
    board_id: "board_a",
    list_name: "Doing",
    assignee_id: "m1",
  });
  expect(listRes.isError).not.toBe(true);
  expect(listRes.structuredContent).toEqual({
    cards: [
      { id: "c1", board_id: "board_a", title: "Viết API", list_name: "Doing" },
    ],
    count: 1,
  });

  const membersRes = await call("list_members", { board_id: "board_a" });
  expect(membersRes.isError).not.toBe(true);
  expect(membersRes.structuredContent).toEqual({
    members: [
      { id: "m1", name: "An", task_count: 1 },
      { id: "m2", name: "Bình", task_count: 0 },
    ],
  });

  const receiptsAfter = await raw`SELECT count(*)::int AS n FROM hub_receipts`;
  const messagesAfter = await raw`SELECT count(*)::int AS n FROM hub_messages`;
  expect(receiptsAfter[0]!.n).toBe(receiptsBefore[0]!.n);
  expect(messagesAfter[0]!.n).toBe(messagesBefore[0]!.n);
});

it("[TH-03] [R02] list_cards returns empty cards array and count 0 when no cards match filter", async () => {
  const res = await call("list_cards", {
    board_id: "board_a",
    list_name: "Backlog",
  });
  expect(res.isError).not.toBe(true);
  expect(res.structuredContent).toEqual({ cards: [], count: 0 });
});

it("[TH-03] [R03] rejects absent or other owner board and cards with NOT_FOUND", async () => {
  const missingBoard = await call("list_cards", { board_id: "nonexistent_board" });
  expect(missingBoard.isError).toBe(true);
  expect(errorCode(missingBoard)).toBe("NOT_FOUND");

  const missingMembersBoard = await call("list_members", { board_id: "nonexistent_board" });
  expect(missingMembersBoard.isError).toBe(true);
  expect(errorCode(missingMembersBoard)).toBe("NOT_FOUND");

  const missingCard = await call("get_card", { card_id: "nonexistent_card" });
  expect(missingCard.isError).toBe(true);
  expect(errorCode(missingCard)).toBe("NOT_FOUND");

  const otherUser = randomUUID();
  await seedDemo(connection, otherUser);
  await raw`INSERT INTO hub_boards (user_id, board_id, name)
    VALUES (${otherUser}, 'board_userB_only', 'Board B Only')`;
  await raw`INSERT INTO hub_lists (user_id, board_id, list_name, position, is_done)
    VALUES (${otherUser}, 'board_userB_only', 'Doing', 0, false)`;
  await raw`INSERT INTO hub_cards (user_id, card_id, board_id, list_name, title)
    VALUES (${otherUser}, 'c_userB_only', 'board_userB_only', 'Doing', 'Card B Only')`;

  const otherOwnerBoardCards = await call("list_cards", { board_id: "board_userB_only" });
  expect(otherOwnerBoardCards.isError).toBe(true);
  expect(errorCode(otherOwnerBoardCards)).toBe("NOT_FOUND");

  const otherOwnerBoardMembers = await call("list_members", { board_id: "board_userB_only" });
  expect(otherOwnerBoardMembers.isError).toBe(true);
  expect(errorCode(otherOwnerBoardMembers)).toBe("NOT_FOUND");

  const crossRes = await call("get_card", { card_id: "c_userB_only" });
  expect(crossRes.isError).toBe(true);
  expect(errorCode(crossRes)).toBe("NOT_FOUND");
});

it("[TH-03] [R04] rejects list or assignee existing only in another board with NOT_FOUND", async () => {
  await raw`INSERT INTO hub_boards (user_id, board_id, name) VALUES (${DEMO_USER_ID}, 'board_b', 'Board B')`;
  await raw`INSERT INTO hub_lists (user_id, board_id, list_name, position, is_done) VALUES (${DEMO_USER_ID}, 'board_b', 'ListB', 0, false)`;
  await raw`INSERT INTO hub_members (user_id, board_id, member_id, name) VALUES (${DEMO_USER_ID}, 'board_b', 'mB', 'Member B')`;

  const listMismatch = await call("list_cards", {
    board_id: "board_a",
    list_name: "ListB",
  });
  expect(listMismatch.isError).toBe(true);
  expect(errorCode(listMismatch)).toBe("NOT_FOUND");

  const assigneeMismatch = await call("list_cards", {
    board_id: "board_a",
    assignee_id: "mB",
  });
  expect(assigneeMismatch.isError).toBe(true);
  expect(errorCode(assigneeMismatch)).toBe("NOT_FOUND");

  const otherOwner = randomUUID();
  await seedDemo(connection, otherOwner);
  await raw`INSERT INTO hub_lists (user_id, board_id, list_name, position, is_done) VALUES (${otherOwner}, 'board_a', 'ListOnlyOtherOwner', 0, false)`;
  await raw`INSERT INTO hub_members (user_id, board_id, member_id, name) VALUES (${otherOwner}, 'board_a', 'mOnlyOtherOwner', 'Member Other')`;

  const otherOwnerList = await call("list_cards", {
    board_id: "board_a",
    list_name: "ListOnlyOtherOwner",
  });
  expect(otherOwnerList.isError).toBe(true);
  expect(errorCode(otherOwnerList)).toBe("NOT_FOUND");

  const otherOwnerAssignee = await call("list_cards", {
    board_id: "board_a",
    assignee_id: "mOnlyOtherOwner",
  });
  expect(otherOwnerAssignee.isError).toBe(true);
  expect(errorCode(otherOwnerAssignee)).toBe("NOT_FOUND");
});

it("[TH-03] [R05] rejects invalid dates, since > until, and extra args with BAD_ARGS and no DB mutation", async () => {
  const cardsBefore = await raw`SELECT count(*)::int AS n FROM hub_cards`;

  const inverted = await call("list_cards", {
    board_id: "board_a",
    since: "2026-09-15",
    until: "2026-09-14",
  });
  expect(inverted.isError).toBe(true);
  expect(errorCode(inverted)).toBe("BAD_ARGS");

  const invalidDate = await call("list_cards", {
    board_id: "board_a",
    since: "2026-02-30",
  });
  expect(invalidDate.isError).toBe(true);
  expect(errorCode(invalidDate)).toBe("BAD_ARGS");

  const extraArgs = await call("get_card", {
    card_id: "c1",
    extra_field: "disallowed",
  });
  expect(extraArgs.isError).toBe(true);
  expect(errorCode(extraArgs)).toBe("BAD_ARGS");

  const cardsAfter = await raw`SELECT count(*)::int AS n FROM hub_cards`;
  expect(cardsAfter[0]!.n).toBe(cardsBefore[0]!.n);
});

it("[TH-03] [R06] filters cards exactly on Asia/Ho_Chi_Minh local day boundaries", async () => {
  await raw`UPDATE hub_cards SET updated_at = '2026-01-01T00:00:00Z' WHERE user_id=${DEMO_USER_ID}`;

  await raw`INSERT INTO hub_cards (user_id, card_id, board_id, list_name, title, updated_at) VALUES
    (${DEMO_USER_ID}, 'hcm_below', 'board_a', 'Doing', 'HCM Below', '2026-09-13T16:59:59.999Z'),
    (${DEMO_USER_ID}, 'hcm_lower', 'board_a', 'Doing', 'HCM Lower', '2026-09-13T17:00:00.000Z'),
    (${DEMO_USER_ID}, 'hcm_upper_minus_1', 'board_a', 'Doing', 'HCM Upper - 1', '2026-09-14T16:59:59.999Z'),
    (${DEMO_USER_ID}, 'hcm_above', 'board_a', 'Doing', 'HCM Above', '2026-09-14T17:00:00.000Z')`;

  const res = await call(
    "list_cards",
    { board_id: "board_a", since: "2026-09-14", until: "2026-09-14" },
    undefined,
    client,
    { time_zone: "Asia/Ho_Chi_Minh" },
  );
  expect(res.isError).not.toBe(true);
  const cards = (res.structuredContent as any).cards;
  expect(cards.map((c: any) => c.id)).toEqual(["hcm_lower", "hcm_upper_minus_1"]);
});

it("[TH-03] [R07] filters cards exactly on America/New_York DST 23-hour day boundaries", async () => {
  await raw`UPDATE hub_cards SET updated_at = '2026-01-01T00:00:00Z' WHERE user_id=${DEMO_USER_ID}`;

  await raw`INSERT INTO hub_cards (user_id, card_id, board_id, list_name, title, updated_at) VALUES
    (${DEMO_USER_ID}, 'ny_below', 'board_a', 'Doing', 'NY Below', '2026-03-08T04:59:59.999Z'),
    (${DEMO_USER_ID}, 'ny_lower', 'board_a', 'Doing', 'NY Lower', '2026-03-08T05:00:00.000Z'),
    (${DEMO_USER_ID}, 'ny_upper_minus_1', 'board_a', 'Doing', 'NY Upper - 1', '2026-03-09T03:59:59.999Z'),
    (${DEMO_USER_ID}, 'ny_above', 'board_a', 'Doing', 'NY Above', '2026-03-09T04:00:00.000Z')`;

  const res = await call(
    "list_cards",
    { board_id: "board_a", since: "2026-03-08", until: "2026-03-08" },
    undefined,
    client,
    { time_zone: "America/New_York" },
  );
  expect(res.isError).not.toBe(true);
  const cards = (res.structuredContent as any).cards;
  expect(cards.map((c: any) => c.id)).toEqual(["ny_lower", "ny_upper_minus_1"]);
});

it("[TH-03] [R08] rejects malformed or unsupported time zone with BAD_ARGS", async () => {
  const invalidZone = await call(
    "list_cards",
    { board_id: "board_a" },
    undefined,
    client,
    { time_zone: "Not/A_Real_Timezone" },
  );
  expect(invalidZone.isError).toBe(true);
  expect(errorCode(invalidZone)).toBe("BAD_ARGS");

  const malformedMeta = await call(
    "list_cards",
    { board_id: "board_a" },
    undefined,
    client,
    { extra_unknown_prop: 123 } as any,
  );
  expect(malformedMeta.isError).toBe(true);
  expect(errorCode(malformedMeta)).toBe("BAD_ARGS");
});

it("[TH-03] [R09] list_members calculates task_count only for active assigned cards in the same board", async () => {
  await raw`DELETE FROM hub_cards WHERE user_id=${DEMO_USER_ID}`;

  await raw`INSERT INTO hub_cards (user_id, card_id, board_id, list_name, title, assignee_id) VALUES
    (${DEMO_USER_ID}, 'c_active', 'board_a', 'Doing', 'Active', 'm1'),
    (${DEMO_USER_ID}, 'c_done', 'board_a', 'Done', 'Done', 'm1'),
    (${DEMO_USER_ID}, 'c_unassigned', 'board_a', 'Doing', 'Unassigned', NULL)`;

  await raw`INSERT INTO hub_boards (user_id, board_id, name) VALUES (${DEMO_USER_ID}, 'board_other', 'Board Other')`;
  await raw`INSERT INTO hub_lists (user_id, board_id, list_name, position, is_done) VALUES (${DEMO_USER_ID}, 'board_other', 'Doing', 0, false)`;
  await raw`INSERT INTO hub_members (user_id, board_id, member_id, name) VALUES (${DEMO_USER_ID}, 'board_other', 'm1', 'An Other')`;
  await raw`INSERT INTO hub_cards (user_id, card_id, board_id, list_name, title, assignee_id) VALUES
    (${DEMO_USER_ID}, 'c_other_board', 'board_other', 'Doing', 'Other Board', 'm1')`;

  const otherUser = randomUUID();
  await seedDemo(connection, otherUser);
  await raw`INSERT INTO hub_cards (user_id, card_id, board_id, list_name, title, assignee_id) VALUES
    (${otherUser}, 'c_other_owner', 'board_a', 'Doing', 'Other Owner Card', 'm1')`;

  const res = await call("list_members", { board_id: "board_a" });
  expect(res.isError).not.toBe(true);
  expect(res.structuredContent).toEqual({
    members: [
      { id: "m1", name: "An", task_count: 1 },
      { id: "m2", name: "Bình", task_count: 0 },
    ],
  });
});

it("[TH-03] [R10] list_cards and list_members throw LIMIT_EXCEEDED when matching > 1000 items", async () => {
  await raw`DELETE FROM hub_cards WHERE user_id=${DEMO_USER_ID}`;

  const cardRows = Array.from({ length: 1001 }, (_, i) => ({
    user_id: DEMO_USER_ID,
    card_id: `card_${String(i).padStart(4, "0")}`,
    board_id: "board_a",
    list_name: "Doing",
    title: `Card ${i}`,
  }));
  await raw`INSERT INTO hub_cards ${raw(cardRows, "user_id", "card_id", "board_id", "list_name", "title")}`;

  const cardsLimit = await call("list_cards", { board_id: "board_a" });
  expect(cardsLimit.isError).toBe(true);
  expect(errorCode(cardsLimit)).toBe("LIMIT_EXCEEDED");

  await raw`DELETE FROM hub_members WHERE user_id=${DEMO_USER_ID}`;
  const memberRows = Array.from({ length: 1001 }, (_, i) => ({
    user_id: DEMO_USER_ID,
    board_id: "board_a",
    member_id: `m_${String(i).padStart(4, "0")}`,
    name: `Member ${i}`,
  }));
  await raw`INSERT INTO hub_members ${raw(memberRows, "user_id", "board_id", "member_id", "name")}`;

  const membersLimit = await call("list_members", { board_id: "board_a" });
  expect(membersLimit.isError).toBe(true);
  expect(errorCode(membersLimit)).toBe("LIMIT_EXCEEDED");
});

it("[TH-03] [R11] list_cards tie-breaks on card_id COLLATE C; reads produce zero receipts or messages", async () => {
  await raw`DELETE FROM hub_cards WHERE user_id=${DEMO_USER_ID}`;

  const sameTime = new Date("2026-09-14T10:00:00.000Z");
  await raw`INSERT INTO hub_cards (user_id, card_id, board_id, list_name, title, updated_at) VALUES
    (${DEMO_USER_ID}, 'card_b', 'board_a', 'Doing', 'Title B', ${sameTime}),
    (${DEMO_USER_ID}, 'card_a', 'board_a', 'Doing', 'Title A', ${sameTime})`;

  const res = await call("list_cards", { board_id: "board_a" });
  expect(res.isError).not.toBe(true);
  const cards = (res.structuredContent as any).cards;
  expect(cards.map((c: any) => c.id)).toEqual(["card_a", "card_b"]);

  const receipts = await raw`SELECT count(*)::int AS n FROM hub_receipts`;
  const messages = await raw`SELECT count(*)::int AS n FROM hub_messages`;
  expect(receipts[0]!.n).toBe(0);
  expect(messages[0]!.n).toBe(0);
});

it("[TH-03] maps schema-invalid stored card data to INTERNAL_ERROR and restores table constraints in finally", async () => {
  await raw.unsafe("ALTER TABLE hub_cards DROP CONSTRAINT IF EXISTS hub_cards_title_check");
  try {
    await raw`INSERT INTO hub_cards (user_id, card_id, board_id, list_name, title)
      VALUES (${DEMO_USER_ID}, 'corrupt_card', 'board_a', 'Doing', '')`;

    const corruptRes = await call("get_card", { card_id: "corrupt_card" });
    expect(corruptRes.isError).toBe(true);
    expect(errorCode(corruptRes)).toBe("INTERNAL_ERROR");

    const corruptList = await call("list_cards", { board_id: "board_a" });
    expect(corruptList.isError).toBe(true);
    expect(errorCode(corruptList)).toBe("INTERNAL_ERROR");
  } finally {
    await raw`DELETE FROM hub_cards WHERE card_id = 'corrupt_card'`;
    await raw.unsafe("ALTER TABLE hub_cards ADD CONSTRAINT hub_cards_title_check CHECK (char_length(title) BETWEEN 1 AND 500 AND title ~ '[^[:space:]]')");
  }

  // Assert constraint is restored
  await expect(
    raw`INSERT INTO hub_cards (user_id, card_id, board_id, list_name, title) VALUES (${DEMO_USER_ID}, 'retest_card', 'board_a', 'Doing', '')`
  ).rejects.toThrow();
});

it("[TH-03] live discovery exposes active tools matching toolDefinitions", async () => {
  const tools = await client!.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  expect(names).toEqual([
    "append_sheet_rows",
    "create_card",
    "get_card",
    "list_cards",
    "list_members",
    "move_card",
    "read_sheet_range",
    "send_slack_message",
  ]);

  const built = toolDefinitions();
  expect(tools.tools).toHaveLength(built.length);
  for (const t of tools.tools) {
    const matching = built.find((b) => b.name === t.name);
    expect(matching).toBeDefined();
    expect(t.description).toBe(matching!.description);
    expect(t.inputSchema).toEqual(matching!.inputSchema);
    expect(t.outputSchema).toEqual(matching!.outputSchema);
  }
});

it("[TH-03-date-domain] schema rejects year 0000 and invalid dates across Zod and JSON Schema validator", () => {
  // 1. Zod input schema validation
  expect(inputs.list_cards.safeParse({ board_id: "board_a", since: "0000-01-01" }).success).toBe(false);
  expect(inputs.list_cards.safeParse({ board_id: "board_a", until: "0000-12-31" }).success).toBe(false);
  expect(inputs.list_cards.safeParse({ board_id: "board_a", since: "0001-01-01" }).success).toBe(true);
  expect(inputs.list_cards.safeParse({ board_id: "board_a", until: "9999-12-31" }).success).toBe(true);
  expect(inputs.list_cards.safeParse({ board_id: "board_a", since: "2024-02-29" }).success).toBe(true);
  expect(inputs.list_cards.safeParse({ board_id: "board_a", since: "2025-02-29" }).success).toBe(false);
  expect(inputs.list_cards.safeParse({ board_id: "board_a", since: "2026-02-30" }).success).toBe(false);

  // 2. Exported tool definition JSON schema validation via Ajv validator
  const def = toolDefinitions().find((t) => t.name === "list_cards");
  expect(def).toBeDefined();
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
  const addFormats = typeof (formatsPlugin as any).default === "function" ? (formatsPlugin as any).default : formatsPlugin;
  addFormats(ajv);
  const validate = ajv.compile(def!.inputSchema as Record<string, unknown>);

  expect(validate({ board_id: "board_a", since: "0000-01-01" })).toBe(false);
  expect(validate({ board_id: "board_a", until: "0000-12-31" })).toBe(false);
  expect(validate({ board_id: "board_a", since: "2025-02-29" })).toBe(false);
  expect(validate({ board_id: "board_a", since: "2026-02-30" })).toBe(false);

  expect(validate({ board_id: "board_a", since: "0001-01-01" })).toBe(true);
  expect(validate({ board_id: "board_a", until: "9999-12-31" })).toBe(true);
  expect(validate({ board_id: "board_a", since: "2024-02-29" })).toBe(true);
});

it("[TH-03-date-domain] live MCP list_cards rejects year 0000 with BAD_ARGS and accepts 0001 and 9999", async () => {
  const sinceZero = await call("list_cards", { board_id: "board_a", since: "0000-01-01" });
  expect(sinceZero.isError).toBe(true);
  expect(errorCode(sinceZero)).toBe("BAD_ARGS");

  const untilZero = await call("list_cards", { board_id: "board_a", until: "0000-12-31" });
  expect(untilZero.isError).toBe(true);
  expect(errorCode(untilZero)).toBe("BAD_ARGS");

  const sinceOne = await call("list_cards", { board_id: "board_a", since: "0001-01-01" });
  expect(sinceOne.isError).not.toBe(true);

  const untilMax = await call("list_cards", { board_id: "board_a", until: "9999-12-31" });
  expect(untilMax.isError).not.toBe(true);
});

it("[TH-04] creates card with all optional fields, verifies DB storage and receipt", async () => {
  const args = {
    board_id: "board_a",
    list_name: "Backlog",
    title: "Viết tài liệu API",
    description: "OpenAPI notes",
    due_date: "2026-09-20",
    assignee_id: "m2",
  };
  const auth = await grant("create_card", args);
  const response = await call("create_card", args, auth);
  expect(response.isError).not.toBe(true);
  const output = outputs.create_card.parse(response.structuredContent);
  expect(output.id).toMatch(/^[a-f0-9-]{36}$/);
  const stored = await raw`SELECT board_id, list_name, title, description, due_date::text AS due_date, assignee_id FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id=${output.id}`;
  expect(stored[0]).toEqual({ ...args });
  const receipt = await raw`SELECT result FROM hub_receipts WHERE user_id=${DEMO_USER_ID} AND operation_id=${auth.operation_id}`;
  expect(receipt).toHaveLength(1);
  expect(receipt[0]!.result).toEqual({ id: output.id });
});

it("[TH-04] creates card with omitted optional fields, storing empty description and nulls", async () => {
  const args = {
    board_id: "board_a",
    list_name: "Backlog",
    title: "Minimal Card",
  };
  const auth = await grant("create_card", args);
  const response = await call("create_card", args, auth);
  expect(response.isError).not.toBe(true);
  const output = outputs.create_card.parse(response.structuredContent);
  expect(output.id).toMatch(/^[a-f0-9-]{36}$/);
  const stored = await raw`SELECT board_id, list_name, title, description, due_date, assignee_id FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id=${output.id}`;
  expect(stored[0]).toEqual({
    board_id: "board_a",
    list_name: "Backlog",
    title: "Minimal Card",
    description: "",
    due_date: null,
    assignee_id: null,
  });
  const receipt = await raw`SELECT result FROM hub_receipts WHERE user_id=${DEMO_USER_ID} AND operation_id=${auth.operation_id}`;
  expect(receipt).toHaveLength(1);
  expect(receipt[0]!.result).toEqual({ id: output.id });
});

it("[TH-04] rejects create_card for missing or other-owner board/list/assignee with NOT_FOUND and zero mutation/receipt", async () => {
  const initialCards = (await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n;
  const initialReceipts = (await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n;

  // 1. Missing board
  const badBoardArgs = { board_id: "nonexistent", list_name: "Backlog", title: "Test" };
  const auth1 = await grant("create_card", badBoardArgs);
  const res1 = await call("create_card", badBoardArgs, auth1);
  expect(res1.isError).toBe(true);
  expect(errorCode(res1)).toBe("NOT_FOUND");

  // 2. Board belonging only to another user
  const otherUser = randomUUID();
  await raw`INSERT INTO users(id, email, password_hash) VALUES (${otherUser}, ${'other_' + otherUser + '@example.com'}, 'test')`;
  await raw`INSERT INTO hub_boards(user_id, board_id, name) VALUES (${otherUser}, 'board_other', 'Other Board')`;
  await raw`INSERT INTO hub_lists(user_id, board_id, list_name) VALUES (${otherUser}, 'board_other', 'Doing')`;
  await raw`INSERT INTO hub_lists(user_id, board_id, list_name) VALUES (${otherUser}, 'board_other', 'OtherOnlyList')`;
  await raw`INSERT INTO hub_members(user_id, board_id, member_id, name) VALUES (${otherUser}, 'board_other', 'm_other', 'Other Member')`;

  const foreignBoardArgs = { board_id: "board_other", list_name: "Doing", title: "Foreign Board" };
  const auth2 = await grant("create_card", foreignBoardArgs);
  const res2 = await call("create_card", foreignBoardArgs, auth2);
  expect(res2.isError).toBe(true);
  expect(errorCode(res2)).toBe("NOT_FOUND");

  // 3. Missing list on valid board
  const badListArgs = { board_id: "board_a", list_name: "NonexistentList", title: "Test" };
  const auth3 = await grant("create_card", badListArgs);
  const res3 = await call("create_card", badListArgs, auth3);
  expect(res3.isError).toBe(true);
  expect(errorCode(res3)).toBe("NOT_FOUND");

  // 4. List/member on another board of the SAME owner (board_b)
  await raw`INSERT INTO hub_boards(user_id, board_id, name) VALUES (${DEMO_USER_ID}, 'board_b', 'Board B')`;
  await raw`INSERT INTO hub_lists(user_id, board_id, list_name) VALUES (${DEMO_USER_ID}, 'board_b', 'ListOnlyOnB')`;
  await raw`INSERT INTO hub_members(user_id, board_id, member_id, name) VALUES (${DEMO_USER_ID}, 'board_b', 'm_only_on_b', 'Member Only On B')`;

  const sameOwnerWrongBoardList = { board_id: "board_a", list_name: "ListOnlyOnB", title: "Test" };
  const authSameOwnerList = await grant("create_card", sameOwnerWrongBoardList);
  const resSameOwnerList = await call("create_card", sameOwnerWrongBoardList, authSameOwnerList);
  expect(resSameOwnerList.isError).toBe(true);
  expect(errorCode(resSameOwnerList)).toBe("NOT_FOUND");

  const sameOwnerWrongBoardAssignee = { board_id: "board_a", list_name: "Backlog", title: "Test", assignee_id: "m_only_on_b" };
  const authSameOwnerAssignee = await grant("create_card", sameOwnerWrongBoardAssignee);
  const resSameOwnerAssignee = await call("create_card", sameOwnerWrongBoardAssignee, authSameOwnerAssignee);
  expect(resSameOwnerAssignee.isError).toBe(true);
  expect(errorCode(resSameOwnerAssignee)).toBe("NOT_FOUND");

  // 5. List/member of ANOTHER OWNER on the SAME board_id (board_a)
  await raw`INSERT INTO hub_boards(user_id, board_id, name) VALUES (${otherUser}, 'board_a', 'Other Board A')`;
  await raw`INSERT INTO hub_lists(user_id, board_id, list_name) VALUES (${otherUser}, 'board_a', 'OtherOwnerListOnA')`;
  await raw`INSERT INTO hub_members(user_id, board_id, member_id, name) VALUES (${otherUser}, 'board_a', 'm_other_on_a', 'Other Member On A')`;

  const otherOwnerSameBoardList = { board_id: "board_a", list_name: "OtherOwnerListOnA", title: "Test" };
  const authOtherList = await grant("create_card", otherOwnerSameBoardList);
  const resOtherList = await call("create_card", otherOwnerSameBoardList, authOtherList);
  expect(resOtherList.isError).toBe(true);
  expect(errorCode(resOtherList)).toBe("NOT_FOUND");

  const otherOwnerSameBoardAssignee = { board_id: "board_a", list_name: "Backlog", title: "Test", assignee_id: "m_other_on_a" };
  const authOtherAssignee = await grant("create_card", otherOwnerSameBoardAssignee);
  const resOtherAssignee = await call("create_card", otherOwnerSameBoardAssignee, authOtherAssignee);
  expect(resOtherAssignee.isError).toBe(true);
  expect(errorCode(resOtherAssignee)).toBe("NOT_FOUND");

  // 6. Missing assignee
  const badAssigneeArgs = { board_id: "board_a", list_name: "Backlog", title: "Test", assignee_id: "nonexistent_m" };
  const auth5 = await grant("create_card", badAssigneeArgs);
  const res5 = await call("create_card", badAssigneeArgs, auth5);
  expect(res5.isError).toBe(true);
  expect(errorCode(res5)).toBe("NOT_FOUND");

  expect((await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n).toBe(initialCards);
  expect((await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n).toBe(initialReceipts);
});

it("[TH-04] denies create_card with missing/pending/expired/stale approvals or payload/version drift", async () => {
  const args = { board_id: "board_a", list_name: "Backlog", title: "Auth Test" };
  const initialCards = (await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n;
  const initialReceipts = (await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n;

  // 1. Missing metadata
  const res1 = await call("create_card", args);
  expect(res1.isError).toBe(true);
  expect(errorCode(res1)).toBe("NOT_AUTHORIZED");

  // 2. Pending approval
  const pendingAuth = await grant("create_card", args, { approved: false });
  const res2 = await call("create_card", args, pendingAuth);
  expect(res2.isError).toBe(true);
  expect(errorCode(res2)).toBe("NOT_AUTHORIZED");

  // 3. Expired approval
  const expiredAuth = await grant("create_card", args, { expired: true });
  const res3 = await call("create_card", args, expiredAuth);
  expect(res3.isError).toBe(true);
  expect(errorCode(res3)).toBe("NOT_AUTHORIZED");

  // 4. Stale snapshot hash
  const validAuth = await grant("create_card", args);
  const staleAuth = { ...validAuth, snapshot_hash: "0".repeat(64) };
  const res4 = await call("create_card", args, staleAuth);
  expect(res4.isError).toBe(true);
  expect(errorCode(res4)).toBe("NOT_AUTHORIZED");

  // 5. Payload drift (args differ from granted approval)
  const differentArgs = { ...args, title: "Different Title" };
  const res5 = await call("create_card", differentArgs, validAuth);
  expect(res5.isError).toBe(true);
  expect(errorCode(res5)).toBe("NOT_AUTHORIZED");

  // 6. Wrong owner (approval belongs to another user)
  const otherUser = randomUUID();
  await raw`INSERT INTO users(id, email, password_hash) VALUES (${otherUser}, ${'other_' + otherUser + '@example.com'}, 'test')`;
  const otherAuth = await grant("create_card", args, { userId: otherUser });
  const res6 = await call("create_card", args, otherAuth);
  expect(res6.isError).toBe(true);
  expect(errorCode(res6)).toBe("NOT_AUTHORIZED");

  // 7. Version drift: new valid version on same workflow, run.workflow_version_id changed
  const validAuth7 = await grant("create_card", args);
  const [apprRow] = await raw<{ run_id: string; workflow_version_id: string }[]>`
    SELECT run_id, workflow_version_id FROM approvals WHERE id = ${validAuth7.approval_id}
  `;
  const [runRow] = await raw<{ workflow_id: string }[]>`
    SELECT workflow_id FROM runs WHERE id = ${apprRow!.run_id}
  `;
  const [vRow] = await raw<{ plan: unknown }[]>`
    SELECT plan FROM workflow_versions WHERE id = ${apprRow!.workflow_version_id}
  `;
  const driftVersionId = randomUUID();
  await raw`INSERT INTO workflow_versions(id, workflow_id, version_no, plan)
    VALUES (${driftVersionId}, ${runRow!.workflow_id}, 2, ${raw.json(vRow!.plan as any)})`;
  await raw`UPDATE runs SET workflow_version_id = ${driftVersionId} WHERE id = ${apprRow!.run_id}`;
  const res7 = await call("create_card", args, validAuth7);
  expect(res7.isError).toBe(true);
  expect(errorCode(res7)).toBe("NOT_AUTHORIZED");

  expect((await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n).toBe(initialCards);
  expect((await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n).toBe(initialReceipts);
});

it("[TH-04] rejects create_card with BAD_ARGS on extra args, whitespace title, length violations", async () => {
  const initialCards = (await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n;
  const initialReceipts = (await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n;

  // 1. Extra arg
  const extraArgs = { board_id: "board_a", list_name: "Backlog", title: "Valid", extra_field: "not allowed" };
  const auth1 = await grant("create_card", extraArgs);
  const res1 = await call("create_card", extraArgs, auth1);
  expect(res1.isError).toBe(true);
  expect(errorCode(res1)).toBe("BAD_ARGS");

  // 2. Whitespace title
  const wsArgs = { board_id: "board_a", list_name: "Backlog", title: "   \t\n  " };
  const auth2 = await grant("create_card", wsArgs);
  const res2 = await call("create_card", wsArgs, auth2);
  expect(res2.isError).toBe(true);
  expect(errorCode(res2)).toBe("BAD_ARGS");

  // 3. Title > 500 chars
  const longTitleArgs = { board_id: "board_a", list_name: "Backlog", title: "a".repeat(501) };
  const auth3 = await grant("create_card", longTitleArgs);
  const res3 = await call("create_card", longTitleArgs, auth3);
  expect(res3.isError).toBe(true);
  expect(errorCode(res3)).toBe("BAD_ARGS");

  // 4. Description > 16000 chars
  const longDescArgs = { board_id: "board_a", list_name: "Backlog", title: "Valid", description: "a".repeat(16001) };
  const auth4 = await grant("create_card", longDescArgs);
  const res4 = await call("create_card", longDescArgs, auth4);
  expect(res4.isError).toBe(true);
  expect(errorCode(res4)).toBe("BAD_ARGS");

  expect((await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n).toBe(initialCards);
  expect((await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n).toBe(initialReceipts);
});

it("[TH-04-due-date] create_card due_date schema rejects year 0000 and invalid dates across Zod and JSON Schema validator", () => {
  // 1. Zod input schema validation
  expect(inputs.create_card.safeParse({ board_id: "board_a", list_name: "Backlog", title: "T", due_date: "0000-01-01" }).success).toBe(false);
  expect(inputs.create_card.safeParse({ board_id: "board_a", list_name: "Backlog", title: "T", due_date: "0000-12-31" }).success).toBe(false);
  expect(inputs.create_card.safeParse({ board_id: "board_a", list_name: "Backlog", title: "T", due_date: "2026-02-30" }).success).toBe(false);
  expect(inputs.create_card.safeParse({ board_id: "board_a", list_name: "Backlog", title: "T", due_date: "2025-02-29" }).success).toBe(false);
  expect(inputs.create_card.safeParse({ board_id: "board_a", list_name: "Backlog", title: "T", due_date: "0001-01-01" }).success).toBe(true);
  expect(inputs.create_card.safeParse({ board_id: "board_a", list_name: "Backlog", title: "T", due_date: "9999-12-31" }).success).toBe(true);
  expect(inputs.create_card.safeParse({ board_id: "board_a", list_name: "Backlog", title: "T", due_date: "2024-02-29" }).success).toBe(true);

  // 2. Exported tool definition JSON schema validation via Ajv validator
  const def = toolDefinitions().find((t) => t.name === "create_card");
  expect(def).toBeDefined();
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
  const addFormats = typeof (formatsPlugin as any).default === "function" ? (formatsPlugin as any).default : formatsPlugin;
  addFormats(ajv);
  const validate = ajv.compile(def!.inputSchema as Record<string, unknown>);

  expect(validate({ board_id: "board_a", list_name: "Backlog", title: "T", due_date: "0000-01-01" })).toBe(false);
  expect(validate({ board_id: "board_a", list_name: "Backlog", title: "T", due_date: "0000-12-31" })).toBe(false);
  expect(validate({ board_id: "board_a", list_name: "Backlog", title: "T", due_date: "2026-02-30" })).toBe(false);
  expect(validate({ board_id: "board_a", list_name: "Backlog", title: "T", due_date: "2025-02-29" })).toBe(false);

  expect(validate({ board_id: "board_a", list_name: "Backlog", title: "T", due_date: "0001-01-01" })).toBe(true);
  expect(validate({ board_id: "board_a", list_name: "Backlog", title: "T", due_date: "9999-12-31" })).toBe(true);
  expect(validate({ board_id: "board_a", list_name: "Backlog", title: "T", due_date: "2024-02-29" })).toBe(true);
});

it("[TH-04-due-date] live MCP create_card rejects year 0000 and invalid dates with BAD_ARGS, accepts 0001 and 9999", async () => {
  const initialCards = (await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n;
  const initialReceipts = (await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n;

  const yearZeroArgs = { board_id: "board_a", list_name: "Backlog", title: "Year 0", due_date: "0000-01-01" };
  const auth0 = await grant("create_card", yearZeroArgs);
  const res0 = await call("create_card", yearZeroArgs, auth0);
  expect(res0.isError).toBe(true);
  expect(errorCode(res0)).toBe("BAD_ARGS");

  const invalidDateArgs = { board_id: "board_a", list_name: "Backlog", title: "Feb 30", due_date: "2026-02-30" };
  const authInv = await grant("create_card", invalidDateArgs);
  const resInv = await call("create_card", invalidDateArgs, authInv);
  expect(resInv.isError).toBe(true);
  expect(errorCode(resInv)).toBe("BAD_ARGS");

  const minYearArgs = { board_id: "board_a", list_name: "Backlog", title: "Year 1", due_date: "0001-01-01" };
  const auth1 = await grant("create_card", minYearArgs);
  const res1 = await call("create_card", minYearArgs, auth1);
  expect(res1.isError).not.toBe(true);

  const maxYearArgs = { board_id: "board_a", list_name: "Backlog", title: "Year 9999", due_date: "9999-12-31" };
  const auth9 = await grant("create_card", maxYearArgs);
  const res9 = await call("create_card", maxYearArgs, auth9);
  expect(res9.isError).not.toBe(true);

  expect((await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n).toBe(initialCards + 2);
  expect((await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n).toBe(initialReceipts + 2);
});

it("[TH-04] concurrent same-operation replay produces identical ID and exactly 1 card + 1 receipt", async () => {
  const initialCards = (await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n;
  const initialReceipts = (await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n;

  const args = { board_id: "board_a", list_name: "Backlog", title: "Concurrent Card" };
  const auth = await grant("create_card", args);
  const [res1, res2] = await Promise.all([
    call("create_card", args, auth),
    call("create_card", args, auth),
  ]);
  expect(res1.isError).not.toBe(true);
  expect(res2.isError).not.toBe(true);
  expect(res1.structuredContent).toEqual(res2.structuredContent);
  const id = (res1.structuredContent as any).id;
  const cards = await raw`SELECT count(*)::int AS n FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id=${id}`;
  expect(cards[0]!.n).toBe(1);
  const receipts = await raw`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${DEMO_USER_ID} AND operation_id=${auth.operation_id}`;
  expect(receipts[0]!.n).toBe(1);

  // Assert TOTAL card count increased by exactly 1 and receipt count increased by exactly 1
  expect((await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n).toBe(initialCards + 1);
  expect((await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n).toBe(initialReceipts + 1);
});

it("[TH-04] replay survives MCP process restart, returning original card ID with zero extra card", async () => {
  const initialCards = (await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n;
  const initialReceipts = (await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n;

  const args = { board_id: "board_a", list_name: "Backlog", title: "Restart Replay" };
  const auth = await grant("create_card", args);
  const first = await call("create_card", args, auth);
  expect(first.isError).not.toBe(true);
  const originalId = (first.structuredContent as any).id;

  await client!.close();
  client = await startClient();

  const second = await call("create_card", args, auth);
  expect(second.isError).not.toBe(true);
  expect(second.structuredContent).toEqual({ id: originalId });

  const matchingCards = await raw`SELECT count(*)::int AS n FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id=${originalId}`;
  expect(matchingCards[0]!.n).toBe(1);
  const matchingReceipts = await raw`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${DEMO_USER_ID} AND operation_id=${auth.operation_id}`;
  expect(matchingReceipts[0]!.n).toBe(1);

  // Assert TOTAL card count increased by exactly 1 and receipt count increased by exactly 1
  expect((await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n).toBe(initialCards + 1);
  expect((await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n).toBe(initialReceipts + 1);
});

it("[TH-04] same operation with changed payload is denied and leaves original state intact", async () => {
  const initialCards = (await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n;
  const initialReceipts = (await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n;

  const args = { board_id: "board_a", list_name: "Backlog", title: "Original Title" };
  const auth = await grant("create_card", args);
  const first = await call("create_card", args, auth);
  expect(first.isError).not.toBe(true);
  const originalId = (first.structuredContent as any).id;

  // 1. Changed title with same operation
  const changedTitleArgs = { board_id: "board_a", list_name: "Backlog", title: "Tampered Title" };
  const tamperedTitle = await call("create_card", changedTitleArgs, auth);
  expect(tamperedTitle.isError).toBe(true);
  expect(errorCode(tamperedTitle)).toBe("NOT_AUTHORIZED");

  // 2. Changed board with same operation
  const changedBoardArgs = { board_id: "board_b", list_name: "Backlog", title: "Original Title" };
  const tamperedBoard = await call("create_card", changedBoardArgs, auth);
  expect(tamperedBoard.isError).toBe(true);
  expect(errorCode(tamperedBoard)).toBe("NOT_AUTHORIZED");

  // Verify original card data and receipt intact
  const origCard = await raw`SELECT board_id, list_name, title FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id=${originalId}`;
  expect(origCard[0]).toEqual({ board_id: "board_a", list_name: "Backlog", title: "Original Title" });
  const origReceipt = await raw`SELECT result FROM hub_receipts WHERE user_id=${DEMO_USER_ID} AND operation_id=${auth.operation_id}`;
  expect(origReceipt[0]!.result).toEqual({ id: originalId });

  const tamperedCards = await raw`SELECT count(*)::int AS n FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND title='Tampered Title'`;
  expect(tamperedCards[0]!.n).toBe(0);

  expect((await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n).toBe(initialCards + 1);
  expect((await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n).toBe(initialReceipts + 1);
});

it("[TH-04] distinct operations with same title create two distinct cards with two receipts", async () => {
  const args1 = { board_id: "board_a", list_name: "Backlog", title: "Duplicate Title" };
  const auth1 = await grant("create_card", args1);
  const res1 = await call("create_card", args1, auth1);
  expect(res1.isError).not.toBe(true);

  const args2 = { board_id: "board_a", list_name: "Backlog", title: "Duplicate Title" };
  const auth2 = await grant("create_card", args2);
  const res2 = await call("create_card", args2, auth2);
  expect(res2.isError).not.toBe(true);

  const id1 = (res1.structuredContent as any).id;
  const id2 = (res2.structuredContent as any).id;
  expect(id1).not.toEqual(id2);

  const cards = await raw`SELECT card_id FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND title='Duplicate Title'`;
  expect(cards).toHaveLength(2);
  const receipts = await raw`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${DEMO_USER_ID} AND operation_id IN (${auth1.operation_id}, ${auth2.operation_id})`;
  expect(receipts[0]!.n).toBe(2);
});

it("[TH-04] rolls back card insert when receipt persistence fails after mutation", async () => {
  const args = { board_id: "board_a", list_name: "Backlog", title: "Rollback Card" };
  const auth = await grant("create_card", args);
  await raw.unsafe(
    `CREATE FUNCTION fail_create_card_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN
       IF NEW.tool_name = 'create_card' THEN
         RAISE EXCEPTION 'injected create_card receipt failure';
       END IF;
       RETURN NEW;
     END $$`,
  );
  await raw.unsafe(
    "CREATE TRIGGER fail_create_card_receipt_trg BEFORE INSERT ON hub_receipts FOR EACH ROW EXECUTE FUNCTION fail_create_card_receipt()",
  );
  try {
    const res = await call("create_card", args, auth);
    expect(res.isError).toBe(true);
    expect(errorCode(res)).toBe("INTERNAL_ERROR");
    const created = await raw`SELECT count(*)::int AS n FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND title='Rollback Card'`;
    expect(created[0]!.n).toBe(0);
    const receipts = await raw`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${DEMO_USER_ID} AND operation_id=${auth.operation_id}`;
    expect(receipts[0]!.n).toBe(0);
  } finally {
    await raw.unsafe("DROP TRIGGER IF EXISTS fail_create_card_receipt_trg ON hub_receipts");
    await raw.unsafe("DROP FUNCTION IF EXISTS fail_create_card_receipt()");
  }
});

it("[TH-04] denies create_card when destination list lock causes waiting past approval expiry", async () => {
  const args = { board_id: "board_a", list_name: "Backlog", title: "Locked Destination Card" };
  const auth = await grant("create_card", args);

  let blockerConn: ReturnType<typeof postgres> | undefined;
  let releaseBlocker: (() => void) | undefined;
  let blockerTx: Promise<void> | undefined;

  try {
    blockerConn = postgres(url, { max: 1, onnotice: () => {} });
    const blockerAcquired = new Promise<void>((resolve) => {
      blockerTx = blockerConn!.begin(async (tx) => {
        await tx`SELECT * FROM hub_lists WHERE user_id=${DEMO_USER_ID} AND board_id='board_a' AND list_name='Backlog' FOR UPDATE`;
        resolve();
        await new Promise<void>((r) => {
          releaseBlocker = r;
        });
      });
    });
    await blockerAcquired;

    // Set approval expires_at to 1 second in future
    await raw`UPDATE approvals SET expires_at=clock_timestamp()+interval '1 second' WHERE id=${auth.approval_id}`;
    const [appr] = await raw<{ expires_at: Date }[]>`SELECT expires_at FROM approvals WHERE id=${auth.approval_id}`;
    const expiresAt = appr!.expires_at;

    const pending = call("create_card", args, auth);

    // Verify backend is actually waiting on blocker using pg_blocking_pids
    await vi.waitFor(
      async () => {
        const rows = await raw<{ pid: number; blocking: number[] }[]>`
          SELECT pid, pg_blocking_pids(pid) AS blocking
          FROM pg_stat_activity
          WHERE datname=${dbName} AND cardinality(pg_blocking_pids(pid)) > 0
        `;
        expect(rows.length).toBeGreaterThan(0);
      },
      { timeout: 2000, interval: 25 },
    );

    // Poll until DB clock passes expires_at and assert true BEFORE releasing blocker
    await vi.waitFor(
      async () => {
        const [clock] = await raw<{ expired: boolean }[]>`SELECT clock_timestamp() > ${expiresAt} AS expired`;
        expect(clock!.expired).toBe(true);
      },
      { timeout: 3000, interval: 50 },
    );

    // Release blocker now
    releaseBlocker!();
    await blockerTx!;

    const res = await pending;
    expect(res.isError).toBe(true);
    expect(errorCode(res)).toBe("NOT_AUTHORIZED");

    const cards = await raw`SELECT count(*)::int AS n FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND title='Locked Destination Card'`;
    expect(cards[0]!.n).toBe(0);
    const receipts = await raw`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${DEMO_USER_ID} AND operation_id=${auth.operation_id}`;
    expect(receipts[0]!.n).toBe(0);
  } finally {
    if (releaseBlocker) releaseBlocker();
    if (blockerTx) await blockerTx.catch(() => {});
    await blockerConn?.end();
  }
});

it("[TH-04] maps corrupt stored receipt on replay to INTERNAL_ERROR and leaves database unmutated", async () => {
  const initialCards = (await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n;
  const initialReceipts = (await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n;

  const args = { board_id: "board_a", list_name: "Backlog", title: "Corrupt Receipt Card" };
  const auth = await grant("create_card", args);
  const first = await call("create_card", args, auth);
  expect(first.isError).not.toBe(true);
  const cardId = (first.structuredContent as any).id;

  const [originalReceipt] = await raw<{ result: unknown }[]>`
    SELECT result FROM hub_receipts WHERE user_id=${DEMO_USER_ID} AND operation_id=${auth.operation_id}
  `;
  expect(originalReceipt).toBeDefined();

  try {
    // Corrupt stored receipt result to {}
    await raw`UPDATE hub_receipts SET result='{}'::jsonb WHERE user_id=${DEMO_USER_ID} AND operation_id=${auth.operation_id}`;

    // Replay with identical args + auth must yield INTERNAL_ERROR (not BAD_ARGS)
    const replayRes = await call("create_card", args, auth);
    expect(replayRes.isError).toBe(true);
    expect(errorCode(replayRes)).toBe("INTERNAL_ERROR");

    // No new cards or receipts created
    expect((await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n).toBe(initialCards + 1);
    expect((await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n).toBe(initialReceipts + 1);
  } finally {
    // Restore original receipt
    await raw`UPDATE hub_receipts SET result=${raw.json(originalReceipt!.result as any)} WHERE user_id=${DEMO_USER_ID} AND operation_id=${auth.operation_id}`;
  }

  // Retest replay after restore succeeds
  const retested = await call("create_card", args, auth);
  expect(retested.isError).not.toBe(true);
  expect((retested.structuredContent as any).id).toBe(cardId);
});

it("[TH-04] live discovery exposes active tools matching toolDefinitions", async () => {
  const tools = await client!.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  expect(names).toEqual([
    "append_sheet_rows",
    "create_card",
    "get_card",
    "list_cards",
    "list_members",
    "move_card",
    "read_sheet_range",
    "send_slack_message",
  ]);

  const built = toolDefinitions();
  expect(tools.tools).toHaveLength(built.length);
  for (const t of tools.tools) {
    const matching = built.find((b) => b.name === t.name);
    expect(matching).toBeDefined();
    expect(t.description).toBe(matching!.description);
    expect(t.inputSchema).toEqual(matching!.inputSchema);
    expect(t.outputSchema).toEqual(matching!.outputSchema);
  }
});

it("[TH-05] moves card from Doing to Done, updating list_name and updated_at, reducing m1 workload to 0", async () => {
  const [initialCard] = await raw<{ board_id: string; list_name: string; updated_at: string }[]>`
    SELECT board_id, list_name, updated_at::text FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'
  `;
  expect(initialCard).toBeDefined();
  expect(initialCard!.list_name).toBe("Doing");

  // Initial workload for m1 is 1
  const initialMembers = await call("list_members", { board_id: "board_a" });
  expect(initialMembers.isError).not.toBe(true);
  const m1Before = (initialMembers.structuredContent as any).members.find((m: any) => m.id === "m1");
  expect(m1Before.task_count).toBe(1);

  const initialReceipts = (await raw`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${DEMO_USER_ID}`)[0]!.n;

  const args = { card_id: "c1", target_list: "Done" };
  const auth = await grant("move_card", args);
  const res = await call("move_card", args, auth);
  expect(res.isError).not.toBe(true);
  expect(res.structuredContent).toEqual({ id: "c1", list_name: "Done" });

  const [afterCard] = await raw<{ board_id: string; list_name: string; updated_at: string }[]>`
    SELECT board_id, list_name, updated_at::text FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'
  `;
  expect(afterCard!.board_id).toBe(initialCard!.board_id);
  expect(afterCard!.list_name).toBe("Done");
  expect(afterCard!.updated_at).not.toBe(initialCard!.updated_at);

  // Workload for m1 is now 0
  const afterMembers = await call("list_members", { board_id: "board_a" });
  expect(afterMembers.isError).not.toBe(true);
  const m1After = (afterMembers.structuredContent as any).members.find((m: any) => m.id === "m1");
  expect(m1After.task_count).toBe(0);

  // Exactly 1 new receipt
  const currentReceipts = (await raw`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${DEMO_USER_ID}`)[0]!.n;
  expect(currentReceipts).toBe(initialReceipts + 1);
  const opReceipt = await raw`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${DEMO_USER_ID} AND operation_id=${auth.operation_id}`;
  expect(opReceipt[0]!.n).toBe(1);
});

it("[TH-05] moves card from Done to Doing, restoring m1 workload to 1", async () => {
  // Setup: Explicitly put c1 in Done first so we are truly testing Done -> Doing
  await raw`UPDATE hub_cards SET list_name='Done', updated_at=clock_timestamp() - interval '1 minute' WHERE user_id=${DEMO_USER_ID} AND card_id='c1'`;
  const [beforeCard] = await raw<{ list_name: string; updated_at: string }[]>`
    SELECT list_name, updated_at::text FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'
  `;
  expect(beforeCard!.list_name).toBe("Done");
  const timestampBefore = beforeCard!.updated_at;

  // Workload before move: c1 and c2 are both Done, so m1 task_count is 0
  const membersBefore = await call("list_members", { board_id: "board_a" });
  expect(membersBefore.isError).not.toBe(true);
  const m1Before = (membersBefore.structuredContent as any).members.find((m: any) => m.id === "m1");
  expect(m1Before.task_count).toBe(0);

  // Move c1 from Done to Doing
  const args = { card_id: "c1", target_list: "Doing" };
  const auth = await grant("move_card", args);
  const res = await call("move_card", args, auth);
  expect(res.isError).not.toBe(true);
  expect(res.structuredContent).toEqual({ id: "c1", list_name: "Doing" });

  const [afterCard] = await raw<{ list_name: string; updated_at: string }[]>`
    SELECT list_name, updated_at::text FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'
  `;
  expect(afterCard!.list_name).toBe("Doing");
  expect(afterCard!.updated_at).not.toBe(timestampBefore);

  // Workload after move: c1 is in Doing, so m1 task_count is 1
  const membersAfter = await call("list_members", { board_id: "board_a" });
  expect(membersAfter.isError).not.toBe(true);
  const m1After = (membersAfter.structuredContent as any).members.find((m: any) => m.id === "m1");
  expect(m1After.task_count).toBe(1);
});

it("[TH-05] denies move_card when authorization is missing, pending, expired, stale hash, version drift, or wrong owner", async () => {
  const [initialCard] = await raw<{ list_name: string; updated_at: string }[]>`
    SELECT list_name, updated_at::text FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'
  `;
  const initialCards = (await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n;
  const initialReceipts = (await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n;

  const args = { card_id: "c1", target_list: "Done" };

  // 1. Missing authorization
  const res1 = await call("move_card", args, undefined);
  expect(res1.isError).toBe(true);
  expect(errorCode(res1)).toBe("NOT_AUTHORIZED");

  // 2. Pending approval
  const auth2 = await grant("move_card", args, { approved: false });
  const res2 = await call("move_card", args, auth2);
  expect(res2.isError).toBe(true);
  expect(errorCode(res2)).toBe("NOT_AUTHORIZED");

  // 3. Expired approval
  const auth3 = await grant("move_card", args, { expired: true });
  const res3 = await call("move_card", args, auth3);
  expect(res3.isError).toBe(true);
  expect(errorCode(res3)).toBe("NOT_AUTHORIZED");

  // 4. Stale snapshot hash
  const auth4 = await grant("move_card", args);
  auth4.snapshot_hash = "0".repeat(64);
  const res4 = await call("move_card", args, auth4);
  expect(res4.isError).toBe(true);
  expect(errorCode(res4)).toBe("NOT_AUTHORIZED");

  // 5. Version drift: run has different workflow_version_id than approval (copy valid plan)
  const auth5 = await grant("move_card", args);
  const [appr5] = await raw<{ run_id: string; workflow_version_id: string }[]>`
    SELECT run_id, workflow_version_id FROM approvals WHERE id = ${auth5.approval_id}
  `;
  const [run5] = await raw<{ workflow_id: string }[]>`
    SELECT workflow_id FROM runs WHERE id = ${appr5!.run_id}
  `;
  const [vRow5] = await raw<{ plan: unknown }[]>`
    SELECT plan FROM workflow_versions WHERE id = ${appr5!.workflow_version_id}
  `;
  const newVersionId = randomUUID();
  await raw`INSERT INTO workflow_versions (id, workflow_id, version_no, plan)
    VALUES (${newVersionId}, ${run5!.workflow_id}, 2, ${raw.json(vRow5!.plan as any)})`;
  await raw`UPDATE runs SET workflow_version_id = ${newVersionId} WHERE id = ${appr5!.run_id}`;
  const res5 = await call("move_card", args, auth5);
  expect(res5.isError).toBe(true);
  expect(errorCode(res5)).toBe("NOT_AUTHORIZED");

  // 6. Wrong owner
  const otherUser = randomUUID();
  await raw`INSERT INTO users (id, email, password_hash, display_name) VALUES (${otherUser}, ${`g1-${otherUser}@local.invalid`}, 'LOCAL_DEMO_LOGIN_DISABLED', 'Other')`;
  const auth6 = await grant("move_card", args, { userId: otherUser });
  const res6 = await call("move_card", args, auth6);
  expect(res6.isError).toBe(true);
  expect(errorCode(res6)).toBe("NOT_AUTHORIZED");

  // Verify card state and counts unchanged
  const [currentCard] = await raw<{ list_name: string; updated_at: string }[]>`
    SELECT list_name, updated_at::text FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'
  `;
  expect(currentCard!.list_name).toBe(initialCard!.list_name);
  expect(currentCard!.updated_at).toBe(initialCard!.updated_at);
  expect((await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n).toBe(initialCards);
  expect((await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n).toBe(initialReceipts);
});

it("[TH-05] returns NOT_FOUND for missing card, foreign card, missing target list, cross-board list, and other-owner list", async () => {
  // Setup:
  // 1. Same owner, different board 'board_b' with list 'OnlyB'
  await raw`INSERT INTO hub_boards (user_id, board_id, name) VALUES (${DEMO_USER_ID}, 'board_b', 'Board B') ON CONFLICT DO NOTHING`;
  await raw`INSERT INTO hub_lists (user_id, board_id, list_name, position, is_done) VALUES (${DEMO_USER_ID}, 'board_b', 'OnlyB', 0, false) ON CONFLICT DO NOTHING`;

  // 2. Other owner with board 'board_a' and list 'OnlyOther' and card 'foreign_card'
  const otherOwner = randomUUID();
  await raw`INSERT INTO users (id, email, password_hash, display_name) VALUES (${otherOwner}, ${`g1-${otherOwner}@local.invalid`}, 'LOCAL_DEMO_LOGIN_DISABLED', 'Other Owner')`;
  await raw`INSERT INTO hub_boards (user_id, board_id, name) VALUES (${otherOwner}, 'board_a', 'Other A')`;
  await raw`INSERT INTO hub_lists (user_id, board_id, list_name, position, is_done) VALUES (${otherOwner}, 'board_a', 'OnlyOther', 0, false)`;
  await raw`INSERT INTO hub_cards (user_id, card_id, board_id, list_name, title) VALUES (${otherOwner}, 'foreign_card', 'board_a', 'OnlyOther', 'Foreign Card')`;

  // Capture snapshots AFTER foreign card and board fixtures are created
  const [c1Snapshot] = await raw<{ list_name: string; updated_at: string }[]>`
    SELECT list_name, updated_at::text FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'
  `;
  const [foreignSnapshot] = await raw<{ list_name: string; updated_at: string }[]>`
    SELECT list_name, updated_at::text FROM hub_cards WHERE user_id=${otherOwner} AND card_id='foreign_card'
  `;
  const totalCardsSnapshot = (await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n;
  const totalReceiptsSnapshot = (await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n;

  // 1. Missing card
  const args1 = { card_id: "missing_card_xyz", target_list: "Done" };
  const auth1 = await grant("move_card", args1);
  const res1 = await call("move_card", args1, auth1);
  expect(res1.isError).toBe(true);
  expect(errorCode(res1)).toBe("NOT_FOUND");

  // 2. Foreign card (belongs to other owner)
  const args2 = { card_id: "foreign_card", target_list: "Done" };
  const auth2 = await grant("move_card", args2);
  const res2 = await call("move_card", args2, auth2);
  expect(res2.isError).toBe(true);
  expect(errorCode(res2)).toBe("NOT_FOUND");

  // 3. Missing target list
  const args3 = { card_id: "c1", target_list: "NonexistentList" };
  const auth3 = await grant("move_card", args3);
  const res3 = await call("move_card", args3, auth3);
  expect(res3.isError).toBe(true);
  expect(errorCode(res3)).toBe("NOT_FOUND");

  // 4. Target list on different board of same owner ('OnlyB' is on board_b, c1 is on board_a)
  const args4 = { card_id: "c1", target_list: "OnlyB" };
  const auth4 = await grant("move_card", args4);
  const res4 = await call("move_card", args4, auth4);
  expect(res4.isError).toBe(true);
  expect(errorCode(res4)).toBe("NOT_FOUND");

  // 5. Target list of other owner on same board_a ('OnlyOther' is on board_a but owned by otherOwner)
  const args5 = { card_id: "c1", target_list: "OnlyOther" };
  const auth5 = await grant("move_card", args5);
  const res5 = await call("move_card", args5, auth5);
  expect(res5.isError).toBe(true);
  expect(errorCode(res5)).toBe("NOT_FOUND");

  // Assert total cards and receipts unchanged
  expect((await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n).toBe(totalCardsSnapshot);
  expect((await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n).toBe(totalReceiptsSnapshot);

  // Assert c1 card unchanged
  const [c1After] = await raw<{ list_name: string; updated_at: string }[]>`
    SELECT list_name, updated_at::text FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'
  `;
  expect(c1After!.list_name).toBe(c1Snapshot!.list_name);
  expect(c1After!.updated_at).toBe(c1Snapshot!.updated_at);

  // Assert foreign card unchanged
  const [foreignAfter] = await raw<{ list_name: string; updated_at: string }[]>`
    SELECT list_name, updated_at::text FROM hub_cards WHERE user_id=${otherOwner} AND card_id='foreign_card'
  `;
  expect(foreignAfter!.list_name).toBe(foreignSnapshot!.list_name);
  expect(foreignAfter!.updated_at).toBe(foreignSnapshot!.updated_at);
});

it("[TH-05] schema validation rejects extra args, empty card_id, empty target_list, and null with BAD_ARGS", async () => {
  const initialCards = (await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n;
  const initialReceipts = (await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n;

  // 1. Extra args
  const extraArgs = { card_id: "c1", target_list: "Done", extra_field: 123 };
  const auth1 = await grant("move_card", extraArgs);
  const res1 = await call("move_card", extraArgs, auth1);
  expect(res1.isError).toBe(true);
  expect(errorCode(res1)).toBe("BAD_ARGS");

  // 2. Empty card_id
  const emptyCardArgs = { card_id: "", target_list: "Done" };
  const auth2 = await grant("move_card", emptyCardArgs);
  const res2 = await call("move_card", emptyCardArgs, auth2);
  expect(res2.isError).toBe(true);
  expect(errorCode(res2)).toBe("BAD_ARGS");

  // 3. Empty target_list
  const emptyListArgs = { card_id: "c1", target_list: "" };
  const auth3 = await grant("move_card", emptyListArgs);
  const res3 = await call("move_card", emptyListArgs, auth3);
  expect(res3.isError).toBe(true);
  expect(errorCode(res3)).toBe("BAD_ARGS");

  // 4. Null target_list
  const nullListArgs = { card_id: "c1", target_list: null as any };
  const auth4 = await grant("move_card", nullListArgs);
  const res4 = await call("move_card", nullListArgs, auth4);
  expect(res4.isError).toBe(true);
  expect(errorCode(res4)).toBe("BAD_ARGS");

  expect((await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n).toBe(initialCards);
  expect((await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n).toBe(initialReceipts);
});

it("[TH-05] same-op replay across restart preserves exact timestamp and produces identical result with 1 mutation and 1 receipt", async () => {
  // Move c1 to Done
  const args = { card_id: "c1", target_list: "Done" };
  const auth = await grant("move_card", args);
  const first = await call("move_card", args, auth);
  expect(first.isError).not.toBe(true);
  expect(first.structuredContent).toEqual({ id: "c1", list_name: "Done" });

  const [firstCard] = await raw<{ updated_at: string }[]>`
    SELECT updated_at::text FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'
  `;
  const firstTimestamp = firstCard!.updated_at;

  const initialReceipts = (await raw`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${DEMO_USER_ID}`)[0]!.n;

  // Restart MCP process
  await client!.close();
  client = await startClient();

  // Replay
  const second = await call("move_card", args, auth);
  expect(second.isError).not.toBe(true);
  expect(second.structuredContent).toEqual(first.structuredContent);

  const [secondCard] = await raw<{ updated_at: string }[]>`
    SELECT updated_at::text FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'
  `;
  expect(secondCard!.updated_at).toBe(firstTimestamp);

  const currentReceipts = (await raw`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${DEMO_USER_ID}`)[0]!.n;
  expect(currentReceipts).toBe(initialReceipts);
  const opReceipt = await raw`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${DEMO_USER_ID} AND operation_id=${auth.operation_id}`;
  expect(opReceipt[0]!.n).toBe(1);
});

it("[TH-05] concurrent identical move_card calls produce identical output with exactly 1 mutation and 1 receipt", async () => {
  const initialReceipts = (await raw`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${DEMO_USER_ID}`)[0]!.n;

  const args = { card_id: "c1", target_list: "Backlog" };
  const auth = await grant("move_card", args);
  const [res1, res2] = await Promise.all([
    call("move_card", args, auth),
    call("move_card", args, auth),
  ]);
  expect(res1.isError).not.toBe(true);
  expect(res2.isError).not.toBe(true);
  expect(res1.structuredContent).toEqual({ id: "c1", list_name: "Backlog" });
  expect(res2.structuredContent).toEqual({ id: "c1", list_name: "Backlog" });

  const [card] = await raw<{ list_name: string }[]>`
    SELECT list_name FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'
  `;
  expect(card!.list_name).toBe("Backlog");

  const currentReceipts = (await raw`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${DEMO_USER_ID}`)[0]!.n;
  expect(currentReceipts).toBe(initialReceipts + 1);
  const opReceipt = await raw`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${DEMO_USER_ID} AND operation_id=${auth.operation_id}`;
  expect(opReceipt[0]!.n).toBe(1);
});

it("[TH-05] same-target NEW operation requires approval, preserves timestamp, and records exactly one new receipt", async () => {
  // c1 starts in Doing from seedDemo
  const [beforeCard] = await raw<{ list_name: string; updated_at: string }[]>`
    SELECT list_name, updated_at::text FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'
  `;
  expect(beforeCard!.list_name).toBe("Doing");
  const timestampBefore = beforeCard!.updated_at;

  const initialReceipts = (await raw`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${DEMO_USER_ID}`)[0]!.n;

  // New operation targeting same list 'Doing'
  const args = { card_id: "c1", target_list: "Doing" };
  const authNew = await grant("move_card", args);
  const res = await call("move_card", args, authNew);
  expect(res.isError).not.toBe(true);
  expect(res.structuredContent).toEqual({ id: "c1", list_name: "Doing" });

  const [afterCard] = await raw<{ list_name: string; updated_at: string }[]>`
    SELECT list_name, updated_at::text FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'
  `;
  expect(afterCard!.list_name).toBe("Doing");
  expect(afterCard!.updated_at).toBe(timestampBefore);

  const currentReceipts = (await raw`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${DEMO_USER_ID}`)[0]!.n;
  expect(currentReceipts).toBe(initialReceipts + 1);
  const opReceipt = await raw`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${DEMO_USER_ID} AND operation_id=${authNew.operation_id}`;
  expect(opReceipt[0]!.n).toBe(1);
});

it("[TH-05] denies replay when payload is changed for same operation_id, leaving original data and receipt intact", async () => {
  const args = { card_id: "c1", target_list: "Done" };
  const auth = await grant("move_card", args);
  const res = await call("move_card", args, auth);
  expect(res.isError).not.toBe(true);
  expect(res.structuredContent).toEqual({ id: "c1", list_name: "Done" });

  const [cardSnapshot] = await raw<{ list_name: string; updated_at: string }[]>`
    SELECT list_name, updated_at::text FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'
  `;
  const [receiptSnapshot] = await raw<{ result: unknown }[]>`
    SELECT result FROM hub_receipts WHERE user_id=${DEMO_USER_ID} AND operation_id=${auth.operation_id}
  `;

  // Tamper payload with same auth
  const tamperedArgs = { card_id: "c1", target_list: "Doing" };
  const deniedRes = await call("move_card", tamperedArgs, auth);
  expect(deniedRes.isError).toBe(true);
  expect(errorCode(deniedRes)).toBe("NOT_AUTHORIZED");

  const [afterCard] = await raw<{ list_name: string; updated_at: string }[]>`
    SELECT list_name, updated_at::text FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'
  `;
  expect(afterCard!.list_name).toBe(cardSnapshot!.list_name);
  expect(afterCard!.updated_at).toBe(cardSnapshot!.updated_at);

  const [afterReceipt] = await raw<{ result: unknown }[]>`
    SELECT result FROM hub_receipts WHERE user_id=${DEMO_USER_ID} AND operation_id=${auth.operation_id}
  `;
  expect(afterReceipt!.result).toEqual(receiptSnapshot!.result);
});

it("[TH-05] serializes two distinct operations on same card with different targets, verifying barrier overlap via pg_blocking_pids", async () => {
  const ADVISORY_KEY = 987654;
  const argsA = { card_id: "c1", target_list: "Backlog" };
  const authA = await grant("move_card", argsA);

  const argsB = { card_id: "c1", target_list: "Done" };
  const authB = await grant("move_card", argsB);

  let barrierConn: ReturnType<typeof postgres> | undefined;
  let promiseA: Promise<any> | undefined;
  let promiseB: Promise<any> | undefined;
  let barrierPid: number | undefined;

  try {
    barrierConn = postgres(url, { max: 1, onnotice: () => {} });
    const [barrierRow] = await barrierConn`SELECT pg_backend_pid() AS pid`;
    barrierPid = barrierRow!.pid;

    await barrierConn`SELECT pg_advisory_lock(${ADVISORY_KEY})`;

    await raw.unsafe(`
      CREATE FUNCTION wait_on_move_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.card_id = 'c1' AND NEW.list_name = 'Backlog' THEN
          PERFORM pg_advisory_lock(${ADVISORY_KEY});
          PERFORM pg_advisory_unlock(${ADVISORY_KEY});
        END IF;
        RETURN NEW;
      END $$
    `);
    await raw.unsafe(`
      CREATE TRIGGER move_barrier_trg AFTER UPDATE ON hub_cards
      FOR EACH ROW EXECUTE FUNCTION wait_on_move_barrier()
    `);

    // Dispatch Operation A
    promiseA = call("move_card", argsA, authA);

    // Wait until Operation A is blocked on the advisory lock, specifically by barrierPid in this dbName
    let pidA: number | undefined;
    await vi.waitFor(
      async () => {
        const rows = await raw<{ pid: number; blocking: number[] }[]>`
          SELECT l.pid, pg_blocking_pids(l.pid) AS blocking
          FROM pg_locks l
          JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE a.datname = ${dbName}
            AND l.locktype = 'advisory'
            AND (l.objid = ${ADVISORY_KEY} OR l.classid = ${ADVISORY_KEY})
            AND NOT l.granted
        `;
        expect(rows.length).toBeGreaterThan(0);
        const waitingA = rows.find((r) => r.blocking.includes(barrierPid!));
        expect(waitingA).toBeDefined();
        pidA = waitingA!.pid;
      },
      { timeout: 4000, interval: 30 },
    );
    expect(pidA).toBeDefined();

    // Now Operation A has updated c1 to Backlog and is holding the row lock on c1 inside its uncommitted transaction!
    // Dispatch Operation B
    promiseB = call("move_card", argsB, authB);

    // Verify Operation B is waiting on Operation A's backend (pidA) using pg_blocking_pids
    await vi.waitFor(
      async () => {
        const rows = await raw<{ pid: number; blocking: number[] }[]>`
          SELECT pid, pg_blocking_pids(pid) AS blocking
          FROM pg_stat_activity
          WHERE datname = ${dbName} AND cardinality(pg_blocking_pids(pid)) > 0
        `;
        const waitingB = rows.find((r) => r.blocking.includes(pidA!));
        expect(waitingB).toBeDefined();
      },
      { timeout: 4000, interval: 30 },
    );

    // Release advisory barrier to let Operation A complete and commit
    await barrierConn`SELECT pg_advisory_unlock(${ADVISORY_KEY})`;

    // Wait for both operations to resolve
    const [resA, resB] = await Promise.all([promiseA, promiseB]);
    expect(resA.isError).not.toBe(true);
    expect(resB.isError).not.toBe(true);
    expect(resA.structuredContent).toEqual({ id: "c1", list_name: "Backlog" });
    expect(resB.structuredContent).toEqual({ id: "c1", list_name: "Done" });

    // Assert two receipts recorded
    const receipts = await raw`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${DEMO_USER_ID} AND operation_id IN (${authA.operation_id}, ${authB.operation_id})`;
    expect(receipts[0]!.n).toBe(2);

    // Final card state is Done (from Operation B)
    const [finalCard] = await raw<{ list_name: string }[]>`SELECT list_name FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'`;
    expect(finalCard!.list_name).toBe("Done");

    // Workload check: m1 task_count is 0
    const membersRes = await call("list_members", { board_id: "board_a" });
    expect(membersRes.isError).not.toBe(true);
    const m1 = (membersRes.structuredContent as any).members.find((m: any) => m.id === "m1");
    expect(m1.task_count).toBe(0);
  } finally {
    // 1. Release advisory lock / close barrier connection first so A never hangs
    if (barrierConn) {
      await barrierConn`SELECT pg_advisory_unlock_all()`.catch(() => {});
      await barrierConn.end().catch(() => {});
    }
    // 2. Await both calls settling before dropping trigger
    await Promise.allSettled([promiseA, promiseB]);
    // 3. Drop trigger and function cleanly
    await raw.unsafe("DROP TRIGGER IF EXISTS move_barrier_trg ON hub_cards");
    await raw.unsafe("DROP FUNCTION IF EXISTS wait_on_move_barrier()");
  }
});

it("[TH-05] denies move_card when destination card lock causes waiting past approval expiry", async () => {
  const [initialCard] = await raw<{ list_name: string; updated_at: string }[]>`
    SELECT list_name, updated_at::text FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'
  `;
  const initialCards = (await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n;
  const initialReceipts = (await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n;

  const args = { card_id: "c1", target_list: "Done" };
  const auth = await grant("move_card", args);

  let blockerConn: ReturnType<typeof postgres> | undefined;
  let releaseBlocker: (() => void) | undefined;
  let blockerTx: Promise<void> | undefined;
  let blockerPid: number | undefined;

  try {
    blockerConn = postgres(url, { max: 1, onnotice: () => {} });
    const [blockerRow] = await blockerConn`SELECT pg_backend_pid() AS pid`;
    blockerPid = blockerRow!.pid;

    const blockerAcquired = new Promise<void>((resolve) => {
      blockerTx = blockerConn!.begin(async (tx) => {
        await tx`SELECT * FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1' FOR UPDATE`;
        resolve();
        await new Promise<void>((r) => {
          releaseBlocker = r;
        });
      });
    });
    await blockerAcquired;

    // Set approval expires_at to 4 seconds in future (generous TTL avoiding setup races)
    await raw`UPDATE approvals SET expires_at=clock_timestamp()+interval '4 seconds' WHERE id=${auth.approval_id}`;
    const [appr] = await raw<{ expires_at: Date }[]>`SELECT expires_at FROM approvals WHERE id=${auth.approval_id}`;
    const expiresAt = appr!.expires_at;

    const pending = call("move_card", args, auth);

    // Verify backend is actually waiting on blockerPid specifically using pg_blocking_pids
    await vi.waitFor(
      async () => {
        const rows = await raw<{ pid: number; blocking: number[] }[]>`
          SELECT pid, pg_blocking_pids(pid) AS blocking
          FROM pg_stat_activity
          WHERE datname=${dbName} AND cardinality(pg_blocking_pids(pid)) > 0
        `;
        const waiting = rows.find((r) => r.blocking.includes(blockerPid!));
        expect(waiting).toBeDefined();
      },
      { timeout: 3000, interval: 30 },
    );

    // Poll until DB clock passes expires_at and assert true BEFORE releasing blocker
    await vi.waitFor(
      async () => {
        const [clock] = await raw<{ expired: boolean }[]>`SELECT clock_timestamp() > ${expiresAt} AS expired`;
        expect(clock!.expired).toBe(true);
      },
      { timeout: 6000, interval: 50 },
    );

    // Release blocker now
    releaseBlocker!();
    await blockerTx!;

    const res = await pending;
    expect(res.isError).toBe(true);
    expect(errorCode(res)).toBe("NOT_AUTHORIZED");

    // Assert card list_name, updated_at::text, and total card and receipt counts are exactly preserved
    const [afterCard] = await raw<{ list_name: string; updated_at: string }[]>`
      SELECT list_name, updated_at::text FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'
    `;
    expect(afterCard!.list_name).toBe(initialCard!.list_name);
    expect(afterCard!.updated_at).toBe(initialCard!.updated_at);
    expect((await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n).toBe(initialCards);
    expect((await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n).toBe(initialReceipts);
  } finally {
    if (releaseBlocker) releaseBlocker();
    if (blockerTx) await blockerTx.catch(() => {});
    await blockerConn?.end();
  }
});

it("[TH-05] rolls back card update and restores original list_name and updated_at when receipt persistence fails", async () => {
  const [initialCard] = await raw<{ list_name: string; updated_at: string }[]>`
    SELECT list_name, updated_at::text FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'
  `;

  const args = { card_id: "c1", target_list: "Backlog" };
  const auth = await grant("move_card", args);

  await raw.unsafe(`
    CREATE FUNCTION fail_move_card_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.tool_name = 'move_card' THEN
        RAISE EXCEPTION 'injected move_card receipt failure';
      END IF;
      RETURN NEW;
    END $$
  `);
  await raw.unsafe(
    "CREATE TRIGGER fail_move_card_receipt_trg BEFORE INSERT ON hub_receipts FOR EACH ROW EXECUTE FUNCTION fail_move_card_receipt()",
  );

  try {
    const res = await call("move_card", args, auth);
    expect(res.isError).toBe(true);
    expect(errorCode(res)).toBe("INTERNAL_ERROR");

    // Exact list_name and updated_at::text must match initial snapshot
    const [afterCard] = await raw<{ list_name: string; updated_at: string }[]>`
      SELECT list_name, updated_at::text FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'
    `;
    expect(afterCard!.list_name).toBe(initialCard!.list_name);
    expect(afterCard!.updated_at).toBe(initialCard!.updated_at);

    const receipts = await raw`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${DEMO_USER_ID} AND operation_id=${auth.operation_id}`;
    expect(receipts[0]!.n).toBe(0);
  } finally {
    await raw.unsafe("DROP TRIGGER IF EXISTS fail_move_card_receipt_trg ON hub_receipts");
    await raw.unsafe("DROP FUNCTION IF EXISTS fail_move_card_receipt()");
  }
});

it("[TH-05] maps corrupt stored receipt on replay to INTERNAL_ERROR and leaves database unmutated", async () => {
  const args = { card_id: "c1", target_list: "Done" };
  const auth = await grant("move_card", args);
  const first = await call("move_card", args, auth);
  expect(first.isError).not.toBe(true);

  const [originalReceipt] = await raw<{ result: unknown }[]>`
    SELECT result FROM hub_receipts WHERE user_id=${DEMO_USER_ID} AND operation_id=${auth.operation_id}
  `;
  expect(originalReceipt).toBeDefined();

  const [cardSnapshot] = await raw<{ list_name: string; updated_at: string }[]>`
    SELECT list_name, updated_at::text FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'
  `;
  const initialCards = (await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n;
  const initialReceipts = (await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n;

  try {
    // Corrupt stored receipt result to {}
    await raw`UPDATE hub_receipts SET result='{}'::jsonb WHERE user_id=${DEMO_USER_ID} AND operation_id=${auth.operation_id}`;

    // Replay with identical args + auth must yield INTERNAL_ERROR
    const replayRes = await call("move_card", args, auth);
    expect(replayRes.isError).toBe(true);
    expect(errorCode(replayRes)).toBe("INTERNAL_ERROR");

    // Card and receipts unchanged
    const [currentCard] = await raw<{ list_name: string; updated_at: string }[]>`
      SELECT list_name, updated_at::text FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'
    `;
    expect(currentCard!.list_name).toBe(cardSnapshot!.list_name);
    expect(currentCard!.updated_at).toBe(cardSnapshot!.updated_at);
    expect((await raw`SELECT count(*)::int AS n FROM hub_cards`)[0]!.n).toBe(initialCards);
    expect((await raw`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n).toBe(initialReceipts);
  } finally {
    // Restore original receipt
    await raw`UPDATE hub_receipts SET result=${raw.json(originalReceipt!.result as any)} WHERE user_id=${DEMO_USER_ID} AND operation_id=${auth.operation_id}`;
  }

  // Retest replay after restore succeeds
  const retested = await call("move_card", args, auth);
  expect(retested.isError).not.toBe(true);
  expect(retested.structuredContent).toEqual({ id: "c1", list_name: "Done" });
});

it("[TH-05] live discovery exposes active tools matching toolDefinitions", async () => {
  const tools = await client!.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  expect(names).toEqual([
    "append_sheet_rows",
    "create_card",
    "get_card",
    "list_cards",
    "list_members",
    "move_card",
    "read_sheet_range",
    "send_slack_message",
  ]);

  const built = toolDefinitions();
  expect(tools.tools).toHaveLength(built.length);
  for (const t of tools.tools) {
    const matching = built.find((b) => b.name === t.name);
    expect(matching).toBeDefined();
    expect(t.description).toBe(matching!.description);
    expect(t.inputSchema).toEqual(matching!.inputSchema);
    expect(t.outputSchema).toEqual(matching!.outputSchema);
  }
});

