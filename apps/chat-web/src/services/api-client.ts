import { authStorage } from './auth-storage';
import { getActiveWorkspaceId, getExplicitWorkspaceId, setActiveWorkspaceId } from './workspace-storage';
import type { ScheduleApprovalMode, ScheduleView, ScheduleRunView } from '@wap/tool-schemas';
import type {
  ActivePlan,
  ChatMessage,
  Conversation,
  ServiceInfo,
  User,
  ExecutionSnapshot,
  AdminUser, AdminUserPage,
  AuthMessageResponse,
  AccountProfile, AccountSession,
  PersonalSpreadsheetItem, MySheetsPickerSession,
  WorkspaceSummary, WorkspacesListResponse,
} from '../types';

export function sharesAuthSession(previous: string | null, current: string | null): boolean {
  // Decode only to constrain retries, never to authenticate. The backend still
  // verifies signatures. Missing/malformed lineage cannot authorize adoption.
  const lineage = (token: string | null): { sub: string; sid: string } | null => {
    try {
      const parts = token?.split('.');
      if (parts?.length !== 3) return null;
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload.type === 'access' && typeof payload.sub === 'string' && payload.sub && typeof payload.sid === 'string' && payload.sid
        ? { sub: payload.sub, sid: payload.sid } : null;
    } catch { return null; }
  };
  const before = lineage(previous), after = lineage(current);
  return !!before && !!after && before.sub === after.sub && before.sid === after.sid;
}

export class ApiClient {
  private refreshPromise: Promise<any> | null = null;
  private responseOwners = new WeakMap<Response, string | null>();

