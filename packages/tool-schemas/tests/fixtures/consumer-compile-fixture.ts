/**
 * Consumer Compile Fixture for JIRA-02 Contracts.
 *
 * This file is typechecked by `npx tsc --noEmit -p packages/tool-schemas/tsconfig.contracts.json`
 * to verify contract type safety, interface shapes, protocol boundaries, and negative constraints
 * (@ts-expect-error) for consumers (Backend, Tool-Adapters, Planner, Executor, Frontend).
 */

import {
  type ToolDefinition,
  type ServiceDefinition,
  type PlanConnections,
  type PlanStep,
  MYJIRA_TOOLS,
  MYJIRA_SCOPES,
  JIRA_SITE_ID_PATTERN,
  JIRA_CLOUD_ID_PATTERN,
  type JiraBinding,
  type JiraCompoundKey,
  type JiraResourceType,
  type JiraSourceRef,
  type JiraPlanStepScope,
  type JiraPlanConnection,
  formatJiraCompoundKey,
  parseJiraCompoundKey,
  isCrossSiteReference,
  validateJiraBinding,
  sameJiraBinding,
  validateJiraSourceRef,
  sameJiraSourceRef,
  validateJiraPlanConnection,
  type JiraModelPolicy,
  type JiraModelRequest,
  type JiraModelBlockReason,
  type JiraModelUseDecision,
  decideJiraModelUse,
  type JiraAuthorizationLease,
  validateJiraAuthorizationLease,
  type JiraVerifiedDirectorySite,
  validateVerifiedDirectory,
  JIRA_SQL_LOCK_HIERARCHY,
  type JiraConnectionState,
  type JiraOAuthStartRequest,
  type JiraOAuthStartResponse,
  type JiraOAuthCallbackRequest,
  type JiraOAuthCallbackResponse,
  type JiraConnectionStatusResponse,
  type JiraSyncSitesResponse,
  type JiraDisconnectResponse,
  type CreateWorkspaceRequest,
  type CreateWorkspaceResponse,
  type WorkspaceJoinRequest,
  type WorkspaceJoinResponse,
  type MemberDecisionRequest,
  type MemberDecisionResponse,
  type CreateInviteRequest,
  type CreateInviteResponse,
  type WorkspaceJiraCapabilitiesResponse,
  type WorkspaceMembershipStatus,
  type WorkspaceRole,
  type WorkspaceSummary,
  type GetWorkspacesResponse,
  type WorkspaceMemberItem,
  type ListWorkspaceMembersResponse,
  type WorkspaceSiteItem,
  type ListWorkspaceSitesResponse,
  type LinkWorkspaceSiteRequest,
  type LinkWorkspaceSiteResponse,
  type UpdateWorkspaceSiteRequest,
  type UpdateWorkspaceSiteResponse,
  type WorkspaceProjectItem,
  type GetWorkspaceProjectsResponse,
  type ConfigureWorkspaceProjectsRequest,
  type ConfigureWorkspaceProjectsResponse,
  type WorkspaceInviteItem,
  type ListWorkspaceInvitesResponse,
  type RevokeInviteResponse,
  type JiraApiErrorCategory,
  type JiraApiError,
  createJiraApiError,
  MYJIRA_SERVICE,
} from '../../src/index.js';

// ============================================================================
// 1. Tool Schemas and Service Registry
// ============================================================================

const _tools: ToolDefinition[] = MYJIRA_TOOLS;
const _scopes: readonly string[] = MYJIRA_SCOPES;
const _service: ServiceDefinition = MYJIRA_SERVICE;
const _sitePattern: RegExp = JIRA_SITE_ID_PATTERN;
const _cloudPattern: RegExp = JIRA_CLOUD_ID_PATTERN;

// ============================================================================
// 2. JiraBinding (7 Distinct Identity Fields)
// ============================================================================

const validBinding: JiraBinding = {
  atiUserId: 'ati-user-001',
  jiraAccountId: 'jira-acc-local-01',
  atlassianAccountId: 'atlassian-account-opaque-id-99',
  workspaceId: 'ws-ati-01',
  membershipVersion: 1,
  grantId: 'grant-01',
  identityVersion: 1,
};

