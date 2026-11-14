import { Router, type Request, type Response } from 'express';
import type { CredentialRepo } from '../db/repositories/credential-repo.js';
import { hasGoogleCredentialOrigin } from '../services/gmail/credential-origin.js';
import { encryptCredentials, decryptCredentials } from '@wap/tool-adapters';
import {
  ALL_TOOLS,
  GMAIL_SERVICE,
  GMAIL_TOOLS,
  JIRA_LEGACY_SHARED_DISABLED,
  MYCALENDAR_SERVICE,
  MYCALENDAR_TOOLS,
  MYJIRA_G2A_TOOLS,
  MYJIRA_SERVICE,
  MYJIRA_TOOLS,
  MYSHEETS_SERVICE,
  MYSHEETS_TOOLS,
  NOTION_OAUTH_TOOLS,
  type PersonalCalendarItem,
  type PersonalSpreadsheetItem,
} from '@wap/tool-schemas';
import { createHash } from 'node:crypto';
import {
  getRegisteredServices,
  getRegisteredService,
  hasValidCredentials,
  isServiceAccountService,
  normalizeAllowedScope,
} from '../services/registered-services.js';
import { isAdmin } from '../auth/jwt.js';
import type { NotionConnectionRepo } from '../db/repositories/notion-connection-repo.js';
import { createNotionConnectionLookup } from '../services/notion/connection-reference.js';

export interface ServicesRoutesOptions {
  slackOAuthAvailable?: boolean;
  credentialRepo?: CredentialRepo;
  encryptionKey?: string;
  fetchFn?: typeof fetch;
  onCredentialsChanged?: (service: string, workspaceId?: string | null, userId?: string) => void;
  adminUserIds?: string[];
  /** Gmail is enabled and usable (flag on, OAuth and PostgreSQL configured). */
  gmailAvailable?: boolean;
  /** MyCalendar is enabled and usable (flag on, OAuth and PostgreSQL configured). */
  mycalendarAvailable?: boolean;
  /** MySheets is enabled and usable (flag on, OAuth and PostgreSQL configured). */
  mysheetsAvailable?: boolean;
  /** Live clients only; legacy grants require consent before appearing usable. */
  googleClientIds?: Partial<Record<'gmail' | 'mycalendar' | 'mysheets', string>>;
  /** MyJira OAuth is enabled and usable (flag on, OAuth and PostgreSQL configured). */
  myjiraAvailable?: boolean;
  jiraOAuthRepo?: {
    getConnectionStatus?: (userId: string) => Promise<{
      connected?: boolean;
      connectionState?: string;
      jiraAccountId?: string | null;
      atlassianAccountId?: string | null;
      displayName?: string;
      sites?: Array<{ cloudId: string; name: string; url: string }>;
    }>;
    getIdentityConnection?: (userId: string) => Promise<{
      status?: string;
      jiraAccountId?: string;
      updatedAt?: Date | string;
    } | null>;
  };
  jiraWorkspaceRepo?: {
    getCapabilities: (workspaceId: string, userId: string) => Promise<{
      sites?: Array<{ siteId: string; siteName?: string }>;
    } | null>;
  };
  trelloTeamRepo?: {
    get: (scopeId?: string) => Promise<{ boards?: Array<{ boardId: string; boardName?: string }> } | null>;
  };
  githubTeamRepo?: {
    get: (scopeId?: string) => Promise<{ repos?: Array<{ repoId: string; fullName: string }> } | null>;
  };
  githubOAuthClient?: {
    repos?: (accessToken: string, signal?: AbortSignal) => Promise<Array<any>>;
    repositories?: (accessToken: string, signal?: AbortSignal) => Promise<Array<any>>;
  };
  githubTokens?: {
    forConnection: (
      userId: string,
      credentialId: string,
      stored: { accessToken: string; refreshToken?: string }
    ) => { getAccessToken: (options?: { signal?: AbortSignal; forceRefresh?: boolean }) => Promise<string> };
  };
  notionConnectionRepo?: Pick<NotionConnectionRepo, 'getActive'>;
  notionConnection?: (userId: string) => Promise<any>;
}

const PERSONAL_ONLY = 'Gmail do mỗi người tự kết nối ở mục "Của riêng bạn"; không có khoá chung để quản trị viên cấu hình.';
const MYCALENDAR_PERSONAL_ONLY = 'Google Calendar cá nhân do mỗi người tự kết nối ở mục "Của riêng bạn"; không có khoá chung để quản trị viên cấu hình.';
const MYSHEETS_PERSONAL_ONLY = 'Google Sheets cá nhân do mỗi người tự kết nối ở mục "Của riêng bạn"; không có khoá chung để quản trị viên cấu hình.';
const MYJIRA_PERSONAL_ONLY = 'Jira dùng đăng nhập OAuth cá nhân và Planora Workspace.';

