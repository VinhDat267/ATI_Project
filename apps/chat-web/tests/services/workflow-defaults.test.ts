// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildDefaultsKey,
  loadWorkflowDefaults,
  saveWorkflowDefaults,
  clearWorkflowDefaults,
  type WorkflowResourceDefaults,
} from '../../src/services/workflow-defaults-storage';

describe('Workflow Defaults Storage (FLOW-04)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('builds scoped storage keys by userId and workspaceKey', () => {
    expect(buildDefaultsKey('user-1', 'personal')).toBe('planora_defaults_v2:user-1:personal');
    expect(buildDefaultsKey('user-1', 'ws-org-99')).toBe('planora_defaults_v2:user-1:ws-org-99');
    expect(buildDefaultsKey(null, null)).toBe('planora_defaults_v2:anonymous:personal');
  });

  it('isolates resource defaults between users and workspaces', () => {
    const defaultsA: WorkflowResourceDefaults = {
      github: { repo: 'acme/project-a' },
      slack: { channelId: 'C1234567' },
    };
    const defaultsB: WorkflowResourceDefaults = {
      github: { repo: 'other/project-b' },
      slack: { channelId: 'C9999999' },
    };

    saveWorkflowDefaults('user-a', 'personal', defaultsA);
    saveWorkflowDefaults('user-b', 'personal', defaultsB);
    saveWorkflowDefaults('user-a', 'ws-team', { trello: { boardId: 'b-1', listId: 'l-1' } });

    expect(loadWorkflowDefaults('user-a', 'personal')).toEqual(defaultsA);
    expect(loadWorkflowDefaults('user-b', 'personal')).toEqual(defaultsB);
    expect(loadWorkflowDefaults('user-a', 'ws-team')).toEqual({
      trello: { boardId: 'b-1', listId: 'l-1' },
    });
  });

  it('clears defaults for a specific scope without affecting others', () => {
    saveWorkflowDefaults('user-1', 'personal', { github: { repo: 'org/repo' } });
    saveWorkflowDefaults('user-1', 'team-ws', { slack: { channelId: 'C_DEV' } });

    clearWorkflowDefaults('user-1', 'personal');
    expect(loadWorkflowDefaults('user-1', 'personal')).toBeNull();
    expect(loadWorkflowDefaults('user-1', 'team-ws')).toEqual({ slack: { channelId: 'C_DEV' } });
  });

  it('strips invalid or unauthorized recipient emails if accidentally provided', () => {
    const maliciousPayload = {
      github: { repo: 'org/repo' },
      recipientEmail: 'hacker@example.com',
      arbitraryField: 'attack',
    } as any;

    saveWorkflowDefaults('user-1', 'personal', maliciousPayload);
    const loaded = loadWorkflowDefaults('user-1', 'personal');
    expect(loaded).toEqual({ github: { repo: 'org/repo' } });
    expect((loaded as any)?.recipientEmail).toBeUndefined();
    expect((loaded as any)?.arbitraryField).toBeUndefined();
  });
});
