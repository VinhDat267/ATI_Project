export interface JiraBinding {
  atiUserId: string;
  jiraAccountId: string;
  atlassianAccountId: string;
  workspaceId: string;
  membershipVersion: number;
  grantId: string;
  identityVersion: number;
}

export type JiraResourceType = 'site' | 'project' | 'issue' | 'comment';

export interface JiraCompoundKey {
  workspaceId: string;
  cloudId: string;
  resourceType: JiraResourceType;
  providerId: string;
}

export interface JiraSourceRef {
  binding: JiraBinding;
  workspaceId: string;
  workspaceVersion: number;
  siteId: string;
  cloudId: string;
  sitePolicyVersion: number;
  projectId?: string;
  projectPolicyVersion?: number;
  resourceType: JiraResourceType;
  providerResourceId: string;
  revision: string;
}

export interface JiraPlanStepScope {
  siteId: string;
  cloudId: string;
  sitePolicyVersion: number;
  projectId?: string;
  projectPolicyVersion?: number;
}

export interface JiraPlanConnection extends JiraBinding {
  workspaceVersion: number;
  siteSteps: Record<string, JiraPlanStepScope>;
}

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

export function validateJiraBinding(value: unknown): JiraBinding {
  if (!isRecord(value)) {
    throw new TypeError('JiraBinding must be a non-null object');
  }

  const stringFields = [
    'atiUserId',
    'jiraAccountId',
    'atlassianAccountId',
    'workspaceId',
    'grantId',
  ] as const;

  for (const field of stringFields) {
    if (!hasOwn(value, field) || !isNonEmptyString(value[field])) {
      throw new TypeError(`JiraBinding.${field} must be a non-empty string`);
    }
  }

  if (!hasOwn(value, 'membershipVersion') || !isPositiveSafeInteger(value.membershipVersion)) {
    throw new TypeError('JiraBinding.membershipVersion must be a positive safe integer');
  }

  if (!hasOwn(value, 'identityVersion') || !isPositiveSafeInteger(value.identityVersion)) {
    throw new TypeError('JiraBinding.identityVersion must be a positive safe integer');
  }

  return {
    atiUserId: value.atiUserId as string,
    jiraAccountId: value.jiraAccountId as string,
    atlassianAccountId: value.atlassianAccountId as string,
    workspaceId: value.workspaceId as string,
    membershipVersion: value.membershipVersion as number,
    grantId: value.grantId as string,
    identityVersion: value.identityVersion as number,
  };
}

export function sameJiraBinding(a: JiraBinding, b: JiraBinding): boolean {
  if (!a || !b) return false;
  return (
    a.atiUserId === b.atiUserId &&
    a.jiraAccountId === b.jiraAccountId &&
    a.atlassianAccountId === b.atlassianAccountId &&
    a.workspaceId === b.workspaceId &&
    a.membershipVersion === b.membershipVersion &&
    a.grantId === b.grantId &&
    a.identityVersion === b.identityVersion
  );
}

export function formatJiraCompoundKey(key: JiraCompoundKey): string {
  return JSON.stringify([key.workspaceId, key.cloudId, key.resourceType, key.providerId]);
}

const VALID_RESOURCE_TYPES = new Set<string>(['site', 'project', 'issue', 'comment']);

export function parseJiraCompoundKey(raw: string): JiraCompoundKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TypeError('Malformed canonical compound key: not valid JSON');
  }

  if (!Array.isArray(parsed) || parsed.length !== 4) {
    throw new TypeError('Canonical compound key must be an array of length 4');
  }

  for (let i = 0; i < 4; i++) {
    if (!isNonEmptyString(parsed[i])) {
      throw new TypeError(`Canonical compound key component ${i} must be a non-empty string`);
    }
  }

  const resourceType = parsed[2] as string;
  if (!VALID_RESOURCE_TYPES.has(resourceType)) {
    throw new TypeError(`Canonical compound key invalid resourceType: ${resourceType}`);
  }

  return {
    workspaceId: parsed[0] as string,
    cloudId: parsed[1] as string,
    resourceType: resourceType as JiraResourceType,
    providerId: parsed[3] as string,
  };
}

const JIRA_CANONICAL_DECIMAL_PATTERN = /^[1-9][0-9]*$/;

