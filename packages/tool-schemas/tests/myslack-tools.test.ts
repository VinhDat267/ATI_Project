import { describe, expect, it } from 'vitest';
import {
  SLACK_METHOD_FAMILIES,
  MYSLACK_SAMPLE_TOOLS,
  MYSLACK_CONVERSATIONS_HISTORY_TOOL,
  MYSLACK_CONVERSATIONS_LIST_TOOL,
  MYSLACK_CHAT_POST_MESSAGE_TOOL,
  MYSLACK_USERS_INFO_TOOL,
  validateSlackToolDefinition,
  validateSlackToolExecutionArgs,
  ALL_TOOLS,
  SERVICE_REGISTRY,
  type SlackBinding,
  type SlackToolDefinition,
  type SlackMethodFamily,
} from '../src/index.js';

const binding: SlackBinding = {
  atiUserId: 'ati-user-1',
  connectionId: 'conn-1',
  workspaceId: 'T123',
  slackUserId: 'U123',
  identityVersion: 1,
};

describe('Slack Tool Catalog Metadata & Fail-Closed Execution Contracts', () => {
  describe('Exact 36 Snapshot Families', () => {
    it('contains exactly 36 families matching inventory sitemap without ellipsis or invented names', () => {
      expect(SLACK_METHOD_FAMILIES).toHaveLength(36);
      const expectedFamilies: SlackMethodFamily[] = [
        'admin', 'agents', 'api', 'apps', 'assistant', 'auth', 'blocks', 'bookmarks', 'bots', 'calls',
        'canvases', 'chat', 'conversations', 'dialog', 'dnd', 'emoji', 'entity', 'files', 'functions', 'migration',
        'oauth', 'openid', 'pins', 'reactions', 'reminders', 'rtm', 'search', 'slackLists', 'slackbot', 'stars',
        'team', 'tooling', 'usergroups', 'users', 'views', 'workflows',
      ];
      expect(new Set(SLACK_METHOD_FAMILIES)).toEqual(new Set(expectedFamilies));
      expect(SLACK_METHOD_FAMILIES).not.toContain('skills');
      expect(SLACK_METHOD_FAMILIES).not.toContain('misc');
    });
  });

  describe('Sample 03C Tool Definitions Grounded in Inventory', () => {
    it('defines 4 fixed sample tools with exact scopes and fail-closed schemas', () => {
      expect(MYSLACK_SAMPLE_TOOLS).toHaveLength(4);
      expect(MYSLACK_SAMPLE_TOOLS.map(t => t.name)).toEqual([
        'myslack.conversations_history',
        'myslack.conversations_list',
        'myslack.chat_postMessage',
        'myslack.users_info',
      ]);
    });

    it('conversations.history matches pinned inventory metadata', () => {
      const tool = MYSLACK_CONVERSATIONS_HISTORY_TOOL;
      expect(tool.method).toBe('conversations.history');
      expect(tool.family).toBe('conversations');
      expect(tool.sideEffect).toBe('read');
      expect(tool.riskLevel).toBe('low');
      expect(tool.userScopes).toEqual(['channels:history', 'groups:history', 'im:history', 'mpim:history']);
      expect(tool.hasUnknownScopes).toBe(false);
      expect(tool.requiresBinding).toBe(true);
      expect(tool.inputSchema.additionalProperties).toBe(false);
    });

    it('conversations.list matches pinned inventory metadata', () => {
      const tool = MYSLACK_CONVERSATIONS_LIST_TOOL;
      expect(tool.method).toBe('conversations.list');
      expect(tool.family).toBe('conversations');
      expect(tool.sideEffect).toBe('read');
      expect(tool.riskLevel).toBe('low');
      expect(tool.userScopes).toEqual(['channels:read', 'groups:read', 'im:read', 'mpim:read']);
    });

    it('chat.postMessage matches pinned inventory metadata with high risk and write sideEffect', () => {
      const tool = MYSLACK_CHAT_POST_MESSAGE_TOOL;
      expect(tool.method).toBe('chat.postMessage');
      expect(tool.family).toBe('chat');
      expect(tool.sideEffect).toBe('write');
      expect(tool.riskLevel).toBe('high');
      expect(tool.userScopes).toEqual(['chat:write']);
    });

    it('users.info matches pinned inventory metadata', () => {
      const tool = MYSLACK_USERS_INFO_TOOL;
      expect(tool.method).toBe('users.info');
      expect(tool.family).toBe('users');
      expect(tool.sideEffect).toBe('read');
      expect(tool.riskLevel).toBe('low');
      expect(tool.userScopes).toEqual(['users:read']);
    });
  });

  describe('validateSlackToolDefinition', () => {
    it('validates tool definitions with unknown scopes represented as null', () => {
      const probeTool: SlackToolDefinition = {
        name: 'myslack.views_open',
        service: 'myslack',
        description: 'Opens a modal view',
        method: 'views.open',
        family: 'views',
        sideEffect: 'write',
        riskLevel: 'medium',
        userScopes: null,
        hasUnknownScopes: true,
        planTier: 'any',
        isProbeRequired: true,
        requiresBinding: true,
        inputSchema: {
          type: 'object',
          properties: {
            binding: { type: 'object' },
            trigger_id: { type: 'string' },
          },
          required: ['binding', 'trigger_id'],
          additionalProperties: false,
        },
        outputSchema: { type: 'object' },
      };
      const clean = validateSlackToolDefinition(probeTool);
      expect(clean.userScopes).toBeNull();
      expect(clean.hasUnknownScopes).toBe(true);
    });

    it('rejects tool definitions with invalid family or service', () => {
      const invalid = {
        ...MYSLACK_CONVERSATIONS_HISTORY_TOOL,
        family: 'invented_family' as any,
      };
      expect(() => validateSlackToolDefinition(invalid)).toThrow(TypeError);

      const invalidService = {
        ...MYSLACK_CONVERSATIONS_HISTORY_TOOL,
        service: 'other_service' as any,
      };
      expect(() => validateSlackToolDefinition(invalidService)).toThrow(TypeError);
    });

    it('detaches input/output schema so mutating validated output does not mutate caller', () => {
      const definition = structuredClone(MYSLACK_CONVERSATIONS_HISTORY_TOOL);
      const clean = validateSlackToolDefinition(definition);
      (clean.inputSchema.properties as any).channel.type = 'object';
      expect((definition.inputSchema.properties as any).channel.type).toBe('string');
    });
  });

  describe('validateSlackToolExecutionArgs (Fail-Closed Parameter Validation)', () => {
    it('validates and accepts valid args with binding for conversations.history', () => {
      const validArgs = {
        binding,
        channel: 'C12345678',
        limit: 50,
      };
      const result = validateSlackToolExecutionArgs(MYSLACK_CONVERSATIONS_HISTORY_TOOL, validArgs);
      expect(result.binding).toEqual(binding);
      expect(result.params).toEqual({
        channel: 'C12345678',
        limit: 50,
      });
    });

    it('accepts nested params structure { binding, params: { ... } }', () => {
      const nestedArgs = {
        binding,
        params: {
          channel: 'C12345678',
          inclusive: true,
        },
      };
      const result = validateSlackToolExecutionArgs(MYSLACK_CONVERSATIONS_HISTORY_TOOL, nestedArgs);
      expect(result.binding).toEqual(binding);
      expect(result.params).toEqual({
        channel: 'C12345678',
        inclusive: true,
      });
    });

    it('fails closed when unknown extra properties are supplied', () => {
      const dirtyArgs = {
        binding,
        channel: 'C12345678',
        extraSneakyField: 'injected',
      };
      expect(() =>
        validateSlackToolExecutionArgs(MYSLACK_CONVERSATIONS_HISTORY_TOOL, dirtyArgs)
      ).toThrow(TypeError);
    });

    it('fails closed when credential or token is injected into args', () => {
      const injectedTokenArgs = {
        binding,
        channel: 'C12345678',
        token: 'xoxp-1234567890-synthetic-secret',
      };
      expect(() =>
        validateSlackToolExecutionArgs(MYSLACK_CONVERSATIONS_HISTORY_TOOL, injectedTokenArgs)
      ).toThrow(TypeError);
    });

    it('fails closed when parameter violates schema type or bounds', () => {
      const invalidLimitType = {
        binding,
        channel: 'C12345678',
        limit: '50' as any,
      };
      expect(() =>
        validateSlackToolExecutionArgs(MYSLACK_CONVERSATIONS_HISTORY_TOOL, invalidLimitType)
      ).toThrow(TypeError);

      const negativeLimit = {
        binding,
        channel: 'C12345678',
        limit: -5,
      };
      expect(() =>
        validateSlackToolExecutionArgs(MYSLACK_CONVERSATIONS_HISTORY_TOOL, negativeLimit)
      ).toThrow(TypeError);
    });

    it('fails closed when required parameter is missing', () => {
      const missingChannel = {
        binding,
        limit: 10,
      };
      expect(() =>
        validateSlackToolExecutionArgs(MYSLACK_CONVERSATIONS_HISTORY_TOOL, missingChannel)
      ).toThrow(TypeError);
    });

    it('fails closed when binding is missing or malformed', () => {
      expect(() =>
        validateSlackToolExecutionArgs(MYSLACK_CONVERSATIONS_HISTORY_TOOL, { channel: 'C123' })
      ).toThrow(TypeError);
    });

    it('unknown method cannot reuse a known sample tool argument schema', () => {
      expect(() =>
        validateSlackToolExecutionArgs(
          { ...MYSLACK_CHAT_POST_MESSAGE_TOOL, method: 'fictional.write' },
          { binding, channel: 'C1', text: 'fixture' }
        )
      ).toThrow(TypeError);
    });

    it('nested params are validated recursively or rejected as unsupported', () => {
      const tool: SlackToolDefinition = {
        ...MYSLACK_CHAT_POST_MESSAGE_TOOL,
        name: 'myslack.views_open',
        method: 'views.open',
        family: 'views',
        userScopes: null,
        hasUnknownScopes: true,
        inputSchema: {
          type: 'object',
          properties: {
            binding: { type: 'object' },
            view: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['modal'] },
              },
              required: ['type'],
              additionalProperties: false,
            },
          },
          required: ['binding', 'view'],
          additionalProperties: false,
        },
      };
      expect(() =>
        validateSlackToolExecutionArgs(tool, {
          binding,
          view: { type: 'modal', access_token: 'FIXTURE_SECRET_SHOULD_NOT_PASS' },
        })
      ).toThrow(TypeError);
    });

    it('nested params envelope rejects unknown outer arguments', () => {
      expect(() =>
        validateSlackToolExecutionArgs(MYSLACK_CHAT_POST_MESSAGE_TOOL, {
          binding,
          params: { channel: 'C1', text: 'fixture' },
          unexpected: 'ignored',
        })
      ).toThrow(TypeError);
    });

    it('unknown method in a known family remains rejected with a matching invented name', () => {
      expect(() =>
        validateSlackToolExecutionArgs(
          { ...MYSLACK_CHAT_POST_MESSAGE_TOOL, name: 'myslack.chat_nonexistent', method: 'chat.nonexistent' },
          { binding, channel: 'C1', text: 'fixture' }
        )
      ).toThrow(TypeError);
    });

    it('known method cannot weaken its canonical text schema through caller metadata', () => {
      const weakened = structuredClone(MYSLACK_CHAT_POST_MESSAGE_TOOL);
      (weakened.inputSchema.properties as any).text = { type: 'object', additionalProperties: true };
      expect(() =>
        validateSlackToolExecutionArgs(weakened, {
          binding,
          channel: 'C1',
          text: { access_token: 'FIXTURE_SECRET_SHOULD_NOT_PASS' },
        })
      ).toThrow(TypeError);
    });
  });

  describe('Global Registry Invariants', () => {
    it('confirms personal Slack tools remain strictly outside ALL_TOOLS and SERVICE_REGISTRY', () => {
      for (const tool of MYSLACK_SAMPLE_TOOLS) {
        expect(ALL_TOOLS.some(t => t.name === tool.name)).toBe(false);
      }
      expect(ALL_TOOLS.some(t => t.service === 'myslack')).toBe(false);
      expect(SERVICE_REGISTRY.some(s => s.id === 'myslack')).toBe(false);
    });
  });
});
