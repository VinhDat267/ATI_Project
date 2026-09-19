export type ClientErrorKind = "http" | "network" | "protocol" | "aborted";

export interface ClientErrorOptions {
  message: string;
  kind: ClientErrorKind;
  status?: number;
  code?: string;
  requestId?: string;
  uncertain?: boolean;
  cause?: unknown;
}

export class ClientError extends Error {
  readonly kind: ClientErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly uncertain: boolean;

  constructor(options: ClientErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "ClientError";
    this.kind = options.kind;
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.uncertain = options.uncertain ?? false;
  }
}

export function isClientError(error: unknown): error is ClientError {
  return error instanceof ClientError;
}
