import { describe, expect, it } from 'vitest';
import {
  type JiraApiErrorCategory,
  createJiraApiError,
} from '../src/myjira-dto.js';

describe('JiraApiError Taxonomy & Error Factory', () => {
  it('maps native_permission_denied to 403 non-retryable without a reconnect action', () => {
    const error = createJiraApiError('native_permission_denied', 'User lacks ADD_COMMENTS on this issue');
    expect(error.category).toBe('native_permission_denied');
    expect(error.status).toBe(403);
    expect(error.retryable).toBe(false);
    expect(error.suggestedAction).toBeUndefined(); // Crucial: must NOT suggest reconnect when it is a native permission failure
    expect(error.message).toBe('User lacks ADD_COMMENTS on this issue');
  });

  it('maps upstream_auth to 401 non-retryable with reconnect suggested action', () => {
    const error = createJiraApiError('upstream_auth', 'Expired or invalid Atlassian credentials');
    expect(error.category).toBe('upstream_auth');
    expect(error.status).toBe(401);
    expect(error.retryable).toBe(false);
    expect(error.suggestedAction).toBe('reconnect');
  });

  it('maps workspace_not_found to 404 to conceal private workspace existence', () => {
    const error = createJiraApiError('workspace_not_found', 'Workspace not found');
    expect(error.category).toBe('workspace_not_found');
    expect(error.status).toBe(404);
    expect(error.retryable).toBe(false);
    expect(error.suggestedAction).toBeUndefined();
  });

  it('maps upstream_not_found to 404 non-retryable without reconnect action', () => {
    const error = createJiraApiError('upstream_not_found', 'Jira project or issue not found upstream');
    expect(error.category).toBe('upstream_not_found');
    expect(error.status).toBe(404);
    expect(error.retryable).toBe(false);
    expect(error.suggestedAction).toBeUndefined();
    expect(error.message).toBe('Jira project or issue not found upstream');
  });

  it('maps upstream_rate_limited to 429 retryable with retry_later', () => {
    const error = createJiraApiError('upstream_rate_limited', 'Rate limit exceeded on Atlassian API');
    expect(error.category).toBe('upstream_rate_limited');
    expect(error.status).toBe(429);
    expect(error.retryable).toBe(true);
    expect(error.suggestedAction).toBe('retry_later');
  });

  it('maps upstream_unavailable to 503 retryable with retry_later', () => {
    const error = createJiraApiError('upstream_unavailable', 'Atlassian Jira service unavailable');
    expect(error.category).toBe('upstream_unavailable');
    expect(error.status).toBe(503);
    expect(error.retryable).toBe(true);
    expect(error.suggestedAction).toBe('retry_later');
  });

  it('maps upstream_error to 502 non-retryable', () => {
    const error = createJiraApiError('upstream_error', 'Bad gateway from Atlassian API');
    expect(error.category).toBe('upstream_error');
    expect(error.status).toBe(502);
    expect(error.retryable).toBe(false);
    expect(error.suggestedAction).toBeUndefined();
  });

  it('maps reconnect_required to 403 non-retryable with reconnect suggested action', () => {
    const error = createJiraApiError('reconnect_required', 'Jira account connection has been revoked');
    expect(error.category).toBe('reconnect_required');
    expect(error.status).toBe(403);
    expect(error.retryable).toBe(false);
    expect(error.suggestedAction).toBe('reconnect');
  });

  it('maps membership_required to 403 non-retryable with request_membership action', () => {
    const error = createJiraApiError('membership_required', 'Active membership required in this workspace');
    expect(error.category).toBe('membership_required');
    expect(error.status).toBe(403);
    expect(error.retryable).toBe(false);
    expect(error.suggestedAction).toBe('request_membership');
  });

  it('maps stale_version to 409 conflict non-retryable with refresh_page action', () => {
    const error = createJiraApiError('stale_version', 'Workspace membership or policy version is stale');
    expect(error.category).toBe('stale_version');
    expect(error.status).toBe(409);
    expect(error.retryable).toBe(false);
    expect(error.suggestedAction).toBe('refresh_page');
  });

  it('maps write_indeterminate to 500 and enforces retryable: false unconditionally', () => {
    const error = createJiraApiError('write_indeterminate', 'Write operation outcome unknown');
    expect(error.category).toBe('write_indeterminate');
    expect(error.status).toBe(500);
    expect(error.retryable).toBe(false); // NEVER retryable!
    expect(error.suggestedAction).toBeUndefined();
  });

  it('proves safety: extra runtime override objects cannot relabel or retry write_indeterminate', () => {
    const maliciousOverrides = {
      category: 'upstream_error',
      status: 200,
      retryable: true,
      suggestedAction: 'retry_later',
      extraPayload: { secret: 'leak' },
    };
    const error = (createJiraApiError as any)(
      'write_indeterminate',
      'Write operation outcome unknown',
      maliciousOverrides
    );
    expect(error.category).toBe('write_indeterminate');
    expect(error.status).toBe(500);
    expect(error.retryable).toBe(false);
    expect(error.message).toBe('Write operation outcome unknown');
    expect(error.suggestedAction).toBeUndefined();
    expect((error as any).extraPayload).toBeUndefined();
  });

  it('proves safety: extra runtime override objects cannot modify status or actions of native_permission_denied', () => {
    const maliciousOverrides = {
      status: 200,
      retryable: true,
      suggestedAction: 'reconnect',
    };
    const error = (createJiraApiError as any)(
      'native_permission_denied',
      'Access denied by Atlassian',
      maliciousOverrides
    );
    expect(error.category).toBe('native_permission_denied');
    expect(error.status).toBe(403);
    expect(error.retryable).toBe(false);
    expect(error.suggestedAction).toBeUndefined();
  });

  it.each(['__proto__', 'constructor', 'toString', 'valueOf', 'isPrototypeOf'])(
    'rejects prototype-inherited category %s and throws TypeError without echoing unsafe payload',
    (badCategory) => {
      expect(() => (createJiraApiError as any)(badCategory, 'Some message')).toThrow(TypeError);
    }
  );
});
