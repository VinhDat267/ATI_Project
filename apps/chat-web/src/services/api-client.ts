import { authStorage } from './auth-storage';
import type {
  ActivePlan,
  ChatMessage,
  Conversation,
  ServiceInfo,
  User,
  ExecutionSnapshot,
} from '../types';

export class ApiClient {
  private refreshPromise: Promise<any> | null = null;

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
    const { accessToken } = authStorage.getStoredTokens();
    if (accessToken) {
      if (isRetry || !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${accessToken}`);
      }
    }

    const response = await fetch(url, { ...options, headers });

    if (
      response.status === 401 &&
      !isRetry &&
      !url.includes('/api/auth/login') &&
      !url.includes('/api/auth/refresh')
    ) {
      try {
        await this.refreshToken();
        const retryRes = await this.requestRaw(url, options, true);
        if (retryRes.status === 401) {
          authStorage.clearStoredTokens();
        }
        return retryRes;
      } catch (refreshErr) {
        if ((refreshErr as {status?:number}).status !== 409) authStorage.clearStoredTokens();
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

    if (!response.ok) {
      if (response.status === 401) {
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
  async getAuthConfig(): Promise<{signupEnabled:boolean;googleEnabled:boolean}> {
    return this.request('/api/auth/config');
  }
  async signup(data:{name:string;email:string;password:string}):Promise<{message:string}> {
    return this.request('/api/auth/signup',{method:'POST',body:JSON.stringify(data)});
  }
  async verifyEmail(token:string):Promise<{message:string}> {
    return this.request('/api/auth/verify-email',{method:'POST',body:JSON.stringify({token})});
  }
  async resendVerification(email:string):Promise<{message:string}> {
    return this.request('/api/auth/resend-verification',{method:'POST',body:JSON.stringify({email})});
  }
  async logout():Promise<void> {
    return this.request('/api/auth/logout',{method:'POST',signal:AbortSignal.timeout(5000)});
  }
  async getPendingUsers(page=1,q=''):Promise<{users:Array<User & {createdAt:string}>;total:number;page:number}> {
    return this.request(`/api/admin/users?page=${page}&q=${encodeURIComponent(q)}`);
  }
  async approveUser(id:string):Promise<{user:User}> {
    return this.request(`/api/admin/users/${encodeURIComponent(id)}/approve`,{method:'POST'});
  }
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
      const { refreshToken } = authStorage.getStoredTokens();
      if (!refreshToken) {
        throw new Error('No refresh token available');
      }

      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if(res.status===409&&errData.code==='REFRESH_ROTATED') {
          // The winning tab may still be receiving its response. Keep its
          // session intact and briefly wait for the shared storage update.
          for (const delay of [0,150,300,500,800]) {
            if (delay) await new Promise(resolve=>setTimeout(resolve,delay));
            const latest=authStorage.getStoredTokens();
            if(latest.refreshToken&&latest.refreshToken!==refreshToken&&latest.accessToken)
              return {accessToken:latest.accessToken,refreshToken:latest.refreshToken};
          }
        }
        if(res.status!==409) authStorage.clearStoredTokens();
        const err: any = new Error(errData.error || 'Failed to refresh token');
        err.status = res.status;
        throw err;
      }

      const data = await res.json();
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

  // --- Conversations ---
  async getConversations(filter: 'active' | 'archived' | 'deleted' = 'active'): Promise<{ conversations: Conversation[] }> {
    return this.request<{ conversations: Conversation[] }>(filter === 'active' ? '/api/conversations' : `/api/conversations?filter=${filter}`);
  }

  async archiveConversation(id: string): Promise<{ conversation: Conversation }> {
    return this.request(`/api/conversations/${encodeURIComponent(id)}/archive`, { method: 'POST' });
  }

  async restoreConversation(id: string): Promise<{ conversation: Conversation }> {
    return this.request(`/api/conversations/${encodeURIComponent(id)}/restore`, { method: 'POST' });
  }

  async deleteConversation(id: string): Promise<void> {
    return this.request(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
