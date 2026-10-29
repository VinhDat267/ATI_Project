import { describe, expect, it } from 'vitest';
import {
  ALL_TOOLS,
  SERVICE_REGISTRY,
  validateSlackConnectionPublicInfo,
  validateSlackProcessingConsentInfo,
  validateSlackCallbackResult,
  validateSlackStartConnectionResponse,
  validateSlackListConnectionsResponse,
  type SlackConnectionPublicInfo,
  type SlackProcessingConsentInfo,
  type SlackCallbackResult,
  type SlackStartConnectionResponse,
  type SlackListConnectionsResponse,
} from '../src/index.js';

function validConnectionInput(): SlackConnectionPublicInfo {
  return {
    id: 'conn-123',
    workspaceId: 'T12345678',
    workspaceName: 'Acme Corp',
    slackUserId: 'U12345678',
    slackUserLabel: 'Dat Nguyen',
    status: 'active',
    identityVersion: 1,
    scopes: ['chat:write', 'channels:read'],
    connectedAt: '2026-10-29T07:00:00.000Z',
    consentStatus: 'granted',
    processingReady: true,
  };
}

function validConsentInput(): SlackProcessingConsentInfo {
  return {
    workspaceId: 'T12345678',
    providerId: 'provider-gemini',
    policyVersion: 'policy-v1',
    status: 'granted',
    retentionDays: 30,
    evidenceRef: 'doc-ref-999',
    authorizedBy: 'admin-ati-1',
    grantedAt: '2026-10-29T06:00:00.000Z',
  };
}

