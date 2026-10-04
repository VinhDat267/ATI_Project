import { authStorage } from './auth-storage';
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
      const error: any = new Error(
        data?.error ||
          data?.message ||
          `Request failed with status ${response.status}`
      );
      error.status = response.status;
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
    if (!response.ok) throw Object.assign(new Error(data.error || 'Không thể hoàn tất yêu cầu tài khoản.'), { status: response.status, data });
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
    return this.googleAuthAction<{ url: string }>('start', { mode });
  }
  completeGoogleAuth(code: string, state: string) {
    return this.googleAuthAction<{ accessToken: string; refreshToken: string; user: User } | { success: true }>('callback', { code, state });
  }
  unlinkGoogle() { return this.googleAuthAction<{ success: true }>('unlink', {}); }

  async login(
    email: string,
    password: string
  ): Promise<{ accessToken: string; refreshToken?: string; user: User }> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.accessToken || !data.user) {
      const error: any = new Error(
        data.error || 'Không thể xác thực với API backend'
      );
      error.status = res.status;
      error.data = data;
      throw error;
    }

    authStorage.setStoredTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || null,
      user: data.user,
    });

    return data;
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

  async getRuntime(): Promise<{ runtimeMode: 'sandbox' | 'live' }> {
    return this.request('/api/health');
  }

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
      `/api/conversations/${id}`
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
    return this.request<any>(`/api/conversations/${convId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, tempId }),
    });
  }

  // --- Plans ---
  async getActivePlan(convId: string): Promise<ActivePlan | null> {
    try {
      const data = await this.request<any>(
        `/api/conversations/${convId}/plans/active`
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
      return await this.request<ExecutionSnapshot>(`/api/conversations/${convId}/executions/latest`);
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
  async getServices(): Promise<{ services: ServiceInfo[] }> {
    return this.request<{ services: ServiceInfo[] }>('/api/services');
  }

  async testConnection(service: string): Promise<any> {
    const res = await this.requestRaw(`/api/services/${service}/test`, {
      method: 'POST',
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