export function isCrossSiteReference(
  a: unknown,
  b: unknown
): boolean {
  if (!isRecord(a) || !isRecord(b)) {
    return true;
  }
  if (!hasOwn(a, 'workspaceId') || !isNonEmptyString(a.workspaceId)) {
    return true;
  }
  if (!hasOwn(b, 'workspaceId') || !isNonEmptyString(b.workspaceId)) {
    return true;
  }
  if (!hasOwn(a, 'cloudId') || !isNonEmptyString(a.cloudId)) {
    return true;
  }
  if (!hasOwn(b, 'cloudId') || !isNonEmptyString(b.cloudId)) {
    return true;
  }
  return a.workspaceId !== b.workspaceId || a.cloudId !== b.cloudId;
}

export function validateJiraSourceRef(value: unknown): JiraSourceRef {
  if (!isRecord(value)) {
    throw new TypeError('JiraSourceRef must be a non-null object');
  }

  if (!hasOwn(value, 'binding')) {
    throw new TypeError('JiraSourceRef must include a binding');
  }
  const binding = validateJiraBinding(value.binding);

  if (!hasOwn(value, 'workspaceId') || !isNonEmptyString(value.workspaceId)) {
    throw new TypeError('JiraSourceRef.workspaceId must be a non-empty string');
  }

  if (value.workspaceId !== binding.workspaceId) {
    throw new TypeError('JiraSourceRef.workspaceId must match binding.workspaceId');
  }

  if (!hasOwn(value, 'workspaceVersion') || !isPositiveSafeInteger(value.workspaceVersion)) {
    throw new TypeError('JiraSourceRef.workspaceVersion must be a positive safe integer');
  }

  if (!hasOwn(value, 'siteId') || !isNonEmptyString(value.siteId)) {
    throw new TypeError('JiraSourceRef.siteId must be a non-empty string');
  }

  if (!hasOwn(value, 'cloudId') || !isNonEmptyString(value.cloudId)) {
    throw new TypeError('JiraSourceRef.cloudId must be a non-empty string');
  }

  if (!hasOwn(value, 'sitePolicyVersion') || !isPositiveSafeInteger(value.sitePolicyVersion)) {
    throw new TypeError('JiraSourceRef.sitePolicyVersion must be a positive safe integer');
  }

  if (!hasOwn(value, 'resourceType') || !isNonEmptyString(value.resourceType) || !VALID_RESOURCE_TYPES.has(value.resourceType)) {
    throw new TypeError('JiraSourceRef.resourceType must be a valid JiraResourceType');
  }

  if (!hasOwn(value, 'providerResourceId') || !isNonEmptyString(value.providerResourceId)) {
    throw new TypeError('JiraSourceRef.providerResourceId must be a non-empty string');
  }

  if (!hasOwn(value, 'revision') || !isNonEmptyString(value.revision)) {
    throw new TypeError('JiraSourceRef.revision must be a non-empty string');
  }

  const resourceType = value.resourceType as JiraResourceType;
  let projectId: string | undefined;
  let projectPolicyVersion: number | undefined;

  if (resourceType === 'site') {
    if (value.providerResourceId !== value.cloudId) {
      throw new TypeError('JiraSourceRef.providerResourceId must equal cloudId for resourceType site');
    }
  } else {
    if (!hasOwn(value, 'projectId') || !isNonEmptyString(value.projectId)) {
      throw new TypeError(`JiraSourceRef.projectId is required for resourceType ${resourceType}`);
    }
    if (!JIRA_CANONICAL_DECIMAL_PATTERN.test(value.projectId as string)) {
      throw new TypeError(`JiraSourceRef.projectId must be a canonical positive decimal string for resourceType ${resourceType}`);
    }
    if (!JIRA_CANONICAL_DECIMAL_PATTERN.test(value.providerResourceId as string)) {
      throw new TypeError(`JiraSourceRef.providerResourceId must be a canonical positive decimal string for resourceType ${resourceType}`);
    }
    if (resourceType === 'project' && value.projectId !== value.providerResourceId) {
      throw new TypeError('JiraSourceRef.projectId must equal providerResourceId for resourceType project');
    }
    if (!hasOwn(value, 'projectPolicyVersion') || !isPositiveSafeInteger(value.projectPolicyVersion)) {
      throw new TypeError(`JiraSourceRef.projectPolicyVersion must be a positive safe integer for resourceType ${resourceType}`);
    }
    projectId = value.projectId as string;
    projectPolicyVersion = value.projectPolicyVersion as number;
  }

  const result: JiraSourceRef = {
    binding,
    workspaceId: value.workspaceId as string,
    workspaceVersion: value.workspaceVersion as number,
    siteId: value.siteId as string,
    cloudId: value.cloudId as string,
    sitePolicyVersion: value.sitePolicyVersion as number,
    resourceType,
    providerResourceId: value.providerResourceId as string,
    revision: value.revision as string,
  };

  if (projectId !== undefined) {
    result.projectId = projectId;
    result.projectPolicyVersion = projectPolicyVersion;
  }

  return result;
}

