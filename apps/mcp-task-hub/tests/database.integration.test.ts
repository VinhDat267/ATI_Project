import { afterAll, beforeAll, expect, it } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { mkdtempSync, cpSync, appendFileSync, rmSync } from "node:fs";
import * as implementation from "../../../packages/db/src/index.js";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const name = "g1_it_" + randomUUID().replaceAll("-", "");
const adminUrl =
  process.env.G1_TEST_ADMIN_URL ??
  "postgresql://wap:wap@127.0.0.1:55432/wap_g1";
const address = new URL(adminUrl);
if (
  !["127.0.0.1", "localhost"].includes(address.hostname) ||
  address.pathname !== "/wap_g1"
)
  throw new Error(
    "Integration tests require the dedicated local wap_g1 database",
  );
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
address.pathname = "/" + name;
const url = address.href;
let raw: ReturnType<typeof postgres>;
beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  raw = postgres(url, { max: 1, onnotice: () => {} });
});
afterAll(async () => {
  await raw?.end();
  await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
});

it("applies SQL migrations exactly once and detects checksum drift", async () => {
  expect(implementation.migrate).toBeTypeOf("function");
  const first = await implementation.migrate(url);
  expect(first.applied).toEqual([
    "0001_init.sql",
    "0002_audit_contracts.sql",
    "0003_task_hub_local.sql",
    "0004_task_hub_cards.sql",
    "0005_filesystem_dispatches.sql",
    "0006_http_trace_snapshots.sql",
  ]);
  expect((await implementation.migrate(url)).applied).toEqual([]);
  const dir = mkdtempSync(path.join(tmpdir(), "ati-migration-test-"));
  try {
    cpSync(path.join(root, "db/migrations"), dir, { recursive: true });
    appendFileSync(path.join(dir, "0001_init.sql"), "\n-- unexpected edit");
    await expect(implementation.migrate(url, dir)).rejects.toThrow(/checksum/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("creates the filesystem dispatch reservation with the intended boundary contract", async () => {
  const columns = await raw`
    SELECT column_name,data_type
    FROM information_schema.columns
    WHERE table_name='filesystem_dispatches'
    ORDER BY ordinal_position`;
  expect(columns.map((row) => row.column_name)).toEqual([
    "operation_id",
    "user_id",
    "run_id",
    "relative_path",
    "content_sha256",
    "launch_hash",
    "dispatched_at",
  ]);
  const [comment] = await raw`
    SELECT obj_description('filesystem_dispatches'::regclass) AS comment`;
  expect(comment!.comment).toMatch(/NOT proof a filesystem write happened/);
});

it("seed is repeatable without resetting sheets or messages", async () => {
  expect(implementation.seedDemo).toBeTypeOf("function");
  const connection = implementation.openDatabase(url);
  try {
    await implementation.seedDemo(connection);
    const user = implementation.DEMO_USER_ID;
    const first =
      await raw`SELECT cells FROM hub_sheets WHERE user_id=${user} AND workbook_id='source' AND sheet_name='Progress'`;
    expect(first[0]!.cells).toEqual([
      ["API", "Done"],
      ["UI", "Doing"],
    ]);
    await raw`UPDATE hub_sheets SET cells='[["keep","me"]]'::jsonb WHERE user_id=${user} AND workbook_id='dest' AND sheet_name='Report'`;
    await implementation.seedDemo(connection);
    expect(
      (
        await raw`SELECT cells FROM hub_sheets WHERE user_id=${user} AND workbook_id='dest' AND sheet_name='Report'`
      )[0]!.cells,
    ).toEqual([["keep", "me"]]);
  } finally {
    await connection.close();
  }
});

it("permits planning without a version and rejects an executable versionless run", async () => {
  expect(implementation.seedDemo).toBeTypeOf("function");
  const user = implementation.DEMO_USER_ID;
  const workflow = randomUUID();
  await raw`INSERT INTO workflows (id,user_id,name,source_prompt) VALUES (${workflow},${user},'test','test')`;
  const [run] =
    await raw`INSERT INTO runs (user_id,workflow_id,source_prompt) VALUES (${user},${workflow},'test') RETURNING id,workflow_version_id`;
  expect(run!.workflow_version_id).toBeNull();
  await expect(
    raw`UPDATE runs SET status='running' WHERE id=${run!.id}`,
  ).rejects.toMatchObject({ code: "23514" });
  await raw`UPDATE runs SET status='refused',planner_result='{"kind":"refusal","reason":"unsupported"}'::jsonb WHERE id=${run!.id}`;
  expect(
    (await raw`SELECT status FROM runs WHERE id=${run!.id}`)[0]!.status,
  ).toBe("refused");
});

it("binds run owner to workflow owner", async () => {
  expect(implementation.seedDemo).toBeTypeOf("function");
  const other = randomUUID();
  const connection = implementation.openDatabase(url);
  try {
    await implementation.seedDemo(connection, other);
  } finally {
    await connection.close();
  }
  const [workflow] =
    await raw`SELECT id FROM workflows WHERE user_id=${implementation.DEMO_USER_ID} LIMIT 1`;
  await expect(
    raw`INSERT INTO runs (user_id,workflow_id,source_prompt) VALUES (${other},${workflow!.id},'test')`,
  ).rejects.toMatchObject({ code: "23503" });
});
it("keeps native SQL JSON and timestamp codecs separate from Drizzle codecs", async () => {
  await implementation.migrate(url);
  const connection = implementation.openDatabase(url);
  try {
    const when = new Date("2026-09-13T01:02:03.000Z");
    const [row] =
      await connection.client`SELECT ${connection.client.json({ rows: [["native"]] })}::jsonb AS payload,${connection.client.json("scalar")}::jsonb AS scalar,${when}::timestamptz AS stamp`;
    expect(row!.payload).toEqual({ rows: [["native"]] });
    expect(row!.scalar).toBe("scalar");
    expect(row!.stamp).toEqual(when);
    await implementation.seedDemo(connection);
  } finally {
    await connection.close();
  }
});

it("[TH-01] seeds boards, lists, members and cards, and preserves user edits on reseed", async () => {
  await implementation.migrate(url);
  const connection = implementation.openDatabase(url);
  try {
    const user = randomUUID();
    await implementation.seedDemo(connection, user);
    const first =
      await raw`SELECT card_id,title,list_name,assignee_id FROM hub_cards WHERE user_id=${user} ORDER BY card_id`;
    expect(first).toEqual([
      { card_id: "c1", title: "Viết API", list_name: "Doing", assignee_id: "m1" },
      { card_id: "c2", title: "Kiểm thử", list_name: "Done", assignee_id: "m1" },
    ]);
    await raw`UPDATE hub_cards SET title='Keep my edit',list_name='Backlog' WHERE user_id=${user} AND card_id='c1'`;
    await implementation.seedDemo(connection, user);
    expect(
      (
        await raw`SELECT title,list_name FROM hub_cards WHERE user_id=${user} AND card_id='c1'`
      )[0],
    ).toEqual({ title: "Keep my edit", list_name: "Backlog" });
  } finally {
    await connection.close();
  }
});

it("[TH-01] allows two owners to independently have card c1 and rejects cross-owner foreign keys with 23503", async () => {
  await implementation.migrate(url);
  const connection = implementation.openDatabase(url);
  try {
    const userA = randomUUID();
    const userB = randomUUID();
    await implementation.seedDemo(connection, userA);
    await implementation.seedDemo(connection, userB);

    const cardA =
      await raw`SELECT card_id,title,list_name FROM hub_cards WHERE user_id=${userA} AND card_id='c1'`;
    const cardB =
      await raw`SELECT card_id,title,list_name FROM hub_cards WHERE user_id=${userB} AND card_id='c1'`;
    expect(cardA).toEqual([{ card_id: "c1", title: "Viết API", list_name: "Doing" }]);
    expect(cardB).toEqual([{ card_id: "c1", title: "Viết API", list_name: "Doing" }]);

    // Create a board and list that exist ONLY for userB
    await raw`INSERT INTO hub_boards (user_id, board_id, name)
      VALUES (${userB}, 'board_b_only', 'Board B Only')`;
    await raw`INSERT INTO hub_lists (user_id, board_id, list_name, position, is_done)
      VALUES (${userB}, 'board_b_only', 'list_b_only', 1, false)`;

    // userA creating a list referencing userB's board 'board_b_only' must fail with FK error 23503
    await expect(
      raw`INSERT INTO hub_lists (user_id, board_id, list_name, position, is_done)
        VALUES (${userA}, 'board_b_only', 'list_a_cross', 1, false)`,
    ).rejects.toMatchObject({ code: "23503" });

    // userA creating a member referencing userB's board 'board_b_only' must fail with FK error 23503
    await expect(
      raw`INSERT INTO hub_members (user_id, board_id, member_id, name)
        VALUES (${userA}, 'board_b_only', 'member_a_cross', 'Member A Cross')`,
    ).rejects.toMatchObject({ code: "23503" });

    // userA creating a card in userB's board/list ('board_b_only', 'list_b_only') must fail with FK error 23503
    await expect(
      raw`INSERT INTO hub_cards (user_id, card_id, board_id, list_name, title)
        VALUES (${userA}, 'cross_b', 'board_b_only', 'list_b_only', 'Cross Board Card')`,
    ).rejects.toMatchObject({ code: "23503" });

    // Create a list that exists ONLY for userB on shared board_id name
    await raw`INSERT INTO hub_lists (user_id, board_id, list_name, position, is_done)
      VALUES (${userB}, 'board_a', 'SpecialB', 9, false)`;

    // userA inserting a card referencing userB's list 'SpecialB' must fail with FK error 23503
    await expect(
      raw`INSERT INTO hub_cards (user_id, card_id, board_id, list_name, title)
        VALUES (${userA}, 'cross1', 'board_a', 'SpecialB', 'Cross List')`,
    ).rejects.toMatchObject({ code: "23503" });

    // Create a member that exists ONLY for userB on shared board_id name
    await raw`INSERT INTO hub_members (user_id, board_id, member_id, name)
      VALUES (${userB}, 'board_a', 'mB_only', 'Member B Only')`;

    // userA inserting a card referencing userB's member 'mB_only' must fail with FK error 23503
    await expect(
      raw`INSERT INTO hub_cards (user_id, card_id, board_id, list_name, title, assignee_id)
        VALUES (${userA}, 'cross2', 'board_a', 'Doing', 'Cross Assignee', 'mB_only')`,
    ).rejects.toMatchObject({ code: "23503" });
  } finally {
    await connection.close();
  }
});
