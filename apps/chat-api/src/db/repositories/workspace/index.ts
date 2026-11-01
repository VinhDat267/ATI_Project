import type pg from 'pg';
import { WorkspaceAuditRepo } from './workspace-audit-repo.js';
import { WorkspaceCoreRepo } from './workspace-core-repo.js';
import { WorkspaceMembershipRepo } from './workspace-membership-repo.js';
import { WorkspaceInviteRepo } from './workspace-invite-repo.js';
import {
  WorkspaceSiteProjectRepo,
  type WorkspaceSiteProjectRepoOptions,
} from './workspace-site-project-repo.js';
import type {
  ArchiveWorkspaceResponse,
  CreateInviteRequest,
  CreateInviteResponse,
  CreateWorkspaceRequest,
  CreateWorkspaceResponse,
  JoinWorkspaceInternalResponse,
  MemberDecisionRequest,
  MemberDecisionResponse,
  RecoverWorkspaceAdminRequest,
  RecoverWorkspaceAdminResponse,
  RevokeInviteResponse,
  WorkspaceInviteItem,
  WorkspaceSummary,
} from './types.js';
import type {
  LinkWorkspaceSiteRequest,
  LinkWorkspaceSiteResponse,
  UpdateWorkspaceSiteRequest,
  UpdateWorkspaceSiteResponse,
  ConfigureWorkspaceProjectsRequest,
  ConfigureWorkspaceProjectsResponse,
  WorkspaceSiteItem,
  WorkspaceMemberItem,
  GetWorkspaceProjectsResponse,
  WorkspaceJiraCapabilitiesResponse,
} from '@wap/tool-schemas';

export interface WorkspaceRepoOptions extends WorkspaceSiteProjectRepoOptions {}

export class WorkspaceRepo {
  private readonly auditRepo: WorkspaceAuditRepo;
  private readonly coreRepo: WorkspaceCoreRepo;
  private readonly membershipRepo: WorkspaceMembershipRepo;
  private readonly inviteRepo: WorkspaceInviteRepo;
  private readonly siteProjectRepo: WorkspaceSiteProjectRepo;

  constructor(
    private readonly pool: pg.Pool,
    options?: WorkspaceRepoOptions
  ) {
    this.auditRepo = new WorkspaceAuditRepo(pool);
    this.coreRepo = new WorkspaceCoreRepo(pool, this.auditRepo);
    this.membershipRepo = new WorkspaceMembershipRepo(pool, this.auditRepo);
    this.inviteRepo = new WorkspaceInviteRepo(pool, this.auditRepo);
    this.siteProjectRepo = new WorkspaceSiteProjectRepo(pool, options);
  }

  createWorkspaceWithBootstrapAdmin(
    actorUserId: string,
    input: CreateWorkspaceRequest
  ): Promise<CreateWorkspaceResponse> {
    return this.coreRepo.createWorkspaceWithBootstrapAdmin(actorUserId, input);
  }

  listWorkspacesForUser(actorUserId: string): Promise<WorkspaceSummary[]> {
    return this.coreRepo.listWorkspacesForUser(actorUserId);
  }

  createInvite(
    workspaceId: string,
    actorUserId: string,
    request?: CreateInviteRequest
  ): Promise<CreateInviteResponse> {
    return this.inviteRepo.createInvite(workspaceId, actorUserId, request);
  }

  listInvites(
    workspaceId: string,
    actorUserId: string
  ): Promise<WorkspaceInviteItem[]> {
    return this.inviteRepo.listInvites(workspaceId, actorUserId);
  }

  revokeInvite(
    workspaceId: string,
    actorUserId: string,
    inviteId: string
  ): Promise<RevokeInviteResponse> {
    return this.inviteRepo.revokeInvite(workspaceId, actorUserId, inviteId);
  }

  joinWorkspaceWithInvite(
    actorUserId: string,
    inviteToken: string
  ): Promise<JoinWorkspaceInternalResponse> {
    return this.inviteRepo.joinWorkspaceWithInvite(actorUserId, inviteToken);
  }

  decideMember(
    workspaceId: string,
    actorUserId: string,
    targetUserId: string,
    input: MemberDecisionRequest
  ): Promise<MemberDecisionResponse> {
    return this.membershipRepo.decideMember(
      workspaceId,
      actorUserId,
      targetUserId,
      input
    );
  }

  listMembers(
    workspaceId: string,
    actorUserId: string
  ): Promise<WorkspaceMemberItem[]> {
    return this.membershipRepo.listMembers(workspaceId, actorUserId);
  }

  archiveWorkspace(
    actorUserId: string,
    workspaceId: string,
    expectedVersion: number
  ): Promise<ArchiveWorkspaceResponse> {
    return this.coreRepo.archiveWorkspace(actorUserId, workspaceId, expectedVersion);
  }

  recoverWorkspaceAdmin(
    actorUserId: string,
    workspaceId: string,
    input: RecoverWorkspaceAdminRequest
  ): Promise<RecoverWorkspaceAdminResponse> {
    return this.coreRepo.recoverWorkspaceAdmin(actorUserId, workspaceId, input);
  }

  linkSite(
    workspaceId: string,
    actorId: string,
    req: LinkWorkspaceSiteRequest
  ): Promise<LinkWorkspaceSiteResponse> {
    return this.siteProjectRepo.linkSite(workspaceId, actorId, req);
  }

  updateSite(
    workspaceId: string,
    actorId: string,
    siteId: string,
    req: UpdateWorkspaceSiteRequest
  ): Promise<UpdateWorkspaceSiteResponse> {
    return this.siteProjectRepo.updateSite(workspaceId, actorId, siteId, req);
  }

  configureProjects(
    workspaceId: string,
    actorId: string,
    siteId: string,
    req: ConfigureWorkspaceProjectsRequest
  ): Promise<ConfigureWorkspaceProjectsResponse> {
    return this.siteProjectRepo.configureProjects(workspaceId, actorId, siteId, req);
  }

  listSites(
    workspaceId: string,
    actorId: string
  ): Promise<WorkspaceSiteItem[]> {
    return this.siteProjectRepo.listSites(workspaceId, actorId);
  }

  getProjects(
    workspaceId: string,
    actorId: string,
    siteId: string
  ): Promise<GetWorkspaceProjectsResponse> {
    return this.siteProjectRepo.getProjects(workspaceId, actorId, siteId);
  }

  getCapabilities(
    workspaceId: string,
    actorId: string
  ): Promise<WorkspaceJiraCapabilitiesResponse> {
    return this.siteProjectRepo.getCapabilities(workspaceId, actorId);
  }
}

export default WorkspaceRepo;
export * from './types.js';
export * from './errors.js';
export * from './transaction.js';
export * from './shared-auth.js';
export * from './workspace-audit-repo.js';
export * from './workspace-core-repo.js';
export * from './workspace-membership-repo.js';
export * from './workspace-invite-repo.js';
export * from './workspace-site-project-repo.js';
