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

export class NotionOAuthError extends Error {
  readonly authenticationLost: boolean;
  constructor(messageOrLost: string | boolean = 'Không xác thực được với Notion.', authenticationLost = false) {
    const msg = typeof messageOrLost === 'string' ? messageOrLost : 'Không xác thực được với Notion.';
    const lost = typeof messageOrLost === 'boolean' ? messageOrLost : authenticationLost;
    super(msg);
    this.name = 'NotionOAuthError';
    this.authenticationLost = lost;
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

function actorIdFromOwner(owner: any): string {
  const userId = owner?.type === 'user' ? owner?.user?.id : undefined;
  if (typeof userId !== 'string' || !NOTION_ID_PATTERN.test(userId.trim())) {
    throw new NotionOAuthError('Workspace Notion không trả về định danh người ủy quyền.');
  }
  return normalizeNotionId(userId);
}

function parseTokenGrant(data: any, appId: string): NotionTokenGrant {
  const accessToken = typeof data?.access_token === 'string' ? data.access_token.trim() : '';
  const refreshToken = typeof data?.refresh_token === 'string' ? data.refresh_token.trim() : '';
  const rawWorkspace = typeof data?.workspace_id === 'string' ? data.workspace_id.trim() : '';
  const rawBot = typeof data?.bot_id === 'string' ? data.bot_id.trim() : '';
  if (
    !accessToken ||
    !refreshToken ||
    !NOTION_ID_PATTERN.test(rawWorkspace) ||
    !NOTION_ID_PATTERN.test(rawBot)
  ) {
    throw new NotionOAuthError('Phản hồi OAuth từ Notion không đầy đủ hoặc không hợp lệ.');
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
    actorId: actorIdFromOwner(data?.owner),
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

  private async request(path: string, init: RequestInit): Promise<any> {
    const res = await this.fetchFn(`${this.config.apiBaseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      redirect: 'manual',
    });
    if (res.status >= 300 && res.status < 400) {
      throw new NotionOAuthError('Notion trả về chuyển hướng không hợp lệ.');
    }
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = typeof data?.code === 'string' ? data.code : '';
      const lost =
        res.status === 401 ||
        res.status === 403 ||
        code === 'unauthorized' ||
        code === 'invalid_grant' ||
        data?.error === 'invalid_grant';
      throw new NotionOAuthError('Không xác thực được với Notion.', lost);
    }
    return data;
  }

  async verify(accessToken: string, botId: string, signal: AbortSignal): Promise<void> {
    const me = await this.request('/users/me', {
      method: 'GET',
      signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Notion-Version': NOTION_API_VERSION,
      },
    });
    const returnedId = typeof me?.id === 'string' && NOTION_ID_PATTERN.test(me.id) ? normalizeNotionId(me.id) : '';
    if (me?.type !== 'bot' || returnedId !== normalizeNotionId(botId)) {
      throw new NotionOAuthError('Token Notion không khớp với bot của kết nối.', true);
    }
  }

  async exchange(code: string, signal: AbortSignal): Promise<NotionTokenGrant> {
    const grant = parseTokenGrant(
      await this.request('/oauth/token', {
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
      }),
      this.config.clientId,
    );
    await this.verify(grant.accessToken, grant.botId, signal);
    return grant;
  }

  async refresh(refreshToken: string, signal: AbortSignal): Promise<NotionTokenGrant> {
    const grant = parseTokenGrant(
      await this.request('/oauth/token', {
        method: 'POST',
        signal,
        headers: {
          Authorization: this.basicAuth(),
          'Content-Type': 'application/json',
          'Notion-Version': NOTION_API_VERSION,
        },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      }),
      this.config.clientId,
    );
    await this.verify(grant.accessToken, grant.botId, signal);
    return grant;
  }

  async revoke(accessToken: string, signal: AbortSignal): Promise<void> {
    await this.request('/oauth/revoke', {
      method: 'POST',
      signal,
      headers: {
        Authorization: this.basicAuth(),
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_API_VERSION,
      },
      body: JSON.stringify({ token: accessToken }),
    });
  }

  async databases(
    accessToken: string,
    query: string,
    signal: AbortSignal,
  ): Promise<{ databases: NotionDatabaseItem[]; hasMore: boolean }> {
    const body: Record<string, unknown> = { page_size: 20 };
    if (query.trim()) body.query = query.trim();
    const data = await this.request('/search', {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_API_VERSION,
      },
      body: JSON.stringify(body),
    });
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
    accessToken: string,
    idsOrUrls: string[],
    signal: AbortSignal,
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
      const data = await this.request(`/databases/${databaseId}`, {
        method: 'GET',
        signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Notion-Version': NOTION_API_VERSION,
        },
      });
      const returnedId =
        typeof data?.id === 'string' && NOTION_ID_PATTERN.test(data.id) ? normalizeNotionId(data.id) : '';
      if (
        data?.object !== 'database' ||
        data?.in_trash === true ||
        data?.archived === true ||
        returnedId !== databaseId
      ) {
        throw new NotionOAuthError('Database Notion không thuộc phạm vi đã chia sẻ cho kết nối.');
      }
      items.push({
        id: returnedId,
        title: plainTitle(data?.title),
        url: typeof data?.url === 'string' ? data.url : '',
      });
    }
    return items;
  }
}