  async requestRaw(
    url: string,
    options: RequestInit = {},
    isRetry = false
  ): Promise<Response> {
    const headers = new Headers(options.headers || {});
    if (
      !headers.has('Content-Type') &&
      options.body &&
      typeof options.body === 'string'
    ) {
      headers.set('Content-Type', 'application/json');
    }
    const { accessToken, refreshToken: requestRefresh } = authStorage.getStoredTokens();
    if (accessToken) {
      if (isRetry || !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${accessToken}`);
      }
      if (!headers.has('X-Workspace-Id')) {
        const explicitWorkspaceId = getExplicitWorkspaceId();
        if (explicitWorkspaceId) {
          headers.set('X-Workspace-Id', explicitWorkspaceId);
        }
      }
    }

    const response = await fetch(url, { ...options, headers });
    this.responseOwners.set(response, accessToken);
    // A response from an earlier session cannot refresh or clear credentials
    // installed by a later login (including a Google callback).
    const { accessToken: currentAccess, refreshToken: currentRefresh } = authStorage.getStoredTokens();
    if (currentAccess !== accessToken || currentRefresh !== requestRefresh) {
      if (!sharesAuthSession(accessToken, currentAccess)) throw new Error('Phiên đăng nhập đã thay đổi.');
      if (response.status === 401 && !isRetry) {
        const retry = await this.requestRaw(url, options, true);
        const latest = authStorage.getStoredTokens();
        if (retry.status === 401 && latest.accessToken === currentAccess && latest.refreshToken === currentRefresh) authStorage.clearStoredTokens();
        return retry;
      }
      return response;
    }

    if (
      response.status === 401 &&
      !isRetry &&
      !url.includes('/api/auth/login') &&
      !url.includes('/api/auth/refresh')
    ) {
      try {
        const refreshed = await this.refreshToken();
        const latest = authStorage.getStoredTokens();
        if (latest.accessToken !== refreshed.accessToken || (refreshed.refreshToken && latest.refreshToken !== refreshed.refreshToken)) {
          throw new Error('Phiên đăng nhập đã thay đổi.');
        }
        const { accessToken: retryToken, refreshToken: retryRefresh } = authStorage.getStoredTokens();
        const retryRes = await this.requestRaw(url, options, true);
        const retryLatest = authStorage.getStoredTokens();
        if (retryRes.status === 401 && retryLatest.accessToken === retryToken && retryLatest.refreshToken === retryRefresh) {
          authStorage.clearStoredTokens();
        }
        return retryRes;
      } catch (refreshErr) {
        const latest = authStorage.getStoredTokens();
        if ((refreshErr as any)?.status === 401 && latest.accessToken === accessToken && latest.refreshToken === requestRefresh) authStorage.clearStoredTokens();
        throw refreshErr;
      }
    }

    return response;
  }

  async request<T>(
    url: string,
    options: RequestInit = {},
    isRetry = false
  ): Promise<T> {
    const { accessToken: requestToken, refreshToken: requestRefresh } = authStorage.getStoredTokens();
    const response = await this.requestRaw(url, options, isRetry);

    let data: any = null;
    const contentType = response.headers?.get?.('content-type');
    if (contentType?.includes('application/json') || response.status !== 204) {
      try {
        data = await response.json();
      } catch {
        data = null;
      }
    }

    // Headers can arrive before a login transition while the body is still
    // pending. Check the token that owned this response again after JSON read.
    const responseToken = this.responseOwners.has(response) ? this.responseOwners.get(response)! : requestToken;
    const latestToken = authStorage.getStoredTokens().accessToken;
    if (latestToken !== responseToken && !sharesAuthSession(responseToken, latestToken)) throw new Error('Phiên đăng nhập đã thay đổi.');

    if (!response.ok) {
      const latest = authStorage.getStoredTokens();
      if (response.status === 401 && latest.accessToken === requestToken && latest.refreshToken === requestRefresh) {
        authStorage.clearStoredTokens();
      }
      const errCode = typeof data?.error === 'object' ? data.error?.code : typeof data?.code === 'string' ? data.code : typeof data?.error === 'string' && /^[A-Z0-9_]+$/.test(data.error) ? data.error : undefined;
      if (
        response.status === 403 &&
        (errCode === 'WORKSPACE_MEMBER_PENDING' ||
          errCode === 'WORKSPACE_MEMBER_DISABLED' ||
          errCode === 'WORKSPACE_ACCESS_DENIED') &&
        !url.includes('/api/workspaces/join') &&
        getActiveWorkspaceId() !== 'personal'
      ) {
        setActiveWorkspaceId('personal');
      }
      const rawErrorText = typeof data?.error === 'object' ? data.error?.message : data?.error;
      const preferredMessage =
        typeof rawErrorText === 'string' && /^[A-Z0-9_]+$/.test(rawErrorText) && typeof data?.message === 'string' && data.message
          ? data.message
          : rawErrorText || data?.message || `Request failed with status ${response.status}`;
      const error: any = new Error(preferredMessage);
      error.status = response.status;
      error.code = errCode;
      error.data = data;
      error.response = response;
      throw error;
    }

    return data as T;
  }

  // --- Auth ---
  private async publicAuthAction(path: string, body: object): Promise<AuthMessageResponse> {
    const response = await fetch(`/api/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || 'Không thể hoàn tất yêu cầu tài khoản.'), { status: response.status, data, response });
    return data;
  }
  signup(name: string, email: string, password: string) { return this.publicAuthAction('signup', { name, email, password }); }
  verifyEmail(token: string) { return this.publicAuthAction('verify-email', { token }); }
  resendVerification(email: string) { return this.publicAuthAction('resend-verification', { email }); }
  forgotPassword(email: string) { return this.publicAuthAction('forgot-password', { email }); }
  resetPassword(token: string, password: string) { return this.publicAuthAction('reset-password', { token, password }); }

