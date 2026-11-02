import type {
  CreateInviteResponse,
  CreateWorkspaceResponse,
  GetWorkspaceProjectsResponse,
  GetWorkspacesResponse,
  JiraConnectionStatusResponse,
  JiraOAuthCallbackResponse,
  JiraOAuthStartResponse,
  JiraSyncSitesResponse,
  JiraDisconnectResponse,
  ListWorkspaceInvitesResponse,
  ListWorkspaceMembersResponse,
  ListWorkspaceSitesResponse,
  LinkWorkspaceSiteResponse,
  UpdateWorkspaceSiteResponse,
  ConfigureWorkspaceProjectsResponse,
  WorkspaceJiraCapabilitiesResponse,
  WorkspaceJoinResponse,
  MemberDecisionResponse,
  RevokeInviteResponse,
} from '@wap/tool-schemas';
import { apiClient } from './api-client';

const json = (body: object): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
});

const workspace = (id: string) => `/api/jira-workspaces/${encodeURIComponent(id)}`;

export const jiraApi = {
  connection: () =>
    apiClient.request<JiraConnectionStatusResponse>('/api/connections/myjira'),

  start: (mode: 'identity' | 'authorize_sites', returnTo?: string) =>
    apiClient.request<JiraOAuthStartResponse>(
      '/api/connections/myjira/start',
      json({ mode, ...(returnTo ? { returnTo } : {}) })
    ),

  callback: (code: string, state: string) =>
    apiClient.request<JiraOAuthCallbackResponse & { returnTo?: string }>(
      '/api/connections/myjira/callback',
      json({ code, state }),
      true // One-use state: never retry or refresh on 401
    ),

  syncSites: () =>
    apiClient.request<JiraSyncSitesResponse>(
      '/api/connections/myjira/sync-sites',
      json({})
    ),

  disconnect: () =>
    apiClient.request<JiraDisconnectResponse>('/api/connections/myjira', {
      method: 'DELETE',
    }),

  workspaces: () =>
    apiClient.request<GetWorkspacesResponse>('/api/jira-workspaces'),

  createWorkspace: (name: string, slug: string, bootstrapAdminUserId: string) =>
    apiClient.request<CreateWorkspaceResponse>(
      '/api/admin/jira-workspaces',
      json({ name, slug, bootstrapAdminUserId })
    ),

  enableWorkspace: (id: string, slug: string, bootstrapAdminUserId: string) =>
    apiClient.request<CreateWorkspaceResponse>(
      `/api/admin/jira-workspaces/${encodeURIComponent(id)}/enable`,
      json({ slug, bootstrapAdminUserId })
    ),

  archiveWorkspace: (id: string, expectedVersion: number) =>
    apiClient.request<{ archived: boolean; version: number }>(
      `/api/admin/jira-workspaces/${encodeURIComponent(id)}/archive`,
      json({ expectedVersion })
    ),

  recoverAdmin: (id: string, targetUserId: string) =>
    apiClient.request<{ recovered: boolean }>(
      `/api/admin/jira-workspaces/${encodeURIComponent(id)}/recover-admin`,
      json({ targetUserId })
    ),

  join: (inviteToken: string) =>
    apiClient.request<WorkspaceJoinResponse>(
      '/api/jira-workspace-join-requests',
      json({ inviteToken })
    ),

  members: (id: string) =>
    apiClient.request<ListWorkspaceMembersResponse>(`${workspace(id)}/members`),

  decision: (
    id: string,
    userId: string,
    expectedVersion: number,
    decision: 'approve' | 'reject' | 'remove'
  ) =>
    apiClient.request<MemberDecisionResponse>(
      `${workspace(id)}/members/${encodeURIComponent(userId)}/decision`,
      json({ expectedVersion, decision })
    ),

  invites: (id: string) =>
    apiClient.request<ListWorkspaceInvitesResponse>(`${workspace(id)}/invites`),

  createInvite: (id: string, expiresInDays?: number) =>
    apiClient.request<CreateInviteResponse>(
      `${workspace(id)}/invites`,
      json(expiresInDays ? { expiresInDays } : {})
    ),

  revokeInvite: (id: string, inviteId: string) =>
    apiClient.request<RevokeInviteResponse>(
      `${workspace(id)}/invites/${encodeURIComponent(inviteId)}`,
      { method: 'DELETE' }
    ),

  sites: (id: string) =>
    apiClient.request<ListWorkspaceSitesResponse>(`${workspace(id)}/jira-sites`),

  linkSite: (id: string, cloudId: string) =>
    apiClient.request<LinkWorkspaceSiteResponse>(
      `${workspace(id)}/jira-sites`,
      json({ cloudId })
    ),

  updateSite: (
    id: string,
    siteId: string,
    expectedPolicyVersion: number,
    active: boolean
  ) =>
    apiClient.request<UpdateWorkspaceSiteResponse>(
      `${workspace(id)}/jira-sites/${encodeURIComponent(siteId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ expectedPolicyVersion, active }),
      }
    ),

  projects: (id: string, siteId: string) =>
    apiClient.request<GetWorkspaceProjectsResponse>(
      `${workspace(id)}/jira-sites/${encodeURIComponent(siteId)}/projects`
    ),

  configureProjects: (
    id: string,
    siteId: string,
    expectedPolicyVersion: number,
    selectedProjectIds: string[]
  ) =>
    apiClient.request<ConfigureWorkspaceProjectsResponse>(
      `${workspace(id)}/jira-sites/${encodeURIComponent(siteId)}/projects`,
      {
        method: 'PUT',
        body: JSON.stringify({ expectedPolicyVersion, selectedProjectIds }),
      }
    ),

  capabilities: (id: string) =>
    apiClient.request<WorkspaceJiraCapabilitiesResponse>(
      `${workspace(id)}/jira-capabilities`
    ),
};
