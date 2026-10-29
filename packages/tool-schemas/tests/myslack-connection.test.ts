import { describe, expect, it } from 'vitest';
import {
  ALL_TOOLS,
  SERVICE_REGISTRY,
  validateSlackConnectionPublicInfo,
  validateSlackProcessingConsentInfo,
  validateSlackCallbackResult,
  validateSlackListConnectionsResponse,
  type SlackConnectionPublicInfo,
  type SlackProcessingConsentInfo,
  type SlackCallbackResult,
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
    consentStatus: 'granted',
    processingReady: true,
    connectedAt: '2026-10-29T07:00:00.000Z',
    updatedAt: '2026-10-29T07:00:00.000Z',
  };
}

function validConsentInput(): SlackProcessingConsentInfo {
  return {
    id: 'consent-123',
    workspaceId: 'T12345678',
    providerId: 'provider-gemini',
    status: 'granted',
    evidenceRef: 'doc-ref-999',
    authorizedBy: 'admin-ati-1',
    grantedAt: '2026-10-29T06:00:00.000Z',
    retentionDays: 30,
    updatedAt: '2026-10-29T06:00:00.000Z',
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

    it('rejects invalid updatedAt date', () => {
      const input = { ...validConnectionInput(), updatedAt: 'invalid-date' };
      expect(() => validateSlackConnectionPublicInfo(input)).toThrow(/updatedAt/i);
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

    it('allows pending consent without grantedAt, evidenceRef or authorizedBy', () => {
      const pending: SlackProcessingConsentInfo = {
        id: 'consent-pending-1',
        workspaceId: 'T12345678',
        providerId: 'provider-gemini',
        status: 'pending',
        retentionDays: 14,
        updatedAt: '2026-10-29T06:00:00.000Z',
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

      const missingAuthorizer = { ...validConsentInput(), authorizedBy: undefined };
      expect(() => validateSlackProcessingConsentInfo(missingAuthorizer)).toThrow(/authorizedBy/i);

      const missingGrantedAt = { ...validConsentInput(), grantedAt: undefined };
      expect(() => validateSlackProcessingConsentInfo(missingGrantedAt)).toThrow(/grantedAt/i);
    });

    it.each([0, -5, 1.2, NaN, '30'])(
      'rejects invalid retentionDays %s',
      (val) => {
        const input = { ...validConsentInput(), retentionDays: val };
        expect(() => validateSlackProcessingConsentInfo(input)).toThrow(/retentionDays/i);
      }
    );

    it.each(['id', 'workspaceId', 'providerId'] as const)(
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
    it('validates successful callback result with connection and returnTo', () => {
      const result: SlackCallbackResult = {
        ok: true,
        connection: validConnectionInput(),
        returnTo: '/c/123e4567-e89b-12d3-a456-426614174000',
      };
      const validated = validateSlackCallbackResult(result);
      expect(validated.ok).toBe(true);
      expect(validated.connection).toEqual(validConnectionInput());
      expect(validated.returnTo).toBe('/c/123e4567-e89b-12d3-a456-426614174000');
    });

    it('validates failure callback result with error and errorCode', () => {
      const result: SlackCallbackResult = {
        ok: false,
        error: 'State mismatch',
        errorCode: 'SLACK_STATE_INVALID',
      };
      const validated = validateSlackCallbackResult(result);
      expect(validated.ok).toBe(false);
      expect(validated.error).toBe('State mismatch');
      expect(validated.errorCode).toBe('SLACK_STATE_INVALID');
    });

    it('throws if ok is not boolean', () => {
      expect(() => validateSlackCallbackResult({ ok: 'true' })).toThrow(/ok/i);
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
