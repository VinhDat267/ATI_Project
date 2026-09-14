import { z } from "zod";
import { type Database, sql } from "@wap/db";
import { inputs, outputs, type ToolName } from "./contracts.js";
import { ToolError } from "./errors.js";

export type CardReadName = "list_cards" | "get_card" | "list_members";

export function isCardReadName(name: ToolName): name is CardReadName {
  return (
    name === "list_cards" || name === "get_card" || name === "list_members"
  );
}

const RuntimeMetadataSchema = z
  .object({
    time_zone: z.string().min(1).max(100),
  })
  .strict();

async function resolveTimeZone(
  connection: Database,
  runtimeMetadata?: unknown,
): Promise<string> {
  let timeZone = "Asia/Ho_Chi_Minh";
  if (runtimeMetadata !== undefined) {
    const parsed = RuntimeMetadataSchema.safeParse(runtimeMetadata);
    if (!parsed.success) {
      throw new ToolError("BAD_ARGS", "Malformed runtime metadata");
    }
    timeZone = parsed.data.time_zone;
  }

  try {
    Intl.DateTimeFormat(undefined, { timeZone });
  } catch {
    throw new ToolError("BAD_ARGS", `Unsupported time zone: ${timeZone}`);
  }

  const [zoneExists] = await connection.db.execute<{ exists: number }>(
    sql`SELECT 1 AS exists FROM pg_timezone_names WHERE name = ${timeZone} LIMIT 1`,
  );
  if (!zoneExists) {
    throw new ToolError(
      "BAD_ARGS",
      `Unsupported time zone in PostgreSQL: ${timeZone}`,
    );
  }

  return timeZone;
}

export async function readCardTool(
  connection: Database,
  userId: string,
  name: CardReadName,
  args: unknown,
  runtimeMetadata?: unknown,
): Promise<Record<string, unknown>> {
  if (name === "get_card") {
    const input = inputs.get_card.parse(args);
    const rows = await connection.db.execute<{
      id: string;
      board_id: string;
      title: string;
      list_name: string;
    }>(sql`
      SELECT c.card_id AS id, c.board_id, c.title, c.list_name
      FROM hub_cards c
      WHERE c.user_id = ${userId} AND c.card_id = ${input.card_id}
    `);
    const [row] = rows;
    if (!row) {
      throw new ToolError("NOT_FOUND", "Card not found for this principal");
    }
    const result = outputs.get_card.safeParse(row);
    if (!result.success) {
      throw new ToolError(
        "INTERNAL_ERROR",
        "Stored card data failed the output contract",
      );
    }
    return result.data;
  }

  if (name === "list_members") {
    const input = inputs.list_members.parse(args);
    const [board] = await connection.db.execute<{ exists: number }>(sql`
      SELECT 1 AS exists FROM hub_boards WHERE user_id = ${userId} AND board_id = ${input.board_id}
    `);
    if (!board) {
      throw new ToolError("NOT_FOUND", "Board not found for this principal");
    }

    const rows = await connection.db.execute<{
      id: string;
      name: string;
      task_count: number;
    }>(sql`
      SELECT m.member_id AS id, m.name,
             (count(c.card_id) FILTER (WHERE l.is_done = false))::int AS task_count
      FROM hub_members m
      LEFT JOIN hub_cards c ON c.user_id = m.user_id AND c.board_id = m.board_id AND c.assignee_id = m.member_id
      LEFT JOIN hub_lists l ON l.user_id = c.user_id AND l.board_id = c.board_id AND l.list_name = c.list_name
      WHERE m.user_id = ${userId} AND m.board_id = ${input.board_id}
      GROUP BY m.member_id, m.name
      ORDER BY m.member_id COLLATE "C" ASC LIMIT 1001
    `);

    if (rows.length > 1000) {
      throw new ToolError("LIMIT_EXCEEDED", "list_members exceeds 1000 results");
    }

    const result = outputs.list_members.safeParse({ members: rows });
    if (!result.success) {
      throw new ToolError(
        "INTERNAL_ERROR",
        "Stored member data failed the output contract",
      );
    }
    return result.data;
  }

  if (name === "list_cards") {
    const input = inputs.list_cards.parse(args);
    if (input.since && input.until && input.since > input.until) {
      throw new ToolError("BAD_ARGS", "since cannot be later than until");
    }

    const timeZone = await resolveTimeZone(connection, runtimeMetadata);

    const [board] = await connection.db.execute<{ exists: number }>(sql`
      SELECT 1 AS exists FROM hub_boards WHERE user_id = ${userId} AND board_id = ${input.board_id}
    `);
    if (!board) {
      throw new ToolError("NOT_FOUND", "Board not found for this principal");
    }

    if (input.list_name) {
      const [list] = await connection.db.execute<{ exists: number }>(sql`
        SELECT 1 AS exists FROM hub_lists WHERE user_id = ${userId} AND board_id = ${input.board_id} AND list_name = ${input.list_name}
      `);
      if (!list) {
        throw new ToolError("NOT_FOUND", "List not found for this board");
      }
    }

    if (input.assignee_id) {
      const [member] = await connection.db.execute<{ exists: number }>(sql`
        SELECT 1 AS exists FROM hub_members WHERE user_id = ${userId} AND board_id = ${input.board_id} AND member_id = ${input.assignee_id}
      `);
      if (!member) {
        throw new ToolError("NOT_FOUND", "Assignee not found for this board");
      }
    }

    const rows = await connection.db.execute<{
      id: string;
      board_id: string;
      title: string;
      list_name: string;
    }>(sql`
      SELECT c.card_id AS id, c.board_id, c.title, c.list_name
      FROM hub_cards c
      WHERE c.user_id = ${userId} AND c.board_id = ${input.board_id}
        AND (${input.list_name ?? null}::text IS NULL OR c.list_name = ${input.list_name ?? null})
        AND (${input.assignee_id ?? null}::text IS NULL OR c.assignee_id = ${input.assignee_id ?? null})
        AND (${input.since ?? null}::date IS NULL OR c.updated_at >= (${input.since ?? null}::date::timestamp AT TIME ZONE ${timeZone}))
        AND (${input.until ?? null}::date IS NULL OR c.updated_at < ((${input.until ?? null}::date + 1)::timestamp AT TIME ZONE ${timeZone}))
      ORDER BY c.updated_at ASC, c.card_id COLLATE "C" ASC LIMIT 1001
    `);

    if (rows.length > 1000) {
      throw new ToolError(
        "LIMIT_EXCEEDED",
        "list_cards exceeds 1000 results; narrow the filters",
      );
    }

    const result = outputs.list_cards.safeParse({
      cards: rows,
      count: rows.length,
    });
    if (!result.success) {
      throw new ToolError(
        "INTERNAL_ERROR",
        "Stored card data failed the output contract",
      );
    }
    return result.data;
  }

  throw new ToolError("BAD_ARGS", `Unsupported card read tool: ${name}`);
}

