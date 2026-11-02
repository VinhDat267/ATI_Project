import { describe, it, expect, vi, beforeEach } from 'vitest';
import { jiraApi } from '../src/services/jira-api';
import { apiClient } from '../src/services/api-client';

describe('jiraApi facade', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls status endpoint', async () => {
    const spy = vi.spyOn(apiClient, 'request').mockResolvedValue({
      connected: true,
      connectionState: 'connected',
      jiraAccountId: 'acc-1',
      atlassianAccountId: 'atl-1',
      displayName: 'Alice Jira',
      sites: [],
    } as any);

    const res = await jiraApi.connection();
    expect(spy).toHaveBeenCalledWith('/api/connections/myjira');
    expect(res.connectionState).toBe('connected');
  });

  it('calls start endpoint with mode and optional returnTo', async () => {
    const spy = vi.spyOn(apiClient, 'request').mockResolvedValue({ authUrl: 'https://auth.atlassian.com/test' } as any);

    await jiraApi.start('identity', '/c/11111111-2222-4333-8444-555555555555');
    expect(spy).toHaveBeenCalledWith(
      '/api/connections/myjira/start',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ mode: 'identity', returnTo: '/c/11111111-2222-4333-8444-555555555555' }),
      })
    );
  });

  it('calls callback endpoint with isRetry = true so it never replays on 401', async () => {
    const spy = vi.spyOn(apiClient, 'request').mockResolvedValue({
      connected: true,
      connectionState: 'connected',
      jiraAccountId: 'acc-1',
      atlassianAccountId: 'atl-1',
      siteCount: 1,
    } as any);

    await jiraApi.callback('auth-code', 'state-token');
    expect(spy).toHaveBeenCalledWith(
      '/api/connections/myjira/callback',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ code: 'auth-code', state: 'state-token' }),
      }),
      true
    );
  });

  it('calls syncSites and disconnect endpoints', async () => {
    const syncSpy = vi.spyOn(apiClient, 'request').mockResolvedValue({ syncedCount: 1, sites: [] } as any);
    await jiraApi.syncSites();
    expect(syncSpy).toHaveBeenCalledWith(
      '/api/connections/myjira/sync-sites',
      expect.objectContaining({ method: 'POST' })
    );

    const disSpy = vi.spyOn(apiClient, 'request').mockResolvedValue({ disconnected: true, revokedAt: '2026-11-02T00:00:00Z', identityVersion: 1 } as any);
    await jiraApi.disconnect();
    expect(disSpy).toHaveBeenCalledWith('/api/connections/myjira', expect.objectContaining({ method: 'DELETE' }));
  });

  it('calls workspace listing, join, members, decisions, invites, sites, projects, and capabilities', async () => {
    const spy = vi.spyOn(apiClient, 'request').mockResolvedValue({} as any);
    const wsId = 'ws-123';

    await jiraApi.workspaces();
    expect(spy).toHaveBeenCalledWith('/api/jira-workspaces');

    await jiraApi.join('test-invite-token-32-chars-long-abc');
    expect(spy).toHaveBeenCalledWith('/api/jira-workspace-join-requests', expect.objectContaining({ method: 'POST' }));

    await jiraApi.members(wsId);
    expect(spy).toHaveBeenCalledWith(`/api/jira-workspaces/${wsId}/members`);

    await jiraApi.decision(wsId, 'user-456', 2, 'approve');
    expect(spy).toHaveBeenCalledWith(
      `/api/jira-workspaces/${wsId}/members/user-456/decision`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ expectedVersion: 2, decision: 'approve' }) })
    );

    await jiraApi.invites(wsId);
    expect(spy).toHaveBeenCalledWith(`/api/jira-workspaces/${wsId}/invites`);

    await jiraApi.createInvite(wsId, 7);
    expect(spy).toHaveBeenCalledWith(
      `/api/jira-workspaces/${wsId}/invites`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ expiresInDays: 7 }) })
    );

    await jiraApi.revokeInvite(wsId, 'inv-789');
    expect(spy).toHaveBeenCalledWith(`/api/jira-workspaces/${wsId}/invites/inv-789`, expect.objectContaining({ method: 'DELETE' }));

    await jiraApi.sites(wsId);
    expect(spy).toHaveBeenCalledWith(`/api/jira-workspaces/${wsId}/jira-sites`);

    await jiraApi.linkSite(wsId, 'cloud-abc');
    expect(spy).toHaveBeenCalledWith(
      `/api/jira-workspaces/${wsId}/jira-sites`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ cloudId: 'cloud-abc' }) })
    );

    await jiraApi.updateSite(wsId, 'site-999', 3, false);
    expect(spy).toHaveBeenCalledWith(
      `/api/jira-workspaces/${wsId}/jira-sites/site-999`,
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ expectedPolicyVersion: 3, active: false }) })
    );

    await jiraApi.projects(wsId, 'site-999');
    expect(spy).toHaveBeenCalledWith(`/api/jira-workspaces/${wsId}/jira-sites/site-999/projects`);

    await jiraApi.configureProjects(wsId, 'site-999', 4, ['10001', '10002']);
    expect(spy).toHaveBeenCalledWith(
      `/api/jira-workspaces/${wsId}/jira-sites/site-999/projects`,
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ expectedPolicyVersion: 4, selectedProjectIds: ['10001', '10002'] }) })
    );

    await jiraApi.capabilities(wsId);
    expect(spy).toHaveBeenCalledWith(`/api/jira-workspaces/${wsId}/jira-capabilities`);
  });
});
