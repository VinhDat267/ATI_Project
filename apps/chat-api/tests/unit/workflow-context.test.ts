import { describe, it, expect, vi } from 'vitest';
import {
  validateWorkflowContext,
  type WorkflowContext,
} from '@wap/tool-schemas';
import { filterPermittedWorkflowDefaults } from '../../src/services/workflow-context-guard.js';
import { ChatService } from '../../src/services/chat-service.js';

describe('WorkflowContext Shared DTO & API Guard (FLOW-04)', () => {
  it('accepts valid workflowContext with allowed resourceDefaults', () => {
    const validCtx: WorkflowContext = {
      templateId: 'DEV-02',
      resourceDefaults: {
        github: { repo: 'org/repo-1' },
        slack: { channelId: 'C12345' },
      },
    };

    const res = validateWorkflowContext(validCtx);
    expect(res.valid).toBe(true);
    expect(res.value).toEqual(validCtx);
  });

  it('rejects arbitrary fields or recipient email in workflowContext', () => {
    const invalidCtx = {
      templateId: 'OFF-02',
      resourceDefaults: {
        mycalendar: { calendarId: 'primary' },
        recipientEmail: 'victim@example.com', // Forbidden!
      },
    };

    const res = validateWorkflowContext(invalidCtx);
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/recipientEmail|unknown/i);
  });

  it('rejects invalid resource groups (e.g. trello missing listId)', () => {
    const invalidCtx = {
      templateId: 'PM-01',
      resourceDefaults: {
        trello: { boardId: 'b-1' } as any, // Missing listId
      },
    };

    const res = validateWorkflowContext(invalidCtx);
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/listId/i);
  });

  it('filterPermittedWorkflowDefaults drops resources not in user allowlists', () => {
    const ctx: WorkflowContext = {
      templateId: 'DEV-02',
      resourceDefaults: {
        github: { repo: 'unauthorized/secret-repo' },
        slack: { channelId: 'C_ALLOWED' },
      },
    };

    const userConnections = {
      github: { credentialId: 'cred-1', githubUserId: 'u1', login: 'octocat', repos: ['authorized/public-repo'] },
      myslack: { credentialId: 'cred-2', scopes: ['chat:write'] },
    };

    const filtered = filterPermittedWorkflowDefaults(ctx, userConnections as any);
    // Unauthorized github repo must be dropped
    expect(filtered.resourceDefaults?.github).toBeUndefined();
    // Slack channel is retained
    expect(filtered.resourceDefaults?.slack).toEqual({ channelId: 'C_ALLOWED' });
  });

  it('filterPermittedWorkflowDefaults drops resources when service is not connected', () => {
    const ctx: WorkflowContext = {
      templateId: 'PM-01',
      resourceDefaults: {
        trello: { boardId: 'b-1', listId: 'l-1' },
      },
    };

    const userConnections = {}; // No trello connection

    const filtered = filterPermittedWorkflowDefaults(ctx, userConnections as any);
    expect(filtered.resourceDefaults?.trello).toBeUndefined();
  });

  it('filterPermittedWorkflowDefaults drops mycalendar default "primary" when "primary" is not in allowedCalendars', () => {
    const ctx: WorkflowContext = {
      templateId: 'OFF-02',
      resourceDefaults: {
        mycalendar: { calendarId: 'primary' },
      },
    };
    const filtered = filterPermittedWorkflowDefaults(ctx, {
      mycalendar: {
        credentialId: 'cred-1',
        email: 'alice@example.test',
        allowedCalendars: ['alice@example.test'],
      },
    });
    expect(filtered.resourceDefaults?.mycalendar).toBeUndefined();
  });

  it('ChatService unwraps { status, connection } lookup envelopes for workflowContext and forwards workspaceMode/workspaceId to Trello precheck', async () => {
    let seenWorkflowDefaults: any;
    let seenTrelloScope: string | undefined;
    let seenGithubScope: string | undefined;
    const seenAdapterContexts: any[] = [];

    const chatService = new ChatService({
      convRepo: {
        getConversation: async () => ({
          id: 'conv-org-1',
          user_id: 'u1',
          workspace_mode: 'organization',
          workspace_id: 'ws-org-1',
        }),
      } as any,
      workspaceRepo: {
        findMember: async () => ({ status: 'active' }),
      } as any,
      msgRepo: {
        createMessage: async (_c: string, _r: string, _text: string, meta?: any) => ({ id: 'msg-1', metadata: meta }),
        listMessages: async () => [],
      } as any,
      planRepo: {
        savePlan: async () => ({ id: 'plan-1', plan_hash: 'h1' }),
      } as any,
      eventEmitter: { emit: () => {} },
      trelloConnection: async (_userId: string, scopeId?: string) => {
        seenTrelloScope = scopeId;
        return {
          status: 'connected',
          connection: {
            credentialId: 'cred-tr-1',
            memberId: 'mem-1',
            username: 'alice',
            boardIds: ['board-allowed'],
          },
          teamBoards: [{ boardId: 'board-allowed', boardName: 'Engineering' }],
        };
      },
      githubConnection: async (_userId: string, scopeId?: string) => {
        seenGithubScope = scopeId;
        return {
          status: 'connected',
          connection: {
            credentialId: 'cred-gh-1',
            githubUserId: '101',
            login: 'octocat',
            repos: ['org/allowed-repo'],
          },
          teamRepos: [{ repoId: 'r1', fullName: 'org/allowed-repo', name: 'allowed-repo' }],
        };
      },
      getAdapter: async (service: string, context?: any) => {
        seenAdapterContexts.push({ service, context });
        return {
          execute: async () => [],
        };
      },
      planner: {
        processMessage: async (input: any) => {
          seenWorkflowDefaults = input.memory.getEntity('workflow_resource_defaults');
          return {
            kind: 'plan',
            thinking: 'Create Trello card in allowed board',
            summary: 'Create Trello card',
            warnings: [],
            steps: [
              {
                id: 'step_1',
                tool: 'trello.create_card',
                description: 'Create card',
                args: { listId: 'list-1', title: 'Audit item' },
                boardId: 'board-allowed',
                dependsOn: [],
              } as any,
            ],
          };
        },
        routeSchedule: () => ({ services: [], unavailable: [] }),
      } as any,
    });

    await chatService.handleUserMessage({
      conversationId: 'conv-org-1',
      userId: 'u1',
      content: 'Tạo card Audit item trong workspace',
      workflowContext: {
        templateId: 'DEV-02',
        resourceDefaults: {
          trello: { boardId: 'board-allowed', listId: 'list-1' },
          github: { repo: 'org/allowed-repo' },
        },
      },
    });

    await vi.waitFor(() => {
      expect(seenAdapterContexts.length).toBeGreaterThan(0);
    });

    expect(seenTrelloScope).toBe('ws-org-1');
    expect(seenGithubScope).toBe('ws-org-1');
    expect(seenWorkflowDefaults).toEqual({
      trello: { boardId: 'board-allowed', listId: 'list-1' },
      github: { repo: 'org/allowed-repo' },
    });

    const trelloPrecheck = seenAdapterContexts.find((c) => c.service === 'trello');
    expect(trelloPrecheck?.context?.workspaceMode).toBe('organization');
    expect(trelloPrecheck?.context?.workspaceId).toBe('ws-org-1');
  });
});
