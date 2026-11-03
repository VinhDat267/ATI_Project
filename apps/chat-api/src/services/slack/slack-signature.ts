import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SlackSignatureInput {
  signatureHeader: string | undefined;
  timestampHeader: string | undefined;
  rawBody: Buffer;
  signingSecret: string;
  nowMs?: number;
}

export type SlackSignatureVerificationResult =
  | { ok: true; timestamp: number }
  | {
      ok: false;
      status: 400 | 401;
      code: 'INVALID_TIMESTAMP' | 'INVALID_SIGNATURE' | 'MALFORMED_HEADER';
      error: string;
    };

/** Slack signs with exactly 64 lowercase hex characters after the v0 prefix. */
const SIGNATURE_HEADER = /^v0=([0-9a-f]{64})$/;
/** Ten digits covers every current Slack epoch and rejects junk suffixes outright. */
const TIMESTAMP_HEADER = /^\d{1,10}$/;
const MAX_SKEW_SECONDS = 300;

/**
 * Verifies a Slack Events API request against its exact raw bytes.
 *
 * The HMAC is computed over `v0:<timestamp>:` + the raw Buffer handed to the HTTP layer,
 * never over a UTF-8 round-tripped string. Header shapes are validated before any
 * cryptographic work so timingSafeEqual can never receive mismatched lengths.
 */
export function verifySlackSignature(input: SlackSignatureInput): SlackSignatureVerificationResult {
  if (!input || typeof input !== 'object') throw new TypeError('Slack signature input must be an object');
  if (!Buffer.isBuffer(input.rawBody)) throw new TypeError('Slack signature rawBody must be a Buffer');
  if (typeof input.signingSecret !== 'string' || input.signingSecret.length === 0) {
    throw new TypeError('Slack signing secret must be a non-empty string');
  }
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) throw new TypeError('Slack signature nowMs must be finite');

  const timestampHeader = input.timestampHeader;
  if (typeof timestampHeader !== 'string' || timestampHeader.length === 0) {
    return { ok: false, status: 401, code: 'MALFORMED_HEADER', error: 'Missing Slack request timestamp header' };
  }
  if (!TIMESTAMP_HEADER.test(timestampHeader)) {
    return { ok: false, status: 400, code: 'INVALID_TIMESTAMP', error: 'Malformed Slack request timestamp header' };
  }
  const timestamp = Number(timestampHeader);
  if (Math.abs(Math.floor(nowMs / 1000) - timestamp) > MAX_SKEW_SECONDS) {
    return { ok: false, status: 400, code: 'INVALID_TIMESTAMP', error: 'Stale Slack request timestamp header' };
  }

  const signatureHeader = input.signatureHeader;
  if (typeof signatureHeader !== 'string' || signatureHeader.length === 0) {
    return { ok: false, status: 401, code: 'MALFORMED_HEADER', error: 'Missing Slack signature header' };
  }
  const match = SIGNATURE_HEADER.exec(signatureHeader);
  if (!match) {
    return { ok: false, status: 401, code: 'MALFORMED_HEADER', error: 'Malformed Slack signature header' };
  }

  const expected = createHmac('sha256', input.signingSecret)
    .update(`v0:${timestampHeader}:`)
    .update(input.rawBody)
    .digest();
  const provided = Buffer.from(match[1]!, 'hex');
  if (provided.length !== expected.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, status: 401, code: 'INVALID_SIGNATURE', error: 'Invalid Slack signature' };
  }

  return { ok: true, timestamp };
}
