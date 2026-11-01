import { Router, type Request, type Response } from 'express';
import type { CredentialRepo } from '../db/repositories/credential-repo.js';
import { encryptCredentials, decryptCredentials } from '@wap/tool-adapters';
import {
  ALL_TOOLS,
  GMAIL_SERVICE,
  GMAIL_TOOLS,
  MYCALENDAR_SERVICE,
  MYCALENDAR_TOOLS,
  MYSHEETS_SERVICE,
  MYSHEETS_TOOLS,
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

export interface ServicesRoutesOptions {
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
}

const PERSONAL_ONLY = 'Gmail do mỗi người tự kết nối ở mục "Của riêng bạn"; không có khoá chung để quản trị viên cấu hình.';
const MYCALENDAR_PERSONAL_ONLY = 'Google Calendar cá nhân do mỗi người tự kết nối ở mục "Của riêng bạn"; không có khoá chung để quản trị viên cấu hình.';
const MYSHEETS_PERSONAL_ONLY = 'Google Sheets cá nhân do mỗi người tự kết nối ở mục "Của riêng bạn"; không có khoá chung để quản trị viên cấu hình.';

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

  /** The caller's own Gmail row; another person's connection is never read. */
  const personalGmail = async (userId: string) => {
    const { id, name, description, scopes, scopeKey, scopeLabel, credentialFields } = GMAIL_SERVICE;
    const record = await credentialRepo!.getPersonalConnectionStatus('gmail', userId);
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
      connectionStatus: connected ? 'unchecked' : 'unconfigured',
      lastCheckedAt: null,
      allowedScope: [],
      personalStatus,
      ...details,
    };
  };

  /** The caller's own MyCalendar row; another person's connection is never read. */
  const personalMyCalendar = async (userId: string) => {
    const { id, name, description, scopes, scopeKey, scopeLabel, credentialFields } = MYCALENDAR_SERVICE;
    const record = await credentialRepo!.getPersonalConnectionStatus('mycalendar', userId);
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
      connectionStatus: connected ? 'unchecked' : 'unconfigured',
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
    const record = await credentialRepo!.getPersonalConnectionStatus('mysheets', userId);
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
      connectionStatus: connected ? 'unchecked' : 'unconfigured',
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
  router.all('/telegram/credentials', (_req, res) => {
    res.status(410).json({ error: 'Telegram dùng kết nối 1 chạm.' });
  });
  router.all('/telegram/scope', (_req, res) => {
    res.status(410).json({ error: 'Telegram dùng kết nối 1 chạm.' });
  });

  // GET /api/services
  router.get('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const { mode, workspaceId, isAdminUser } = getContext(req);
      const userId = (req as any).user?.id;

      let registered = getRegisteredServices();
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

          const config = record && encryptionKey ? decryptCredentials(record.config, encryptionKey) : null;
          const scope = config?.allowedScope as Record<string, unknown> | undefined;
          const entries = scope?.[scopeKey];
          const configured =
            !isPersonalOAuth &&
            Boolean(config && hasValidCredentials(credentialFields, config) && normalizeAllowedScope(definition, scope));
          const savedCheck = checks.get(checkKey(id, mode, workspaceId, userId));
          const check =
            savedCheck?.credentialVersion === (record ? versionOf(record.config) : null) ? savedCheck : undefined;

          let personalStatus: 'connected' | 'reconnect_required' | undefined;
          let username: string | undefined;
          let connectedAt: string | undefined;

          if (isPersonalOAuth && credentialRepo && typeof credentialRepo.getPersonalConnectionStatus === 'function') {
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
              if (encryptionKey) {
                try {
                  const dec = decryptCredentials(personalRecord.config, encryptionKey);
                  if (typeof dec.username === 'string') username = dec.username;
                  else if (typeof dec.login === 'string') username = dec.login;
                } catch {
                  if (personalRecord.status === 'active') {
                    personalStatus = 'reconnect_required';
                  }
                }
              }
            }
          }

          return {
            id,
            name,
            description,
            scopes,
            scopeKey,
            scopeLabel,
            credentialFields,
            connection: definition.connection ?? 'shared',
            tools: ALL_TOOLS.filter((tool) => tool.service === id).map((tool) => tool.name),
            configured,
            connected: configured && check?.connectionStatus === 'healthy',
            connectionStatus: configured ? check?.connectionStatus ?? 'unchecked' : 'unconfigured',
            lastCheckedAt: check?.lastCheckedAt ?? null,
            allowedScope: Array.isArray(entries) ? entries : [],
            ...(isPersonalOAuth && personalStatus
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

      res.status(200).json({
        services,
        canConfigure: mode === 'personal' ? true : isAdminUser,
        canSelectTeamScope: mode === 'personal' ? true : isAdminUser,
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