export function sameJiraSourceRef(a: JiraSourceRef, b: JiraSourceRef): boolean {
  if (!a || !b) return false;
  return (
    sameJiraBinding(a.binding, b.binding) &&
    a.workspaceId === b.workspaceId &&
    a.workspaceVersion === b.workspaceVersion &&
    a.siteId === b.siteId &&
    a.cloudId === b.cloudId &&
    a.sitePolicyVersion === b.sitePolicyVersion &&
    a.projectId === b.projectId &&
    a.projectPolicyVersion === b.projectPolicyVersion &&
    a.resourceType === b.resourceType &&
    a.providerResourceId === b.providerResourceId &&
    a.revision === b.revision
  );
}

export function validateJiraPlanConnection(value: unknown): JiraPlanConnection {
  if (!isRecord(value)) {
    throw new TypeError('JiraPlanConnection must be a non-null object');
  }

  const binding = validateJiraBinding(value);

  if (!hasOwn(value, 'workspaceVersion') || !isPositiveSafeInteger(value.workspaceVersion)) {
    throw new TypeError('JiraPlanConnection.workspaceVersion must be a positive safe integer');
  }

  if (!hasOwn(value, 'siteSteps') || !isRecord(value.siteSteps)) {
    throw new TypeError('JiraPlanConnection.siteSteps must be a record of step scopes');
  }

  const cleanSiteSteps: Record<string, JiraPlanStepScope> = {};

  for (const [stepId, scopeRaw] of Object.entries(value.siteSteps)) {
    if (!hasOwn(value.siteSteps, stepId)) continue;
    if (!isRecord(scopeRaw)) {
      throw new TypeError(`JiraPlanConnection.siteSteps[${stepId}] must be an object`);
    }

    if (!hasOwn(scopeRaw, 'siteId') || !isNonEmptyString(scopeRaw.siteId)) {
      throw new TypeError(`JiraPlanConnection.siteSteps[${stepId}].siteId must be a non-empty string`);
    }

    if (!hasOwn(scopeRaw, 'cloudId') || !isNonEmptyString(scopeRaw.cloudId)) {
      throw new TypeError(`JiraPlanConnection.siteSteps[${stepId}].cloudId must be a non-empty string`);
    }

    if (!hasOwn(scopeRaw, 'sitePolicyVersion') || !isPositiveSafeInteger(scopeRaw.sitePolicyVersion)) {
      throw new TypeError(`JiraPlanConnection.siteSteps[${stepId}].sitePolicyVersion must be a positive safe integer`);
    }

    let projectId: string | undefined;
    let projectPolicyVersion: number | undefined;

    if (hasOwn(scopeRaw, 'projectId') && scopeRaw.projectId !== undefined) {
      if (!isNonEmptyString(scopeRaw.projectId)) {
        throw new TypeError(`JiraPlanConnection.siteSteps[${stepId}].projectId must be a non-empty string`);
      }
      projectId = scopeRaw.projectId as string;
    }

    if (hasOwn(scopeRaw, 'projectPolicyVersion') && scopeRaw.projectPolicyVersion !== undefined) {
      if (!isPositiveSafeInteger(scopeRaw.projectPolicyVersion)) {
        throw new TypeError(`JiraPlanConnection.siteSteps[${stepId}].projectPolicyVersion must be a positive safe integer`);
      }
      projectPolicyVersion = scopeRaw.projectPolicyVersion as number;
    }

    const hasProjId = projectId !== undefined;
    const hasProjVer = projectPolicyVersion !== undefined;
    if (hasProjId !== hasProjVer) {
      throw new TypeError(
        `JiraPlanConnection.siteSteps[${stepId}] must provide both projectId and projectPolicyVersion together`
      );
    }

    const cleanScope: JiraPlanStepScope = {
      siteId: scopeRaw.siteId as string,
      cloudId: scopeRaw.cloudId as string,
      sitePolicyVersion: scopeRaw.sitePolicyVersion as number,
    };

    if (hasProjId && hasProjVer) {
      cleanScope.projectId = projectId;
      cleanScope.projectPolicyVersion = projectPolicyVersion;
    }

    Object.defineProperty(cleanSiteSteps, stepId, {
      value: cleanScope,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  return {
    ...binding,
    workspaceVersion: value.workspaceVersion as number,
    siteSteps: cleanSiteSteps,
  };
}
