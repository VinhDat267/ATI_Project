import { redactSecrets } from './config.js';

export class PilotHttpError extends Error {
  statusCode: number;
  isTimeout: boolean;
  isNetworkError: boolean;
  url: string;
  responseBody?: string;

  constructor(options: {
    message: string;
    statusCode?: number;
    isTimeout?: boolean;
    isNetworkError?: boolean;
    url: string;
    responseBody?: string;
  }) {
    super(options.message);
    this.name = 'PilotHttpError';
    this.statusCode = options.statusCode ?? 0;
    this.isTimeout = options.isTimeout ?? false;
    this.isNetworkError = options.isNetworkError ?? false;
    this.url = options.url;
    this.responseBody = options.responseBody;
  }
}

export type PilotFetchOptions = {
  timeoutMs?: number;
  maxResponseBytes?: number;
  retries?: number;
  retryDelayMs?: number;
  secrets?: (string | undefined | null)[];
};

export type PilotHttpResponse<T = unknown> = {
  status: number;
  statusText: string;
  headers: Headers;
  data: T;
  rawText: string;
};

export async function pilotFetch<T = unknown>(
  url: string,
  init?: RequestInit,
  options?: PilotFetchOptions,
): Promise<PilotHttpResponse<T>> {
  const timeoutMs = options?.timeoutMs ?? 30000;
  const maxBytes = options?.maxResponseBytes ?? 5 * 1024 * 1024; // 5MB
  const maxRetries = options?.retries ?? 0;
  const retryDelayMs = options?.retryDelayMs ?? 500;
  const secrets = options?.secrets ?? [];

  const method = (init?.method ?? 'GET').toUpperCase();
  const isIdempotent = method === 'GET' || method === 'HEAD';

  let attempt = 0;

  while (true) {
    attempt++;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const rawText = await response.text();
      if (rawText.length > maxBytes) {
        throw new Error('RESPONSE_TOO_LARGE: Exceeded max allowed bytes');
      }

      if (!response.ok) {
        const isTransient = [429, 502, 503, 504].includes(response.status);
        if (isIdempotent && isTransient && attempt <= maxRetries) {
          await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
          continue;
        }

        const safeUrl = redactSecrets(url, secrets);
        const safeBody = redactSecrets(rawText, secrets);
        throw new PilotHttpError({
          message: `HTTP ${response.status} ${response.statusText} for ${safeUrl}: ${safeBody}`,
          statusCode: response.status,
          url: safeUrl,
          responseBody: safeBody,
        });
      }

      let data: T;
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json') || rawText.trim().startsWith('{') || rawText.trim().startsWith('[')) {
        try {
          data = JSON.parse(rawText) as T;
        } catch {
          data = rawText as unknown as T;
        }
      } else {
        data = rawText as unknown as T;
      }

      return {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data,
        rawText,
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);

      if (err instanceof PilotHttpError) {
        throw err;
      }

      const isAbort =
        (err as Error)?.name === 'AbortError' ||
        controller.signal.aborted;

      if (isIdempotent && attempt <= maxRetries && !isAbort) {
        await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
        continue;
      }

      const safeUrl = redactSecrets(url, secrets);
      const rawMessage = (err as Error)?.message ?? String(err);
      const safeMessage = redactSecrets(rawMessage, secrets);

      throw new PilotHttpError({
        message: isAbort
          ? `Request timeout (${timeoutMs}ms) for ${safeUrl}`
          : `Network error for ${safeUrl}: ${safeMessage}`,
        isTimeout: isAbort,
        isNetworkError: !isAbort,
        statusCode: 0,
        url: safeUrl,
      });
    }
  }
}