const _validatedBinding: JiraBinding = validateJiraBinding(validBinding);
const _isSameBinding: boolean = sameJiraBinding(validBinding, _validatedBinding);

// Negative compile checks for JiraBinding
// @ts-expect-error - Missing identityVersion in JiraBinding
const _incompleteBinding: JiraBinding = {
  atiUserId: 'ati-user-001',
  jiraAccountId: 'jira-acc-local-01',
  atlassianAccountId: 'atlassian-account-opaque-id-99',
  workspaceId: 'ws-ati-01',
  membershipVersion: 1,
  grantId: 'grant-01',
};

const _secretBinding1: JiraBinding = {
  ...validBinding,
  // @ts-expect-error - JiraBinding must not contain accessToken
  accessToken: 'leak-token',
};

const _secretBinding2: JiraBinding = {
  ...validBinding,
  // @ts-expect-error - JiraBinding must not contain refreshToken
  refreshToken: 'leak-refresh',
};

// ============================================================================
// 3. Canonical JSON Compound Keys & Source References
// ============================================================================

const compoundKey: JiraCompoundKey = {
  workspaceId: 'ws-ati-01',
  cloudId: '12345678-1234-1234-1234-123456789abc',
  resourceType: 'issue',
  providerId: '10001',
};

const _formattedKey: string = formatJiraCompoundKey(compoundKey);
const _parsedKey: JiraCompoundKey = parseJiraCompoundKey(_formattedKey);
const _crossSiteCheck: boolean = isCrossSiteReference(
  { workspaceId: 'ws-1', cloudId: 'cloud-1' },
  { workspaceId: 'ws-1', cloudId: 'cloud-2' }
);

const siteSourceRef: JiraSourceRef = {
  binding: validBinding,
  workspaceId: 'ws-ati-01',
  workspaceVersion: 1,
  siteId: 'site-1',
  cloudId: '12345678-1234-1234-1234-123456789abc',
  sitePolicyVersion: 1,
  resourceType: 'site',
  providerResourceId: '12345678-1234-1234-1234-123456789abc',
  revision: 'rev-site-1',
};

const issueSourceRef: JiraSourceRef = {
  binding: validBinding,
  workspaceId: 'ws-ati-01',
  workspaceVersion: 1,
  siteId: 'site-1',
  cloudId: '12345678-1234-1234-1234-123456789abc',
  sitePolicyVersion: 1,
  projectId: '10001',
  projectPolicyVersion: 1,
  resourceType: 'issue',
  providerResourceId: '20002',
  revision: 'rev-issue-1',
};

const _validatedSource: JiraSourceRef = validateJiraSourceRef(issueSourceRef);
const _isSameSource: boolean = sameJiraSourceRef(siteSourceRef, issueSourceRef);

// Negative compile checks for JiraSourceRef
// @ts-expect-error - Invalid resourceType
const _badResourceType: JiraResourceType = 'board';

const _invalidSourceRef: JiraSourceRef = {
  ...siteSourceRef,
  // @ts-expect-error - JiraSourceRef cannot have unknown resourceType
  resourceType: 'unknown_type',
};

// ============================================================================
// 4. Model Policy, Authorization Lease & PostgreSQL Lock Order
// ============================================================================

const modelPolicy: JiraModelPolicy = {
  source: issueSourceRef,
  currentBinding: validBinding,
  workspaceActive: true,
  currentWorkspaceVersion: 1,
  membershipStatus: 'active',
  siteActive: true,
  currentSitePolicyVersion: 1,
  projectAllowed: true,
  currentProjectPolicyVersion: 1,
  nativePermission: 'granted',
};

// Negative probe: JiraModelPolicy requires authoritative currentBinding
// @ts-expect-error - currentBinding is required on JiraModelPolicy
const _missingCurrentBindingPolicy: JiraModelPolicy = {
  source: issueSourceRef,
  workspaceActive: true,
  currentWorkspaceVersion: 1,
  membershipStatus: 'active',
  siteActive: true,
  currentSitePolicyVersion: 1,
  projectAllowed: true,
  currentProjectPolicyVersion: 1,
  nativePermission: 'granted',
};

