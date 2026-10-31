import type { CredentialRepo } from '../db/repositories/credential-repo.js';
import {
  decryptCredentials,
  StepError,
  TrelloAdapter,
  type GmailAccessTokenProvider,
} from '@wap/tool-adapters';
import type { AllowedScope, PlanConnections } from '@wap/tool-schemas';
import type { AdapterExecutor } from '@wap/executor';
import { getRegisteredService } from './registered-services.js';
import type { GmailTokenManager } from './gmail/token-manager.js';

/** Who an adapter is for. Shared services ignore it; Gmail & MyCalendar require it. */
export interface AdapterContext {
  userId?: string;
  phase: 'planning' | 'execution';
  /** Required when phase is 'execution' and the service is personal: the connection the plan was previewed with. */
  connections?: PlanConnections;
}

export interface AdapterFactoryOptions {
  credentialRepo: CredentialRepo;
  encryptionKey: string;
  /** Builds the Gmail adapter of one member; absent until GMAIL-02 wires the real and sandbox adapters. */
  createGmailAdapter?: (input: { userId: string; tokens: GmailAccessTokenProvider }) => AdapterExecutor;
  gmailTokens?: GmailTokenManager;
  /** Builds the MyCalendar adapter of one member with explicit scope allowlist. */
  createMyCalendarAdapter?: (input: { userId: string; tokens: GmailAccessTokenProvider; allowedScope: AllowedScope }) => AdapterExecutor;
  mycalendarTokens?: GmailTokenManager;
  /** Builds the MySheets adapter of one member with explicit scope allowlist. */
  createMySheetsAdapter?: (input: { userId: string; tokens: GmailAccessTokenProvider; allowedScope: AllowedScope }) => AdapterExecutor;
  mysheetsTokens?: GmailTokenManager;
  createTrelloAdapter?: (input: { userId: string; accessToken: string; allowedBoardIds: string[] }) => AdapterExecutor;
  trelloTokens?: any;
  trelloTeamRepo?: any;
  trelloOAuthClient?: any;
  trelloApiBaseUrl?: string;
}

const gmailError = (category: 'AUTH_ERROR' | 'VALIDATION', message: string) =>
  new StepError({ category, message, retryable: false });
const mycalendarError = (category: 'AUTH_ERROR' | 'VALIDATION', message: string) =>
  new StepError({ category, message, retryable: false });
const mysheetsError = (category: 'AUTH_ERROR' | 'VALIDATION', message: string) =>
  new StepError({ category, message, retryable: false });
const trelloError = (category: 'AUTH_ERROR' | 'VALIDATION', message: string) =>
  new StepError({ category, message, retryable: false });

export class AdapterFactory {
  private credentialRepo: CredentialRepo;
  private encryptionKey: string;
  private adapterCache = new Map<string, any>();
  private personalCache = new Map<string, { credentialId: string; adapter: AdapterExecutor; scopeKey?: string }>();

  constructor(private options: AdapterFactoryOptions) {
    this.credentialRepo = options.credentialRepo;
    this.encryptionKey = options.encryptionKey;
  }

  clearCache(serviceName: string): void {
    this.adapterCache.delete(serviceName);
  }

  /** Forget the Gmail, MyCalendar, MySheets & Trello adapters and access tokens of one member (connect, disconnect, reconnect_required). */
  clearPersonal(userId: string): void {
    this.personalCache.delete(`gmail:${userId}`);
    this.personalCache.delete(`mycalendar:${userId}`);
    this.personalCache.delete(`mysheets:${userId}`);
    this.personalCache.delete(`trello:${userId}`);
    this.options.gmailTokens?.clear(userId);
    this.options.mycalendarTokens?.clear(userId);
    this.options.mysheetsTokens?.clear(userId);
    this.options.trelloTokens?.clear?.(userId);
  }

