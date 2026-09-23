import type { PilotConfig } from './config.js';
import type { PilotPolicy } from './policy.js';
import { readSheetsRequest } from './adapters/sheets.js';
import {
  trelloListLists,
  trelloListMembers,
  trelloGetCard,
} from './adapters/trello-read.js';
import { trelloCreateCard } from './adapters/trello-write.js';

export type PilotToolEntry = {
  name: string;
  description: string;
  sideEffect: 'read' | 'write';
  policyVersion: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
};

const PILOT_TOOLS: PilotToolEntry[] = [
  {
    name: 'google_sheets.read_request',
    description: 'Read a client design/web service request from the configured Google Sheet',
    sideEffect: 'read',
    policyVersion: 'pilot-v2',
    inputSchema: {
      type: 'object',
      properties: {
        spreadsheetId: { type: 'string' },
        tabId: { type: 'string' },
        requestId: { type: 'string' },
      },
      required: ['spreadsheetId', 'tabId', 'requestId'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        row: { type: 'object' },
        checklist: { type: 'object' },
        sourceKey: { type: 'string' },
        sourceRevision: { type: 'string' },
      },
      required: ['row', 'checklist', 'sourceKey', 'sourceRevision'],
    },
  },
  {
    name: 'trello.list_lists',
    description: 'List active columns/lists on the configured Trello board',
    sideEffect: 'read',
    policyVersion: 'pilot-v2',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
      },
      required: ['boardId'],
    },
    outputSchema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          closed: { type: 'boolean' },
        },
      },
    },
  },
  {
    name: 'trello.list_members',
    description: 'List members assigned to the configured Trello board',
    sideEffect: 'read',
    policyVersion: 'pilot-v2',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
      },
      required: ['boardId'],
    },
    outputSchema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          fullName: { type: 'string' },
          username: { type: 'string' },
        },
      },
    },
  },
  {
    name: 'trello.get_card',
    description: 'Fetch real-time card details by card ID on Trello',
    sideEffect: 'read',
    policyVersion: 'pilot-v2',
    inputSchema: {
      type: 'object',
      properties: {
        cardId: { type: 'string' },
      },
      required: ['cardId'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        desc: { type: 'string' },
        idList: { type: 'string' },
        due: { type: ['string', 'null'] },
        idMembers: { type: 'array', items: { type: 'string' } },
        url: { type: 'string' },
      },
    },
  },
  {
    name: 'trello.create_card',
    description: 'Create a new Trello task card on the specified board list (Write action)',
    sideEffect: 'write',
    policyVersion: 'pilot-v2',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'string' },
        listName: { type: 'string' },
        listId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        assigneeId: { type: 'string' },
        dueDate: { type: 'string' },
        intentKey: { type: 'string' },
      },
      required: ['boardId', 'listName', 'title', 'intentKey'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        cardId: { type: 'string' },
        url: { type: 'string' },
        listId: { type: 'string' },
        boardId: { type: 'string' },
        title: { type: 'string' },
        intentKey: { type: 'string' },
      },
      required: ['cardId', 'url', 'listId', 'boardId', 'title', 'intentKey'],
    },
  },
];

export const PILOT_TOOL_CATALOG: readonly PilotToolEntry[] = PILOT_TOOLS;

export function getPilotCatalog(): PilotToolEntry[] {
  return [...PILOT_TOOLS];
}

export type PilotCallContext = {
  config: PilotConfig;
  policy: PilotPolicy;
  principalId: string;
  approvalExpiresAt?: Date;
};

export async function dispatchPilotTool(
  toolName: string,
  args: Record<string, unknown>,
  context: PilotCallContext,
): Promise<unknown> {
  const { config, policy, principalId } = context;

  switch (toolName) {
    case 'google_sheets.read_request':
      return readSheetsRequest({
        config,
        policy,
        principalId,
        spreadsheetId: String(args.spreadsheetId ?? ''),
        tabId: String(args.tabId ?? ''),
        requestId: String(args.requestId ?? ''),
      });

    case 'trello.list_lists':
      return trelloListLists({
        config,
        policy,
        principalId,
        boardId: String(args.boardId ?? ''),
      });

    case 'trello.list_members':
      return trelloListMembers({
        config,
        policy,
        principalId,
        boardId: String(args.boardId ?? ''),
      });

    case 'trello.get_card':
      return trelloGetCard({
        config,
        policy,
        principalId,
        cardId: String(args.cardId ?? ''),
      });

    case 'trello.create_card':
      return trelloCreateCard({
        config,
        policy,
        principalId,
        boardId: String(args.boardId ?? ''),
        listName: String(args.listName ?? ''),
        listId: args.listId ? String(args.listId) : undefined,
        title: String(args.title ?? ''),
        description: args.description ? String(args.description) : undefined,
        assigneeId: args.assigneeId ? String(args.assigneeId) : undefined,
        dueDate: args.dueDate ? String(args.dueDate) : undefined,
        intentKey: String(args.intentKey ?? ''),
        approvalExpiresAt: context.approvalExpiresAt,
      });

    default:
      throw new Error(`UNKNOWN_TOOL: Tool ${toolName} not recognized in pilot-v2 catalog`);
  }
}