const modelReq: JiraModelRequest = {
  source: issueSourceRef,
};

const _decision: JiraModelUseDecision = decideJiraModelUse(modelPolicy, modelReq);
const _validBlockReasonInvalidEvidence: JiraModelBlockReason = 'invalid_evidence';

// Negative compile checks: No Slack artifacts on JiraModelPolicy
const _slackPolicy1: JiraModelPolicy = {
  ...modelPolicy,
  // @ts-expect-error - noTraining does not exist on JiraModelPolicy
  noTraining: true,
};

const _slackPolicy2: JiraModelPolicy = {
  ...modelPolicy,
  // @ts-expect-error - verified does not exist on JiraModelPolicy
  verified: true,
};

const _slackPolicy3: JiraModelPolicy = {
  ...modelPolicy,
  // @ts-expect-error - retentionDays does not exist on JiraModelPolicy
  retentionDays: 30,
};

const _slackPolicy4: JiraModelPolicy = {
  ...modelPolicy,
  // @ts-expect-error - consent does not exist on JiraModelPolicy
  consent: 'user',
};

// Negative compile checks: invalid block reasons
// @ts-expect-error - invalid block reason
const _badBlockReason: JiraModelBlockReason = 'slack_consent_revoked';

// Lease and Directory
const lease: JiraAuthorizationLease = {
  leaseId: 'lease-001',
  binding: validBinding,
  workspaceId: 'ws-ati-01',
  cloudId: '12345678-1234-1234-1234-123456789abc',
  acquiredAt: '2026-11-01T10:00:00.000Z',
  expiresAt: '2026-11-01T10:00:30.000Z',
  ttlMs: 30000,
};

const _validatedLease: JiraAuthorizationLease = validateJiraAuthorizationLease(lease);

const directorySites: JiraVerifiedDirectorySite[] = [
  {
    siteId: 'site-1',
    cloudId: '12345678-1234-1234-1234-123456789abc',
    name: 'Site 1',
    url: 'https://site1.atlassian.net',
    active: true,
    policyVersion: 1,
  },
];
const _validatedDir: JiraVerifiedDirectorySite[] = validateVerifiedDirectory(directorySites);

const _sqlLocks: readonly [
  'ati_workspaces',
  'ati_workspace_memberships',
  'jira_accounts',
  'ati_workspace_jira_sites',
  'ati_workspace_jira_projects',
] = JIRA_SQL_LOCK_HIERARCHY;

// ============================================================================
// 5. Plan Connections & PlanStep Invariants
// ============================================================================

const stepScope: JiraPlanStepScope = {
  siteId: 'site-1',
  cloudId: '12345678-1234-1234-1234-123456789abc',
  sitePolicyVersion: 1,
  projectId: '10001',
  projectPolicyVersion: 1,
};

const planConn: JiraPlanConnection = {
  ...validBinding,
  workspaceVersion: 1,
  siteSteps: {
    step_1: stepScope,
  },
};

const _validatedPlanConn: JiraPlanConnection = validateJiraPlanConnection(planConn);
const _planConns: PlanConnections = {
  myjira: _validatedPlanConn,
};

const _planStep: PlanStep = {
  id: 'step_1',
  tool: 'myjira.create_issue',
  description: 'Create Jira issue',
  args: { siteId: 'site-1', projectKey: 'PROJ', summary: 'Summary' },
  dependsOn: [],
};

// Negative compile checks for PlanStep and PlanConnection
const _badPlanStep: PlanStep = {
  id: 'step_1',
  tool: 'myjira.create_issue',
  description: 'Create Jira issue',
  args: { siteId: 'site-1' },
  dependsOn: [],
  // @ts-expect-error - PlanStep must NOT have redundant siteId metadata
  siteId: 'site-1',
};

// @ts-expect-error - Missing workspaceVersion in JiraPlanConnection
const _missingWsVerPlanConn: JiraPlanConnection = {
  ...validBinding,
  siteSteps: {},
};

const _leakTokenVerPlanConn: JiraPlanConnection = {
  ...validBinding,
  workspaceVersion: 1,
  // @ts-expect-error - tokenVersion must NOT exist in JiraPlanConnection
  tokenVersion: 1,
  siteSteps: {},
};