  async getAdapterForService(serviceName: string, context?: AdapterContext): Promise<any> {
    if (serviceName === 'gmail') return this.gmailAdapter(context);
    if (serviceName === 'mycalendar') return this.mycalendarAdapter(context);
    if (serviceName === 'mysheets') return this.mysheetsAdapter(context);
    if (serviceName === 'trello') return this.trelloAdapter(context);
    const cached = this.adapterCache.get(serviceName);
    if (cached) return cached;

    const registration = getRegisteredService(serviceName);
    if (!registration) throw new Error(`Unsupported service '${serviceName}'`);

    const record = await this.credentialRepo.getCredentials(serviceName);
    if (!record) {
      throw new Error(`No credentials configured for service '${serviceName}'`);
    }

    const decrypted = decryptCredentials(record.config, this.encryptionKey);
    const allowedScope: AllowedScope = (decrypted.allowedScope || {}) as AllowedScope;
    const entries = allowedScope[registration.definition.scopeKey];
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error(`Allowed scope is required for service '${serviceName}'`);
    }

    if (!registration.definition.credentialFields.every(({ key }) => typeof decrypted[key] === 'string' && String(decrypted[key]).trim())) {
      throw new Error(`Credentials are incomplete for service '${serviceName}'`);
    }
    const adapter = registration.transport.createAdapter(decrypted, allowedScope);

