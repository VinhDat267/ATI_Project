import { describe, it, expect } from 'vitest';
import {
  TRELLO_TOOLS,
  TRELLO_OAUTH_TOOLS,
  TRELLO_RESOURCE_ID_PATTERN,
  isValidTrelloResourceId,
  validateTrelloToolArgs,
  getToolDefinition,
} from '../src/index.js';

describe('packages/tool-schemas (Trello Resource ID Schema & Validator Invariants)', () => {
  it('enforces TRELLO_RESOURCE_ID_PATTERN on all Trello resource ID properties across TRELLO_TOOLS and TRELLO_OAUTH_TOOLS', () => {
    const allTrelloTools = [...TRELLO_TOOLS, ...TRELLO_OAUTH_TOOLS];
    const expectedScalarFields: Record<string, string[]> = {
      'trello.search_lists': ['boardId'],
      'trello.search_members': ['boardId'],
      'trello.search_cards': ['boardId', 'listId'],
      'trello.get_card': ['cardId'],
      'trello.create_card': ['listId'],
      'trello.update_card': ['cardId', 'idList'],
      'trello.add_member': ['cardId', 'memberId'],
      'trello.add_checklist': ['cardId'],
      'trello.add_comment': ['cardId'],
      'trello.create_list': ['boardId'],
      'trello.remove_member': ['cardId', 'memberId'],
      'trello.update_checklist_item': ['cardId', 'checkItemId'],
      'trello.set_card_due_complete': ['cardId'],
    };

    for (const [toolName, fields] of Object.entries(expectedScalarFields)) {
      const tool = getToolDefinition(toolName);
      expect(tool, toolName).toBeDefined();
      for (const field of fields) {
        const prop = tool!.inputSchema.properties[field];
        expect(prop, `${toolName}.${field}`).toBeDefined();
        expect(prop.pattern, `${toolName}.${field}.pattern`).toBe(TRELLO_RESOURCE_ID_PATTERN);
        expect(prop.minLength, `${toolName}.${field}.minLength`).toBe(1);
        expect(prop.maxLength, `${toolName}.${field}.maxLength`).toBe(128);
      }
    }

    const createCard = getToolDefinition('trello.create_card')!;
    expect(createCard.inputSchema.properties.idMembers.items).toMatchObject({
      type: 'string',
      pattern: TRELLO_RESOURCE_ID_PATTERN,
      minLength: 1,
      maxLength: 128,
    });
    expect(allTrelloTools).toHaveLength(14);
  });

  it('validates legitimate Trello IDs and rejects traversal, URL, percent-encoded, and control-character inputs', () => {
    for (const validId of ['C', 'M1', 'b1', 'board-allowed-1', 'card_created_1', '5f4e3d2c1b0a9f8e7d6c5b4a']) {
      expect(isValidTrelloResourceId(validId), validId).toBe(true);
      expect(validateTrelloToolArgs('trello.remove_member', { cardId: 'C', memberId: validId })).toBeNull();
    }

    for (const badId of [
      '',
      '   ',
      '.',
      '..',
      '../../FOREIGN',
      '../boards/SECRET',
      '..%2f..%2fFOREIGN',
      '%2e%2e%2fSECRET',
      '%252e%252e%252fSECRET',
      'a/b',
      'a\\b',
      'id?fields=all',
      'id#hash',
      'https://api.trello.com/1/cards/C',
      'id\u0000null',
      'id\nnewline',
    ]) {
      expect(isValidTrelloResourceId(badId), badId).toBe(false);
      expect(validateTrelloToolArgs('trello.remove_member', { cardId: 'C', memberId: badId })).toMatch(
        /Invalid Trello resource ID/
      );
      expect(validateTrelloToolArgs('trello.create_card', { listId: 'L1', title: 'T', idMembers: [badId] })).toMatch(
        /Invalid Trello resource ID/
      );
    }
  });
});
