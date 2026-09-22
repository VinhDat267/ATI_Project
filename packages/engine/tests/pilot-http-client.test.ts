import { expect, it, describe, vi, afterEach } from 'vitest';
import {
  pilotFetch,
  PilotHttpError,
  type PilotFetchOptions,
} from '../src/pilot/http-client.js';

describe('pilot/http-client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('performs successful GET request and parses JSON data', async () => {
    const mockResponse = { id: 'card-1', name: 'Task' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await pilotFetch<typeof mockResponse>('https://api.trello.com/1/cards/card-1');
    expect(res.status).toBe(200);
    expect(res.data).toEqual(mockResponse);
  });

  it('redacts secrets and query params from error message and URL', async () => {
    const secret = 'secret-key-12345';
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Invalid Token provided', { status: 401 }),
    );

    const promise = pilotFetch(
      `https://api.trello.com/1/cards?key=${secret}&token=secret-token-999`,
      { method: 'GET' },
      { secrets: [secret, 'secret-token-999'] },
    );

    await expect(promise).rejects.toThrow(PilotHttpError);
    try {
      await promise;
    } catch (err) {
      const httpErr = err as PilotHttpError;
      expect(httpErr.statusCode).toBe(401);
      expect(httpErr.url).not.toContain(secret);
      expect(httpErr.url).not.toContain('secret-token-999');
      expect(httpErr.url).toContain('[REDACTED]');
      expect(httpErr.message).not.toContain(secret);
    }
  });

  it('retries on transient errors for GET requests', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Server Unavailable', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const res = await pilotFetch(
      'https://api.trello.com/1/lists',
      { method: 'GET' },
      { retries: 2, retryDelayMs: 10 },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
  });

  it('does NOT retry POST write requests on server error', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Internal Error', { status: 500 }));

    const promise = pilotFetch(
      'https://api.trello.com/1/cards',
      { method: 'POST', body: JSON.stringify({ name: 'card' }) },
      { retries: 3, retryDelayMs: 10 },
    );

    await expect(promise).rejects.toThrow(PilotHttpError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('handles timeout cleanly and flags isTimeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          setTimeout(() => reject(err), 10);
        }),
    );

    const promise = pilotFetch('https://api.trello.com/1/timeout', {}, { timeoutMs: 5 });

    await expect(promise).rejects.toThrow(PilotHttpError);
    try {
      await promise;
    } catch (err) {
      const httpErr = err as PilotHttpError;
      expect(httpErr.isTimeout).toBe(true);
      expect(httpErr.statusCode).toBe(0);
    }
  });

  it('rejects immediately with RESPONSE_TOO_LARGE when content-length exceeds maxResponseBytes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('small text', {
        status: 200,
        headers: {
          'Content-Length': String(10 * 1024 * 1024), // 10MB
        },
      }),
    );

    const promise = pilotFetch(
      'https://api.trello.com/1/large',
      {},
      { maxResponseBytes: 5 * 1024 * 1024 },
    );

    await expect(promise).rejects.toThrow(PilotHttpError);
    await expect(promise).rejects.toThrow('RESPONSE_TOO_LARGE');
  });

  it('throws PilotHttpError with INVALID_REMOTE_RESPONSE when JSON is malformed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{ invalid json body ...', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const promise = pilotFetch('https://api.trello.com/1/bad-json');

    await expect(promise).rejects.toThrow(PilotHttpError);
    await expect(promise).rejects.toThrow('INVALID_REMOTE_RESPONSE');
  });
});