    this.adapterCache.set(serviceName, adapter);
    return adapter;
  }

  /** Only the member's own active connection; at execution, only the exact credential the plan was previewed with. */
  private async gmailAdapter(context?: AdapterContext): Promise<AdapterExecutor> {
    const userId = context?.userId;
    if (!userId) throw gmailError('AUTH_ERROR', 'Gmail chỉ dùng được với kết nối của chính người dùng.');
    const record = await this.credentialRepo.getPersonalCredentials('gmail', userId);
    if (context.phase === 'execution') {
      const previewed = context.connections?.gmail?.credentialId;
      if (!record || !previewed || record.id !== previewed) {
        throw gmailError('AUTH_ERROR', 'Kết nối Gmail đã thay đổi, hãy lập lại kế hoạch.');
      }
    }
    if (!record) throw gmailError('AUTH_ERROR', 'Gmail chưa được kết nối hoặc cần kết nối lại.');
    const key = `gmail:${userId}`;
    const cached = this.personalCache.get(key);
    if (cached?.credentialId === record.id) return cached.adapter;
    if (!this.options.createGmailAdapter || !this.options.gmailTokens) throw gmailError('VALIDATION', 'Gmail chưa sẵn sàng trên máy chủ này.');
    let refreshToken: unknown;
    try {
      refreshToken = decryptCredentials(record.config, this.encryptionKey).refreshToken;
    } catch { /* An unreadable connection is a lost connection, not a network failure. */ }
    if (typeof refreshToken !== 'string' || !refreshToken) throw gmailError('AUTH_ERROR', 'Gmail cần được kết nối lại.');
    const adapter = this.options.createGmailAdapter({ userId, tokens: this.options.gmailTokens.forConnection(userId, record.id, refreshToken) });
    this.personalCache.set(key, { credentialId: record.id, adapter });
    return adapter;
  }

  /** Only the member's own active connection; at execution, credentialId match and allowedCalendars subset match. */
  private async mycalendarAdapter(context?: AdapterContext): Promise<AdapterExecutor> {
    const userId = context?.userId;
    if (!userId) throw mycalendarError('AUTH_ERROR', 'Google Calendar cá nhân chỉ dùng được với kết nối của chính người dùng.');
    const record = await this.credentialRepo.getPersonalCredentials('mycalendar', userId);
    if (!record || record.status !== 'active') throw mycalendarError('AUTH_ERROR', 'Google Calendar chưa được kết nối hoặc cần kết nối lại.');

    let config: any;
    try {
      config = decryptCredentials(record.config, this.encryptionKey);
    } catch {
      throw mycalendarError('AUTH_ERROR', 'Google Calendar cần được kết nối lại.');
    }

    const allowedCalendars: string[] = Array.isArray(config.allowedScope?.calendars)
      ? config.allowedScope.calendars
      : Array.isArray(config.selectedCalendars)
        ? config.selectedCalendars.map((c: any) => c.id)
        : [];
    if (!allowedCalendars.length) {
      throw mycalendarError('AUTH_ERROR', 'Bạn chưa chọn lịch Google Calendar được phép sử dụng.');
    }

    if (context.phase === 'execution') {
      const previewed = context.connections?.mycalendar;
      if (!previewed || record.id !== previewed.credentialId) {
        throw mycalendarError('AUTH_ERROR', 'Kết nối hoặc phạm vi lịch Google Calendar đã thay đổi, hãy lập lại kế hoạch.');
      }
      const currentSet = new Set(allowedCalendars);
      if (!Array.isArray(previewed.allowedCalendars) || !previewed.allowedCalendars.every((id) => currentSet.has(id))) {
        throw mycalendarError('AUTH_ERROR', 'Kết nối hoặc phạm vi lịch Google Calendar đã thay đổi, hãy lập lại kế hoạch.');
      }
    }

    const key = `mycalendar:${userId}`;
    const scopeKey = [...allowedCalendars].sort().join(',');
    const cached = this.personalCache.get(key);
    if (cached?.credentialId === record.id && cached.scopeKey === scopeKey) return cached.adapter;

    if (!this.options.createMyCalendarAdapter || !this.options.mycalendarTokens) {
      throw mycalendarError('VALIDATION', 'Google Calendar chưa sẵn sàng trên máy chủ này.');
    }

    const refreshToken = config.refreshToken;
    if (typeof refreshToken !== 'string' || !refreshToken) {
      throw mycalendarError('AUTH_ERROR', 'Google Calendar cần được kết nối lại.');
    }

    const adapter = this.options.createMyCalendarAdapter({
      userId,
      tokens: this.options.mycalendarTokens.forConnection(userId, record.id, refreshToken),
      allowedScope: { calendars: allowedCalendars },
    });
    this.personalCache.set(key, { credentialId: record.id, adapter, scopeKey });
    return adapter;
  }

  /** Only the member's own active connection; at execution, credentialId match and allowedSpreadsheets subset match. */
  private async mysheetsAdapter(context?: AdapterContext): Promise<AdapterExecutor> {
    const userId = context?.userId;
    if (!userId) throw mysheetsError('AUTH_ERROR', 'Google Sheets cá nhân chỉ dùng được với kết nối của chính người dùng.');
    const record = await this.credentialRepo.getPersonalCredentials('mysheets', userId);
    if (!record || record.status !== 'active') throw mysheetsError('AUTH_ERROR', 'Google Sheets chưa được kết nối hoặc cần kết nối lại.');

    let config: any;
    try {
      config = decryptCredentials(record.config, this.encryptionKey);
    } catch {
      throw mysheetsError('AUTH_ERROR', 'Google Sheets cần được kết nối lại.');
    }

    const allowedSpreadsheets: string[] = Array.isArray(config.allowedScope?.spreadsheets)
      ? config.allowedScope.spreadsheets
      : Array.isArray(config.selectedSpreadsheets)
        ? config.selectedSpreadsheets.map((s: any) => s.id)
        : [];
    if (!allowedSpreadsheets.length) {
      throw mysheetsError('AUTH_ERROR', 'Bạn chưa chọn bảng tính Google Sheets cho ATI.');
    }

    if (context.phase === 'execution') {
      const previewed = context.connections?.mysheets;
      if (!previewed || record.id !== previewed.credentialId) {
        throw mysheetsError('AUTH_ERROR', 'Kết nối hoặc danh sách bảng tính đã đổi, hãy lập lại kế hoạch.');
      }
      const currentSet = new Set(allowedSpreadsheets);
      if (!Array.isArray(previewed.allowedSpreadsheets) || !previewed.allowedSpreadsheets.every((id) => currentSet.has(id))) {
        throw mysheetsError('AUTH_ERROR', 'Kết nối hoặc danh sách bảng tính đã đổi, hãy lập lại kế hoạch.');
      }
    }

    const key = `mysheets:${userId}`;
    const scopeKey = [...allowedSpreadsheets].sort().join(',');
    const cached = this.personalCache.get(key);
    if (cached?.credentialId === record.id && cached.scopeKey === scopeKey) return cached.adapter;

    if (!this.options.createMySheetsAdapter || !this.options.mysheetsTokens) {
      throw mysheetsError('VALIDATION', 'Google Sheets chưa sẵn sàng trên máy chủ này.');
    }

    const refreshToken = config.refreshToken;
    if (typeof refreshToken !== 'string' || !refreshToken) {
      throw mysheetsError('AUTH_ERROR', 'Google Sheets cần được kết nối lại.');
    }

    const adapter = this.options.createMySheetsAdapter({
      userId,
      tokens: this.options.mysheetsTokens.forConnection(userId, record.id, refreshToken),
      allowedScope: { spreadsheets: allowedSpreadsheets },
    });
    this.personalCache.set(key, { credentialId: record.id, adapter, scopeKey });
    return adapter;
  }

  /** Only the member's own active connection; at execution, credentialId match, team scope match and live membership match. */
  private async trelloAdapter(context?: AdapterContext): Promise<AdapterExecutor> {
    const userId = context?.userId;
    if (!userId) throw trelloError('AUTH_ERROR', 'Trello cá nhân chỉ dùng được với kết nối của chính người dùng.');
    const record = await this.credentialRepo.getPersonalCredentials('trello', userId);
    if (!record || record.status !== 'active') throw trelloError('AUTH_ERROR', 'Trello chưa được kết nối hoặc cần kết nối lại.');

    if (context?.phase === 'execution') {
      const previewed = context.connections?.trello;
      if (!previewed || record.id !== previewed.credentialId) {
        throw trelloError('AUTH_ERROR', 'Kết nối Trello đã thay đổi, hãy lập lại kế hoạch.');
      }
    }

    const scope = this.options.trelloTeamRepo ? await this.options.trelloTeamRepo.get() : null;
    if (!scope || !scope.boards || scope.boards.length === 0) {
      throw trelloError('AUTH_ERROR', 'Quản trị chưa chọn bảng Trello.');
    }

    const currentTeamBoardIds = new Set<string>(scope.boards.map((b: any) => String(b.boardId)));
    if (context?.phase === 'execution') {
      const previewed = context.connections?.trello;
      if (previewed) {
        const missing = previewed.boardIds.some((id: string) => !currentTeamBoardIds.has(id));
        if (missing) {
          throw trelloError('AUTH_ERROR', 'Bảng Trello trong kế hoạch đã bị bỏ khỏi phạm vi nhóm.');
        }
      }
    }

    let refreshToken: string | undefined;
    try {
      const config = decryptCredentials(record.config, this.encryptionKey);
      refreshToken = config.refreshToken;
    } catch {
      try {
        const parsed = JSON.parse(record.config);
        refreshToken = parsed.refreshToken;
      } catch {
        throw trelloError('AUTH_ERROR', 'Trello cần được kết nối lại.');
      }
    }

    if (!refreshToken) {
      throw trelloError('AUTH_ERROR', 'Trello cần được kết nối lại.');
    }

    if (!this.options.trelloTokens) {
      throw trelloError('VALIDATION', 'Trello chưa sẵn sàng trên máy chủ này.');
    }

    const provider = this.options.trelloTokens.forConnection(userId, record.id, refreshToken);
    const accessToken = await provider.getAccessToken();

    let liveMemberBoardIds: Set<string> = currentTeamBoardIds;
    if (this.options.trelloOAuthClient) {
      const callerBoards = await this.options.trelloOAuthClient.boards(
        accessToken,
        scope.workspaceId,
        AbortSignal.timeout(10_000)
      );
      liveMemberBoardIds = new Set<string>(callerBoards.filter((b: any) => b.member === true).map((b: any) => String(b.id)));
    }

    if (context?.phase === 'execution') {
      const previewed = context.connections?.trello;
      if (previewed) {
        const notMember = previewed.boardIds.some((id: string) => !liveMemberBoardIds.has(id));
        if (notMember) {
          throw trelloError('AUTH_ERROR', 'Bạn không còn là thành viên của bảng Trello trong kế hoạch.');
        }
      }
    }

    const previewedBoardIds: string[] = (context?.connections?.trello?.boardIds ?? Array.from(currentTeamBoardIds)) as string[];
    const allowedBoardIds: string[] = previewedBoardIds.filter(
      (id: string) => currentTeamBoardIds.has(id) && liveMemberBoardIds.has(id)
    );

    if (allowedBoardIds.length === 0) {
      throw trelloError('AUTH_ERROR', 'Không có bảng Trello nào hợp lệ để thực thi.');
    }

    if (this.options.createTrelloAdapter) {
      return this.options.createTrelloAdapter({ userId, accessToken, allowedBoardIds });
    }

    return new TrelloAdapter({
      credentials: { accessToken },
      allowedBoardIds,
      baseUrl: this.options.trelloApiBaseUrl,
    });
  }
}
