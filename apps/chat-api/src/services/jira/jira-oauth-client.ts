import type { JiraOAuthConfig } from '../../config/env.js';

export type JiraOAuthErrorCode =
  | 'INVALID_CONFIG'
  | 'PROVIDER_RESPONSE'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_HTTP_ERROR'
  | 'REQUEST_ABORTED'
  | 'NETWORK_ERROR';

export class JiraOAuthError extends Error {
  readonly code: JiraOAuthErrorCode;
  readonly status?: number;

  constructor(message: string, code: JiraOAuthErrorCode, status?: number) {
    super(message);
    this.name = 'JiraOAuthError';
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      status: this.status,
    };
  }
}

export interface JiraOAuthClientOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export interface JiraAuthorizationUrlOptions {
  state: string;
  mode: 'identity' | 'authorize_sites';
}

export interface JiraTokensResult {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
  scopes: string[];
}

export interface JiraProfileResult {
  accountId: string;
}

export interface JiraAccessibleResource {
  id: string;
  name: string;
  url: string;
  scopes: string[];
}

const SAFE_CLOUD_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
const ATLASSIAN_SITE_HOSTNAME_REGEX =
  /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.atlassian\.net$/i;

function isLoopbackUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
  } catch {
    return false;
  }
}

export class JiraOAuthClient {
  private readonly config: JiraOAuthConfig;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly mode: 'live' | 'fixture';
  private readonly authUrl: string;
  private readonly tokenUrl: string;
  private readonly profileUrl: string;
  private readonly accessibleResourcesUrl: string;

  constructor(config: JiraOAuthConfig & { fetchFn?: typeof fetch }, options?: JiraOAuthClientOptions) {
    if (!config?.clientId?.trim()) {
      throw new JiraOAuthError('[INVALID_CONFIG] clientId is required', 'INVALID_CONFIG');
    }
    if (!config?.clientSecret?.trim()) {
      throw new JiraOAuthError('[INVALID_CONFIG] clientSecret is required', 'INVALID_CONFIG');
    }
    if (!config?.redirectUri?.trim()) {
      throw new JiraOAuthError('[INVALID_CONFIG] redirectUri is required', 'INVALID_CONFIG');
    }

    this.config = {
      clientId: config.clientId.trim(),
      clientSecret: config.clientSecret.trim(),
      redirectUri: config.redirectUri.trim(),
      mode: config.mode,
      fixtureBaseUrl: config.fixtureBaseUrl?.trim(),
      timeoutMs: config.timeoutMs,
    };

    this.fetchFn = options?.fetchFn ?? config.fetchFn ?? fetch;
    this.timeoutMs = options?.timeoutMs ?? config.timeoutMs ?? 10_000;
    this.mode = config.mode ?? 'live';

    if (this.mode === 'live') {
      if (config.fixtureBaseUrl?.trim()) {
        throw new JiraOAuthError('[INVALID_CONFIG] fixtureBaseUrl is strictly forbidden in live mode', 'INVALID_CONFIG');
      }
      this.authUrl = 'https://auth.atlassian.com/authorize';
      this.tokenUrl = 'https://auth.atlassian.com/oauth/token';
      this.profileUrl = 'https://api.atlassian.com/me';
      this.accessibleResourcesUrl = 'https://api.atlassian.com/oauth/token/accessible-resources';
    } else if (this.mode === 'fixture') {
      const baseUrl = config.fixtureBaseUrl?.trim();
      if (!baseUrl || !isLoopbackUrl(baseUrl)) {
        throw new JiraOAuthError(
          `[INVALID_CONFIG] fixtureBaseUrl must be a loopback URL (127.0.0.1 or localhost) in fixture mode: ${baseUrl}`,
          'INVALID_CONFIG'
        );
      }
      const cleanBase = baseUrl.replace(/\/+$/, '');
      this.authUrl = `${cleanBase}/authorize`;
      this.tokenUrl = `${cleanBase}/oauth/token`;
      this.profileUrl = `${cleanBase}/me`;
      this.accessibleResourcesUrl = `${cleanBase}/oauth/token/accessible-resources`;
    } else {
      throw new JiraOAuthError(`[INVALID_CONFIG] Unsupported mode: ${this.mode}`, 'INVALID_CONFIG');
    }
  }