export type ReceiverTx = Parameters<
  Parameters<Database["db"]["transaction"]>[0]
>[0];

export type CardWriteName = "create_card" | "move_card";

export function isCardWriteName(name: ToolName): name is CardWriteName {
  return name === "create_card" || name === "move_card";
}

export async function writeCardTool(
  tx: ReceiverTx,
  userId: string,
  name: CardWriteName,
  args: unknown,
  assertLive: () => Promise<void>,
): Promise<Record<string, unknown>> {
  if (name === "create_card") {
    const input = inputs.create_card.parse(args);

    const [board] = await tx.execute<{ exists: number }>(sql`
      SELECT 1 AS exists FROM hub_boards
      WHERE user_id = ${userId} AND board_id = ${input.board_id}
      FOR KEY SHARE
    `);
    if (!board) {
      throw new ToolError("NOT_FOUND", "Board not found for this principal");
    }

    const [list] = await tx.execute<{ exists: number }>(sql`
      SELECT 1 AS exists FROM hub_lists
      WHERE user_id = ${userId} AND board_id = ${input.board_id} AND list_name = ${input.list_name}
      FOR KEY SHARE
    `);
    if (!list) {
      throw new ToolError("NOT_FOUND", "List not found for this board");
    }

    if (input.assignee_id) {
      const [member] = await tx.execute<{ exists: number }>(sql`
        SELECT 1 AS exists FROM hub_members
        WHERE user_id = ${userId} AND board_id = ${input.board_id} AND member_id = ${input.assignee_id}
        FOR KEY SHARE
      `);
      if (!member) {
        throw new ToolError("NOT_FOUND", "Assignee not found for this board");
      }
    }

    await assertLive();

    const [created] = await tx.execute<{ id: string }>(sql`
      INSERT INTO hub_cards(user_id, board_id, list_name, title, description, due_date, assignee_id)
      VALUES (${userId}, ${input.board_id}, ${input.list_name}, ${input.title},
              ${input.description ?? ""}, ${input.due_date ?? null}::date, ${input.assignee_id ?? null})
      RETURNING card_id AS id
    `);
    if (!created) {
      throw new ToolError("INTERNAL_ERROR", "Card insert returned no ID");
    }
    return { id: created.id };
  }

  if (name === "move_card") {
    const input = inputs.move_card.parse(args);

    const [card] = await tx.execute<{
      card_id: string;
      board_id: string;
      list_name: string;
      updated_at: string;
    }>(sql`
      SELECT card_id, board_id, list_name, updated_at::text
      FROM hub_cards
      WHERE user_id = ${userId} AND card_id = ${input.card_id}
      FOR UPDATE
    `);
    if (!card) {
      throw new ToolError("NOT_FOUND", "Card not found for this principal");
    }

    const [list] = await tx.execute<{ exists: number }>(sql`
      SELECT 1 AS exists
      FROM hub_lists
      WHERE user_id = ${userId} AND board_id = ${card.board_id} AND list_name = ${input.target_list}
      FOR KEY SHARE
    `);
    if (!list) {
      throw new ToolError(
        "NOT_FOUND",
        "Target list does not exist in the card's board",
      );
    }

    await assertLive();

    if (card.list_name !== input.target_list) {
      await tx.execute(sql`
        UPDATE hub_cards
        SET list_name = ${input.target_list}, updated_at = clock_timestamp()
        WHERE user_id = ${userId} AND card_id = ${input.card_id}
      `);
    }

    return { id: input.card_id, list_name: input.target_list };
  }

  throw new ToolError("BAD_ARGS", `Unsupported card write tool: ${name}`);
}
