import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const CursorPayloadSchema = z
  .object({
    v: z.literal(1),
    snapshot_id: z.uuid(),
    run_id: z.uuid(),
    user_id: z.uuid(),
    offset: z.number().int().nonnegative().multipleOf(100).max(10_000),
  })
  .strict();
type CursorPayload = z.infer<typeof CursorPayloadSchema>;

const sign = (value: string, key: Buffer) =>
  createHmac("sha256", key).update(value).digest("base64url");

export function encodeTraceCursor(
  payload: Omit<CursorPayload, "v">,
  key: Buffer,
): string {
  const body = Buffer.from(
    JSON.stringify(CursorPayloadSchema.parse({ v: 1, ...payload })),
  ).toString("base64url");
  return `${body}.${sign(body, key)}`;
}

export function decodeTraceCursor(
  value: string,
  key: Buffer,
  binding: { runId: string; userId: string },
): CursorPayload {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value))
    throw new Error("Invalid trace cursor");
  const [body, signature] = value.split(".");
  const expected = sign(body!, key);
  if (
    signature!.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature!), Buffer.from(expected))
  )
    throw new Error("Invalid trace cursor");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid trace cursor");
  }
  const cursor = CursorPayloadSchema.parse(parsed);
  if (cursor.run_id !== binding.runId || cursor.user_id !== binding.userId)
    throw new Error("Invalid trace cursor binding");
  return cursor;
}
