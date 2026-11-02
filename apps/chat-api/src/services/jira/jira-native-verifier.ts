import type { JiraTokenManager } from './jira-token-manager.js';
import type {
  NativeAdminVerifier,
  NativeAdminVerifierEvidence,
  NativeAdminVerifierResult,
} from '../../db/repositories/workspace/workspace-site-project-repo.js';

export interface JiraNativeVerifierOptions {
  tokenManager: JiraTokenManager;
  mode?: 'fixture' | 'live';
  fixtureBaseUrl?: string;
  fetchFn?: typeof fetch;
}

export interface NativeUserPermissionsEvidence {
  actorId: string;
  workspaceId?: string;
  cloudId: string;
  projectId?: string;
  [key: string]: unknown;
}

export interface NativeUserPermissionsResult {
  canBrowse: boolean;
  canCreateIssue: boolean;
  canAddComment: boolean;
  status?: 'granted' | 'denied' | 'unavailable';
  reason?: string;
}

export interface ExtendedNativeVerifier extends NativeAdminVerifier {
  verifyUserPermissions(
    evidence: NativeUserPermissionsEvidence,
    options?: { signal?: AbortSignal }
  ): Promise<NativeUserPermissionsResult>;
}

const ATLASSIAN_API_BASE = 'https://api.atlassian.com';

export class JiraNativeVerifier implements ExtendedNativeVerifier {
  private readonly tokenManager: JiraTokenManager;
  private readonly mode: 'fixture' | 'live';
  private readonly fixtureBaseUrl?: string;
  private readonly fetchFn: typeof fetch;
  private readonly cache = new Map<string, { expiresAt: number; value: unknown }>();

  clearCache(): void {
    this.cache.clear();
  }

