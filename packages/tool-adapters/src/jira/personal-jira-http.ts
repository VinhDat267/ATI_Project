import { StepError, type ErrorCategory } from '../base-adapter.js';
import { GlobalRateLimiter, waitWithSignal } from '../rate-limiter.js';

export interface JiraAccessTokenProvider {
  getAccessToken(
    optionsOrUserId?: { signal?: AbortSignal; forceRefresh?: boolean } | string,
    maybeOptions?: { signal?: AbortSignal; forceRefresh?: boolean }
  ): Promise<string>;
}

export interface PersonalJiraHttpConfig {
  apiBaseUrl?: string;
  userId: string;
  tokens: JiraAccessTokenProvider;
  fetchFn?: typeof fetch;
  rateLimiter?: GlobalRateLimiter;
  timeoutMs?: number;
}

export function createJiraStepError(
  category: ErrorCategory,
  statusCode?: number,
  customMessage?: string,
  retryable = false,
  details?: Record<string, unknown>
): StepError {
  const message = customMessage ?? (
    category === 'UNKNOWN'
      ? 'Jira write outcome is unknown; verify before writing again.'
      : 'Jira request failed: ' + category
  );
  return new StepError({
    category,
    statusCode,
    retryable,
    message,
    ...(details ? { details } : {}),
  });
}

export class PersonalJiraHttpTransport {
  private readonly apiBase: string;
  private readonly userId: string;
  private readonly tokens: JiraAccessTokenProvider;
  private readonly fetchFn: typeof fetch;
  private readonly rateLimiter?: GlobalRateLimiter;
  private readonly defaultTimeoutMs?: number;

  constructor(config: PersonalJiraHttpConfig) {
    this.apiBase = (config.apiBaseUrl ?? 'https://api.atlassian.com').trim().replace(/\/+$/, '');
    this.userId = config.userId;
    this.tokens = config.tokens;
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
    this.rateLimiter = config.rateLimiter;
    this.defaultTimeoutMs = config.timeoutMs;
  }