// ============================================================================
// 6. DTOs and Protocol Boundaries
// ============================================================================

// Connection state
const _validState: JiraConnectionState = 'connected';
// @ts-expect-error - Unknown connection state
const _invalidState: JiraConnectionState = 'partially_connected';

// OAuth Start Request & Response
const startReq: JiraOAuthStartRequest = {
  mode: 'authorize_sites',
  returnTo: '/c/12345678-1234-1234-1234-123456789abc',
};

// authUrl may carry state parameter; NO standalone state in JiraOAuthStartResponse
const startRes: JiraOAuthStartResponse = {
  authUrl: 'https://auth.atlassian.com/authorize?state=secure-state-123',
};

const _startResWithState: JiraOAuthStartResponse = {
  authUrl: 'https://auth.atlassian.com/authorize?state=secure-state-123',
  // @ts-expect-error - JiraOAuthStartResponse must not contain standalone state
  state: 'secure-state-123',
};

// @ts-expect-error - Missing mode in JiraOAuthStartRequest
const _missingModeStartReq: JiraOAuthStartRequest = {
  returnTo: '/c/12345678-1234-1234-1234-123456789abc',
};

// OAuth Callback: Sensitive inputs allowed in Request
const callbackReq: JiraOAuthCallbackRequest = {
  code: 'sensitive-auth-code-xyz',
  state: 'sensitive-state-param',
};

const callbackRes: JiraOAuthCallbackResponse = {
  connected: true,
  connectionState: 'connected',
  jiraAccountId: 'jira-acc-01',
  atlassianAccountId: 'atlassian-acc-01',
  siteCount: 2,
};

// Negative compile checks: Callback response must NOT echo secrets
const _leakCodeInCallback: JiraOAuthCallbackResponse = {
  ...callbackRes,
  // @ts-expect-error - Callback response must not echo code
  code: 'sensitive-auth-code-xyz',
};

const _leakStateInCallback: JiraOAuthCallbackResponse = {
  ...callbackRes,
  // @ts-expect-error - Callback response must not echo state
  state: 'sensitive-state-param',
};

const _leakAccessTokenInCallback: JiraOAuthCallbackResponse = {
  ...callbackRes,
  // @ts-expect-error - Callback response must not contain accessToken
  accessToken: 'leak-token',
};

const _leakRefreshTokenInCallback: JiraOAuthCallbackResponse = {
  ...callbackRes,
  // @ts-expect-error - Callback response must not contain refreshToken
  refreshToken: 'leak-refresh',
};

// Connection Status Response
const statusRes: JiraConnectionStatusResponse = {
  connected: true,
  connectionState: 'connected',
  jiraAccountId: 'jira-acc-01',
  atlassianAccountId: 'atlassian-acc-01',
  displayName: 'Alex Doe',
  sites: [
    {
      cloudId: '12345678-1234-1234-1234-123456789abc',
      name: 'Site 1',
      url: 'https://site1.atlassian.net',
      lastVerifiedAt: '2026-11-01T10:00:00.000Z',
    },
  ],
};

const _leakTokenInStatus: JiraConnectionStatusResponse = {
  ...statusRes,
  // @ts-expect-error - Status response must not contain accessToken
  accessToken: 'leak-token',
};

const _leakSecretInStatus: JiraConnectionStatusResponse = {
  ...statusRes,
  // @ts-expect-error - Status response must not contain clientSecret
  clientSecret: 'leak-secret',
};

// Sync Sites and Disconnect
const _syncRes: JiraSyncSitesResponse = {
  syncedCount: 1,
  sites: [{ cloudId: 'c-1', name: 'Site', url: 'https://site.net' }],
};

const _disconnectRes: JiraDisconnectResponse = {
  disconnected: true,
  revokedAt: '2026-11-01T10:00:00.000Z',
  identityVersion: 1,
};

// Negative probe: JiraDisconnectResponse requires identityVersion for audit
// @ts-expect-error - JiraDisconnectResponse requires identityVersion
const _missingIdentityVersionDisconnect: JiraDisconnectResponse = {
  disconnected: true,
  revokedAt: '2026-11-01T10:00:00.000Z',
};

