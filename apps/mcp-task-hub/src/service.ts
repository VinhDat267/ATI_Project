import { z } from "zod";
import {
  type Database,
  sheets,
  messages,
  receipts,
  channels,
  sql,
  eq,
  and,
} from "@wap/db";
import { PreviewActionSchema } from "@wap/dsl";
import {
  AuthorizationSchema,
  inputs,
  outputs,
  POLICY_VERSION,
  type ToolName,
} from "./contracts.js";
import { writeFingerprint } from "./fingerprint.js";
import { ToolError } from "./errors.js";
import {
  isCardReadName,
  readCardTool,
  isCardWriteName,
  writeCardTool,
} from "./cards.js";

export { ToolError };
const deny = (message = "Approval, operation or payload is not valid") =>
  new ToolError("NOT_AUTHORIZED", message);

function parseRange(range: string) {
  const match = /^([^!]+)!([A-Z]{1,3})([1-9]\d*):([A-Z]{1,3})([1-9]\d*)$/.exec(
    range,
  );
  if (!match)
    throw new ToolError(
      "BAD_RANGE",
      "Use a bounded A1 range such as Progress!A1:B2",
    );
  const column = (s: string) =>
    [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const c1 = column(match[2]!),
    c2 = column(match[4]!),
    r1 = Number(match[3]) - 1,
    r2 = Number(match[5]) - 1;
  if (
    !Number.isSafeInteger(r2) ||
    r2 < r1 ||
    c2 < c1 ||
    r2 - r1 >= 1000 ||
    c2 - c1 >= 100
  )
    throw new ToolError(
      "BAD_RANGE",
      "Range must be forward and at most 1000 rows × 100 columns",
    );
  return { sheet: match[1]!, c1, c2, r1, r2 };
}

export class TaskHub {
  constructor(
    private readonly connection: Database,
    private readonly userId: string,
  ) {
    z.uuid().parse(userId);
  }

  async call(
    name: ToolName,
    args: unknown,
    metadata: unknown,
    runtimeMetadata?: unknown,
  ): Promise<{ output: Record<string, unknown>; replayed: boolean }> {
    if (isCardReadName(name)) {
      const output = await readCardTool(
        this.connection,
        this.userId,
        name,
        args,
        runtimeMetadata,
      );
      return { output, replayed: false };
    }
    if (name === "read_sheet_range") {
      const input = inputs.read_sheet_range.parse(args),
        range = parseRange(input.range);
      const [sheet] = await this.connection.db
        .select()
        .from(sheets)
        .where(
          and(
            eq(sheets.userId, this.userId),
            eq(sheets.workbookId, input.spreadsheet_id),
            eq(sheets.sheetName, range.sheet),
          ),
        );
      if (!sheet)
        throw new ToolError(
          "NOT_FOUND",
          "Local sheet not found for this principal",
        );
      const stored = z.array(z.array(z.string())).parse(sheet.cells);
      const values = stored
        .slice(range.r1, range.r2 + 1)
        .map((row) =>
          Array.from(
            { length: range.c2 - range.c1 + 1 },
            (_, i) => row[range.c1 + i] ?? "",
          ),
        );
      return {
        output: outputs.read_sheet_range.parse({
          values,
          row_count: values.length,
        }),
        replayed: false,
      };
    }
    const input = inputs[name].parse(args);
    const auth = AuthorizationSchema.safeParse(metadata);
    if (!auth.success)
      throw deny("Write requires controller approval metadata");
    const hash = writeFingerprint(name, input);
    return this.connection.db.transaction(async (tx) => {
      // Lock control state first. A concurrent cancel/replan cannot revoke it halfway through this local mutation.
      const [gate] = await tx.execute<{
        decision: string;
        preview: { actions: unknown };
        snapshot_hash: string;
        run_id: string;
        approval_version: string;
        current_version: string;
        status: string;
      }>(sql`SELECT a.decision,a.preview,a.snapshot_hash,a.run_id,a.workflow_version_id AS approval_version,
        r.workflow_version_id AS current_version,r.status
        FROM approvals a JOIN runs r ON r.id=a.run_id
        WHERE a.id=${auth.data.approval_id} AND r.user_id=${this.userId} FOR UPDATE OF r,a`);
      if (
        !gate ||
        gate.decision !== "approved" ||
        gate.status !== "running" ||
        gate.snapshot_hash !== auth.data.snapshot_hash ||
        gate.approval_version !== gate.current_version
      )
        throw deny();
      const [operation] = await tx.execute<{
        run_id: string;
        workflow_version_id: string;
        step_id: string;
        tool_server: string;
        tool_name: string;
        policy_version: string;
        payload_hash: string;
        resolved_args: unknown;
        state: string;
      }>(
        sql`SELECT * FROM tool_operations WHERE operation_id=${auth.data.operation_id} AND user_id=${this.userId} FOR UPDATE`,
      );
      if (
        !operation ||
        operation.run_id !== gate.run_id ||
        operation.workflow_version_id !== gate.current_version ||
        operation.tool_server !== "task_hub" ||
        operation.tool_name !== name ||
        operation.policy_version !== POLICY_VERSION ||
        operation.payload_hash !== hash ||
        writeFingerprint(name, operation.resolved_args) !== hash
      )
        throw deny();
      const actions = z
        .array(PreviewActionSchema)
        .safeParse(gate.preview.actions);
      const action = actions.success
        ? actions.data.find((a) => a.operation_id === auth.data.operation_id)
        : undefined;
      if (
        !action ||
        action.step_id !== operation.step_id ||
        action.server !== "task_hub" ||
        action.tool !== name ||
        action.policy_version !== POLICY_VERSION ||
        action.payload_hash !== hash ||
        writeFingerprint(name, action.resolved_args) !== hash
      )
        throw deny();
      // Evaluate DB time AFTER waiting for locks; an approval may expire while waiting.
      const assertLive = async () => {
        const [fresh] = await tx.execute<{ live: boolean }>(
          sql`SELECT expires_at>clock_timestamp() AS live FROM approvals WHERE id=${auth.data.approval_id}`,
        );
        if (!fresh?.live) throw deny("Approval expired");
      };
      await assertLive();
      const [receipt] = await tx
        .select()
        .from(receipts)
        .where(
          and(
            eq(receipts.userId, this.userId),
            eq(receipts.operationId, auth.data.operation_id),
          ),
        );
      if (receipt) {
        if (
          receipt.payloadHash !== hash ||
          receipt.toolName !== name ||
          receipt.policyVersion !== POLICY_VERSION
        )
          throw deny("Operation payload conflicts with its receipt");
        const parsed = outputs[name].safeParse(receipt.result);
        if (!parsed.success) {
          throw new ToolError(
            "INTERNAL_ERROR",
            "Stored receipt result failed the output contract",
          );
        }
        return { output: parsed.data, replayed: true };
      }
      if (operation.state !== "in_flight")
        throw deny(
          "Controller must claim the operation before dispatch; unknown writes require reconciliation",
        );

      let output: Record<string, unknown>;
      if (name === "append_sheet_rows") {
        const append = inputs.append_sheet_rows.parse(input);
        const [sheet] = await tx
          .select()
          .from(sheets)
          .where(
            and(
              eq(sheets.userId, this.userId),
              eq(sheets.workbookId, append.spreadsheet_id),
              eq(sheets.sheetName, append.sheet_name),
            ),
          )
          .for("update");
        if (!sheet)
          throw new ToolError("NOT_FOUND", "Destination sheet does not exist");
        const existing = z.array(z.array(z.string())).parse(sheet.cells);
        await assertLive(); // The sheet lock may have waited past the approval TTL.
        await tx
          .update(sheets)
          .set({ cells: [...existing, ...append.rows] })
          .where(
            and(
              eq(sheets.userId, this.userId),
              eq(sheets.workbookId, append.spreadsheet_id),
              eq(sheets.sheetName, append.sheet_name),
            ),
          );
        output = { appended_count: append.rows.length };
      } else if (name === "send_slack_message") {
        const message = inputs.send_slack_message.parse(input);
        const [channel] = await tx
          .select()
          .from(channels)
          .where(
            and(
              eq(channels.userId, this.userId),
              eq(channels.channel, message.channel),
            ),
          );
        if (!channel)
          throw new ToolError("NOT_FOUND", "Local channel does not exist");
        if (message.thread_ts) {
          const [parent] = await tx
            .select()
            .from(messages)
            .where(
              and(
                eq(messages.id, message.thread_ts),
                eq(messages.userId, this.userId),
                eq(messages.channel, message.channel),
              ),
            );
          if (!parent)
            throw new ToolError(
              "NOT_FOUND",
              "Thread must belong to the same principal and local channel",
            );
        }
        await assertLive();
        const [created] = await tx
          .insert(messages)
          .values({
            userId: this.userId,
            channel: message.channel,
            text: message.text,
            threadId: message.thread_ts ?? null,
          })
          .returning();
        output = {
          id: created!.id,
          channel: created!.channel,
          text: created!.text,
        };
      } else if (isCardWriteName(name)) {
        output = await writeCardTool(tx, this.userId, name, input, assertLive);
      } else {
        throw new ToolError("BAD_ARGS", "Tool is not enabled");
      }
      // Validation and receipt insert belong to the same transaction as the mutation.
      const checkedResult = outputs[name].safeParse(output);
      if (!checkedResult.success) {
        throw new ToolError(
          "INTERNAL_ERROR",
          "Write output failed the output contract",
        );
      }
      const checked = checkedResult.data;
      await tx.insert(receipts).values({
        userId: this.userId,
        operationId: auth.data.operation_id,
        toolName: name,
        policyVersion: POLICY_VERSION,
        payloadHash: hash,
        result: checked,
      });
      await assertLive(); // Roll back both writes if later DB work waited past expiry.
      return { output: checked, replayed: false };
    });
  }
}
