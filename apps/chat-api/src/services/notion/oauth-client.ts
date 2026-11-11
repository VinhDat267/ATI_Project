import { NOTION_ID_PATTERN, normalizeNotionId } from '@wap/tool-schemas';
import type { NotionOAuthConfig } from '../../config/notion-env.js';

export const NOTION_API_VERSION = '2026-03-11';

export interface NotionTokenGrant {
  appId: string;
  accessToken: string;
  refreshToken: string;
  workspaceId: string;
  workspaceName: string;
  actorId: string;
  botId: string;
  scopes: string[];
}

export interface NotionDatabaseItem {
  id: string;
  title: string;
  url: string;
}

export interface NotionDigestDatabase extends NotionDatabaseItem {
  dataSourceId: string;
}

export type NotionEndpointKind = 'resource' | 'identity' | 'token' | 'revoke';

export type NotionFailureReason =
  | 'resource_denied'
  | 'resource_unavailable'
  | 'access_rejected'
  | 'grant_rejected'
  | 'client_misconfigured'
  | 'identity_mismatch'
  | 'rate_limited'
  | 'transient'
  | 'invalid_request'
  | 'rotation_unknown';

export type NotionRequestState = 'not_sent' | 'response_received' | 'possibly_sent';

export interface NotionOAuthErrorDetails {
  endpointKind?: NotionEndpointKind;
  statusCode?: number;
  providerCode?: string;
  reason?: NotionFailureReason;
  requestState?: NotionRequestState;
}

const ALLOWLISTED_PROVIDER_CODES = new Set([
  'unauthorized',
  'restricted_resource',
  'object_not_found',
  'validation_error',
  'rate_limited',
  'internal_server_error',
  'service_unavailable',
  'conflict_error',
  'invalid_grant',
  'invalid_client',
  'invalid_request',
  'unsupported_grant_type',
  'unauthorized_client',
]);

function extractAllowlistedProviderCode(data: any): string | undefined {
  for (const candidate of [data?.code, data?.error]) {
    if (typeof candidate === 'string') {
      const normalized = candidate.trim().toLowerCase();
      if (ALLOWLISTED_PROVIDER_CODES.has(normalized)) {
        return normalized;
      }
    }
  }
  return undefined;
}

export class NotionOAuthError extends Error {
  readonly authenticationLost: boolean;
  readonly endpointKind: NotionEndpointKind;
  readonly statusCode?: number;
  readonly providerCode?: string;
  readonly reason: NotionFailureReason;
  readonly requestState: NotionRequestState;

  constructor(
    messageOrLost: string | boolean = 'Không xác thực được với Notion.',
    authenticationLost = false,
    details?: NotionOAuthErrorDetails,
  ) {
    const msg = typeof messageOrLost === 'string' ? messageOrLost : 'Không xác thực được với Notion.';
    const lost = typeof messageOrLost === 'boolean' ? messageOrLost : authenticationLost;
    super(msg);
    this.name = 'NotionOAuthError';
    this.authenticationLost = lost;
    this.endpointKind = details?.endpointKind ?? 'resource';
    this.statusCode = details?.statusCode ?? (lost && !details ? 401 : undefined);
    this.providerCode = details?.providerCode;
    this.reason = details?.reason ?? (lost ? 'access_rejected' : 'invalid_request');
    this.requestState = details?.requestState ?? (details || lost ? 'response_received' : 'not_sent');
  }
}