// Workspace Admin & Membership DTOs
const _createWsReq: CreateWorkspaceRequest = {
  name: 'Engineering',
  slug: 'engineering',
  bootstrapAdminUserId: 'user-001',
};

const _createWsRes: CreateWorkspaceResponse = {
  workspace: { id: 'ws-1', name: 'Engineering', slug: 'engineering', version: 1 },
};

const joinReq: WorkspaceJoinRequest = {
  inviteToken: 'sensitive-invite-token-abc',
};

const joinRes: WorkspaceJoinResponse = {
  requestId: 'req-001',
  workspaceId: 'ws-001',
  status: 'pending',
};

const _leakTokenInJoinRes: WorkspaceJoinResponse = {
  ...joinRes,
  // @ts-expect-error - WorkspaceJoinResponse must not echo inviteToken
  inviteToken: 'sensitive-invite-token-abc',
};

const _decisionReq: MemberDecisionRequest = {
  expectedVersion: 1,
  decision: 'approve',
};

const _badDecisionReq: MemberDecisionRequest = {
  expectedVersion: 1,
  // @ts-expect-error - Unknown decision is rejected
  decision: 'ban',
};

const _decisionRes: MemberDecisionResponse = {
  status: 'active',
  version: 2,
};

const _createInviteReq: CreateInviteRequest = {
  expiresInDays: 7,
};

// CreateInviteResponse is the ONE explicit protocol place where inviteToken secret is returned
const _createInviteRes: CreateInviteResponse = {
  inviteId: 'inv-001',
  inviteToken: 'one-time-secret-token',
  expiresAt: '2026-11-08T10:00:00.000Z',
};

const _capsRes: WorkspaceJiraCapabilitiesResponse = {
  workspaceId: 'ws-001',
  sites: [
    {
      siteId: 'site-1',
      cloudId: 'cloud-1',
      name: 'Site 1',
      url: 'https://site1.atlassian.net',
      projects: [{ id: '10001', key: 'PROJ', name: 'Project 1' }],
    },
  ],
};

// ============================================================================
// 7. Workspace Admin, Member, Site & Project Management DTOs (Frontend Review)
// ============================================================================

// Workspace Listing & Roles
const _wsRole: WorkspaceRole = 'admin';
// @ts-expect-error - Invalid WorkspaceRole
const _badWsRole: WorkspaceRole = 'superadmin';

const _membershipStatus: WorkspaceMembershipStatus = 'active';
// @ts-expect-error - Invalid WorkspaceMembershipStatus
const _badMembershipStatus: WorkspaceMembershipStatus = 'suspended';

const _wsSummary: WorkspaceSummary = {
  id: 'ws-1',
  name: 'Engineering',
  slug: 'engineering',
  role: 'admin',
  membershipStatus: 'active',
  workspaceVersion: 1,
  membershipVersion: 1,
};

const _getWorkspacesRes: GetWorkspacesResponse = {
  workspaces: [_wsSummary],
};

// Negative: summary must distinguish workspaceVersion and membershipVersion
// @ts-expect-error - WorkspaceSummary requires membershipVersion
const _missingMemVerSummary: WorkspaceSummary = {
  id: 'ws-1',
  name: 'Engineering',
  slug: 'engineering',
  role: 'admin',
  membershipStatus: 'active',
  workspaceVersion: 1,
};

// Workspace Members & CAS Versioning
const _memberItem: WorkspaceMemberItem = {
  userId: 'user-001',
  role: 'member',
  status: 'active',
  version: 2,
  joinedAt: '2026-11-01T10:00:00.000Z',
};

const _listMembersRes: ListWorkspaceMembersResponse = {
  members: [_memberItem],
};

// @ts-expect-error - WorkspaceMemberItem requires version for CAS
const _missingVersionMember: WorkspaceMemberItem = {
  userId: 'user-001',
  role: 'member',
  status: 'active',
};

// Workspace Sites Admin (Listing, Linking, Updating)
const _siteItem: WorkspaceSiteItem = {
  siteId: 'site-1',
  cloudId: '12345678-1234-1234-1234-123456789abc',
  name: 'Primary Jira',
  url: 'https://primary.atlassian.net',
  active: true,
  policyVersion: 1,
};