  private async googleAuthAction<T>(path: string, body: object): Promise<T> {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    const { accessToken } = authStorage.getStoredTokens();
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    // OAuth state is one-use. Never refresh/retry this POST or mutate the session
    // here: the caller owns its lifecycle and may have logged out meanwhile.
    const response = await fetch(`/api/auth/google/${path}`, {
      method: 'POST', credentials: 'include', headers, body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error('Không thể hoàn tất đăng nhập Google.'), { status: response.status, data });
    return data;
  }
  startGoogleAuth(mode: 'login' | 'link' = 'login') {
    // A rejected authenticated start has not issued OAuth state yet. Recover
    // its owned session once, while keeping the one-use callback below separate.
    if (mode === 'link') return this.request<{ url: string }>('/api/auth/google/start', {
      method: 'POST', credentials: 'include', body: JSON.stringify({ mode }),
    });
    return this.googleAuthAction<{ url: string }>('start', { mode });
  }
  completeGoogleAuth(code: string, state: string) {
    return this.googleAuthAction<{ accessToken: string; refreshToken: string; user: User } | { success: true }>('callback', { code, state });
  }
  /** `returnTo`: the conversation to come back to after Google, `/c/<id>` (OAUTH-01). */
  startGmailConnection(options: { returnTo?: string } = {}) {
    return this.request<{ url: string }>('/api/connections/gmail/start', { method: 'POST', credentials: 'include',
      ...(options.returnTo ? { body: JSON.stringify({ returnTo: options.returnTo }) } : {}) });
  }
  completeGmailConnection(code: string, state: string) {
    // OAuth state is one-use. Never replay this request, including on a 401.
    return this.request<{ email: string; returnTo?: string }>('/api/connections/gmail/callback', {
      method: 'POST', credentials: 'include', body: JSON.stringify({ code, state }),
    }, true);
  }
  disconnectGmail() {
    return this.request<{ success: true }>('/api/connections/gmail', { method: 'DELETE', credentials: 'include' });
  }
  /** `returnTo`: the conversation to come back to after Google, `/c/<id>` (OAUTH-02). */
  startMyCalendarConnection(options: { returnTo?: string } = {}) {
    return this.request<{ url: string }>('/api/connections/mycalendar/start', {
      method: 'POST',
      credentials: 'include',
      ...(options.returnTo ? { body: JSON.stringify({ returnTo: options.returnTo }) } : {}),
    });
  }
  completeMyCalendarConnection(code: string, state: string) {
    // OAuth state is one-use. Never replay this request, including on a 401.
    return this.request<{
      status?: 'scope_required';
      email: string;
      calendars: Array<{ id: string; summary: string; timeZone?: string; primary?: boolean; accessRole?: 'owner' | 'writer' }>;
      selectedCalendars?: Array<{ id: string; summary: string; timeZone?: string; primary?: boolean }>;
      returnTo?: string;
    }>('/api/connections/mycalendar/callback', {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ code, state }),
    }, true);
  }
  listMyCalendarCalendars() {
    return this.request<{
      email: string;
      calendars: Array<{ id: string; summary: string; timeZone?: string; primary?: boolean; accessRole?: 'owner' | 'writer' }>;
      selectedCalendarIds: string[];
    }>('/api/connections/mycalendar/calendars', { credentials: 'include' });
  }
  saveMyCalendarScope(calendarIds: string[]) {
    return this.request<{
      status?: 'connected';
      email: string;
      selectedCalendars: Array<{ id: string; summary: string; timeZone?: string; primary?: boolean }>;
      allowedScope: string[];
    }>('/api/connections/mycalendar/scope', {
      method: 'PUT',
      credentials: 'include',
      body: JSON.stringify({ calendarIds }),
    });
  }
  selectPrimaryMyCalendar() {
    return this.request<{
      status?: 'connected';
      email: string;
      selectedCalendars: Array<{ id: string; summary: string; timeZone?: string; primary?: boolean }>;
      allowedScope: string[];
    }>('/api/connections/mycalendar/select-primary', {
      method: 'POST',
      credentials: 'include',
    });
  }
  disconnectMyCalendar() {
    return this.request<{ success: true }>('/api/connections/mycalendar', { method: 'DELETE', credentials: 'include' });
  }
  startMySheetsConnection(body?: { returnTo?: string }) {
    return this.request<{ url: string }>('/api/connections/mysheets/start', {
      method: 'POST',
      credentials: 'include',
      ...(body?.returnTo ? { body: JSON.stringify({ returnTo: body.returnTo }) } : {}),
    });
  }
  completeMySheetsConnection(body: { code: string; state: string }) {
    // OAuth state is one-use. Never replay this request, including on a 401.
    return this.request<{
      email: string;
      returnTo?: string;
    }>('/api/connections/mysheets/callback', {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify(body),
    }, true);
  }
  createMySheetsPickerSession() {
    return this.request<MySheetsPickerSession>('/api/connections/mysheets/picker-session', {
      method: 'POST',
      credentials: 'include',
    });
  }
  getMySheetsSpreadsheets() {
    return this.request<{
      email: string;
      selectedSpreadsheets: PersonalSpreadsheetItem[];
    }>('/api/connections/mysheets/spreadsheets', { credentials: 'include' });
  }
  saveMySheetsScope(body: { spreadsheetIds: string[] }) {
    return this.request<{
      email: string;
      selectedSpreadsheets: PersonalSpreadsheetItem[];
    }>('/api/connections/mysheets/scope', {
      method: 'PUT',
      credentials: 'include',
      body: JSON.stringify(body),
    });
  }
  disconnectMySheets() {
    return this.request<{ ok: boolean }>('/api/connections/mysheets', {
      method: 'DELETE',
      credentials: 'include',
    });
  }
  getTrelloConnection() {
    return this.request<{
      status: 'unconfigured' | 'not_connected' | 'reconnect_required' | 'needs_scope' | 'needs_membership' | 'connected';
      username?: string;
      workspaceName?: string;
      boards: Array<{ boardId: string; boardName: string; member: boolean }>;
    }>('/api/connections/trello', { credentials: 'include' });
  }
  startTrelloConnection(options: { returnTo?: string } = {}) {
    return this.request<{ url: string }>('/api/connections/trello/start', {
      method: 'POST',
      credentials: 'include',
      ...(options.returnTo ? { body: JSON.stringify({ returnTo: options.returnTo }) } : {}),
    });
  }
  completeTrelloConnection(code: string, state: string) {
    return this.request<{ username: string; returnTo?: string }>('/api/connections/trello/callback', {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ code, state }),
    }, true);
  }
  disconnectTrello() {
    return this.request<{ success: true }>('/api/connections/trello', {
      method: 'DELETE',
      credentials: 'include',
    });
  }
  getTrelloWorkspaces() {
    return this.request<{ workspaces: Array<{ id: string; name: string }> }>('/api/connections/trello/workspaces', {
      credentials: 'include',
    });
  }
  getTrelloBoards(workspaceId: string) {
    return this.request<{ boards: Array<{ id: string; name: string; member: boolean }> }>(
      `/api/connections/trello/workspaces/${encodeURIComponent(workspaceId)}/boards`,
      { credentials: 'include' }
    );
  }
  saveTrelloScope(workspaceId: string, boardIds: string[]) {
    return this.request<{
      chosenBy: string;
      workspaceId: string;
      workspaceName: string;
      boards: Array<{ boardId: string; boardName: string }>;
    }>('/api/connections/trello/scope', {
      method: 'PUT',
      credentials: 'include',
      body: JSON.stringify({ workspaceId, boardIds }),
    });
  }
  unlinkGoogle(currentPassword: string) {
    return this.request<{ success: true }>('/api/auth/google/unlink', {
      method: 'POST', credentials: 'include', body: JSON.stringify({ currentPassword }),
    });
  }

  async login(
    email: string,
    password: string
  ): Promise<{ accessToken: string; refreshToken?: string; user: User }> {
    const initial = authStorage.getStoredTokens();
    let invalidated = false;
    const unsubscribe = authStorage.subscribeAuthTokens(tokens => {
      if (!tokens.accessToken || tokens.accessToken !== initial.accessToken || tokens.refreshToken !== initial.refreshToken) invalidated = true;
    });
    try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json().catch(() => ({}));
    const latest = authStorage.getStoredTokens();
    if (invalidated || latest.accessToken !== initial.accessToken || latest.refreshToken !== initial.refreshToken) throw new Error('Phiên đăng nhập đã thay đổi.');
    if (!res.ok || !data.accessToken || !data.user) {
      const error: any = new Error(
        data.error || 'Không thể xác thực với API backend'
      );
      error.status = res.status;
      error.data = data;
      error.response = res;
      throw error;
    }

    unsubscribe();
    authStorage.setStoredTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || null,
      user: data.user,
    });

    return data;
    } finally { unsubscribe(); }
  }

  async refreshToken(): Promise<{ accessToken: string; refreshToken?: string }> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      const { refreshToken, accessToken } = authStorage.getStoredTokens();
      const ownsRefresh = () => {
        const latest = authStorage.getStoredTokens();
        return latest.refreshToken === refreshToken && latest.accessToken === accessToken;
      };
      if (!refreshToken) {
        throw Object.assign(new Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.'), { status: 401 });
      }

      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 409 && errData.code === 'REFRESH_ROTATED') {
          const stored = authStorage.getStoredTokens();
          if (stored.accessToken && stored.refreshToken && stored.refreshToken !== refreshToken && sharesAuthSession(accessToken, stored.accessToken)) {
            authStorage.setStoredTokens(stored);
            return { accessToken: stored.accessToken, refreshToken: stored.refreshToken };
          }
          if (!ownsRefresh()) throw new Error('Phiên đăng nhập đã thay đổi.');
          authStorage.clearStoredTokens();
          throw Object.assign(new Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.'), { status: 401 });
        }
        if (!ownsRefresh()) throw new Error('Phiên đăng nhập đã thay đổi.');
        if (res.status === 401) authStorage.clearStoredTokens();
        const err: any = new Error(errData.error || 'Failed to refresh token');
        err.status = res.status;
        throw err;
      }

      const data = await res.json();
      if (!ownsRefresh()) throw new Error('Phiên đăng nhập đã thay đổi.');
      authStorage.setStoredTokens({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken || refreshToken,
      });
      return data;
    })().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  async getMe(): Promise<{ user: User }> {
    return this.request<{ user: User }>('/api/auth/me');
  }

  async getAuthConfig(): Promise<{ signupEnabled: boolean; googleEnabled: boolean }> {
    const response = await fetch('/api/auth/config');
    if (!response.ok) throw new Error('Không tải được cấu hình đăng nhập.');
    const data = await response.json();
    return { signupEnabled: data.signupEnabled === true, googleEnabled: data.googleEnabled === true };
  }

  async logout(): Promise<{ success: boolean }> {
    return this.request('/api/auth/logout', { method: 'POST' });
  }

  async logoutAll(): Promise<{ success: boolean }> {
    return this.request('/api/auth/logout-all', { method: 'POST' });
  }

  async getRuntime(): Promise<{ runtimeMode: 'sandbox' | 'live'; gmailEnabled?: boolean; mycalendarEnabled?: boolean; mysheetsEnabled?: boolean; schedulesEnabled?: boolean }> {
    return this.request('/api/health');
  }

  getSchedules() { return this.request<{ schedules: ScheduleView[] }>('/api/schedules'); }
  getScheduleRuns(id: string, limit = 10) { return this.request<{ runs: ScheduleRunView[] }>(`/api/schedules/${encodeURIComponent(id)}/runs?limit=${limit}`); }
  getSchedulePendingCount() { return this.request<{ count: number }>('/api/schedules/pending-count'); }
  confirmSchedule(convId: string, messageId: string, approvalMode?: ScheduleApprovalMode) {
    return this.request<{ schedule: ScheduleView }>(
      `/api/conversations/${encodeURIComponent(convId)}/schedule-proposals/${encodeURIComponent(messageId)}/confirm`,
      {
        method: 'POST',
        ...(approvalMode ? { body: JSON.stringify({ approvalMode }) } : {}),
      }
    );
  }
  changeSchedule(id: string, action: 'pause' | 'resume' | 'cancel', version: number) { return this.request<{ schedule: ScheduleView }>(`/api/schedules/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: JSON.stringify({ version }) }); }
  runScheduleNow(id: string) { return this.request<{ run: ScheduleRunView }>(`/api/schedules/${encodeURIComponent(id)}/run-now`, { method: 'POST' }); }
  replanScheduleRun(id: string) { return this.request<{ run: ScheduleRunView }>(`/api/schedule-runs/${encodeURIComponent(id)}/replan`, { method: 'POST' }); }

  async getAdminUsers(options: { status?: 'pending' | 'active' | 'disabled'; search?: string; page?: number; limit?: number } = {}): Promise<AdminUserPage> {
    const query = new URLSearchParams();
    if (options.page !== undefined) query.set('page', String(options.page));
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    if (options.status) query.set('status', options.status);
    if (options.search) query.set('search', options.search);
    return this.request(`/api/admin/users${query.size ? `?${query}` : ''}`);
  }

  async changeAdminUser(id: string, action: 'approve' | 'disable' | 'enable' | 'role', role?: 'member' | 'admin'): Promise<{ user: AdminUser }> {
    return this.request(`/api/admin/users/${encodeURIComponent(id)}/${action}`, { method: 'POST', ...(action === 'role' ? { body: JSON.stringify({ role }) } : {}) });
  }

  async approveAllAdminUsers(): Promise<{ approvedCount: number; approvedUsers: AdminUser[] }> {
    return this.request('/api/admin/users/approve-all', { method: 'POST' });
  }

  async rejectAdminUser(id: string): Promise<{ rejectedId: string }> {
    return this.request(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ action: 'reject' }) });
  }

  // --- Workspaces ---
  async getWorkspaces(): Promise<WorkspacesListResponse> {
    return this.request<WorkspacesListResponse>('/api/workspaces');
  }

  async createWorkspace(name: string, requireApproval = true): Promise<{ workspace: WorkspaceSummary }> {
    return this.request<{ workspace: WorkspaceSummary }>('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name, requireApproval }),
    });
  }

  async joinWorkspace(inviteCode: string): Promise<{ workspace: WorkspaceSummary; created: boolean }> {
    return this.request<{ workspace: WorkspaceSummary; created: boolean }>('/api/workspaces/join', {
      method: 'POST',
      body: JSON.stringify({ inviteCode }),
    });
  }

  async regenerateInviteCode(workspaceId: string): Promise<{ inviteCode: string }> {
    return this.request<{ inviteCode: string }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/invite-code/regenerate`, {
      method: 'POST',
    });
  }

  async updateWorkspaceSettings(workspaceId: string, settings: { requireApproval: boolean }): Promise<{ requireApproval: boolean }> {
    return this.request<{ requireApproval: boolean }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(settings),
    });
  }

  // --- Own account (AUTH-05) ---
  async getAccount(): Promise<{ account: AccountProfile }> {
    return this.request('/api/account');
  }

  async updateAccountName(name: string): Promise<{ user: User }> {
    return this.request('/api/account/profile', { method: 'PATCH', body: JSON.stringify({ name }) });
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<{ message: string }> {
    return this.request('/api/account/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
  }

  async getAccountSessions(): Promise<{ sessions: AccountSession[] }> {
    return this.request('/api/account/sessions');
  }

  async revokeAccountSession(id: string): Promise<{ success: true }> {
    return this.request(`/api/account/sessions/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
  }

  async revokeOtherAccountSessions(): Promise<{ revoked: number }> {
    return this.request('/api/account/sessions/revoke-others', { method: 'POST' });
  }

  // --- Conversations ---
  async getConversations(options: { limit?: number; cursor?: string; search?: string } = {}): Promise<{ conversations: Conversation[]; nextCursor?: string | null }> {
    const query = new URLSearchParams();
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    if (options.cursor) query.set('cursor', options.cursor);
    if (options.search) query.set('search', options.search);
    return this.request(`/api/conversations${query.size ? `?${query}` : ''}`);
  }

  async renameConversation(id: string, title: string): Promise<{ conversation: Conversation }> {
    return this.request(`/api/conversations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ title }) });
  }

  async getConversation(
    id: string
  ): Promise<{ conversation: Conversation; messages: ChatMessage[] }> {
    return this.request<{ conversation: Conversation; messages: ChatMessage[] }>(
      `/api/conversations/${encodeURIComponent(id)}`
    );
  }

  async createConversation(
    title?: string
  ): Promise<{ conversation: Conversation }> {
    return this.request<{ conversation: Conversation }>('/api/conversations', {
      method: 'POST',
      body: title ? JSON.stringify({ title }) : undefined,
    });
  }

  // --- Messages ---
  async sendMessage(
    convId: string,
    content: string,
    tempId: string
  ): Promise<any> {
    return this.request<any>(`/api/conversations/${encodeURIComponent(convId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, tempId }),
    });
  }

  // --- Plans ---
  async getActivePlan(convId: string): Promise<ActivePlan | null> {
    try {
      const data = await this.request<any>(
        `/api/conversations/${encodeURIComponent(convId)}/plans/active`
      );
      return data;
    } catch (err: any) {
      if (err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  async approvePlan(planId: string): Promise<any> {
    return this.request<any>(`/api/plans/${planId}/approve`, {
      method: 'POST',
    });
  }

  async rejectPlan(planId: string): Promise<any> {
    return this.request<any>(`/api/plans/${planId}/reject`, {
      method: 'POST',
    });
  }

  // --- Executions ---
  async getLatestExecutionSnapshot(convId: string): Promise<ExecutionSnapshot | null> {
    try {
      return await this.request<ExecutionSnapshot>(`/api/conversations/${encodeURIComponent(convId)}/executions/latest`);
    } catch (err: any) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  async getExecutionStatus(planId: string): Promise<any> {
    return this.request<any>(`/api/executions/${planId}/status`);
  }

  async retryStep(planId: string, stepId: string): Promise<any> {
    return this.request<any>(
      `/api/executions/${planId}/steps/${stepId}/retry`,
      { method: 'POST' }
    );
  }

  async skipStep(planId: string, stepId: string): Promise<any> {
    return this.request<any>(`/api/executions/${planId}/steps/${stepId}/skip`, {
      method: 'POST',
    });
  }

  async stopExecution(planId: string): Promise<any> {
    return this.request<any>(`/api/executions/${planId}/stop`, {
      method: 'POST',
    });
  }

  async continueExecution(planId: string): Promise<any> {
    return this.request<any>(`/api/executions/${planId}/continue`, { method: 'POST' });
  }

  // --- Services ---
  async getServices(): Promise<{ services: ServiceInfo[]; canConfigure: boolean }> {
    return this.request<{ services: ServiceInfo[]; canConfigure: boolean }>('/api/services');
  }

  async saveServiceScope(
    service: string,
    allowedScope: string[] | Record<string, string[]>
  ): Promise<{ success: true; message: string }> {
    return this.request<{ success: true; message: string }>(`/api/services/${encodeURIComponent(service)}/scope`, {
      method: 'PUT',
      body: JSON.stringify({ allowedScope }),
    });
  }

  async testConnection(service: string, signal?: AbortSignal): Promise<any> {
    const res = await this.requestRaw(`/api/services/${service}/test`, {
      method: 'POST', signal,
    });
    const data = await res.json().catch(() => ({}));
    const success = res.ok && data.status === 'healthy';
    return {
      success,
      status: data.status,
      message:
        success
          ? data.message || 'Kết nối thành công'
          : data.error ||
            data.message ||
            `Kiểm tra kết nối thất bại (${res.status})`,
      latencyMs:
        success && typeof data.latencyMs === 'number'
          ? data.latencyMs
          : undefined,
      ...data,
    };
  }

  async saveCredentials(
    service: string,
    credentials: Record<string, string>,
    scope: string[]
  ): Promise<any> {
    return this.request<any>(`/api/services/${service}/credentials`, {
      method: 'POST',
      body: JSON.stringify({ credentials, allowedScope: scope }),
    });
  }
}

export const apiClient = new ApiClient();
