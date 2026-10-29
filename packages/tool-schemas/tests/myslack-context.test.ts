import { describe, expect, it } from 'vitest';
import {
  ALL_TOOLS,
  SERVICE_REGISTRY,
  sameSlackBinding,
  validateSlackBinding,
  validateSlackSourceRef,
  formatSlackGlobalResourceKey,
  formatSlackOwnerSourceKey,
  type SlackBinding,
  type SlackSourceRef,
  type SlackResourceType,
} from '../src/index.js';

const binding: SlackBinding = { atiUserId: 'ati-a', connectionId: 'conn-free', workspaceId: 'T_FREE', slackUserId: 'U_FREE_A', identityVersion: 1 };

describe('personal Slack identity boundary', () => {
  it('recognizes an independent copy of the same complete identity', () => {
    expect(sameSlackBinding(binding, { ...binding })).toBe(true);
    expect(validateSlackBinding(binding)).toEqual(binding);
  });
  it.each(['atiUserId', 'connectionId', 'workspaceId', 'slackUserId'] as const)('never equates different %s even with the same resource names', field => {
    expect(sameSlackBinding(binding, { ...binding, [field]: 'different' })).toBe(false);
  });
  it('invalidates identities after reconnect rather than reusing the same resource ID', () => {
    expect(sameSlackBinding(binding, { ...binding, identityVersion: 2 })).toBe(false);
  });
  it.each([0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '1', null, undefined])('rejects invalid identity version %s', version => {
    expect(() => validateSlackBinding({ ...binding, identityVersion: version })).toThrow(TypeError);
  });
  it.each(['atiUserId', 'connectionId', 'workspaceId', 'slackUserId'] as const)('rejects missing, blank or non-string %s', field => {
    for (const value of ['', '   ', null, undefined, 5]) {
      expect(() => validateSlackBinding({ ...binding, [field]: value })).toThrow(TypeError);
    }
    const incomplete: Record<string, unknown> = { ...binding };
    delete incomplete[field];
    expect(() => validateSlackBinding(incomplete)).toThrow(TypeError);
  });
  it.each([null, undefined, [], 5, 'binding'])('rejects non-record input %s', input => {
    expect(() => validateSlackBinding(input)).toThrow(TypeError);
  });
  it('projects a clean identity without carrying credentials or mutating the input', () => {
    const input = { ...binding, accessToken: 'synthetic-sensitive-value' };
    const result = validateSlackBinding(input);
    expect(result).toEqual(binding);
    expect(result).not.toBe(input);
    expect(input.accessToken).toBe('synthetic-sensitive-value');
  });
  it('keeps personal Slack contracts out of default tool and service catalogs', () => {
    expect(ALL_TOOLS.some(tool => tool.service === 'myslack')).toBe(false);
    expect(SERVICE_REGISTRY.some(service => service.id === 'myslack')).toBe(false);
  });

  describe('SlackSourceRef and structured composite keys', () => {
    const validRef: SlackSourceRef = {
      binding,
      resourceType: 'message',
      resourceId: 'msg-123',
      revision: '1729000000.000100',
    };

    it('supports extended resource types for Canvas, List, bookmarks, and reminders', () => {
      const extendedTypes: SlackResourceType[] = [
        'conversation',
        'message',
        'file',
        'canvas',
        'list',
        'list_item',
        'bookmark',
        'reminder',
        'user',
        'usergroup',
        'subteam',
      ];
      for (const rt of extendedTypes) {
        const ref: SlackSourceRef = { binding, resourceType: rt, resourceId: 'res-1', revision: 'rev-1' };
        expect(validateSlackSourceRef(ref)).toEqual(ref);
      }
    });

    it('formats structured owner source keys preventing collision between 2 users in same workspace', () => {
      const bindingUserA = { ...binding, atiUserId: 'user-a', connectionId: 'conn-a', slackUserId: 'U_A' };
      const bindingUserB = { ...binding, atiUserId: 'user-b', connectionId: 'conn-b', slackUserId: 'U_B' };
      const refA: SlackSourceRef = { binding: bindingUserA, resourceType: 'message', resourceId: 'msg-1', revision: '1' };
      const refB: SlackSourceRef = { binding: bindingUserB, resourceType: 'message', resourceId: 'msg-1', revision: '1' };

      const keyA = formatSlackOwnerSourceKey(refA);
      const keyB = formatSlackOwnerSourceKey(refB);
      expect(keyA).not.toBe(keyB);
      expect(JSON.parse(keyA)[0]).toBe('user-a');
      expect(JSON.parse(keyB)[0]).toBe('user-b');
      expect(JSON.parse(keyA)[1]).toBe('conn-a');
      expect(JSON.parse(keyB)[1]).toBe('conn-b');
    });

    it('handles delimiter and special characters in resource IDs safely without collision', () => {
      const key1 = formatSlackGlobalResourceKey('T:1', 'message', 'M:2');
      const key2 = formatSlackGlobalResourceKey('T', 'message', '1:M:2');
      expect(key1).not.toBe(key2);
      expect(JSON.parse(key1)).toEqual(['T:1', 'message', 'M:2']);
      expect(JSON.parse(key2)).toEqual(['T', 'message', '1:M:2']);
    });

    it('strips sensitive and extra properties from SlackSourceRef', () => {
      const dirty = {
        binding: { ...binding, extraSecret: 'synthetic-secret-token' },
        resourceType: 'message',
        resourceId: 'msg-123',
        revision: '1729000000.000100',
        maliciousPayload: '<script>',
      };
      const clean = validateSlackSourceRef(dirty);
      expect(clean).toEqual({
        binding,
        resourceType: 'message',
        resourceId: 'msg-123',
        revision: '1729000000.000100',
      });
      expect((clean as any).maliciousPayload).toBeUndefined();
      expect((clean.binding as any).extraSecret).toBeUndefined();
    });

    it('enforces own properties and rejects prototype pollution / inherited properties', () => {
      const proto = { resourceType: 'message' };
      const evil = Object.create(proto);
      evil.binding = binding;
      evil.resourceId = 'res-1';
      evil.revision = 'rev-1';
      expect(() => validateSlackSourceRef(evil)).toThrow(TypeError);
    });

    it.each([null, undefined, 42, 'string', []])('rejects non-object source ref: %s', (val) => {
      expect(() => validateSlackSourceRef(val)).toThrow(TypeError);
    });

    it.each(['', '   ', null, undefined])('rejects invalid resourceId %s', (id) => {
      expect(() => validateSlackSourceRef({ ...validRef, resourceId: id })).toThrow(TypeError);
    });

    it.each(['', '   ', null, undefined])('rejects invalid revision %s', (rev) => {
      expect(() => validateSlackSourceRef({ ...validRef, revision: rev })).toThrow(TypeError);
    });

    it('rejects unknown resourceType', () => {
      expect(() => validateSlackSourceRef({ ...validRef, resourceType: 'unknown_type' as any })).toThrow(TypeError);
    });

    it('rejects invalid inputs to formatSlackGlobalResourceKey', () => {
      expect(() => formatSlackGlobalResourceKey('', 'message', 'msg-1')).toThrow(TypeError);
      expect(() => formatSlackGlobalResourceKey('T123', 'invalid' as any, 'msg-1')).toThrow(TypeError);
      expect(() => formatSlackGlobalResourceKey('T123', 'message', '')).toThrow(TypeError);
    });

    it('rejects invalid inputs to formatSlackOwnerSourceKey', () => {
      expect(() => formatSlackOwnerSourceKey(null as any)).toThrow(TypeError);
      expect(() => formatSlackOwnerSourceKey({} as any)).toThrow(TypeError);
    });
  });
});
