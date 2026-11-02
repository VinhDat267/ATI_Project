export type JiraConnectionState =
  | 'disconnected'
  | 'identity_connected'
  | 'scope_required'
  | 'reconnect_required'
  | 'connected';

export interface JiraOAuthStartRequest {
  mode: 'identity' | 'authorize_sites';
  returnTo?: string;
}

export interface JiraOAuthStartResponse {
  authUrl: string;
}

export interface JiraOAuthCallbackRequest {
  code: string;
  state: string;
}

export interface JiraOAuthCallbackResponse {
  connected: boolean;
  connectionState: JiraConnectionState;
  jiraAccountId: string;
  atlassianAccountId: string;
  displayName?: string;
  siteCount: number;
}

export interface JiraConnectionStatusResponse {
  connected: boolean;
  connectionState: JiraConnectionState;
  jiraAccountId: string | null;
  atlassianAccountId: string | null;
  displayName?: string;
  sites: Array<{ cloudId: string; name: string; url: string; lastVerifiedAt?: string }>;
}

export interface JiraSyncSitesResponse {
  syncedCount: number;
  sites: Array<{ cloudId: string; name: string; url: string }>;
}

export interface JiraDisconnectResponse {
  disconnected: boolean;
  revokedAt: string;
  identityVersion: number;
}

export interface CreateWorkspaceRequest {
  name: string;
  slug: string;
  bootstrapAdminUserId: string;
}

export interface CreateWorkspaceResponse {
  workspace: { id: string; name: string; slug: string; version: number };
}

export interface WorkspaceJoinRequest {
  inviteToken: string;
}

export interface WorkspaceJoinResponse {
  requestId: string;
  workspaceId: string;
  status: 'pending';
}

export interface MemberDecisionRequest {
  expectedVersion: number;
  decision: 'approve' | 'reject' | 'remove';
}

export interface MemberDecisionResponse {
  status: 'active' | 'rejected' | 'removed';
  version: number;
}

export interface CreateInviteRequest {
  expiresInDays?: number;
}

export interface CreateInviteResponse {
  inviteId: string;
  inviteToken: string;
  expiresAt: string;
}

export interface WorkspaceJiraCapabilitiesResponse {
  workspaceId: string;
  sites: Array<{
    siteId: string;
    cloudId: string;
    name: string;
    url: string;
    projects: Array<{ id: string; key: string; name: string }>;
  }>;
}

// ============================================================================
// Workspace Roles, Summaries & Member Administration
// ============================================================================

export type WorkspaceMembershipStatus = 'pending' | 'active' | 'rejected' | 'removed';
export type WorkspaceRole = 'admin' | 'member';

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
  membershipStatus: WorkspaceMembershipStatus;
  workspaceVersion: number;
  membershipVersion: number;
}

export interface GetWorkspacesResponse {
  workspaces: WorkspaceSummary[];
}

export interface WorkspaceMemberItem {
  userId: string;
  role: WorkspaceRole;
  status: WorkspaceMembershipStatus;
  version: number;
  joinedAt?: string;
}

export interface ListWorkspaceMembersResponse {
  members: WorkspaceMemberItem[];
}

// ============================================================================
// Workspace Site & Project Administration
// ============================================================================

export interface WorkspaceSiteItem {
  siteId: string;
  cloudId: string;
  name: string;
  url: string;
  active: boolean;
  policyVersion: number;
}

export interface ListWorkspaceSitesResponse {
  sites: WorkspaceSiteItem[];
}

/**
 * Browser request to link a site.
 * Client provides cloudId ONLY; server resolves authoritative name/url from verified grant
 * and checks native ADMINISTER authority.
 */
export interface LinkWorkspaceSiteRequest {
  cloudId: string;
}

export interface LinkWorkspaceSiteResponse {
  site: WorkspaceSiteItem;
}

export interface UpdateWorkspaceSiteRequest {
  expectedPolicyVersion: number;
  active: boolean;
}

export interface UpdateWorkspaceSiteResponse {
  site: WorkspaceSiteItem;
}