  private redact(text: string, extraSecrets: string[] = []): string {
    let result = text;
    if (this.config.clientSecret) {
      result = result.replaceAll(this.config.clientSecret, '[REDACTED_SECRET]');
    }
    for (const secret of extraSecrets) {
      if (secret && secret.length > 0) {
        result = result.replaceAll(secret, '[REDACTED_TOKEN]');
      }
    }
    return result;
  }

  get clientId(): string {
    return this.config.clientId;
  }

  authorizationUrl(options: JiraAuthorizationUrlOptions): string {
    if (!options?.state) {
      throw new JiraOAuthError('[INVALID_CONFIG] state is required for authorization URL', 'INVALID_CONFIG');
    }

    if (options.mode !== 'identity' && options.mode !== 'authorize_sites') {
      throw new JiraOAuthError(
        `[INVALID_CONFIG] Unsupported authorization mode: ${String(options.mode)}`,
        'INVALID_CONFIG'
      );
    }

    const url = new URL(this.authUrl);
    url.searchParams.set('audience', 'api.atlassian.com');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set(
      'scope',
      options.mode === 'identity'
        ? 'read:me offline_access'
        : 'read:me read:jira-work offline_access'
    );
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('state', options.state);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('prompt', 'consent');

    return url.toString();
  }

  private async fetchJson(
    url: string,
    init: RequestInit,
    signal?: AbortSignal,
    extraSecrets: string[] = []
  ): Promise<any> {
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new JiraOAuthError('[REQUEST_ABORTED] Request was aborted by caller', 'REQUEST_ABORTED');
    }

    const controller = new AbortController();
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;

