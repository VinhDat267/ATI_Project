import type {
  CreateWorkspaceResponse,
  CreateInviteResponse,
  RevokeInviteResponse,
  WorkspaceSummary,
  MemberDecisionResponse,
  WorkspaceJoinResponse,
} from '@wap/tool-schemas';
import WorkspaceRepo from '../../src/db/repositories/workspace/index.js';

/**
 * Pure compile fixture for JIRA-03 Workspace Repository contract conformance.
 * This file is never executed directly by vitest (it has no test() or describe() blocks),
 * but is included in tsconfig to enforce that WorkspaceRepo adheres strictly to the
 * public DTO contracts defined in @wap/tool-schemas without drifting or requiring casts.
 */
export async function assertWorkspaceRepoContractConformance(facade: WorkspaceRepo): Promise<void> {
  const dummyUuid = '00000000-0000-0000-0000-000000000000';

  // 1. createWorkspaceWithBootstrapAdmin -> CreateWorkspaceResponse ({ workspace: { id, name, slug, version } })
  const createWsRes: CreateWorkspaceResponse = await facade.createWorkspaceWithBootstrapAdmin(dummyUuid, {
    name: 'Sample WS',
    slug: 'sample-ws',
    bootstrapAdminUserId: dummyUuid,
  });
  void createWsRes.workspace.id;
  void createWsRes.workspace.name;
  void createWsRes.workspace.slug;
  void createWsRes.workspace.version;

  // 2. createInvite -> CreateInviteResponse ({ inviteId, inviteToken, expiresAt })
  const createInvRes: CreateInviteResponse = await facade.createInvite(dummyUuid, dummyUuid);
  void createInvRes.inviteId;
  void createInvRes.inviteToken;
  void createInvRes.expiresAt;

  // 3. revokeInvite -> RevokeInviteResponse ({ revoked, revokedAt })
  const revokeInvRes: RevokeInviteResponse = await facade.revokeInvite(dummyUuid, dummyUuid, dummyUuid);
  void revokeInvRes.revoked;
  void revokeInvRes.revokedAt;

  // 4. listWorkspacesForUser -> WorkspaceSummary[] ({ id, name, slug, role, membershipStatus, workspaceVersion, membershipVersion })
  const summaries: WorkspaceSummary[] = await facade.listWorkspacesForUser(dummyUuid);
  for (const s of summaries) {
    void s.id;
    void s.name;
    void s.slug;
    void s.role;
    void s.membershipStatus;
    void s.workspaceVersion;
    void s.membershipVersion;
  }

  // 5. decideMember -> MemberDecisionResponse ({ status, version })
  const decideRes: MemberDecisionResponse = await facade.decideMember(dummyUuid, dummyUuid, dummyUuid, {
    decision: 'approve',
    expectedVersion: 1,
  });
  void decideRes.status;
  void decideRes.version;

  // 6. joinWorkspaceWithInvite -> discriminated internal result with required requestId on pending outcome
  // Positive HTTP pending projection by outcome branch without casts
  const joinRes = await facade.joinWorkspaceWithInvite(
    dummyUuid,
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  );
  if (joinRes.outcome === 'pending') {
    const httpPending: WorkspaceJoinResponse = {
      requestId: joinRes.requestId,
      workspaceId: joinRes.workspaceId,
      status: 'pending',
    };
    void httpPending;
  }
}