describe('Slack Connection Contracts & Validation', () => {
  describe('validateSlackConnectionPublicInfo', () => {
    it('returns a detached whitelist copy for valid input', () => {
      const input = {
        ...validConnectionInput(),
        accessToken: 'xoxp-secret-token', // should be stripped
        refreshToken: 'xoxr-secret-refresh', // should be stripped
        extraSneakyField: 'malicious', // should be stripped
      };
      const validated = validateSlackConnectionPublicInfo(input);

      expect(validated).toEqual(validConnectionInput());
      expect((validated as any).accessToken).toBeUndefined();
      expect((validated as any).refreshToken).toBeUndefined();
      expect((validated as any).extraSneakyField).toBeUndefined();

      // Ensure scopes array is cloned (not same reference)
      expect(validated.scopes).not.toBe(input.scopes);
      expect(validated.scopes).toEqual(input.scopes);
    });

    it('rejects inherited fields via Object.create (requires own properties)', () => {
      const inherited = Object.create(validConnectionInput());
      expect(() => validateSlackConnectionPublicInfo(inherited)).toThrow(TypeError);
    });

    it('allows processingReady = false when active and consent granted (e.g. unverified provider config)', () => {
      const input = {
        ...validConnectionInput(),
        processingReady: false,
      };
      const validated = validateSlackConnectionPublicInfo(input);
      expect(validated.processingReady).toBe(false);
    });

    it('rejects processingReady = true when status is not active', () => {
      const input = {
        ...validConnectionInput(),
        status: 'reconnect_required',
        processingReady: true,
      };
      expect(() => validateSlackConnectionPublicInfo(input)).toThrow(
        /processingReady requires status === 'active'/i
      );
    });

    it('rejects processingReady = true when consentStatus is not granted', () => {
      const input = {
        ...validConnectionInput(),
        consentStatus: 'pending',
        processingReady: true,
      };
      expect(() => validateSlackConnectionPublicInfo(input)).toThrow(
        /processingReady requires consentStatus === 'granted'/i
      );
    });

    it('rejects non-object inputs', () => {
      expect(() => validateSlackConnectionPublicInfo(null)).toThrow(/object/i);
      expect(() => validateSlackConnectionPublicInfo(undefined)).toThrow(/object/i);
      expect(() => validateSlackConnectionPublicInfo('string')).toThrow(/object/i);
      expect(() => validateSlackConnectionPublicInfo(123)).toThrow(/object/i);
    });

    it.each([
      'id',
      'workspaceId',
      'workspaceName',
      'slackUserId',
      'slackUserLabel',
    ] as const)('rejects missing or empty string field %s', (field) => {
      const input = { ...validConnectionInput(), [field]: '' };
      expect(() => validateSlackConnectionPublicInfo(input)).toThrow(
        new RegExp(field, 'i')
      );

      const inputMissing = { ...validConnectionInput() };
      delete (inputMissing as any)[field];
      expect(() => validateSlackConnectionPublicInfo(inputMissing)).toThrow(
        new RegExp(field, 'i')
      );
    });

    it('rejects invalid connection status', () => {
      const input = { ...validConnectionInput(), status: 'invalid_status' };
      expect(() => validateSlackConnectionPublicInfo(input)).toThrow(/status/i);
    });

    it('rejects invalid consent status', () => {
      const input = { ...validConnectionInput(), consentStatus: 'invalid_consent' };
      expect(() => validateSlackConnectionPublicInfo(input)).toThrow(/consentStatus/i);
    });

    it.each([0, -1, -99, 1.5, NaN, Infinity, '1', null, undefined])(
      'rejects invalid identityVersion %s',
      (val) => {
        const input = { ...validConnectionInput(), identityVersion: val };
        expect(() => validateSlackConnectionPublicInfo(input)).toThrow(/identityVersion/i);
      }
    );

    it('rejects non-array or non-string scopes', () => {
      expect(() =>
        validateSlackConnectionPublicInfo({ ...validConnectionInput(), scopes: 'chat:write' })
      ).toThrow(/scopes/i);
      expect(() =>
        validateSlackConnectionPublicInfo({ ...validConnectionInput(), scopes: [123] })
      ).toThrow(/scopes/i);
    });

    it.each(['', '   ', '\t', '\n'])(
      'rejects blank scope entry %j',
      (blankScope) => {
        expect(() =>
          validateSlackConnectionPublicInfo({
            ...validConnectionInput(),
            scopes: ['chat:write', blankScope],
          })
        ).toThrow(TypeError);
      }
    );

    it.each([
      'not-a-date',
      '2026-10-29', // missing time/UTC
      '2026-02-31T00:00:00.000Z', // impossible calendar date
      '2026-10-29T07:00:00+07:00', // not UTC ending in Z
      1761721200000,
    ])('rejects invalid connectedAt date %s', (dateVal) => {
      const input = { ...validConnectionInput(), connectedAt: dateVal };
      expect(() => validateSlackConnectionPublicInfo(input)).toThrow(/connectedAt/i);
    });

    it('does NOT require updatedAt on public connection, but validates when provided', () => {
      const withoutUpdatedAt = validConnectionInput();
      expect(withoutUpdatedAt.updatedAt).toBeUndefined();
      const validatedWithout = validateSlackConnectionPublicInfo(withoutUpdatedAt);
      expect(validatedWithout.updatedAt).toBeUndefined();

      const withValidUpdatedAt = {
        ...validConnectionInput(),
        updatedAt: '2026-10-29T08:00:00.000Z',
      };
      const validatedWith = validateSlackConnectionPublicInfo(withValidUpdatedAt);
      expect(validatedWith.updatedAt).toBe('2026-10-29T08:00:00.000Z');

      const withInvalidUpdatedAt = {
        ...validConnectionInput(),
        updatedAt: 'not-a-date',
      };
      expect(() => validateSlackConnectionPublicInfo(withInvalidUpdatedAt)).toThrow(/updatedAt/i);
    });
  });

  describe('validateSlackProcessingConsentInfo', () => {
    it('returns a detached whitelist copy for valid granted consent', () => {
      const input = {
        ...validConsentInput(),
        secretField: 'strip-me',
      };
      const validated = validateSlackProcessingConsentInfo(input);
      expect(validated).toEqual(validConsentInput());
      expect((validated as any).secretField).toBeUndefined();
    });

    it('accepts retentionDays = 0 (zero retention permitted)', () => {
      const input = { ...validConsentInput(), retentionDays: 0 };
      const validated = validateSlackProcessingConsentInfo(input);
      expect(validated.retentionDays).toBe(0);
    });

    it.each([-1, -5, 1.2, NaN, Infinity, -Infinity, '0', '30'])(
      'rejects invalid retentionDays %s',
      (val) => {
        const input = { ...validConsentInput(), retentionDays: val };
        expect(() => validateSlackProcessingConsentInfo(input)).toThrow(/retentionDays/i);
      }
    );

    it('requires policyVersion and rejects missing or blank policyVersion', () => {
      const missing = { ...validConsentInput() };
      delete (missing as any).policyVersion;
      expect(() => validateSlackProcessingConsentInfo(missing)).toThrow(TypeError);

      const blank = { ...validConsentInput(), policyVersion: '   ' };
      expect(() => validateSlackProcessingConsentInfo(blank)).toThrow(TypeError);
    });

    it('rejects inherited fields via Object.create for consent', () => {
      const inherited = Object.create(validConsentInput());
      expect(() => validateSlackProcessingConsentInfo(inherited)).toThrow(TypeError);
    });

    it('allows pending consent without grantedAt, evidenceRef or authorizedBy', () => {
      const pending: SlackProcessingConsentInfo = {
        workspaceId: 'T12345678',
        providerId: 'provider-gemini',
        policyVersion: 'policy-v1',
        status: 'pending',
        retentionDays: 14,
      };
      const validated = validateSlackProcessingConsentInfo(pending);
      expect(validated).toEqual(pending);
      expect(validated.grantedAt).toBeUndefined();
      expect(validated.evidenceRef).toBeUndefined();
      expect(validated.authorizedBy).toBeUndefined();
    });

    it('requires evidenceRef and authorizedBy and grantedAt when status = granted', () => {
      const missingEvidence = { ...validConsentInput(), evidenceRef: '' };
      expect(() => validateSlackProcessingConsentInfo(missingEvidence)).toThrow(/evidenceRef/i);

      const missingAuthorizer = { ...validConsentInput() };
      delete (missingAuthorizer as any).authorizedBy;
      expect(() => validateSlackProcessingConsentInfo(missingAuthorizer)).toThrow(/authorizedBy/i);

      const missingGrantedAt = { ...validConsentInput() };
      delete (missingGrantedAt as any).grantedAt;
      expect(() => validateSlackProcessingConsentInfo(missingGrantedAt)).toThrow(/grantedAt/i);
    });

    it('rejects malformed optional fields instead of silently dropping them', () => {
      // Invalid date in grantedAt for pending status
      const invalidDatePending = {
        ...validConsentInput(),
        status: 'pending',
        grantedAt: 'invalid-date',
      };
      expect(() => validateSlackProcessingConsentInfo(invalidDatePending)).toThrow(TypeError);

      // Blank string in evidenceRef
      const blankEvidence = {
        ...validConsentInput(),
        evidenceRef: '   ',
      };
      expect(() => validateSlackProcessingConsentInfo(blankEvidence)).toThrow(TypeError);

      // Invalid revokedAt date
      const invalidRevoked = {
        ...validConsentInput(),
        status: 'revoked',
        revokedAt: 'not-a-date',
      };
      expect(() => validateSlackProcessingConsentInfo(invalidRevoked)).toThrow(TypeError);

      // Valid revokedAt date accepted
      const validRevoked = {
        ...validConsentInput(),
        status: 'revoked',
        revokedAt: '2026-10-29T10:00:00.000Z',
      };
      const res = validateSlackProcessingConsentInfo(validRevoked);
      expect(res.revokedAt).toBe('2026-10-29T10:00:00.000Z');
    });

    it('does NOT require id or updatedAt on consent, but validates when provided', () => {
      const input = validConsentInput();
      expect(input.id).toBeUndefined();
      expect(input.updatedAt).toBeUndefined();
      const validated = validateSlackProcessingConsentInfo(input);
      expect(validated.id).toBeUndefined();
      expect(validated.updatedAt).toBeUndefined();

      const withMeta = {
        ...input,
        id: 'consent-id-1',
        updatedAt: '2026-10-29T08:00:00.000Z',
      };
      const validatedMeta = validateSlackProcessingConsentInfo(withMeta);
      expect(validatedMeta.id).toBe('consent-id-1');
      expect(validatedMeta.updatedAt).toBe('2026-10-29T08:00:00.000Z');
    });

    it.each(['workspaceId', 'providerId', 'policyVersion'] as const)(
      'rejects missing or empty string field %s',
      (field) => {
        const input = { ...validConsentInput(), [field]: '' };
        expect(() => validateSlackProcessingConsentInfo(input)).toThrow(
          new RegExp(field, 'i')
        );
      }
    );
  });

  describe('validateSlackCallbackResult', () => {
    it('validates flat approved callback result', () => {
      const result: SlackCallbackResult = {
        connectionId: 'conn-123',
        workspaceId: 'T12345678',
        workspaceName: 'Acme Corp',
        slackUserId: 'U12345678',
        returnTo: '/c/123e4567-e89b-12d3-a456-426614174000',
      };
      const validated = validateSlackCallbackResult(result);
      expect(validated).toEqual(result);
    });

    it('validates flat approved callback result without optional returnTo', () => {
      const result: SlackCallbackResult = {
        connectionId: 'conn-123',
        workspaceId: 'T12345678',
        workspaceName: 'Acme Corp',
        slackUserId: 'U12345678',
      };
      const validated = validateSlackCallbackResult(result);
      expect(validated).toEqual(result);
      expect(validated.returnTo).toBeUndefined();
    });

    it.each([
      'connectionId',
      'workspaceId',
      'workspaceName',
      'slackUserId',
    ] as const)('rejects missing or blank %s', (field) => {
      const result = {
        connectionId: 'conn-123',
        workspaceId: 'T12345678',
        workspaceName: 'Acme Corp',
        slackUserId: 'U12345678',
        [field]: '   ',
      };
      expect(() => validateSlackCallbackResult(result)).toThrow(TypeError);
    });

    it('rejects inherited fields for callback result', () => {
      const result = {
        connectionId: 'conn-123',
        workspaceId: 'T12345678',
        workspaceName: 'Acme Corp',
        slackUserId: 'U12345678',
      };
      expect(() => validateSlackCallbackResult(Object.create(result))).toThrow(TypeError);
    });

    it('rejects non-string returnTo', () => {
      const result = {
        connectionId: 'conn-123',
        workspaceId: 'T12345678',
        workspaceName: 'Acme Corp',
        slackUserId: 'U12345678',
        returnTo: 123,
      };
      expect(() => validateSlackCallbackResult(result)).toThrow(TypeError);
    });
  });

  describe('validateSlackStartConnectionResponse', () => {
    it('validates start connection response with url', () => {
      const response: SlackStartConnectionResponse = {
        url: 'https://slack.com/oauth/v2/authorize?client_id=123',
      };
      const validated = validateSlackStartConnectionResponse(response);
      expect(validated.url).toBe(response.url);
    });

    it('rejects missing or blank url', () => {
      expect(() => validateSlackStartConnectionResponse({})).toThrow(TypeError);
      expect(() => validateSlackStartConnectionResponse({ url: '' })).toThrow(TypeError);
      expect(() => validateSlackStartConnectionResponse({ url: '   ' })).toThrow(TypeError);
      expect(() => validateSlackStartConnectionResponse({ url: 123 })).toThrow(TypeError);
    });

    it('rejects inherited fields for start connection response', () => {
      const res = { url: 'https://slack.com/oauth/v2/authorize' };
      expect(() => validateSlackStartConnectionResponse(Object.create(res))).toThrow(TypeError);
    });
  });

  describe('validateSlackListConnectionsResponse', () => {
    it('validates list envelope and maps all connections to detached copies', () => {
      const response: SlackListConnectionsResponse = {
        connections: [validConnectionInput()],
      };
      const validated = validateSlackListConnectionsResponse(response);
      expect(validated.connections).toHaveLength(1);
      expect(validated.connections[0]).toEqual(validConnectionInput());
      expect(validated.connections[0].scopes).not.toBe(response.connections[0].scopes);
    });

    it('throws if connections is not an array', () => {
      expect(() => validateSlackListConnectionsResponse({ connections: null })).toThrow(
        /connections/i
      );
      expect(() => validateSlackListConnectionsResponse({})).toThrow(/connections/i);
    });
  });

  describe('Tool Catalog Invariants', () => {
    it('does NOT register myslack in ALL_TOOLS in SLACK-02A', () => {
      const hasMySlack = ALL_TOOLS.some((tool) => tool.service === 'myslack');
      expect(hasMySlack).toBe(false);
    });

    it('does NOT register myslack in SERVICE_REGISTRY in SLACK-02A', () => {
      expect((SERVICE_REGISTRY as any).myslack).toBeUndefined();
    });
  });
});
