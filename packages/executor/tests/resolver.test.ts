import { describe, it, expect } from 'vitest';
import { resolveArgs, resolveValue } from '../src/index.js';

describe('packages/executor (Task 12: Reference Resolver)', () => {
  const outputs = new Map<string, any>([
    [
      'step_1',
      {
        id: 'card_123',
        url: 'https://trello.com/c/123',
        badges: { votes: 5, comments: 2 },
      },
    ],
    ['step_2', { memberId: 'm_456', username: 'nam' }],
    ['step_3', { channelId: 'C100', channelName: 'general' }],
  ]);

  it('resolves literals and primitive values without modification', () => {
    const args = {
      title: 'Static title',
      count: 42,
      active: true,
      tags: ['backend', 'api'],
    };

    const resolved = resolveArgs(args, outputs);
    expect(resolved).toEqual({
      title: 'Static title',
      count: 42,
      active: true,
      tags: ['backend', 'api'],
    });
  });

  it('resolves $ref paths including nested properties', () => {
    const args = {
      cardId: { $ref: 'step_1.output.id' },
      assignedMember: { $ref: 'step_2.output.memberId' },
      voteCount: { $ref: 'step_1.output.badges.votes' },
    };

    const resolved = resolveArgs(args, outputs);
    expect(resolved.cardId).toBe('card_123');
    expect(resolved.assignedMember).toBe('m_456');
    expect(resolved.voteCount).toBe(5);
  });

  it('resolves $template string interpolations with single and multiple variables', () => {
    const args = {
      msg1: { $template: 'Card: ${step_1.output.url}' },
      msg2: {
        $template:
          'User ${step_2.output.username} added to card ${step_1.output.id} in #${step_3.output.channelName}',
      },
    };

    const resolved = resolveArgs(args, outputs);
    expect(resolved.msg1).toBe('Card: https://trello.com/c/123');
    expect(resolved.msg2).toBe(
      'User nam added to card card_123 in #general'
    );
  });

  it('resolves deeply nested objects and arrays containing $ref and $template', () => {
    const args = {
      payload: {
        cardInfo: {
          id: { $ref: 'step_1.output.id' },
          notification: { $template: 'Notice: ${step_1.output.url}' },
        },
        members: [{ id: { $ref: 'step_2.output.memberId' } }],
      },
    };

    const resolved = resolveArgs(args, outputs);
    expect(resolved.payload.cardInfo.id).toBe('card_123');
    expect(resolved.payload.cardInfo.notification).toBe(
      'Notice: https://trello.com/c/123'
    );
    expect(resolved.payload.members[0].id).toBe('m_456');
  });

  it('throws an error if referenced step does not exist in outputs', () => {
    const args = {
      badRef: { $ref: 'step_99.output.id' },
    };

    expect(() => resolveArgs(args, outputs)).toThrow(
      /referenced step 'step_99' output not found/i
    );
  });

  it('throws an error if referenced property path does not exist on step output', () => {
    const args = {
      badPath: { $ref: 'step_1.output.nonexistent.field' },
    };

    expect(() => resolveArgs(args, outputs)).toThrow(
      /property 'output.nonexistent.field' not found on step 'step_1'/i
    );
  });
});
