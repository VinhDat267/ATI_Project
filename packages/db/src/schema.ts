/** SQL migrations remain authoritative. Only the receiver's tables are mapped here. */
import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  date,
  integer,
  boolean,
  primaryKey,
} from "drizzle-orm/pg-core";
export const sheets = pgTable(
  "hub_sheets",
  {
    userId: uuid("user_id").notNull(),
    workbookId: text("workbook_id").notNull(),
    sheetName: text("sheet_name").notNull(),
    cells: jsonb("cells").$type<string[][]>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.workbookId, t.sheetName] })],
);
export const channels = pgTable(
  "hub_channels",
  {
    userId: uuid("user_id").notNull(),
    channel: text("channel").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.channel] })],
);
export const messages = pgTable("hub_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  channel: text("channel").notNull(),
  text: text("text").notNull(),
  threadId: uuid("thread_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const receipts = pgTable(
  "hub_receipts",
  {
    userId: uuid("user_id").notNull(),
    operationId: uuid("operation_id").notNull(),
    toolName: text("tool_name").notNull(),
    policyVersion: text("policy_version").notNull(),
    payloadHash: text("payload_hash").notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.operationId] })],
);

export const boards = pgTable(
  "hub_boards",
  {
    userId: uuid("user_id").notNull(),
    boardId: text("board_id").notNull(),
    name: text("name").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.boardId] })],
);

export const boardLists = pgTable(
  "hub_lists",
  {
    userId: uuid("user_id").notNull(),
    boardId: text("board_id").notNull(),
    listName: text("list_name").notNull(),
    position: integer("position").default(0).notNull(),
    isDone: boolean("is_done").default(false).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.boardId, t.listName] })],
);

export const boardMembers = pgTable(
  "hub_members",
  {
    userId: uuid("user_id").notNull(),
    boardId: text("board_id").notNull(),
    memberId: text("member_id").notNull(),
    name: text("name").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.boardId, t.memberId] })],
);

export const cards = pgTable(
  "hub_cards",
  {
    userId: uuid("user_id").notNull(),
    cardId: text("card_id").notNull(),
    boardId: text("board_id").notNull(),
    listName: text("list_name").notNull(),
    title: text("title").notNull(),
    description: text("description").default("").notNull(),
    dueDate: date("due_date", { mode: "string" }),
    assigneeId: text("assignee_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.cardId] })],
);

