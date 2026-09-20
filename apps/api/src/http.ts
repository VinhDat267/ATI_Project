import type { IncomingMessage, ServerResponse } from "node:http";

export const MAX_BODY_BYTES = 65_536;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

type RequestIterator = IncomingMessage & {
  iterator?: (options?: {
    destroyOnReturn?: boolean;
  }) => AsyncIterable<Uint8Array>;
};

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const mediaType = req.headers["content-type"]
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json")
    throw new HttpError(415, "UNSUPPORTED_MEDIA", "JSON request body required");
  const declared = req.headers["content-length"];
  if (
    declared &&
    /^(0|[1-9][0-9]*)$/.test(declared) &&
    Number(declared) > MAX_BODY_BYTES
  )
    throw new HttpError(413, "BODY_TOO_LARGE", "Request body exceeds 64 KiB");
  let bytes = 0;
  const chunks: Buffer[] = [];
  const source =
    (req as RequestIterator).iterator?.({ destroyOnReturn: false }) ?? req;
  for await (const raw of source) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES)
      throw new HttpError(413, "BODY_TOO_LARGE", "Request body exceeds 64 KiB");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Invalid JSON");
  }
}

export function writeJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
  requestId: string,
): void {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-request-id", requestId);
  response.end(body);
}

export function writeEmpty(
  response: ServerResponse,
  status: number,
  requestId: string,
): void {
  response.statusCode = status;
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-request-id", requestId);
  response.end();
}
