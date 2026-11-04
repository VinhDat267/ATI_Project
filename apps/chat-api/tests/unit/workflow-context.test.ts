import { describe, it, expect } from 'vitest';
import {
  validateWorkflowContext,
  type WorkflowContext,
} from '@wap/tool-schemas';
import { filterPermittedWorkflowDefaults } from '../../src/services/workflow-context-guard.js';

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
});
