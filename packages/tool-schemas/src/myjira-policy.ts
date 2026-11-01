import {
  type JiraBinding,
  type JiraSourceRef,
  sameJiraBinding,
  sameJiraSourceRef,
  validateJiraBinding,
  validateJiraSourceRef,
} from './myjira-context.js';

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function isNonEmptyString(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

function isPositiveSafeInteger(val: unknown): val is number {
  return typeof val === 'number' && Number.isSafeInteger(val) && val > 0;
}

function hasOwn(obj: object, prop: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

export interface JiraModelPolicy {
  source: JiraSourceRef;
  currentBinding: JiraBinding;
  workspaceActive: boolean;
  currentWorkspaceVersion: number;
  membershipStatus: 'active' | 'pending' | 'rejected' | 'removed';
  siteActive: boolean;
  currentSitePolicyVersion: number;
  projectAllowed: boolean;
  currentProjectPolicyVersion?: number;
  nativePermission: 'granted' | 'denied' | 'unavailable';
}

export interface JiraModelRequest {
  source: JiraSourceRef;
}

export type JiraModelBlockReason =
  | 'identity_changed'
  | 'source_mismatch'
  | 'workspace_inactive'
  | 'membership_inactive'
  | 'site_disabled'
  | 'project_denied'
  | 'policy_stale'
  | 'native_permission_denied'
  | 'provider_unavailable'
  | 'invalid_evidence';

export type JiraModelUseDecision =
  | { allowed: true }
  | { allowed: false; reason: JiraModelBlockReason };

export function decideJiraModelUse(
  policy: JiraModelPolicy,
  request: JiraModelRequest
): JiraModelUseDecision {
  if (!isRecord(policy) || !isRecord(request)) {
    return { allowed: false, reason: 'invalid_evidence' };
  }

  if (
    !hasOwn(policy, 'source') ||
    !hasOwn(request, 'source') ||
    !hasOwn(policy, 'currentBinding')
  ) {
    return { allowed: false, reason: 'invalid_evidence' };
  }

  let validatedPolicySource: JiraSourceRef;
  let validatedRequestSource: JiraSourceRef;
  let validatedCurrentBinding: JiraBinding;
  try {
    validatedPolicySource = validateJiraSourceRef(policy.source);
    validatedRequestSource = validateJiraSourceRef(request.source);
    validatedCurrentBinding = validateJiraBinding(policy.currentBinding);
  } catch {
    return { allowed: false, reason: 'invalid_evidence' };
  }

  if (!hasOwn(policy, 'workspaceActive') || typeof policy.workspaceActive !== 'boolean') {
    return { allowed: false, reason: 'invalid_evidence' };
  }

  if (!hasOwn(policy, 'siteActive') || typeof policy.siteActive !== 'boolean') {
    return { allowed: false, reason: 'invalid_evidence' };
  }

  if (!hasOwn(policy, 'membershipStatus') || typeof policy.membershipStatus !== 'string') {
    return { allowed: false, reason: 'invalid_evidence' };
  }

  if (!hasOwn(policy, 'currentWorkspaceVersion') || !isPositiveSafeInteger(policy.currentWorkspaceVersion)) {
    return { allowed: false, reason: 'invalid_evidence' };
  }

  if (!hasOwn(policy, 'currentSitePolicyVersion') || !isPositiveSafeInteger(policy.currentSitePolicyVersion)) {
    return { allowed: false, reason: 'invalid_evidence' };
  }

  if (validatedPolicySource.resourceType !== 'site') {
    if (!hasOwn(policy, 'projectAllowed') || typeof policy.projectAllowed !== 'boolean') {
      return { allowed: false, reason: 'invalid_evidence' };
    }
    if (
      !hasOwn(policy, 'currentProjectPolicyVersion') ||
      !isPositiveSafeInteger(policy.currentProjectPolicyVersion)
    ) {
      return { allowed: false, reason: 'invalid_evidence' };
    }
  }

  if (!sameJiraBinding(validatedPolicySource.binding, validatedRequestSource.binding)) {
    return { allowed: false, reason: 'identity_changed' };
  }

  if (!sameJiraBinding(validatedPolicySource.binding, validatedCurrentBinding)) {
    return { allowed: false, reason: 'identity_changed' };
  }

  if (!sameJiraSourceRef(validatedPolicySource, validatedRequestSource)) {
    return { allowed: false, reason: 'source_mismatch' };
  }

  if (!policy.workspaceActive) {
    return { allowed: false, reason: 'workspace_inactive' };
  }

  if (policy.membershipStatus !== 'active') {
    return { allowed: false, reason: 'membership_inactive' };
  }

  if (!policy.siteActive) {
    return { allowed: false, reason: 'site_disabled' };
  }

  if (validatedPolicySource.resourceType !== 'site' && !policy.projectAllowed) {
    return { allowed: false, reason: 'project_denied' };
  }

  if (validatedPolicySource.workspaceVersion !== policy.currentWorkspaceVersion) {
    return { allowed: false, reason: 'policy_stale' };
  }

  if (validatedPolicySource.sitePolicyVersion !== policy.currentSitePolicyVersion) {
    return { allowed: false, reason: 'policy_stale' };
  }

  if (
    validatedPolicySource.resourceType !== 'site' &&
    validatedPolicySource.projectPolicyVersion !== policy.currentProjectPolicyVersion
  ) {
    return { allowed: false, reason: 'policy_stale' };
  }

  if (hasOwn(policy, 'nativePermission') && policy.nativePermission === 'denied') {
    return { allowed: false, reason: 'native_permission_denied' };
  }

  if (!hasOwn(policy, 'nativePermission') || policy.nativePermission !== 'granted') {
    return { allowed: false, reason: 'provider_unavailable' };
  }

  return { allowed: true };
}

export interface JiraAuthorizationLease {
  leaseId: string;
  binding: JiraBinding;
  workspaceId: string;
  cloudId: string;
  acquiredAt: string;
  expiresAt: string;
  ttlMs: number;
}

export function validateJiraAuthorizationLease(value: unknown): JiraAuthorizationLease {
  if (!isRecord(value)) {
    throw new TypeError('JiraAuthorizationLease must be a non-null object');
  }

  const stringFields = ['leaseId', 'workspaceId', 'cloudId', 'acquiredAt', 'expiresAt'] as const;
  for (const field of stringFields) {
    if (!hasOwn(value, field) || !isNonEmptyString(value[field])) {
      throw new TypeError(`JiraAuthorizationLease.${field} must be a non-empty string`);
    }
  }

  if (!hasOwn(value, 'binding')) {
    throw new TypeError('JiraAuthorizationLease must include a binding');
  }
  const binding = validateJiraBinding(value.binding);

  if (value.workspaceId !== binding.workspaceId) {
    throw new TypeError('JiraAuthorizationLease.workspaceId must match binding.workspaceId');
  }

  if (!hasOwn(value, 'ttlMs') || !isPositiveSafeInteger(value.ttlMs)) {
    throw new TypeError('JiraAuthorizationLease.ttlMs must be a positive safe integer');
  }

  const acquiredTime = new Date(value.acquiredAt as string).getTime();
  const expiresTime = new Date(value.expiresAt as string).getTime();

  if (isNaN(acquiredTime) || isNaN(expiresTime) || expiresTime <= acquiredTime) {
    throw new TypeError('JiraAuthorizationLease expiresAt must be after acquiredAt');
  }

  const expectedTtl = expiresTime - acquiredTime;
  if (value.ttlMs !== expectedTtl) {
    throw new TypeError('JiraAuthorizationLease.ttlMs must equal expiresAt - acquiredAt in milliseconds');
  }

  return {
    leaseId: value.leaseId as string,
    binding,
    workspaceId: value.workspaceId as string,
    cloudId: value.cloudId as string,
    acquiredAt: value.acquiredAt as string,
    expiresAt: value.expiresAt as string,
    ttlMs: value.ttlMs as number,
  };
}

export interface JiraVerifiedDirectorySite {
  siteId: string;
  cloudId: string;
  name: string;
  url: string;
  active: boolean;
  policyVersion: number;
}

/**
 * Validates the shape of a verified directory site list.
 * Note: Parsing a raw directory does not authorize it. Backend supplies current
 * verified native evidence and real synchronization in later cards (JIRA-03–05/08).
 */
export function validateVerifiedDirectory(sites: unknown): JiraVerifiedDirectorySite[] {
  if (!Array.isArray(sites)) {
    throw new TypeError('Verified directory sites must be an array');
  }

  const result: JiraVerifiedDirectorySite[] = [];

  for (const item of sites) {
    if (!isRecord(item)) {
      throw new TypeError('Verified directory site entry must be an object');
    }

    const stringFields = ['siteId', 'cloudId', 'name', 'url'] as const;
    for (const field of stringFields) {
      if (!hasOwn(item, field) || !isNonEmptyString(item[field])) {
        throw new TypeError(`Verified directory site.${field} must be a non-empty string`);
      }
    }

    if (!hasOwn(item, 'active') || typeof item.active !== 'boolean') {
      throw new TypeError('Verified directory site.active must be a boolean');
    }

    if (!hasOwn(item, 'policyVersion') || !isPositiveSafeInteger(item.policyVersion)) {
      throw new TypeError('Verified directory site.policyVersion must be a positive safe integer');
    }

    result.push({
      siteId: item.siteId as string,
      cloudId: item.cloudId as string,
      name: item.name as string,
      url: item.url as string,
      active: item.active as boolean,
      policyVersion: item.policyVersion as number,
    });
  }

  return result;
}

/**
 * PostgreSQL Lock Hierarchy Specification.
 *
 * Ordered set of database tables for authorization lease acquisition (FOR SHARE)
 * and revocation (FOR UPDATE) in ascending order.
 * Grants table is explicitly excluded to prevent token rotation deadlocks.
 */
export const JIRA_SQL_LOCK_HIERARCHY = [
  'ati_workspaces',
  'ati_workspace_memberships',
  'jira_accounts',
  'ati_workspace_jira_sites',
  'ati_workspace_jira_projects',
] as const;