export interface WorkspaceProjectItem {
  projectId: string; // stable provider numeric ID
  key: string;
  name: string;
  selected: boolean;
}

export interface GetWorkspaceProjectsResponse {
  sitePolicyVersion: number;
  projects: WorkspaceProjectItem[];
}

/**
 * Request to configure selected projects for a workspace Jira site.
 * selectedProjectIds is untrusted input; Backend validation rejects wildcards,
 * verifies numeric provider IDs, and enforces native permissions under CAS.
 */
export interface ConfigureWorkspaceProjectsRequest {
  expectedPolicyVersion: number;
  selectedProjectIds: string[];
}

export interface ConfigureWorkspaceProjectsResponse {
  sitePolicyVersion: number;
  updatedCount: number;
}

// ============================================================================
// Workspace Invites Administration (Secret-Free Listings & Revocation)
// ============================================================================

export interface WorkspaceInviteItem {
  id: string;
  workspaceId: string;
  inviterUserId: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface ListWorkspaceInvitesResponse {
  invites: WorkspaceInviteItem[];
}

export interface RevokeInviteResponse {
  revoked: boolean;
  revokedAt: string;
}

// ============================================================================
// Error Taxonomy & Error Factory
// ============================================================================

export type JiraApiErrorCategory =
  | 'upstream_auth'
  | 'upstream_not_found'
  | 'upstream_rate_limited'
  | 'upstream_unavailable'
  | 'upstream_error'
  | 'native_permission_denied'
  | 'reconnect_required'
  | 'membership_required'
  | 'workspace_not_found'
  | 'stale_version'
  | 'write_indeterminate';

export interface JiraApiError {
  category: JiraApiErrorCategory;
  status: number;
  message: string;
  retryable: boolean;
  suggestedAction?: 'reconnect' | 'request_membership' | 'refresh_page' | 'retry_later';
}

interface ErrorCategoryMetadata {
  status: number;
  retryable: boolean;
  suggestedAction?: 'reconnect' | 'request_membership' | 'refresh_page' | 'retry_later';
}

const ERROR_CATEGORY_MAP: Record<JiraApiErrorCategory, ErrorCategoryMetadata> = {
  native_permission_denied: { status: 403, retryable: false },
  upstream_auth: { status: 401, retryable: false, suggestedAction: 'reconnect' },
  workspace_not_found: { status: 404, retryable: false },
  upstream_not_found: { status: 404, retryable: false },
  upstream_rate_limited: { status: 429, retryable: true, suggestedAction: 'retry_later' },
  upstream_unavailable: { status: 503, retryable: true, suggestedAction: 'retry_later' },
  upstream_error: { status: 502, retryable: false },
  reconnect_required: { status: 403, retryable: false, suggestedAction: 'reconnect' },
  membership_required: { status: 403, retryable: false, suggestedAction: 'request_membership' },
  stale_version: { status: 409, retryable: false, suggestedAction: 'refresh_page' },
  write_indeterminate: { status: 500, retryable: false },
};

/**
 * Creates a sanitized JiraApiError projecting safe metadata.
 * The message MUST already be sanitized by Backend before invocation; this factory
 * does not attempt to redact arbitrary text inside the message.
 * Overrides or extra arguments are strictly ignored to prevent tampering with error categories,
 * HTTP statuses, or retryability (especially for write_indeterminate).
 */
export function createJiraApiError(
  category: JiraApiErrorCategory,
  message: string
): JiraApiError {
  if (
    typeof category !== 'string' ||
    !Object.prototype.hasOwnProperty.call(ERROR_CATEGORY_MAP, category)
  ) {
    throw new TypeError('Unknown or invalid JiraApiErrorCategory');
  }

  const meta = ERROR_CATEGORY_MAP[category];

  const result: JiraApiError = {
    category,
    status: meta.status,
    message: typeof message === 'string' ? message : String(message),
    retryable: meta.retryable,
  };

  if (meta.suggestedAction) {
    result.suggestedAction = meta.suggestedAction;
  }

  return result;
}