async function verifyService(
  service: string,
  config: Record<string, unknown>,
  fetchFn: typeof fetch
): Promise<{ healthy: boolean; message: string; latencyMs: number }> {
  const registration = getRegisteredService(service);
  if (!registration) throw new Error(`Unsupported service '${service}'`);
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const healthy = await registration.transport.checkConnection(config, fetchFn, controller.signal);
    return {
      healthy,
      message: healthy ? `Successfully connected to ${service}` : `Provider rejected ${service} credentials`,
      latencyMs: Math.round(performance.now() - started),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function createServicesRoutes(options: ServicesRoutesOptions = {}): Router {
  const router = Router();
  const { credentialRepo, encryptionKey } = options;
  const fetchFn = options.fetchFn || fetch;
  const generations = new Map<string, number>();
  const versionOf = (config: string) => createHash('sha256').update(config).digest('hex');
  const checks = new Map<
    string,
    { credentialVersion: string | null; connectionStatus: 'healthy' | 'unhealthy' | 'unconfigured'; lastCheckedAt: string }
  >();
  const checkKey = (service: string, mode: string, workspaceId: string | null, userId?: string) =>
    mode === 'personal'
      ? `personal:${userId ?? 'anon'}:${service}`
      : mode === 'organization'
        ? `org:${workspaceId ?? 'none'}:${service}`
        : `legacy:${service}`;

  const getContext = (req: Request) => {
    const mode = req.workspace?.mode ?? 'legacy';
    const workspaceId = req.workspace?.workspaceId ?? null;
    const canConfig =
      mode === 'personal'
        ? true
        : mode === 'organization'
          ? req.workspace?.role === 'admin'
          : isAdmin((req as any).user, options.adminUserIds);
    return { mode, workspaceId, isAdminUser: canConfig };
  };

  const googleConnection = async (service: 'gmail' | 'mycalendar' | 'mysheets', userId: string) => {
    const record = await credentialRepo!.getPersonalConnectionStatus(service, userId);
    const clientId = options.googleClientIds?.[service];
    if (record?.status === 'active' && clientId && !hasGoogleCredentialOrigin(record.config, encryptionKey!, clientId)) {
      if (await credentialRepo!.markReconnectRequired(service, userId, record.id)) options.onCredentialsChanged?.(service, null, userId);
      return { ...record, status: 'reconnect_required' as const };
    }
    return record;
  };

  /** The caller's own Gmail row; another person's connection is never read. */
  const personalGmail = async (userId: string) => {
    const { id, name, description, scopes, scopeKey, scopeLabel, credentialFields } = GMAIL_SERVICE;
    const record = await googleConnection('gmail', userId);
    let details: { email?: string; connectedAt?: string } = {};
    let personalStatus: 'connected' | 'reconnect_required' | 'not_connected' = record
      ? record.status === 'active'
        ? 'connected'
        : 'reconnect_required'
      : 'not_connected';
    if (record) {
      try {
        const config = decryptCredentials(record.config, encryptionKey!);
        details = { email: String(config.email), connectedAt: String(config.connectedAt) };
      } catch {
        personalStatus = 'reconnect_required';
      }
    }
    const connected = personalStatus === 'connected';
    return {
      id,
      name,
      description,
      scopes,
      scopeKey,
      scopeLabel,
      credentialFields,
      connection: 'personal' as const,
      tools: GMAIL_TOOLS.map((tool) => tool.name),
      configured: connected,
      connected,
      connectionStatus: connected ? 'healthy' : 'unconfigured',
      lastCheckedAt: null,
      allowedScope: [],
      personalStatus,
      ...details,
    };
  };

  /** The caller's own MyCalendar row; another person's connection is never read. */
  const personalMyCalendar = async (userId: string) => {
    const { id, name, description, scopes, scopeKey, scopeLabel, credentialFields } = MYCALENDAR_SERVICE;
    const record = await googleConnection('mycalendar', userId);
    let details: {
      email?: string;
      connectedAt?: string;
      selectedCalendars?: PersonalCalendarItem[];
      allowedScope?: string[];
      statusReason?: string;
    } = {};
    let personalStatus: 'connected' | 'scope_required' | 'reconnect_required' | 'not_connected' = 'not_connected';

    if (!record) {
      personalStatus = 'not_connected';
      details.statusReason = 'Chưa kết nối tài khoản Google Calendar cá nhân.';
    } else if (record.status === 'reconnect_required') {
      personalStatus = 'reconnect_required';
      details.statusReason = 'Phiên Google Calendar đã hết hạn hoặc bị thu hồi — cần kết nối lại.';
      try {
        const config = decryptCredentials(record.config, encryptionKey!);
        details.email = config.email ? String(config.email) : undefined;
        details.connectedAt = config.connectedAt ? String(config.connectedAt) : undefined;
      } catch {
        // cannot decrypt
      }
    } else {
      try {
        const config = decryptCredentials(record.config, encryptionKey!);
        const email = config.email ? String(config.email) : undefined;
        const connectedAt = config.connectedAt ? String(config.connectedAt) : undefined;
        const selectedCalendars: PersonalCalendarItem[] = Array.isArray(config.selectedCalendars)
          ? config.selectedCalendars
          : [];
        const allowedScope: string[] = Array.isArray(config.allowedScope?.calendars)
          ? config.allowedScope.calendars
          : selectedCalendars.map((c: any) => c.id);

        if (selectedCalendars.length === 0 && allowedScope.length === 0) {
          personalStatus = 'scope_required';
          details = {
            email,
            connectedAt,
            selectedCalendars: [],
            allowedScope: [],
            statusReason: 'Đã xác thực Google nhưng chưa chọn lịch được phép dùng.',
          };
        } else {
          personalStatus = 'connected';
          details = {
            email,
            connectedAt,
            selectedCalendars,
            allowedScope,
          };
        }
      } catch {
        personalStatus = 'reconnect_required';
        details.statusReason = 'Phiên Google Calendar đã hết hạn hoặc bị thu hồi — cần kết nối lại.';
      }
    }

    const connected = personalStatus === 'connected';
    return {
      id,
      name,
      description,
      scopes,
      scopeKey,
      scopeLabel,
      credentialFields,
      connection: 'personal' as const,
      tools: MYCALENDAR_TOOLS.map((tool) => tool.name),
      configured: connected,
      connected,
      connectionStatus: connected ? 'healthy' : 'unconfigured',
      lastCheckedAt: null,
      allowedScope: details.allowedScope ?? [],
      personalStatus,
      email: details.email,
      connectedAt: details.connectedAt,
      selectedCalendars: details.selectedCalendars,
      statusReason: details.statusReason,
    };
  };

  /** The caller's own MySheets row; another person's connection is never read. */
  const personalMySheets = async (userId: string) => {
    const { id, name, description, scopes, scopeKey, scopeLabel, credentialFields } = MYSHEETS_SERVICE;
    const record = await googleConnection('mysheets', userId);
    let details: {
      email?: string;
      connectedAt?: string;
      selectedSpreadsheets?: PersonalSpreadsheetItem[];
      allowedScope?: string[];
      statusReason?: string;
    } = {};
    let personalStatus: 'connected' | 'scope_required' | 'reconnect_required' | 'not_connected' = 'not_connected';

    if (!record) {
      personalStatus = 'not_connected';
      details.statusReason = 'Chưa kết nối tài khoản Google Sheets cá nhân.';
    } else if (record.status === 'reconnect_required') {
      personalStatus = 'reconnect_required';
      details.statusReason = 'Phiên Google Sheets đã hết hạn hoặc bị thu hồi — cần kết nối lại.';
      try {
        const config = decryptCredentials(record.config, encryptionKey!);
        details.email = config.email ? String(config.email) : undefined;
        details.connectedAt = config.connectedAt ? String(config.connectedAt) : undefined;
      } catch {
        // cannot decrypt
      }
    } else {
      try {
        const config = decryptCredentials(record.config, encryptionKey!);
        const email = config.email ? String(config.email) : undefined;
        const connectedAt = config.connectedAt ? String(config.connectedAt) : undefined;
        const selectedSpreadsheets: PersonalSpreadsheetItem[] = Array.isArray(config.selectedSpreadsheets)
          ? config.selectedSpreadsheets
          : [];
        const allowedScope: string[] = Array.isArray(config.allowedScope?.spreadsheets)
          ? config.allowedScope.spreadsheets
          : selectedSpreadsheets.map((s: any) => s.id);

        if (selectedSpreadsheets.length === 0 && allowedScope.length === 0) {
          personalStatus = 'scope_required';
          details = {
            email,
            connectedAt,
            selectedSpreadsheets: [],
            allowedScope: [],
            statusReason: 'Đã xác thực Google nhưng chưa chọn bảng tính được phép dùng.',
          };
        } else {
          personalStatus = 'connected';
          details = {
            email,
            connectedAt,
            selectedSpreadsheets,
            allowedScope,
          };
        }
      } catch {
        personalStatus = 'reconnect_required';
        details.statusReason = 'Phiên Google Sheets đã hết hạn hoặc bị thu hồi — cần kết nối lại.';
      }
    }

    const connected = personalStatus === 'connected';
    return {
      id,
      name,
      description,
      scopes,
      scopeKey,
      scopeLabel,
      credentialFields,
      connection: 'personal' as const,
      tools: MYSHEETS_TOOLS.map((tool) => tool.name),
      configured: connected,
      connected,
      connectionStatus: connected ? 'healthy' : 'unconfigured',
      lastCheckedAt: null,
      allowedScope: details.allowedScope ?? [],
      personalStatus,
      email: details.email,
      connectedAt: details.connectedAt,
      selectedSpreadsheets: details.selectedSpreadsheets,
      statusReason: details.statusReason,
    };
  };

  // Shared-key administration never applies to personal connections
  router.use('/gmail', (_req, res, next) => {
    if (options.gmailAvailable) {
      res.status(400).json({ error: PERSONAL_ONLY, code: 'PERSONAL_CONNECTION' });
      return;
    }
    next();
  });

  router.use('/mycalendar', (_req, res, next) => {
    if (options.mycalendarAvailable) {
      res.status(400).json({ error: MYCALENDAR_PERSONAL_ONLY, code: 'PERSONAL_CONNECTION' });
      return;
    }
    next();
  });

  router.use('/mysheets', (_req, res, next) => {
    if (options.mysheetsAvailable) {
      res.status(400).json({ error: MYSHEETS_PERSONAL_ONLY, code: 'PERSONAL_CONNECTION' });
      return;
    }
    next();
  });

  router.use('/myjira', (_req, res, next) => {
    if (options.myjiraAvailable) {
      res.status(400).json({ error: MYJIRA_PERSONAL_ONLY, code: 'PERSONAL_CONNECTION' });
      return;
    }
    next();
  });

  router.use('/jira', (_req, res) => {
    res.status(410).json({ error: MYJIRA_PERSONAL_ONLY, code: JIRA_LEGACY_SHARED_DISABLED });
  });

  // Shared token administration is gone for Trello and GitHub (HTTP 410 Gone).
  router.all('/trello/credentials', (_req, res) => {
    res.status(410).json({ error: 'Trello dùng đăng nhập OAuth.' });
  });
  router.all('/trello/scope', (_req, res) => {
    res.status(410).json({ error: 'Trello dùng đăng nhập OAuth.' });
  });
  router.all('/github/credentials', (_req, res) => {
    res.status(410).json({ error: 'GitHub dùng đăng nhập OAuth.' });
  });
  router.all('/github/scope', (_req, res) => {
    res.status(410).json({ error: 'GitHub dùng đăng nhập OAuth.' });
  });

  // Shared token administration is gone for Telegram (HTTP 410 Gone).
  router.all(/^\/telegram(?:\/(?:credentials|scope|connect|test))?$/, (req, res, next) => {
    if (req.method === 'GET' && req.path === '/telegram') {
      next();
      return;
    }
    res.status(410).json({ error: 'Telegram dùng kết nối 1 chạm.' });
  });

  // GET /api/services
  router.get('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const { mode, workspaceId, isAdminUser } = getContext(req);
      const userId = (req as any).user?.id;

      let registered = getRegisteredServices().filter((s) => s.id !== 'jira');
      if (mode === 'personal') {
        // In personal mode, enterprise service account services are hidden
        registered = registered.filter((s) => !isServiceAccountService(s));
      }

      const services: Array<Record<string, unknown>> = await Promise.all(
        registered.map(async (definition) => {
          const { id, name, description, scopes, scopeKey, scopeLabel, credentialFields } = definition;
          const isPersonalOAuth = id === 'trello' || id === 'github' || id === 'telegram';

          let record: any = null;
          if (!isPersonalOAuth) {
            if (mode === 'personal' && userId) {
              record = await credentialRepo?.getPersonalCredentials(id, userId);
            } else if (mode === 'organization') {
              record = await credentialRepo?.getCredentials(id, workspaceId);
            } else {
              record = await credentialRepo?.getCredentials(id, null);
            }
          }

          let config: Record<string, any> | null = null;
          if (record && encryptionKey) {
            try {
              config = decryptCredentials(record.config, encryptionKey);
            } catch {
              // One unreadable row (e.g. written under another ENCRYPTION_KEY) must not
              // fail the whole list; the service is reported as not configured.
              console.warn(`[services] Cannot decrypt stored credentials for '${id}'; listing it as unconfigured.`);
            }
          }
          const scope = config?.allowedScope as Record<string, unknown> | undefined;
          const entries = scope?.[scopeKey];
          const configured =
            !isPersonalOAuth &&
            Boolean(config && hasValidCredentials(credentialFields, config) && normalizeAllowedScope(definition, scope));
          const savedCheck = checks.get(checkKey(id, mode, workspaceId, userId));
          const check =
            savedCheck?.credentialVersion === (record ? versionOf(record.config) : null) ? savedCheck : undefined;
          const isPersonalNotionOAuth =
            id === 'notion' && !configured && Boolean(options.notionConnectionRepo || options.notionConnection);
          const effectiveIsPersonalOAuth = isPersonalOAuth || isPersonalNotionOAuth;

          let personalStatus:
            | 'connected'
            | 'scope_required'
            | 'needs_scope'
            | 'reconnect_required'
            | 'not_connected'
            | 'needs_membership'
            | undefined = effectiveIsPersonalOAuth ? 'not_connected' : undefined;
          let personalAllowedScope: string[] | undefined;
          let username: string | undefined;
          let connectedAt: string | undefined;

          if (isPersonalNotionOAuth) {
            if (userId) {
              try {
                const lookup =
                  options.notionConnection ??
                  (options.notionConnectionRepo
                    ? createNotionConnectionLookup({
                        repo: {
                          getActive: async (uid: string) => {
                            const raw: any = await options.notionConnectionRepo!.getActive(uid);
                            if (!raw) return null;
                            return {
                              ...raw,
                              config: raw.config ?? raw.encryptedToken ?? '',
                              allowed_databases:
                                raw.allowed_databases ??
                                raw.allowedDatabases ??
                                (Array.isArray(raw.selectedDatabases)
                                  ? raw.selectedDatabases.map((d: any) => (typeof d === 'string' ? d : d?.id)).filter(Boolean)
                                  : []),
                              selected_databases: raw.selected_databases ?? raw.selectedDatabases ?? [],
                              workspace_name: raw.workspace_name ?? raw.workspaceName,
                              workspace_id: raw.workspace_id ?? raw.workspaceId,
                              bot_id: raw.bot_id ?? raw.botId,
                            };
                          },
                        },
                      })
                    : undefined);
                const notionState = lookup ? await lookup(userId) : null;
                if (notionState?.status === 'connected') {
                  personalStatus = 'connected';
                  const dbIds =
                    notionState.connection?.databaseIds ??
                    notionState.databaseIds ??
                    notionState.allowedScope ??
                    [];
                  personalAllowedScope = Array.isArray(dbIds) ? dbIds.map(String) : [];
                  if (typeof (notionState.connection?.workspaceName ?? notionState.workspaceName) === 'string') {
                    username = notionState.connection?.workspaceName ?? notionState.workspaceName;
                  }
                } else if (notionState?.status === 'needs_scope' || notionState?.status === 'scope_required') {
                  personalStatus = 'scope_required';
                  personalAllowedScope = [];
                  if (typeof (notionState.connection?.workspaceName ?? notionState.workspaceName) === 'string') {
                    username = notionState.connection?.workspaceName ?? notionState.workspaceName;
                  }
                } else if (notionState?.status === 'reconnect_required') {
                  personalStatus = 'reconnect_required';
                  personalAllowedScope = [];
                } else {
                  personalStatus = 'not_connected';
                  personalAllowedScope = [];
                }
              } catch {
                personalStatus = 'not_connected';
                personalAllowedScope = [];
              }
            }
          } else if (isPersonalOAuth && credentialRepo && typeof credentialRepo.getPersonalConnectionStatus === 'function') {
            let personalRecord: any = null;
            if (userId) {
              try {
                personalRecord = await credentialRepo.getPersonalConnectionStatus(id, userId);
              } catch {
                personalRecord = null;
              }
            }
            if (personalRecord) {
              const dateVal = personalRecord.updated_at ?? personalRecord.created_at;
              connectedAt =
                dateVal instanceof Date ? dateVal.toISOString() : dateVal ? new Date(dateVal).toISOString() : undefined;
              if (personalRecord.status === 'reconnect_required') {
                personalStatus = 'reconnect_required';
              } else if (personalRecord.status === 'active') {
                personalStatus = 'connected';
              }
              let dec: Record<string, any> | null = null;
              if (encryptionKey) {
                try {
                  const decrypted = decryptCredentials(personalRecord.config, encryptionKey);
                  dec = decrypted;
                  if (typeof decrypted.username === 'string') username = decrypted.username;
                  else if (typeof decrypted.login === 'string') username = decrypted.login;
                } catch {
                  if (personalRecord.status === 'active') {
                    personalStatus = 'reconnect_required';
                  }
                }
              }
              if (personalStatus === 'connected') {
                if (id === 'trello' && options.trelloTeamRepo) {
                  const trelloScopeId =
                    mode === 'organization' && workspaceId
                      ? workspaceId
                      : mode === 'personal' && userId
                        ? 'personal:' + userId
                        : undefined;
                  let teamScope: { boards?: Array<{ boardId: string; boardName?: string }> } | null = null;
                  try {
                    teamScope = await (trelloScopeId
                      ? options.trelloTeamRepo.get(trelloScopeId)
                      : options.trelloTeamRepo.get());
                  } catch {
                    teamScope = null;
                  }
                  if (!teamScope?.boards?.length) {
                    personalStatus = 'scope_required';
                  } else {
                    personalAllowedScope = teamScope.boards.map((b) => b.boardId);
                  }
                } else if (id === 'github' && options.githubTeamRepo) {
                  const githubScopeId =
                    mode === 'organization'
                      ? workspaceId ?? undefined
                      : userId
                        ? 'personal:' + userId
                        : undefined;
                  let teamScope: { repos?: Array<{ repoId: string; fullName: string }> } | null = null;
                  try {
                    teamScope = githubScopeId ? await options.githubTeamRepo.get(githubScopeId) : null;
                  } catch {
                    teamScope = null;
                  }
                  if (!teamScope?.repos?.length) {
                    personalStatus = 'scope_required';
                  } else {
                    personalAllowedScope = teamScope.repos.map((r) => r.fullName);
                    const fetchRepos = options.githubOAuthClient?.repos ?? options.githubOAuthClient?.repositories;
                    if (
                      options.githubOAuthClient &&
                      options.githubTokens &&
                      typeof fetchRepos === 'function' &&
                      userId &&
                      personalRecord &&
                      dec?.accessToken
                    ) {
                      try {
                        const tokenProvider = options.githubTokens.forConnection(userId, personalRecord.id, {
                          accessToken: dec.accessToken,
                          refreshToken: dec.refreshToken,
                        });
                        const accessToken = await tokenProvider.getAccessToken({
                          signal: AbortSignal.timeout(10_000),
                        });
                        const callerRepos = await fetchRepos.call(
                          options.githubOAuthClient,
                          accessToken,
                          AbortSignal.timeout(10_000),
                        );
                        if (Array.isArray(callerRepos)) {
                          const accessibleRepos = teamScope.repos.filter((tr) =>
                            callerRepos.some(
                              (cr: any) =>
                                cr.member !== false &&
                                ((typeof cr.fullName === 'string' &&
                                  cr.fullName.toLowerCase() === tr.fullName.toLowerCase()) ||
                                  (typeof cr.full_name === 'string' &&
                                    cr.full_name.toLowerCase() === tr.fullName.toLowerCase()) ||
                                  (cr.id !== undefined && String(cr.id) === String(tr.repoId)) ||
                                  (cr.repoId !== undefined && String(cr.repoId) === String(tr.repoId))),
                            ),
                          );
                          if (accessibleRepos.length === 0) {
                            personalStatus = 'needs_membership';
                            personalAllowedScope = [];
                          } else {
                            personalAllowedScope = accessibleRepos.map((r) => r.fullName);
                          }
                        }
                      } catch (err: any) {
                        if (
                          err?.category === 'AUTH_ERROR' ||
                          err?.kind === 'invalid_grant' ||
                          err?.status === 401 ||
                          err?.statusCode === 401
                        ) {
                          personalStatus = 'reconnect_required';
                          personalAllowedScope = [];
                        }
                      }
                    }
                  }
                } else if (id === 'telegram' && dec) {
                  const hasSelectedChats = Array.isArray(dec.selectedChats);
                  const hasAllowedChats = Array.isArray(dec.allowedScope?.chats);
                  if (hasSelectedChats || hasAllowedChats) {
                    const selectedIds = hasSelectedChats
                      ? dec.selectedChats.map((c: any) => (typeof c === 'string' ? c : c?.chatId)).filter(Boolean)
                      : [];
                    const allowedIds = hasAllowedChats ? dec.allowedScope.chats : [];
                    const scopeIds = allowedIds.length > 0 ? allowedIds : selectedIds;
                    if (scopeIds.length === 0) {
                      personalStatus = 'scope_required';
                    } else {
                      personalAllowedScope = scopeIds;
                    }
                  }
                }
              }
            }
          }

          const personalConnected = effectiveIsPersonalOAuth && personalStatus === 'connected';
          const effectiveConfigured = effectiveIsPersonalOAuth ? personalConnected : configured;
          const effectiveConnected = effectiveIsPersonalOAuth
            ? personalConnected
            : configured && check?.connectionStatus === 'healthy';
          const effectiveConnectionStatus = effectiveIsPersonalOAuth
            ? personalConnected
              ? 'healthy'
              : personalStatus === 'needs_membership'
                ? 'needs_scope'
                : 'unconfigured'
            : configured
              ? check?.connectionStatus ?? 'unchecked'
              : 'unconfigured';
          const serviceTools = isPersonalNotionOAuth
            ? [...ALL_TOOLS.filter((tool) => tool.service === 'notion'), ...NOTION_OAUTH_TOOLS].map((tool) => tool.name)
            : ALL_TOOLS.filter((tool) => tool.service === id).map((tool) => tool.name);

          return {
            id,
            name,
            description,
            scopes,
            scopeKey,
            scopeLabel,
            credentialFields,
            connection: effectiveIsPersonalOAuth ? ('personal' as const) : (definition.connection ?? 'shared'),
            tools: serviceTools,
            configured: effectiveConfigured,
            connected: effectiveConnected,
            connectionStatus: effectiveConnectionStatus,
            lastCheckedAt: check?.lastCheckedAt ?? null,
            allowedScope: personalAllowedScope ?? (Array.isArray(entries) ? entries : []),
            ...(effectiveIsPersonalOAuth && personalStatus
              ? { personalStatus, ...(username ? { username } : {}), ...(connectedAt ? { connectedAt } : {}) }
              : {}),
          };
        })
      );

      if (options.gmailAvailable && credentialRepo && encryptionKey && userId) {
        services.push(await personalGmail(userId));
      }
      if (options.mycalendarAvailable && credentialRepo && encryptionKey && userId) {
        services.push(await personalMyCalendar(userId));
      }
      if (options.mysheetsAvailable && credentialRepo && encryptionKey && userId) {
        services.push(await personalMySheets(userId));
      }
      if (options.myjiraAvailable && userId) {
        const { id, name, description, scopes, scopeKey, scopeLabel, credentialFields } = MYJIRA_SERVICE;
        const isOrgMode = mode === 'organization' && Boolean(workspaceId);
        let personalStatus: 'connected' | 'scope_required' | 'reconnect_required' | 'not_connected' | undefined =
          isOrgMode ? 'not_connected' : undefined;
        let allowedScope: string[] = [];
        let connectionStatus: 'healthy' | 'needs_scope' | 'unconfigured' = 'unconfigured';
        try {
          if (options.jiraOAuthRepo?.getConnectionStatus) {
            const statusRes = await options.jiraOAuthRepo.getConnectionStatus(userId);
            if (!isOrgMode) {
              allowedScope = [];
              if (statusRes.connectionState === 'reconnect_required') {
                personalStatus = 'reconnect_required';
                connectionStatus = 'unconfigured';
              } else {
                const isIdentityConnected = Boolean(
                  statusRes.connected ||
                    statusRes.connectionState === 'connected' ||
                    statusRes.connectionState === 'identity_connected' ||
                    statusRes.connectionState === 'scope_required',
                );
                connectionStatus = isIdentityConnected ? 'needs_scope' : 'unconfigured';
                personalStatus = isIdentityConnected ? 'scope_required' : undefined;
              }
            } else if (statusRes.connectionState === 'reconnect_required') {
              personalStatus = 'reconnect_required';
            } else if (
              statusRes.connectionState === 'identity_connected' ||
              statusRes.connectionState === 'scope_required'
            ) {
              personalStatus = 'scope_required';
              connectionStatus = 'needs_scope';
            } else if (statusRes.connectionState === 'connected') {
              if (workspaceId && options.jiraWorkspaceRepo) {
                const caps = await options.jiraWorkspaceRepo.getCapabilities(workspaceId, userId);
                allowedScope = (caps?.sites ?? []).map((s) => s.siteId);
                personalStatus = allowedScope.length > 0 ? 'connected' : 'scope_required';
                connectionStatus = allowedScope.length > 0 ? 'healthy' : 'needs_scope';
              } else {
                allowedScope = [];
                personalStatus = 'scope_required';
                connectionStatus = 'needs_scope';
              }
            }
          } else if (options.jiraOAuthRepo?.getIdentityConnection) {
            const identity = await options.jiraOAuthRepo.getIdentityConnection(userId);
            if (!isOrgMode) {
              allowedScope = [];
              if (identity?.status === 'reconnect_required') {
                personalStatus = 'reconnect_required';
                connectionStatus = 'unconfigured';
              } else if (identity?.status === 'active') {
                personalStatus = 'scope_required';
                connectionStatus = 'needs_scope';
              } else {
                personalStatus = undefined;
                connectionStatus = 'unconfigured';
              }
            } else if (identity) {
              if (identity.status === 'reconnect_required') {
                personalStatus = 'reconnect_required';
              } else if (identity.status === 'active') {
                if (workspaceId && options.jiraWorkspaceRepo) {
                  const caps = await options.jiraWorkspaceRepo.getCapabilities(workspaceId, userId);
                  allowedScope = (caps?.sites ?? []).map((s) => s.siteId);
                  personalStatus = allowedScope.length > 0 ? 'connected' : 'scope_required';
                  connectionStatus = allowedScope.length > 0 ? 'healthy' : 'needs_scope';
                } else {
                  allowedScope = [];
                  personalStatus = 'scope_required';
                  connectionStatus = 'needs_scope';
                }
              }
            }
          }
        } catch {
          personalStatus = isOrgMode ? 'not_connected' : undefined;
          connectionStatus = 'unconfigured';
        }
        const connected = isOrgMode && personalStatus === 'connected';
        if (connected) {
          connectionStatus = 'healthy';
        }
        services.push({
          id,
          name,
          description,
          scopes,
          scopeKey,
          scopeLabel,
          credentialFields,
          connection: 'personal' as const,
          tools: MYJIRA_G2A_TOOLS.map((tool) => tool.name),
          configured: connected,
          connected,
          connectionStatus,
          lastCheckedAt: null,
          allowedScope,
          ...(personalStatus ? { personalStatus } : {}),
        });
      }

      res.status(200).json({
        services,
        canConfigure: mode === 'personal' ? true : isAdminUser,
        canSelectTeamScope: mode === 'personal' ? true : isAdminUser,
        ...(options.slackOAuthAvailable ? { personalOAuth: ['myslack'] } : {}),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to list services' });
    }
  });

  // POST /api/services/:service/test
  router.post('/:service/test', async (req: Request, res: Response): Promise<void> => {
    const service = String(req.params.service);
    const { mode, workspaceId } = getContext(req);
    const userId = (req as any).user?.id;
    const key = checkKey(service, mode, workspaceId, userId);
    const generation = generations.get(key) ?? 0;
    let credentialVersion: string | null = null;
    try {
      if (mode === 'personal' && isServiceAccountService(service)) {
        res.status(400).json({ error: 'Không gian cá nhân dùng MyCalendar/MySheets qua OAuth.', code: 'USE_PERSONAL_OAUTH' });
        return;
      }
      if (!getRegisteredService(service)) {
        res.status(400).json({ error: `Unsupported service: ${service}` });
        return;
      }

      let record: any = null;
      if (mode === 'personal' && userId) {
        record = await credentialRepo?.getPersonalCredentials(service, userId);
      } else if (mode === 'organization') {
        record = await credentialRepo?.getCredentials(service, workspaceId);
      } else {
        record = await credentialRepo?.getCredentials(service, null);
      }

      credentialVersion = record ? versionOf(record.config) : null;
      if (!record || !encryptionKey) {
        if ((generations.get(key) ?? 0) === generation) {
          checks.set(key, { credentialVersion, connectionStatus: 'unconfigured', lastCheckedAt: new Date().toISOString() });
        }
        res.status(409).json({ service, status: 'unconfigured', message: `${service} credentials are not configured` });
        return;
      }
      const config = decryptCredentials(record.config, encryptionKey);
      const result = await verifyService(service, config, fetchFn);
      if ((generations.get(key) ?? 0) === generation) {
        checks.set(key, {
          credentialVersion,
          connectionStatus: result.healthy ? 'healthy' : 'unhealthy',
          lastCheckedAt: new Date().toISOString(),
        });
      }
      res.status(result.healthy ? 200 : 502).json({ service, status: result.healthy ? 'healthy' : 'unhealthy', ...result });
    } catch (err: any) {
      if ((generations.get(key) ?? 0) === generation) {
        checks.set(key, { credentialVersion, connectionStatus: 'unhealthy', lastCheckedAt: new Date().toISOString() });
      }
      res.status(502).json({ status: 'unhealthy', error: 'Service connection verification failed' });
    }
  });

  // POST /api/services/:service/credentials and /api/services/:service/connect
  const handleSaveCredentials = async (req: Request, res: Response): Promise<void> => {
    try {
      const { mode, workspaceId, isAdminUser } = getContext(req);
      const service = String(req.params.service);
      const userId = (req as any).user?.id;

      if (mode === 'personal') {
        if (isServiceAccountService(service)) {
          res.status(400).json({ error: 'Không gian cá nhân dùng MyCalendar/MySheets qua OAuth.', code: 'USE_PERSONAL_OAUTH' });
          return;
        }
      } else if (mode === 'organization') {
        if (!isAdminUser) {
          res.status(403).json({ error: 'Chỉ quản trị viên tổ chức mới có quyền cấu hình dịch vụ.' });
          return;
        }
      } else {
        if (!isAdminUser) {
          res.status(403).json({ error: 'Only a configured service administrator can change shared credentials' });
          return;
        }
      }

      const { credentials, allowedScope } = req.body || {};
      const registration = getRegisteredService(service);
      if (!registration) {
        res.status(400).json({ error: 'Unsupported service' });
        return;
      }

      if (!credentialRepo) {
        res.status(500).json({ error: 'Credential repository not configured' });
        return;
      }

      const fields = registration.definition.credentialFields;
      if (!hasValidCredentials(fields, credentials)) {
        res.status(400).json({ error: 'Valid service credentials are required' });
        return;
      }
      const scope = normalizeAllowedScope(registration.definition, allowedScope);
      if (!scope || !encryptionKey) {
        res.status(400).json({ error: 'A non-empty allowed scope and encryption key are required' });
        return;
      }
      const encrypted = encryptCredentials(
        { ...Object.fromEntries(fields.map(({ key }) => [key, credentials[key]])), allowedScope: scope },
        encryptionKey
      );

      const key = checkKey(service, mode, workspaceId, userId);
      if (mode === 'personal') {
        await credentialRepo.upsertPersonalCredentials({ service, userId, config: encrypted, status: 'active' });
        generations.set(key, (generations.get(key) ?? 0) + 1);
        checks.delete(key);
        options.onCredentialsChanged?.(service, null, userId);
      } else if (mode === 'organization') {
        await credentialRepo.upsertCredentials(service, encrypted, 'active', (req as any).user?.email, workspaceId);
        generations.set(key, (generations.get(key) ?? 0) + 1);
        checks.delete(key);
        options.onCredentialsChanged?.(service, workspaceId);
      } else {
        await credentialRepo.saveCredentials(service, encrypted);
        generations.set(key, (generations.get(key) ?? 0) + 1);
        checks.delete(key);
        options.onCredentialsChanged?.(service);
      }

      res.status(200).json({ success: true, message: `Credentials saved for ${service}` });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to save credentials' });
    }
  };

  router.post('/:service/credentials', handleSaveCredentials);
  router.post('/:service/connect', handleSaveCredentials);

  // DELETE /api/services/:service and /api/services/:service/credentials
  const handleDeleteCredentials = async (req: Request, res: Response): Promise<void> => {
    try {
      const { mode, workspaceId, isAdminUser } = getContext(req);
      const service = String(req.params.service);
      const userId = (req as any).user?.id;

      if (mode === 'personal' && isServiceAccountService(service)) {
        res.status(400).json({ error: 'Không gian cá nhân dùng MyCalendar/MySheets qua OAuth.', code: 'USE_PERSONAL_OAUTH' });
        return;
      }

      if (!credentialRepo) {
        res.status(500).json({ error: 'Credential repository not configured' });
        return;
      }

      const key = checkKey(service, mode, workspaceId, userId);
      if (mode === 'personal') {
        await credentialRepo.deletePersonalCredentials(service, userId);
        generations.set(key, (generations.get(key) ?? 0) + 1);
        checks.delete(key);
        options.onCredentialsChanged?.(service, null, userId);
      } else if (mode === 'organization') {
        if (!isAdminUser) {
          res.status(403).json({ error: 'Chỉ quản trị viên tổ chức mới có quyền xóa kết nối dịch vụ.' });
          return;
        }
        await credentialRepo.deleteCredentials(service, workspaceId);
        generations.set(key, (generations.get(key) ?? 0) + 1);
        checks.delete(key);
        options.onCredentialsChanged?.(service, workspaceId);
      } else {
        if (!isAdminUser) {
          res.status(403).json({ error: 'Only a configured service administrator can change shared credentials' });
          return;
        }
        await credentialRepo.deleteCredentials(service, null);
        generations.set(key, (generations.get(key) ?? 0) + 1);
        checks.delete(key);
        options.onCredentialsChanged?.(service);
      }

      res.status(200).json({ success: true, message: `Credentials deleted for ${service}` });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to delete credentials' });
    }
  };

  router.delete('/:service', handleDeleteCredentials);
  router.delete('/:service/credentials', handleDeleteCredentials);

  // PUT /api/services/:service/scope
  router.put('/:service/scope', async (req: Request, res: Response): Promise<void> => {
    try {
      const { mode, workspaceId, isAdminUser } = getContext(req);
      const userId = (req as any).user?.id;

      if (mode === 'organization' && !isAdminUser) {
        res.status(403).json({ error: 'Only a configured service administrator can change shared credentials' });
        return;
      } else if (mode === 'legacy' && !isAdminUser) {
        res.status(403).json({ error: 'Only a configured service administrator can change shared credentials' });
        return;
      }

      const service = String(req.params.service);
      if (mode === 'personal' && isServiceAccountService(service)) {
        res.status(400).json({ error: 'Không gian cá nhân dùng MyCalendar/MySheets qua OAuth.', code: 'USE_PERSONAL_OAUTH' });
        return;
      }
      const registration = getRegisteredService(service);
      if (!registration) {
        res.status(400).json({ error: 'Unsupported service' });
        return;
      }
      if (!credentialRepo) {
        res.status(500).json({ error: 'Credential repository not configured' });
        return;
      }
      const scope = normalizeAllowedScope(registration.definition, req.body?.allowedScope);
      if (!scope || !encryptionKey) {
        res.status(400).json({ error: 'A non-empty allowed scope and encryption key are required' });
        return;
      }

      const key = checkKey(service, mode, workspaceId, userId);
      if (mode === 'personal') {
        const current = await credentialRepo.getPersonalCredentials(service, userId);
        if (!current) {
          res.status(409).json({ error: 'Hãy lưu thông tin kết nối dịch vụ trước khi đổi phạm vi tài nguyên.' });
          return;
        }
        const dec = decryptCredentials(current.config, encryptionKey);
        const newConfig = encryptCredentials({ ...dec, allowedScope: scope }, encryptionKey);
        await credentialRepo.upsertPersonalCredentials({ service, userId, config: newConfig, status: current.status });
        generations.set(key, (generations.get(key) ?? 0) + 1);
        checks.delete(key);
        options.onCredentialsChanged?.(service, null, userId);
      } else if (mode === 'organization') {
        const saved = await credentialRepo.updateCredentials(
          service,
          (config) =>
            encryptCredentials(
              {
                ...decryptCredentials(config, encryptionKey),
                allowedScope: scope,
              },
              encryptionKey
            ),
          workspaceId
        );
        if (!saved) {
          res.status(409).json({ error: 'Hãy lưu thông tin kết nối dịch vụ trước khi đổi phạm vi tài nguyên.' });
          return;
        }
        generations.set(key, (generations.get(key) ?? 0) + 1);
        checks.delete(key);
        options.onCredentialsChanged?.(service, workspaceId);
      } else {
        const saved = await credentialRepo.updateCredentials(
          service,
          (config) =>
            encryptCredentials(
              {
                ...decryptCredentials(config, encryptionKey),
                allowedScope: scope,
              },
              encryptionKey
            ),
          null
        );
        if (!saved) {
          res.status(409).json({ error: 'Hãy lưu thông tin kết nối dịch vụ trước khi đổi phạm vi tài nguyên.' });
          return;
        }
        generations.set(key, (generations.get(key) ?? 0) + 1);
        checks.delete(key);
        options.onCredentialsChanged?.(service);
      }

      res.status(200).json({ success: true, message: `Allowed scope saved for ${service}` });
    } catch {
      res.status(500).json({ error: 'Không thể lưu phạm vi tài nguyên. Hãy thử lại.' });
    }
  });

  return router;
}