  async request(
    cloudId: string,
    path: string,
    writing: boolean,
    options?: { signal?: AbortSignal; method?: string; body?: unknown; timeoutMs?: number }
  ): Promise<any> {
    const preWriteDetails = { requestSent: false };
    const nonWritingDetails = writing ? undefined : preWriteDetails;
    const deadlineMs = options?.timeoutMs ?? this.defaultTimeoutMs ?? (writing ? 30_000 : 15_000);
    const deadlineSignal = AbortSignal.timeout(deadlineMs);
    const signal = options?.signal ? AbortSignal.any([options.signal, deadlineSignal]) : deadlineSignal;
    if (signal?.aborted) {
      throw createJiraStepError('NETWORK', undefined, 'Jira request cancelled before dispatch', false, preWriteDetails);
    }

    const limiterKey = 'myjira:' + this.userId + ':' + cloudId;
    if (this.rateLimiter) {
      try {
        const acquired = await this.rateLimiter.waitForSlot(limiterKey, 30_000, 50, signal);
        if (!acquired) {
          throw createJiraStepError('RATE_LIMIT', 429, 'Rate limiter slot timeout', !writing, preWriteDetails);
        }
      } catch (error) {
        if (signal?.aborted) {
          throw createJiraStepError('NETWORK', undefined, 'Jira request stopped before dispatch', false, preWriteDetails);
        }
        if (error instanceof StepError) {
          throw new StepError({
            category: error.category,
            statusCode: error.statusCode,
            retryable: error.retryable,
            message: error.message,
            details: { ...(error.details ?? {}), requestSent: false },
          });
        }
        throw createJiraStepError('RATE_LIMIT', 429, 'Rate limiter wait failed', !writing, preWriteDetails);
      }
    }

    if (signal?.aborted) {
      throw createJiraStepError('NETWORK', undefined, 'Jira request cancelled before dispatch', false, preWriteDetails);
    }

    const cleanPath = path.startsWith('/') ? path : '/' + path;
    const url = `${this.apiBase}/ex/jira/${cloudId}/rest/api/3${cleanPath}`;
    const method = options?.method ?? (options?.body !== undefined ? 'POST' : 'GET');
    let networkRetries = 0;
    let serverRetries = 0;
    let rateRetries = 0;
    let refreshed = false;
    let forceRefresh = false;

    for (;;) {
      if (signal?.aborted) {
        throw createJiraStepError('NETWORK', undefined, 'Jira request cancelled before dispatch', false, preWriteDetails);
      }

      let token: string;
      try {
        const provider = this.tokens as any;
        if (!provider || typeof provider.getAccessToken !== 'function') {
          throw createJiraStepError('VALIDATION', undefined, 'PersonalJiraAdapter requires a tokens provider', false, preWriteDetails);
        }
        token = provider.getAccessToken.length >= 2
          ? await provider.getAccessToken(this.userId, { signal, forceRefresh })
          : await provider.getAccessToken({ signal, forceRefresh });
        if (typeof token !== 'string' || !token.trim()) {
          throw createJiraStepError('AUTH_ERROR', 401, 'Jira token acquisition returned empty token', false, preWriteDetails);
        }
      } catch (err) {
        if (signal?.aborted) {
          throw createJiraStepError('NETWORK', undefined, 'Jira request cancelled during token refresh', false, preWriteDetails);
        }
        if (err instanceof StepError) {
          throw new StepError({
            category: err.category,
            statusCode: err.statusCode,
            retryable: err.retryable,
            message: err.message,
            details: { ...(err.details ?? {}), requestSent: false },
          });
        }
        throw createJiraStepError('AUTH_ERROR', 401, 'Jira token acquisition failed', false, preWriteDetails);
      }
      forceRefresh = false;

      if (signal?.aborted) {
        throw createJiraStepError('NETWORK', undefined, 'Jira request cancelled before dispatch', false, preWriteDetails);
      }

      let response: Response;
      try {
        response = await this.fetchFn(url, {
          method,
          signal,
          redirect: 'error',
          headers: {
            Accept: 'application/json',
            Authorization: 'Bearer ' + token,
            ...(options?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(options?.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        });
      } catch {
        if (writing) {
          throw createJiraStepError('UNKNOWN', undefined, 'Jira write outcome is unknown; verify before writing again.');
        }
        if (signal?.aborted) {
          throw createJiraStepError('NETWORK', undefined, 'Jira request aborted', false, nonWritingDetails);
        }
        if (networkRetries++ < 2) continue;
        throw createJiraStepError('NETWORK', undefined, 'Jira transport failed', false, nonWritingDetails);
      }

      let value: any;
      try {
        value = response.status === 204 ? {} : await response.json();
      } catch {
        if (response.ok) {
          throw createJiraStepError(writing ? 'UNKNOWN' : 'SERVER_ERROR', response.status, undefined, false, nonWritingDetails);
        }
      }

      if (response.status === 401) {
        if (!refreshed) {
          refreshed = true;
          forceRefresh = true;
          continue;
        }
        throw createJiraStepError('AUTH_ERROR', 401, undefined, false, nonWritingDetails);
      }

      if (
        !response.ok &&
        writing &&
        typeof value === 'object' &&
        value !== null &&
        typeof value.id === 'string' &&
        /^\d+$/.test(value.id)
      ) {
        throw createJiraStepError('UNKNOWN', response.status);
      }

      if (response.status === 403) {
        throw createJiraStepError('AUTH_ERROR', 403, undefined, false, nonWritingDetails);
      }

      if (response.status === 429) {
        if (!writing) {
          const raw = response.headers.get('Retry-After')?.trim();
          const delay = raw && /^\d+(?:\.\d+)?$/.test(raw)
            ? Number(raw) * 1000
            : raw ? Date.parse(raw) - Date.now() : NaN;
          if (rateRetries++ < 1 && Number.isFinite(delay) && delay >= 0 && delay <= 30000) {
            try {
              await waitWithSignal(delay, signal);
              continue;
            } catch {
              throw createJiraStepError('RATE_LIMIT', 429, 'Rate limit wait cancelled', false, nonWritingDetails);
            }
          }
        }
        throw createJiraStepError('RATE_LIMIT', 429, 'Rate limit exceeded', !writing, nonWritingDetails);
      }

      if (response.status === 404) {
        throw createJiraStepError('NOT_FOUND', 404, undefined, false, nonWritingDetails);
      }

      if (response.status >= 500) {
        if (writing) {
          throw createJiraStepError('UNKNOWN', response.status);
        }
        if (serverRetries++ < 1 && !signal?.aborted) {
          continue;
        }
        throw createJiraStepError('SERVER_ERROR', response.status, undefined, false, nonWritingDetails);
      }

      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          throw createJiraStepError('VALIDATION', response.status, undefined, false, nonWritingDetails);
        }
        throw createJiraStepError(writing ? 'UNKNOWN' : 'SERVER_ERROR', response.status, undefined, false, nonWritingDetails);
      }

      return value;
    }
  }
}