  private getCached<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  private putCached<T>(key: string, value: T): void {
    if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { expiresAt: Date.now() + 60_000, value });
  }

  private async boundedFetch(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; json: () => Promise<any> }> {
    const response = await this.fetchFn(url, { ...init, redirect: 'error' });
    const maxBytes = 65_536;
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw new Error('Jira provider response exceeds 64 KB limit');
    }
    return {
      ok: response.ok,
      status: response.status,
      json: async () => {
        if (!response.body) return response.json();
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) throw new Error('Jira provider response exceeds 64 KB limit');
            chunks.push(value);
          }
        } catch (error) {
          await reader.cancel().catch(() => {});
          throw error;
        } finally {
          reader.releaseLock();
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return JSON.parse(new TextDecoder().decode(bytes));
      },
    };
  }
  constructor(options: JiraNativeVerifierOptions) {
    this.tokenManager = options.tokenManager;
    this.mode = options.mode ?? 'live';
    if (this.mode === 'fixture') {
      if (!options.fixtureBaseUrl) throw new Error('Jira fixture URL is required');
      const parsed = new URL(options.fixtureBaseUrl);
      const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(hostname) || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')) {
        throw new Error('Invalid Jira fixture URL');
      }
    }
    this.fixtureBaseUrl = options.fixtureBaseUrl;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private getBaseUrl(): string {
    if (this.mode === 'fixture' && this.fixtureBaseUrl) {
      try {
        const parsed = new URL(this.fixtureBaseUrl);
        if (
          parsed.hostname === '127.0.0.1' ||
          parsed.hostname === 'localhost' ||
          parsed.hostname === '::1'
        ) {
          return this.fixtureBaseUrl.replace(/\/$/, '');
        }
      } catch {
        // Fall back to fixed base if URL parsing fails
      }
      throw new Error('Invalid Jira fixture URL');
    }
    return ATLASSIAN_API_BASE;
  }

  async verifyAdminister(
    evidence: NativeAdminVerifierEvidence,
    options?: { signal?: AbortSignal }
  ): Promise<NativeAdminVerifierResult> {
    if (options?.signal?.aborted) throw options.signal.reason ?? new Error('Caller aborted');
    const cacheKey = JSON.stringify(['admin', evidence.actorId, evidence.localAccountId, evidence.atlassianAccountId, evidence.grantId, evidence.identityVersion, evidence.workspaceId, evidence.cloudId, evidence.operation]);
    const cached = this.getCached<NativeAdminVerifierResult>(cacheKey);
    if (cached) return cached;
    try {
      const token = await this.tokenManager.getAccessToken(evidence.actorId, {
        signal: options?.signal,
      });

      if (!token) {
        return {
          status: 'unavailable',
          reason: 'Failed to acquire access token for actor',
        };
      }

      const baseUrl = this.getBaseUrl();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      };

      // 1. Check ADMINISTER permission via /mypermissions?permissions=ADMINISTER
      const myPermsUrl = `${baseUrl}/ex/jira/${encodeURIComponent(evidence.cloudId)}/rest/api/3/mypermissions?permissions=ADMINISTER`;
      const myPermsRes = await this.boundedFetch(myPermsUrl, {
        method: 'GET',
        headers,
        signal: options?.signal,
      });

      if (!myPermsRes.ok) {
        if (myPermsRes.status === 401 || myPermsRes.status === 403) {
          return {
            status: 'denied',
            reason: `Jira permission check returned HTTP ${myPermsRes.status}`,
          };
        }
        return {
          status: 'unavailable',
          reason: `Jira permission check failed with HTTP ${myPermsRes.status}`,
        };
      }

      const myPermsData = (await myPermsRes.json()) as any;
      const administerPerm = myPermsData?.permissions?.ADMINISTER;
      const hasAdminister =
        administerPerm === true || administerPerm?.havePermission === true;

      if (!hasAdminister) {
        return {
          status: 'denied',
          reason: 'Actor lacks ADMINISTER permission on this Jira site',
        };
      }

      // 2. Fetch accessible resources to resolve site metadata (siteName, siteUrl)
      let siteName = '';
      let siteUrl = '';

      try {
        const resourcesUrl = `${baseUrl}/oauth/token/accessible-resources`;
        const resourcesRes = await this.boundedFetch(resourcesUrl, {
          method: 'GET',
          headers,
          signal: options?.signal,
        });

        if (resourcesRes.ok) {
          const resourcesData = (await resourcesRes.json()) as any;
          if (Array.isArray(resourcesData)) {
            const matchedSite = resourcesData.find(
              (s: any) => s.id === evidence.cloudId || s.cloudId === evidence.cloudId
            );
            if (matchedSite) {
              siteName = matchedSite.name ?? matchedSite.siteName ?? '';
              siteUrl = matchedSite.url ?? matchedSite.siteUrl ?? '';
            }
          }
        }
      } catch {
        // Soft-fail metadata resolution if accessible-resources is unreachable
      }

      // 3. Fetch projects via /project/search
      const projectSearchUrl = `${baseUrl}/ex/jira/${encodeURIComponent(evidence.cloudId)}/rest/api/3/project/search`;
      const projectSearchRes = await this.boundedFetch(projectSearchUrl, {
        method: 'GET',
        headers,
        signal: options?.signal,
      });

      if (!projectSearchRes.ok) {
        return {
          status: 'unavailable',
          reason: `Failed to fetch projects with HTTP ${projectSearchRes.status}`,
        };
      }

      const searchData = (await projectSearchRes.json()) as any;
      const rawProjects = Array.isArray(searchData)
        ? searchData
        : Array.isArray(searchData?.values)
          ? searchData.values
          : [];

      const verifiedProjects = rawProjects.map((p: any) => ({
        projectId: String(p.id ?? p.projectId),
        key: String(p.key),
        name: String(p.name),
      }));

      const verifiedProjectIds = verifiedProjects.map((p: { projectId: string }) => p.projectId);

      const result: NativeAdminVerifierResult = { status: 'granted', siteName, siteUrl, verifiedProjectIds, verifiedProjects };
      this.putCached(cacheKey, result);
      return result;
    } catch (err: any) {
      if (err?.name === 'AbortError' || options?.signal?.aborted) {
        throw err;
      }
      return {
        status: 'unavailable',
        reason: 'Jira provider unavailable',
      };
    }
  }

  async verifyUserPermissions(
    evidence: NativeUserPermissionsEvidence,
    options?: { signal?: AbortSignal }
  ): Promise<NativeUserPermissionsResult> {
    if (options?.signal?.aborted) throw options.signal.reason ?? new Error('Caller aborted');
    const cacheKey = JSON.stringify(['user', evidence.actorId, evidence.localAccountId, evidence.identityVersion, evidence.workspaceId, evidence.cloudId, evidence.projectId ?? null]);
    const cached = this.getCached<NativeUserPermissionsResult>(cacheKey);
    if (cached) return cached;
    try {
    const token = await this.tokenManager.getAccessToken(evidence.actorId, {
      signal: options?.signal,
    });
    if (!token) return { canBrowse: false, canCreateIssue: false, canAddComment: false, status: 'unavailable' };

    const baseUrl = this.getBaseUrl();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };

    const permissions = 'BROWSE_PROJECTS,CREATE_ISSUES,ADD_COMMENTS';
    let url = `${baseUrl}/ex/jira/${encodeURIComponent(evidence.cloudId)}/rest/api/3/mypermissions?permissions=${permissions}`;
    if (evidence.projectId) {
      url += `&projectId=${encodeURIComponent(evidence.projectId)}`;
    }

    const res = await this.boundedFetch(url, {
      method: 'GET',
      headers,
      signal: options?.signal,
    });

    if (!res.ok) return { canBrowse: false, canCreateIssue: false, canAddComment: false, status: res.status === 401 || res.status === 403 ? 'denied' : 'unavailable' };
    const data = (await res.json()) as any;
    const resolvePerm = (permKey: string, aliasKey: string): boolean => {
      const candidate =
        data?.permissions?.[permKey] ??
        data?.permissions?.[aliasKey] ??
        data?.[permKey] ??
        data?.[aliasKey];

      if (typeof candidate === 'boolean') {
        return candidate;
      }
      if (candidate && typeof candidate === 'object') {
        if (typeof candidate.havePermission === 'boolean') {
          return candidate.havePermission;
        }
        if (typeof candidate.granted === 'boolean') {
          return candidate.granted;
        }
      }
      return false;
    };

    const result: NativeUserPermissionsResult = {
      canBrowse: resolvePerm('BROWSE_PROJECTS', 'canBrowse'),
      canCreateIssue: resolvePerm('CREATE_ISSUES', 'canCreateIssue'),
      canAddComment: resolvePerm('ADD_COMMENTS', 'canAddComment'),
      status: 'granted',
    };
    if (res.ok) this.putCached(cacheKey, result);
    return result;
    } catch (error) {
      if (options?.signal?.aborted) throw error;
      return { canBrowse: false, canCreateIssue: false, canAddComment: false, status: 'unavailable' };
    }
  }
}
