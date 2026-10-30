import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifySlackSignature } from '../../src/services/slack/slack-signature.js';

const SECRET = 'slack-signing-secret-04a';
const NOW_MS = 1_730_214_000_500;
const NOW_SECONDS = 1_730_214_000;

function sign(raw: Buffer, secret = SECRET, timestamp = String(NOW_SECONDS)): string {
  return `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:`).update(raw).digest('hex')}`;
}

function verify(body: Buffer, headers: { signature?: string | null; timestamp?: string | null } = {}) {
  return verifySlackSignature({
    signatureHeader: 'signature' in headers ? headers.signature ?? undefined : sign(body),
    timestampHeader: 'timestamp' in headers ? headers.timestamp ?? undefined : String(NOW_SECONDS),
    rawBody: body,
    signingSecret: SECRET,
    nowMs: NOW_MS,
  });
}

describe('verifySlackSignature (SLACK-04A)', () => {
  it('T2.1: accepts a v0 HMAC computed over the exact raw bytes', () => {
    const body = Buffer.from(
      JSON.stringify({ type: 'event_callback', event_id: 'Ev04A', event: { type: 'message', ts: '1730214000.000100' } }),
      'utf8'
    );
    const result = verify(body);
    expect(result).toEqual({ ok: true, timestamp: NOW_SECONDS });
  });

  it('T2.2: hashes raw bytes, never a UTF-8 round-trip (Vietnamese text and invalid bytes)', () => {
    const body = Buffer.concat([
      Buffer.from('{"type":"event_callback","event":{"text":"Xin chào Việt Nam — đã xoá 🚀"}}', 'utf8'),
      Buffer.from([0x80, 0x81, 0xff, 0xfe]),
    ]);

    expect(verify(body)).toEqual({ ok: true, timestamp: NOW_SECONDS });

    const decoded = Buffer.from(body.toString('utf8'), 'utf8');
    expect(decoded.equals(body)).toBe(false);
    const decodedSignature = sign(decoded);
    const result = verify(body, { signature: decodedSignature });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.code).toBe('INVALID_SIGNATURE');
    }
  });

  it('T2.3: rejects missing or malformed signature headers without a RangeError', () => {
    const body = Buffer.from('{"type":"url_verification","challenge":"abc"}', 'utf8');
    const malformed = [
      undefined,
      '',
      'v0=',
      'v0=abcd',
      'v0=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
      `v0=${'a'.repeat(63)}`,
      `v0=${'a'.repeat(65)}`,
      `v0=${'A'.repeat(64)}`,
      `v1=${'a'.repeat(64)}`,
      `v0=${createHmac('sha256', SECRET).update('v0:1730214000:x').digest('hex')},v0=${'a'.repeat(64)}`,
      null,
    ];

    for (const signature of malformed) {
      let result: ReturnType<typeof verify> | undefined;
      expect(() => {
        result = verify(body, { signature });
      }).not.toThrow();
      expect(result?.ok).toBe(false);
      if (result && !result.ok) {
        expect(result.status).toBe(401);
        expect(result.code).toBe('MALFORMED_HEADER');
        expect(result.error).not.toContain(SECRET);
        expect(result.error).not.toContain('url_verification');
      }
    }
  });

  it('T2.3b: rejects missing or malformed timestamp headers', () => {
    const body = Buffer.from('{"type":"url_verification","challenge":"abc"}', 'utf8');
    for (const timestamp of [undefined, null, '', '  1730214000', '1730214000 ', '+1730214000', '1730214000.0', '-1730214000']) {
      let result: ReturnType<typeof verify> | undefined;
      expect(() => {
        result = verify(body, { timestamp });
      }).not.toThrow();
      expect(result?.ok).toBe(false);
      if (result && !result.ok) {
        expect(result.status === 400 || result.status === 401).toBe(true);
        expect(['MALFORMED_HEADER', 'INVALID_TIMESTAMP']).toContain(result.code);
      }
    }
  });

  it('T2.4: enforces /^\\d{1,10}$/ and a 300 second freshness window', () => {
    const body = Buffer.from('{"type":"url_verification","challenge":"abc"}', 'utf8');
    const junk = [
      '1730214000abc',
      '17302140001',
      '01730214000 ',
      '0x1730214000',
      '1e9',
      '1730214000\n',
      '١730214000',
      '1730214000.000100',
    ];
    for (const timestamp of junk) {
      const result = verify(body, { timestamp, signature: sign(body, SECRET, timestamp) });
      expect(result.ok).toBe(false);
      if (result && !result.ok) {
        expect(result.status).toBe(400);
        expect(result.code).toBe('INVALID_TIMESTAMP');
      }
    }

    const atLimit = verify(body, { timestamp: String(NOW_SECONDS - 300), signature: sign(body, SECRET, String(NOW_SECONDS - 300)) });
    expect(atLimit.ok).toBe(true);
    const futureLimit = verify(body, { timestamp: String(NOW_SECONDS + 300), signature: sign(body, SECRET, String(NOW_SECONDS + 300)) });
    expect(futureLimit.ok).toBe(true);

    const stale = verify(body, { timestamp: '1730213699' });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.status).toBe(400);
      expect(stale.code).toBe('INVALID_TIMESTAMP');
    }
    const future = verify(body, { timestamp: '1730214301' });
    expect(future.ok).toBe(false);
    if (!future.ok) {
      expect(future.status).toBe(400);
      expect(future.code).toBe('INVALID_TIMESTAMP');
    }
  });

  it('T2.5: a well-formed but wrong signature is INVALID_SIGNATURE and constant-time compared', () => {
    const body = Buffer.from('{"type":"event_callback"}', 'utf8');
    const wrong = `v0=${'0'.repeat(64)}`;
    const result = verify(body, { signature: wrong });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.code).toBe('INVALID_SIGNATURE');
    }

    const otherSecret = verify(body, { signature: sign(body, 'other-secret') });
    expect(otherSecret.ok).toBe(false);
  });

  it('T2.6: rejects a non-Buffer body and a missing signing secret as programmer errors', () => {
    expect(() =>
      verifySlackSignature({
        signatureHeader: `v0=${'a'.repeat(64)}`,
        timestampHeader: String(NOW_SECONDS),
        rawBody: 'not-a-buffer' as unknown as Buffer,
        signingSecret: SECRET,
        nowMs: NOW_MS,
      })
    ).toThrow(TypeError);
    expect(() =>
      verifySlackSignature({
        signatureHeader: `v0=${'a'.repeat(64)}`,
        timestampHeader: String(NOW_SECONDS),
        rawBody: Buffer.from('{}'),
        signingSecret: '',
        nowMs: NOW_MS,
      })
    ).toThrow(TypeError);
  });
});
