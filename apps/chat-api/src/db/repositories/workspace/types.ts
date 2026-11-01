// Re-export canonical shared DTOs directly from @wap/tool-schemas
export type {
  CreateWorkspaceRequest,
  CreateWorkspaceResponse,
  WorkspaceJoinRequest,
  WorkspaceJoinResponse,
  MemberDecisionRequest,
  MemberDecisionResponse,
  CreateInviteRequest,
  CreateInviteResponse,
  WorkspaceSummary,
  WorkspaceInviteItem,
  RevokeInviteResponse,
  WorkspaceMembershipStatus,
  WorkspaceRole,
} from '@wap/tool-schemas';

import type { WorkspaceRole } from '@wap/tool-schemas';

// Internal database status/decision types
export type WorkspaceStatus = 'active' | 'archived';
export type MembershipStatus = 'pending' | 'active' | 'rejected' | 'removed';
export type MemberDecision = 'approve' | 'reject' | 'remove';
export type JoinOutcome = 'pending' | 'already_active';

// Internal SQL row representations
export interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  status: WorkspaceStatus;
  version: number;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

export interface WorkspaceMembershipRow {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  status: MembershipStatus;
  version: number;
  requested_at: Date;
  decided_at: Date | null;
  decided_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface WorkspaceInviteRow {
  id: string;
  workspace_id: string;
  token_hash: string;
  inviter_user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

// Discriminated internal join union: requestId is required on the pending branch
export type JoinWorkspaceInternalResponse =
  | { outcome: 'pending'; workspaceId: string; requestId: string }
  | { outcome: 'already_active'; workspaceId: string };

// Backend-local system administration DTOs (Phase 2 local)
export interface EnableExistingWorkspaceRequest {
  slug: string;
  bootstrapAdminUserId: string;
}

export interface ArchiveWorkspaceResponse {
  workspaceVersion: number;
  status: 'archived';
}

export interface RecoverWorkspaceAdminRequest {
  expectedVersion: number;
  userId: string;
}

export interface RecoverWorkspaceAdminResponse {
  workspaceVersion: number;
}
