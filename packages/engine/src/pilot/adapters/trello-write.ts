import { assertPilotAccess, type PilotPolicy } from '../policy.js';
import { pilotFetch } from '../http-client.js';
import type { PilotConfig } from '../config.js';
import type { TrelloReceipt } from '../schemas.js';
import { trelloListLists } from './trello-read.js';

function getTrelloAuth(config: PilotConfig): { query: string; secrets: string[] } {
  const key = config.trello?.apiKey ?? '';
  const token = config.trello?.apiToken ?? '';
  if (!key || !token) {
    throw new Error('CONFIG_ERROR: Missing Trello API key or token');
  }
  return {
    query: `key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`,
    secrets: [key, token],
  };
}

export type TrelloCreateCardParams = {
  config: PilotConfig;
  policy: PilotPolicy;
  principalId: string;
  boardId: string;
  listName: string;
  title: string;
  description?: string;
  assigneeId?: string;
  dueDate?: string;
  intentKey: string;
};

export async function trelloCreateCard(
  params: TrelloCreateCardParams,
): Promise<TrelloReceipt> {
  const {
    config,
    policy,
    principalId,
    boardId,
    listName,
    title,
    description,
    assigneeId,
    dueDate,
    intentKey,
  } = params;

  // 1. Policy check
  assertPilotAccess(policy, principalId, { kind: 'board', boardId });

  // 2. Resolve listName to idList
  const lists = await trelloListLists({
    config,
    policy,
    principalId,
    boardId,
  });

  const matchingList = lists.find(
    (l) => l.name.trim().toLowerCase() === listName.trim().toLowerCase() && !l.closed,
  );

  if (!matchingList) {
    throw new Error(`LIST_NOT_FOUND: List "${listName}" not found on board`);
  }

  // 3. Build card creation payload
  const auth = getTrelloAuth(config);
  const url = `https://api.trello.com/1/cards?${auth.query}`;

  const body: Record<string, unknown> = {
    idList: matchingList.id,
    name: title.trim(),
  };

  if (description?.trim()) {
    body.desc = description.trim();
  }
  if (dueDate?.trim()) {
    body.due = dueDate.trim();
  }
  if (assigneeId?.trim()) {
    body.idMembers = [assigneeId.trim()];
  }

  // 4. POST to Trello (write request -> retries = 0)
  const res = await pilotFetch<{ id: string; url: string }>(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    { secrets: auth.secrets, retries: 0 },
  );

  const card = res.data;
  if (!card?.id || !card?.url) {
    throw new Error('INVALID_REMOTE_RESPONSE: Trello response missing card id or url');
  }

  return {
    cardId: card.id,
    url: card.url,
    listId: matchingList.id,
    boardId,
    title: title.trim(),
    intentKey,
  };
}