    if (this.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.timeoutMs);
    }

    const onCallerAbort = () => {
      if (timer) clearTimeout(timer);
      controller.abort(signal?.reason);
    };

    if (signal) {
      signal.addEventListener('abort', onCallerAbort, { once: true });
    }

    try {
      const res = await this.fetchFn(url, {
        ...init,
        signal: controller.signal,
        redirect: 'error',
      });

      if (res.status >= 300 && res.status < 400) {
        throw new JiraOAuthError(
          `[PROVIDER_HTTP_ERROR] Redirects are strictly rejected to prevent credential leakage (HTTP ${res.status})`,
          'PROVIDER_HTTP_ERROR',
          res.status
        );
      }

      // Check Content-Length header upfront
      const contentLengthHeader = res.headers.get('content-length');
      if (contentLengthHeader) {
        const contentLength = Number.parseInt(contentLengthHeader, 10);
        if (Number.isFinite(contentLength) && contentLength > 65536) {
          throw new JiraOAuthError('[PROVIDER_RESPONSE] Response body exceeds 64 KB limit', 'PROVIDER_RESPONSE');
        }
      }

      // Read response body while strictly enforcing 64 KB limit
      let rawBody = '';
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              totalBytes += value.byteLength;
              if (totalBytes > 65536) {
                try {
                  await reader.cancel();
                } catch {
                  // ignore
                }
                throw new JiraOAuthError('[PROVIDER_RESPONSE] Response body exceeds 64 KB limit', 'PROVIDER_RESPONSE');
              }
              chunks.push(value);
            }
          }
        } finally {
          try {
            reader.releaseLock();
          } catch {
            // ignore
          }
        }
        const combined = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.byteLength;
        }
        rawBody = new TextDecoder('utf-8').decode(combined);
      } else {
        rawBody = await res.text();
        if (Buffer.byteLength(rawBody, 'utf8') > 65536) {
          throw new JiraOAuthError('[PROVIDER_RESPONSE] Response body exceeds 64 KB limit', 'PROVIDER_RESPONSE');
        }
      }

      if (!res.ok) {
        let parsedError: any = null;
        try {
          parsedError = JSON.parse(rawBody);
        } catch {
          // keep null
        }
        const rawSnippet = rawBody
          ? rawBody.length > 500
            ? `${rawBody.slice(0, 500)}...`
            : rawBody
          : `HTTP ${res.status}`;
        const errorMsg =
          parsedError?.error_description ||
          parsedError?.message ||
          parsedError?.error ||
          rawSnippet;

        const boundedMsg = String(errorMsg).length > 500
          ? `${String(errorMsg).slice(0, 500)}...`
          : String(errorMsg);

        throw new JiraOAuthError(
          this.redact(`[PROVIDER_HTTP_ERROR] Provider returned HTTP ${res.status}: ${boundedMsg}`, extraSecrets),
          'PROVIDER_HTTP_ERROR',
          res.status
        );
      }

      try {
        return JSON.parse(rawBody);
      } catch {
        throw new JiraOAuthError('[PROVIDER_RESPONSE] Malformed JSON response from provider', 'PROVIDER_RESPONSE');
      }
    } catch (err: any) {
      if (timedOut) {
        throw new JiraOAuthError(
          `[PROVIDER_TIMEOUT] Request to ${url} timed out after ${this.timeoutMs}ms`,
          'PROVIDER_TIMEOUT'
        );
      }
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new JiraOAuthError('[REQUEST_ABORTED] Request was aborted by caller', 'REQUEST_ABORTED');
      }
      if (err instanceof JiraOAuthError) {
        throw err;
      }
      throw new JiraOAuthError(
        this.redact(`[NETWORK_ERROR] Network error or rejected redirect: ${err?.message ?? 'Unknown'}`, extraSecrets),
        'NETWORK_ERROR'
      );
    } finally {
      if (timer) clearTimeout(timer);
      if (signal) {
        signal.removeEventListener('abort', onCallerAbort);
      }
    }
  }

  private async postJson(
    url: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
    extraSecrets: string[] = []
  ): Promise<any> {
    return this.fetchJson(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      },
      signal,
      extraSecrets
    );
  }

  async exchangeCode(code: string, signal?: AbortSignal): Promise<JiraTokensResult> {
    const trimmedCode = code?.trim();
    if (!trimmedCode) {
      throw new JiraOAuthError('[INVALID_CONFIG] code is required for exchangeCode', 'INVALID_CONFIG');
    }

    try {
      const data = await this.postJson(
        this.tokenUrl,
        {
          grant_type: 'authorization_code',
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          code: trimmedCode,
          redirect_uri: this.config.redirectUri,
        },
        signal,
        [trimmedCode]
      );

      if (!data || typeof data !== 'object' || typeof data.access_token !== 'string' || !data.access_token) {
        throw new JiraOAuthError('[PROVIDER_RESPONSE] Missing access_token in token response', 'PROVIDER_RESPONSE');
      }

      const scopes = typeof data.scope === 'string' && data.scope.trim()
        ? data.scope.trim().split(/\s+/)
        : [];

      return {
        accessToken: data.access_token,
        refreshToken: typeof data.refresh_token === 'string' && data.refresh_token.trim() ? data.refresh_token : undefined,
        expiresInSeconds: typeof data.expires_in === 'number' ? data.expires_in : Number.parseInt(data.expires_in ?? '3600', 10) || 3600,
        scopes,
      };
    } catch (err: any) {
      if (signal?.aborted || err?.name === 'AbortError' || (err instanceof JiraOAuthError && err.code === 'REQUEST_ABORTED')) {
        throw err;
      }
      if (err instanceof JiraOAuthError) {
        const sanitizedMsg = this.redact(err.message, [trimmedCode]);
        if (sanitizedMsg !== err.message) {
          throw new JiraOAuthError(sanitizedMsg, err.code, err.status);
        }
        throw err;
      }
      throw new JiraOAuthError(
        this.redact(`[PROVIDER_RESPONSE] Token exchange failed: ${err?.message ?? 'Unknown error'}`, [trimmedCode]),
        'PROVIDER_RESPONSE'
      );
    }
  }

  async refreshToken(refreshToken: string, signal?: AbortSignal): Promise<JiraTokensResult> {
    const trimmedToken = refreshToken?.trim();
    if (!trimmedToken) {
      throw new JiraOAuthError('[INVALID_CONFIG] refreshToken is required for refreshToken', 'INVALID_CONFIG');
    }

    try {
      const data = await this.postJson(
        this.tokenUrl,
        {
          grant_type: 'refresh_token',
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          refresh_token: trimmedToken,
        },
        signal,
        [trimmedToken]
      );

      if (!data || typeof data !== 'object' || typeof data.access_token !== 'string' || !data.access_token) {
        throw new JiraOAuthError('[PROVIDER_RESPONSE] Missing access_token in token refresh response', 'PROVIDER_RESPONSE');
      }

      const scopes = typeof data.scope === 'string' && data.scope.trim()
        ? data.scope.trim().split(/\s+/)
        : [];

      return {
        accessToken: data.access_token,
        refreshToken: typeof data.refresh_token === 'string' && data.refresh_token.trim() ? data.refresh_token : undefined,
        expiresInSeconds: typeof data.expires_in === 'number' ? data.expires_in : Number.parseInt(data.expires_in ?? '3600', 10) || 3600,
        scopes,
      };
    } catch (err: any) {
      if (signal?.aborted || err?.name === 'AbortError' || (err instanceof JiraOAuthError && err.code === 'REQUEST_ABORTED')) {
        throw err;
      }
      if (err instanceof JiraOAuthError) {
        const sanitizedMsg = this.redact(err.message, [trimmedToken]);
        if (sanitizedMsg !== err.message) {
          throw new JiraOAuthError(sanitizedMsg, err.code, err.status);
        }
        throw err;
      }
      throw new JiraOAuthError(
        this.redact(`[PROVIDER_RESPONSE] Token refresh failed: ${err?.message ?? 'Unknown error'}`, [trimmedToken]),
        'PROVIDER_RESPONSE'
      );
    }
  }

  async getProfile(accessToken: string, signal?: AbortSignal): Promise<JiraProfileResult> {
    const trimmedToken = accessToken?.trim();
    if (!trimmedToken) {
      throw new JiraOAuthError('[INVALID_CONFIG] accessToken is required for getProfile', 'INVALID_CONFIG');
    }

    try {
      const data = await this.fetchJson(
        this.profileUrl,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${trimmedToken}`,
            Accept: 'application/json',
          },
        },
        signal,
        [trimmedToken]
      );

      if (!data || typeof data !== 'object' || typeof data.account_id !== 'string' || !data.account_id.trim()) {
        throw new JiraOAuthError('[PROVIDER_RESPONSE] Missing account_id in profile response', 'PROVIDER_RESPONSE');
      }

      return { accountId: data.account_id.trim() };
    } catch (err: any) {
      if (err instanceof JiraOAuthError) {
        const sanitizedMsg = this.redact(err.message, [trimmedToken]);
        if (sanitizedMsg !== err.message) {
          throw new JiraOAuthError(sanitizedMsg, err.code, err.status);
        }
        throw err;
      }
      throw err;
    }
  }

  async getAccessibleResources(accessToken: string, signal?: AbortSignal): Promise<JiraAccessibleResource[]> {
    const trimmedToken = accessToken?.trim();
    if (!trimmedToken) {
      throw new JiraOAuthError('[INVALID_CONFIG] accessToken is required for getAccessibleResources', 'INVALID_CONFIG');
    }

    try {
      const data = await this.fetchJson(
        this.accessibleResourcesUrl,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${trimmedToken}`,
            Accept: 'application/json',
          },
        },
        signal,
        [trimmedToken]
      );

      if (!Array.isArray(data)) {
        throw new JiraOAuthError('[PROVIDER_RESPONSE] Accessible resources response must be an array', 'PROVIDER_RESPONSE');
      }

      const map = new Map<string, JiraAccessibleResource>();

      for (const item of data) {
        if (!item || typeof item !== 'object') continue;
        const id = typeof item.id === 'string' ? item.id.trim() : '';
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        const url = typeof item.url === 'string' ? item.url.trim() : '';
        const rawScopes: string[] = Array.isArray(item.scopes)
          ? item.scopes.filter((s: unknown) => typeof s === 'string').map((s: string) => s.trim())
          : [];

        // Filter non-Jira containers: container MUST contain at least one Jira scope
        const isJiraContainer = rawScopes.some((s) => s.toLowerCase().includes('jira'));
        if (!isJiraContainer) {
          continue;
        }

        // Validate cloudId syntax: must be non-empty, safe alphanumeric, hyphens, underscores (no traversal/control chars)
        if (!id || !SAFE_CLOUD_ID_REGEX.test(id)) {
          throw new JiraOAuthError(
            '[PROVIDER_RESPONSE] Invalid or unsafe cloudId in accessible resources',
            'PROVIDER_RESPONSE'
          );
        }

        // Validate site URL: must be valid https://*.atlassian.net with standard port and no credentials
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(url);
        } catch {
          throw new JiraOAuthError(
            '[PROVIDER_RESPONSE] Invalid or unsafe site URL in accessible resources',
            'PROVIDER_RESPONSE'
          );
        }

        const isHttps = parsedUrl.protocol === 'https:';
        const hasNoCredentials = !parsedUrl.username && !parsedUrl.password;
        const hasStandardPort = !parsedUrl.port || parsedUrl.port === '443';
        const hasValidHostname = ATLASSIAN_SITE_HOSTNAME_REGEX.test(parsedUrl.hostname);
        const hasStandardPath = parsedUrl.pathname === '/' || parsedUrl.pathname === '';
        const hasNoQueryOrHash = !parsedUrl.search && !parsedUrl.hash;

        if (!isHttps || !hasNoCredentials || !hasStandardPort || !hasValidHostname || !hasStandardPath || !hasNoQueryOrHash) {
          throw new JiraOAuthError(
            '[PROVIDER_RESPONSE] Invalid or unsafe site URL in accessible resources',
            'PROVIDER_RESPONSE'
          );
        }

        const sortedScopes = [...rawScopes].sort();

        if (!map.has(id)) {
          map.set(id, { id, name, url, scopes: sortedScopes });
        } else {
          const existing = map.get(id)!;
          // Deduplicate if strictly identical: same id, name, url, and scopes
          const isIdentical =
            existing.name === name &&
            existing.url === url &&
            existing.scopes.length === sortedScopes.length &&
            existing.scopes.every((s, i) => s === sortedScopes[i]);

          if (!isIdentical) {
            // Conflicting definitions for same cloudId -> FAIL CLOSED
            throw new JiraOAuthError(
              `[PROVIDER_RESPONSE] Conflicting resource definitions for cloudId: ${id}`,
              'PROVIDER_RESPONSE'
            );
          }
        }
      }

      return Array.from(map.values());
    } catch (err: any) {
      if (err instanceof JiraOAuthError) {
        const sanitizedMsg = this.redact(err.message, [trimmedToken]);
        if (sanitizedMsg !== err.message) {
          throw new JiraOAuthError(sanitizedMsg, err.code, err.status);
        }
        throw err;
      }
      throw err;
    }
  }
}