export function extractNotionDatabaseId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (NOTION_ID_PATTERN.test(trimmed)) {
    return normalizeNotionId(trimmed);
  }
  const pathOnly = (trimmed.split(/[?#]/)[0] ?? trimmed).replace(/\/+$/, '');
  const match = pathOnly.match(
    /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{32})$/,
  );
  if (match && NOTION_ID_PATTERN.test(match[1]!)) {
    return normalizeNotionId(match[1]!);
  }
  return null;
}

function actorIdFromOwner(owner: any, requireRefreshToken = false): string {
  const userId = owner?.type === 'user' ? owner?.user?.id : undefined;
  if (typeof userId !== 'string' || !NOTION_ID_PATTERN.test(userId.trim())) {
    throw new NotionOAuthError(
      'Workspace Notion không trả về định danh người ủy quyền.',
      false,
      {
        endpointKind: 'token',
        statusCode: 200,
        reason: requireRefreshToken ? 'rotation_unknown' : 'invalid_request',
        requestState: 'response_received',
      },
    );
  }
  return normalizeNotionId(userId);
}

function parseTokenGrant(data: any, appId: string, requireRefreshToken = false): NotionTokenGrant {
  const accessToken = typeof data?.access_token === 'string' ? data.access_token.trim() : '';
  const refreshToken = typeof data?.refresh_token === 'string' ? data.refresh_token.trim() : '';
  const rawWorkspace = typeof data?.workspace_id === 'string' ? data.workspace_id.trim() : '';
  const rawBot = typeof data?.bot_id === 'string' ? data.bot_id.trim() : '';
  if (
    !accessToken ||
    (requireRefreshToken && !refreshToken) ||
    !NOTION_ID_PATTERN.test(rawWorkspace) ||
    !NOTION_ID_PATTERN.test(rawBot)
  ) {
    throw new NotionOAuthError(
      'Phản hồi OAuth từ Notion không đầy đủ hoặc không hợp lệ.',
      false,
      {
        endpointKind: 'token',
        statusCode: 200,
        reason: requireRefreshToken ? 'rotation_unknown' : 'invalid_request',
        requestState: 'response_received',
      },
    );
  }
  return {
    appId,
    accessToken,
    refreshToken,
    workspaceId: normalizeNotionId(rawWorkspace),
    workspaceName:
      typeof data?.workspace_name === 'string' && data.workspace_name.trim()
        ? data.workspace_name.trim()
        : 'Notion Workspace',
    actorId: actorIdFromOwner(data?.owner, requireRefreshToken),
    botId: normalizeNotionId(rawBot),
    scopes: [],
  };
}

function plainTitle(title: any): string {
  if (!Array.isArray(title)) return 'Database không tên';
  const text = title.map((item) => (typeof item?.plain_text === 'string' ? item.plain_text : '')).join('').trim();
  return text || 'Database không tên';
}

export class NotionOAuthClient {
  private readonly fetchFn: typeof fetch;
  constructor(private readonly config: NotionOAuthConfig, fetchFn: typeof fetch = fetch) {
    this.fetchFn = fetchFn;
  }

  get apiBaseUrl(): string {
    return this.config.apiBaseUrl;
  }

  get appId(): string {
    return this.config.clientId;
  }

  authorizationUrl(state: string): string {
    const url = new URL(this.config.authorizationUrl);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('owner', 'user');
    url.searchParams.set('state', state);
    return url.href;
  }

  private basicAuth(): string {
    const raw = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`, 'utf8').toString('base64');
    return `Basic ${raw}`;
  }

  private async request(
    path: string,
    init: RequestInit,
    endpointKind: NotionEndpointKind = 'resource',
  ): Promise<any> {
    let targetUrl: string;
    try {
      const base = this.config.apiBaseUrl.replace(/\/$/, '');
      const parsed = new URL(`${base}${path}`);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new TypeError('Unsupported protocol');
      }
      targetUrl = `${base}${path}`;
    } catch {
      throw new NotionOAuthError('Cấu hình địa chỉ máy chủ Notion không hợp lệ.', false, {
        endpointKind,
        reason: 'transient',
        requestState: 'not_sent',
      });
    }

    if (init.signal?.aborted) {
      throw new NotionOAuthError('Yêu cầu tới Notion đã bị hủy trước khi gửi.', false, {
        endpointKind,
        reason: 'transient',
        requestState: 'not_sent',
      });
    }

    let res: Response;
    try {
      res = await this.fetchFn(targetUrl, {
        ...init,
        redirect: 'manual',
      });
    } catch (err) {
      if (err instanceof NotionOAuthError) {
        throw err;
      }
      throw new NotionOAuthError(
        endpointKind === 'token'
          ? 'Không xác nhận được phản hồi làm mới token từ Notion.'
          : 'Không thể kết nối tới Notion. Vui lòng thử lại sau.',
        false,
        {
          endpointKind,
          reason: endpointKind === 'token' ? 'rotation_unknown' : 'transient',
          requestState: 'possibly_sent',
        },
      );
    }

    if (res.status >= 300 && res.status < 400) {
      throw new NotionOAuthError('Notion trả về chuyển hướng không hợp lệ.', false, {
        endpointKind,
        statusCode: res.status,
        reason: endpointKind === 'token' ? 'rotation_unknown' : 'invalid_request',
        requestState: 'response_received',
      });
    }

    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const providerCode = extractAllowlistedProviderCode(data);

      if (endpointKind === 'token') {
        if (res.status === 400 && providerCode === 'invalid_grant') {
          throw new NotionOAuthError(
            'Phiên ủy quyền Notion đã hết hiệu lực. Vui lòng kết nối lại.',
            true,
            {
              endpointKind,
              statusCode: res.status,
              providerCode,
              reason: 'grant_rejected',
              requestState: 'response_received',
            },
          );
        }
        if (
          (res.status === 401 && providerCode !== 'invalid_grant') ||
          (res.status === 400 &&
            (providerCode === 'invalid_client' || providerCode === 'unauthorized_client'))
        ) {
          throw new NotionOAuthError(
            'Cấu hình ứng dụng OAuth Notion trên máy chủ không khớp hoặc không hợp lệ.',
            false,
            {
              endpointKind,
              statusCode: res.status,
              providerCode,
              reason: 'client_misconfigured',
              requestState: 'response_received',
            },
          );
        }
        throw new NotionOAuthError(
          'Không xác nhận được trạng thái làm mới phiên xác thực Notion. Vui lòng kết nối lại.',
          false,
          {
            endpointKind,
            statusCode: res.status,
            providerCode,
            reason: 'rotation_unknown',
            requestState: 'response_received',
          },
        );
      }

      if (endpointKind === 'revoke') {
        throw new NotionOAuthError(
          'Không thể xác nhận thu hồi quyền truy cập trên Notion.',
          false,
          {
            endpointKind,
            statusCode: res.status,
            providerCode,
            reason: res.status === 429 ? 'rate_limited' : 'transient',
            requestState: 'response_received',
          },
        );
      }

      if (res.status === 401) {
        throw new NotionOAuthError('Phiên truy cập Notion không còn hợp lệ.', true, {
          endpointKind,
          statusCode: res.status,
          providerCode,
          reason: 'access_rejected',
          requestState: 'response_received',
        });
      }

      if (res.status === 403) {
        throw new NotionOAuthError(
          'Notion từ chối truy cập tài nguyên này do chưa được cấp quyền chia sẻ hoặc giới hạn từ workspace/nhà cung cấp.',
          false,
          {
            endpointKind,
            statusCode: res.status,
            providerCode,
            reason: 'resource_denied',
            requestState: 'response_received',
          },
        );
      }

      if (res.status === 404) {
        throw new NotionOAuthError('Không truy cập được tài nguyên Notion được yêu cầu.', false, {
          endpointKind,
          statusCode: res.status,
          providerCode,
          reason: 'resource_unavailable',
          requestState: 'response_received',
        });
      }

      if (res.status === 429) {
        throw new NotionOAuthError(
          'Notion đang giới hạn tần suất truy cập. Vui lòng thử lại sau.',
          false,
          {
            endpointKind,
            statusCode: res.status,
            providerCode,
            reason: 'rate_limited',
            requestState: 'response_received',
          },
        );
      }

      if (res.status >= 400 && res.status < 500) {
        throw new NotionOAuthError('Yêu cầu tới Notion không hợp lệ.', false, {
          endpointKind,
          statusCode: res.status,
          providerCode,
          reason: 'invalid_request',
          requestState: 'response_received',
        });
      }

      throw new NotionOAuthError('Notion tạm thời không phản hồi. Vui lòng thử lại sau.', false, {
        endpointKind,
        statusCode: res.status,
        providerCode,
        reason: 'transient',
        requestState: 'response_received',
      });
    }

    return data;
  }

  async verify(accessToken: string, botId: string, signal: AbortSignal): Promise<void> {
    const me = await this.request(
      '/users/me',
      {
        method: 'GET',
        signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Notion-Version': NOTION_API_VERSION,
        },
      },
      'identity',
    );
    const returnedId = typeof me?.id === 'string' && NOTION_ID_PATTERN.test(me.id) ? normalizeNotionId(me.id) : '';
    if (!returnedId || (me?.type !== 'bot' && me?.type !== 'person')) {
      throw new NotionOAuthError('Không đọc được danh tính bot từ phản hồi Notion.', false, {
        endpointKind: 'identity',
        statusCode: 200,
        reason: 'transient',
        requestState: 'response_received',
      });
    }
    if (me?.type !== 'bot' || returnedId !== normalizeNotionId(botId)) {
      throw new NotionOAuthError('Token Notion không khớp với bot của kết nối.', true, {
        endpointKind: 'identity',
        statusCode: 200,
        reason: 'identity_mismatch',
        requestState: 'response_received',
      });
    }
  }

  async exchange(code: string, signal: AbortSignal): Promise<NotionTokenGrant> {
    const grant = parseTokenGrant(
      await this.request(
        '/oauth/token',
        {
          method: 'POST',
          signal,
          headers: {
            Authorization: this.basicAuth(),
            'Content-Type': 'application/json',
            'Notion-Version': NOTION_API_VERSION,
          },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            code,
            redirect_uri: this.config.redirectUri,
          }),
        },
        'token',
      ),
      this.config.clientId,
    );
    await this.verify(grant.accessToken, grant.botId, signal);
    return grant;
  }

  async refresh(refreshToken: string, signal: AbortSignal): Promise<NotionTokenGrant> {
    const trimmedRt = typeof refreshToken === 'string' ? refreshToken.trim() : '';
    if (!trimmedRt) {
      throw new NotionOAuthError(
        'Phiên ủy quyền Notion không có refresh token hợp lệ. Vui lòng kết nối lại.',
        true,
        {
          endpointKind: 'token',
          reason: 'grant_rejected',
          requestState: 'not_sent',
        },
      );
    }
    const grant = parseTokenGrant(
      await this.request(
        '/oauth/token',
        {
          method: 'POST',
          signal,
          headers: {
            Authorization: this.basicAuth(),
            'Content-Type': 'application/json',
            'Notion-Version': NOTION_API_VERSION,
          },
          body: JSON.stringify({
            grant_type: 'refresh_token',
            refresh_token: trimmedRt,
          }),
        },
        'token',
      ),
      this.config.clientId,
      true,
    );
    try {
      await this.verify(grant.accessToken, grant.botId, signal);
    } catch (err) {
      if (err instanceof NotionOAuthError && err.reason === 'identity_mismatch') {
        throw err;
      }
      throw new NotionOAuthError(
        'Không xác minh được danh tính bot Notion sau khi làm mới phiên xác thực.',
        false,
        {
          endpointKind: 'identity',
          statusCode: err instanceof NotionOAuthError ? err.statusCode : undefined,
          providerCode: err instanceof NotionOAuthError ? err.providerCode : undefined,
          reason: 'rotation_unknown',
          requestState: 'possibly_sent',
        },
      );
    }
    return grant;
  }

  async revoke(accessToken: string, signal: AbortSignal): Promise<void> {
    await this.request(
      '/oauth/revoke',
      {
        method: 'POST',
        signal,
        headers: {
          Authorization: this.basicAuth(),
          'Content-Type': 'application/json',
          'Notion-Version': NOTION_API_VERSION,
        },
        body: JSON.stringify({ token: accessToken }),
      },
      'revoke',
    );
  }

  async databases(
    accessToken: string,
    query: string,
    signal: AbortSignal,
  ): Promise<{ databases: NotionDatabaseItem[]; hasMore: boolean }> {
    const body: Record<string, unknown> = { page_size: 20 };
    if (query.trim()) body.query = query.trim();
    const data = await this.request(
      '/search',
      {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Notion-Version': NOTION_API_VERSION,
        },
        body: JSON.stringify(body),
      },
      'resource',
    );
    const seen = new Set<string>();
    const databases: NotionDatabaseItem[] = [];
    for (const source of Array.isArray(data?.results) ? data.results : []) {
      if (source?.in_trash === true || source?.archived === true) continue;
      let rawId: string | undefined;
      if (source?.object === 'data_source' && source?.parent?.type === 'database_id') {
        rawId = source.parent.database_id;
      } else if (source?.object === 'database') {
        rawId = source.id;
      }
      if (typeof rawId !== 'string' || !NOTION_ID_PATTERN.test(rawId.trim())) continue;
      const id = normalizeNotionId(rawId);
      if (seen.has(id)) continue;
      seen.add(id);
      databases.push({
        id,
        title: plainTitle(source.title),
        url: typeof source?.url === 'string' ? source.url : '',
      });
    }
    return { databases, hasMore: Boolean(data?.has_more) };
  }

  async validateDatabases(
    accessToken: string, idsOrUrls: string[], signal: AbortSignal, singleSource: true,
  ): Promise<NotionDigestDatabase[]>;
  async validateDatabases(
    accessToken: string, idsOrUrls: string[], signal: AbortSignal,
  ): Promise<NotionDatabaseItem[]>;
  async validateDatabases(
    accessToken: string,
    idsOrUrls: string[],
    signal: AbortSignal,
    singleSource = false,
  ): Promise<NotionDatabaseItem[]> {
    const normalized = Array.from(
      new Set(
        idsOrUrls.map((raw) => {
          const parsed = extractNotionDatabaseId(raw);
          if (!parsed) throw new NotionOAuthError('Database Notion không hợp lệ.');
          return parsed;
        }),
      ),
    );
    if (normalized.length === 0 || normalized.length > 10) {
      throw new NotionOAuthError('Chọn từ 1 đến 10 database Notion.');
    }
    const items: NotionDatabaseItem[] = [];
    for (const databaseId of normalized) {
      const data = await this.request(
        `/databases/${databaseId}`,
        {
          method: 'GET',
          signal,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Notion-Version': NOTION_API_VERSION,
          },
        },
        'resource',
      );
      const returnedId =
        typeof data?.id === 'string' && NOTION_ID_PATTERN.test(data.id) ? normalizeNotionId(data.id) : '';
      if (
        data?.object !== 'database' ||
        data?.in_trash === true ||
        data?.archived === true ||
        returnedId !== databaseId
      ) {
        throw new NotionOAuthError('Database Notion không thuộc phạm vi đã chia sẻ cho kết nối.', false, {
          reason: 'resource_unavailable',
        });
      }
      const database = {
        id: returnedId,
        title: plainTitle(data?.title),
        url: typeof data?.url === 'string' ? data.url : '',
      };
      if (!singleSource) {
        items.push(database);
        continue;
      }
      const rawSourceId = data.data_sources?.[0]?.id;
      if (!Array.isArray(data.data_sources) || data.data_sources.length !== 1 ||
          typeof rawSourceId !== 'string' || !NOTION_ID_PATTERN.test(rawSourceId)) {
        throw new NotionOAuthError('Database Notion cần có đúng một data source hợp lệ.', false, {
          reason: 'resource_unavailable',
        });
      }
      const digestDatabase: NotionDigestDatabase = { ...database, dataSourceId: normalizeNotionId(rawSourceId) };
      items.push(digestDatabase);
    }
    return items;
  }
}