const _listSitesRes: ListWorkspaceSitesResponse = {
  sites: [_siteItem],
};

const _linkSiteReq: LinkWorkspaceSiteRequest = {
  cloudId: '12345678-1234-1234-1234-123456789abc',
};

// Negative type probes: name and url must NOT exist on LinkWorkspaceSiteRequest
const _badLinkSiteName: LinkWorkspaceSiteRequest = {
  cloudId: '12345678-1234-1234-1234-123456789abc',
  // @ts-expect-error - LinkWorkspaceSiteRequest must not accept user-provided name
  name: 'Primary Jira',
};

const _badLinkSiteUrl: LinkWorkspaceSiteRequest = {
  cloudId: '12345678-1234-1234-1234-123456789abc',
  // @ts-expect-error - LinkWorkspaceSiteRequest must not accept user-provided url
  url: 'https://primary.atlassian.net',
};

const _linkSiteRes: LinkWorkspaceSiteResponse = {
  site: _siteItem,
};

const _updateSiteReq: UpdateWorkspaceSiteRequest = {
  expectedPolicyVersion: 1,
  active: false,
};

const _updateSiteRes: UpdateWorkspaceSiteResponse = {
  site: { ..._siteItem, active: false, policyVersion: 2 },
};

// Workspace Projects Admin (Getting, Configuring with Stable Project IDs)
const _projectItem: WorkspaceProjectItem = {
  projectId: '10001',
  key: 'PROJ',
  name: 'Main Project',
  selected: true,
};

const _getProjectsRes: GetWorkspaceProjectsResponse = {
  sitePolicyVersion: 1,
  projects: [_projectItem],
};

const _configureProjectsReq: ConfigureWorkspaceProjectsRequest = {
  expectedPolicyVersion: 1,
  selectedProjectIds: ['10001', '10002'],
};

const _configureProjectsRes: ConfigureWorkspaceProjectsResponse = {
  sitePolicyVersion: 2,
  updatedCount: 2,
};

// Workspace Invites Admin (Listing, Revoking, Secret-Free)
const _inviteItem: WorkspaceInviteItem = {
  id: 'inv-001',
  workspaceId: 'ws-001',
  inviterUserId: 'user-001',
  expiresAt: '2026-11-08T10:00:00.000Z',
};

const _listInvitesRes: ListWorkspaceInvitesResponse = {
  invites: [_inviteItem],
};

const _revokeInviteRes: RevokeInviteResponse = {
  revoked: true,
  revokedAt: '2026-11-01T12:00:00.000Z',
};

// Negative checks: Invites listing and revoke must NEVER expose secrets
const _leakInviteTokenInItem: WorkspaceInviteItem = {
  ..._inviteItem,
  // @ts-expect-error - WorkspaceInviteItem must not expose inviteToken
  inviteToken: 'sensitive-token',
};

const _leakTokenHashInItem: WorkspaceInviteItem = {
  ..._inviteItem,
  // @ts-expect-error - WorkspaceInviteItem must not expose tokenHash
  tokenHash: 'sensitive-hash',
};

const _leakSecretInRevoke: RevokeInviteResponse = {
  ..._revokeInviteRes,
  // @ts-expect-error - RevokeInviteResponse must not expose inviteToken
  inviteToken: 'sensitive-token',
};

// ============================================================================
// 8. JiraApiError Taxonomy & createJiraApiError
// ============================================================================

const _apiError1: JiraApiError = createJiraApiError('native_permission_denied', 'No permission');
const _apiError2: JiraApiError = createJiraApiError('write_indeterminate', 'Outcome unknown');

// Negative compile checks for createJiraApiError
// @ts-expect-error - createJiraApiError rejects a third argument / runtime override object
createJiraApiError('write_indeterminate', 'Failed', { retryable: true });

// @ts-expect-error - createJiraApiError rejects unknown error category
createJiraApiError('unknown_category', 'Failed');

// Export dummy value to ensure fixture is treated as a valid module
export const CONTRACTS_COMPILE_FIXTURE_LOADED = true;
