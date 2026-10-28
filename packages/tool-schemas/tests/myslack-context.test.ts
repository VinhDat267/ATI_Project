import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, SERVICE_REGISTRY, sameSlackBinding, validateSlackBinding, type SlackBinding } from '../src/index.js';

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
});
