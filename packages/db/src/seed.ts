import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./connection.js";
import { sheets, channels, boards, boardLists, boardMembers, cards } from "./schema.js";
export const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";
export async function seedDemo(connection: Database, userId = DEMO_USER_ID) {
  z.uuid().parse(userId);
  await connection.db.transaction(async (tx) => {
    await tx.execute(sql`INSERT INTO users (id,email,password_hash,display_name)
      VALUES (${userId},${`g1-${userId}@local.invalid`},'LOCAL_DEMO_LOGIN_DISABLED','G1 local demo') ON CONFLICT (id) DO NOTHING`);
    await tx
      .insert(sheets)
      .values([
        {
          userId,
          workbookId: "source",
          sheetName: "Progress",
          cells: [
            ["API", "Done"],
            ["UI", "Doing"],
          ],
        },
        { userId, workbookId: "dest", sheetName: "Report", cells: [] },
      ])
      .onConflictDoNothing();
    await tx
      .insert(channels)
      .values([
        { userId, channel: "#team" },
        { userId, channel: "#ops" },
      ])
      .onConflictDoNothing();
    await tx
      .insert(boards)
      .values([{ userId, boardId: "board_a", name: "ATI Project" }])
      .onConflictDoNothing();
    await tx
      .insert(boardLists)
      .values([
        { userId, boardId: "board_a", listName: "Backlog", position: 0, isDone: false },
        { userId, boardId: "board_a", listName: "Doing", position: 1, isDone: false },
        { userId, boardId: "board_a", listName: "Done", position: 2, isDone: true },
      ])
      .onConflictDoNothing();
    await tx
      .insert(boardMembers)
      .values([
        { userId, boardId: "board_a", memberId: "m1", name: "An" },
        { userId, boardId: "board_a", memberId: "m2", name: "Bình" },
      ])
      .onConflictDoNothing();
    await tx
      .insert(cards)
      .values([
        {
          userId,
          cardId: "c1",
          boardId: "board_a",
          listName: "Doing",
          title: "Viết API",
          description: "API demo local",
          assigneeId: "m1",
          dueDate: null,
          createdAt: new Date("2026-09-14T02:00:00Z"),
          updatedAt: new Date("2026-09-14T02:00:00Z"),
        },
        {
          userId,
          cardId: "c2",
          boardId: "board_a",
          listName: "Done",
          title: "Kiểm thử",
          description: "",
          assigneeId: "m1",
          dueDate: null,
          createdAt: new Date("2026-09-15T03:00:00Z"),
          updatedAt: new Date("2026-09-15T03:00:00Z"),
        },
      ])
      .onConflictDoNothing();
  });
  return { user_id: userId };
}
