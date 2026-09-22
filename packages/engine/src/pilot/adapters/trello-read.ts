import { assertPilotAccess, type PilotPolicy } from '../policy.js';
import { pilotFetch } from '../http-client.js';
import type { PilotConfig } from '../config.js';

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

export async function trelloListLists(params: {
  config: PilotConfig;
  policy: PilotPolicy;
  principalId: string;
  boardId: string;
}): Promise<Array<{ id: string; name: string; closed: boolean }>> {
  const { config, policy, principalId, boardId } = params;
  assertPilotAccess(policy, principalId, { kind: 'board', boardId });

  const auth = getTrelloAuth(config);
  const url = `https://api.trello.com/1/boards/${encodeURIComponent(boardId)}/lists?${auth.query}`;

  const res = await pilotFetch<Array<{ id: string; name: string; closed: boolean }>>(
    url,
    { method: 'GET' },
    { secrets: auth.secrets, retries: 2 },
  );

  return res.data ?? [];
}

export async function trelloListMembers(params: {
  config: PilotConfig;
  policy: PilotPolicy;
  principalId: string;
  boardId: string;
}): Promise<Array<{ id: string; fullName: string; username: string }>> {
  const { config, policy, principalId, boardId } = params;
  assertPilotAccess(policy, principalId, { kind: 'board', boardId });

  const auth = getTrelloAuth(config);
  const url = `https://api.trello.com/1/boards/${encodeURIComponent(boardId)}/members?${auth.query}`;

  const res = await pilotFetch<Array<{ id: string; fullName: string; username: string }>>(
    url,
    { method: 'GET' },
    { secrets: auth.secrets, retries: 2 },
  );

  return res.data ?? [];
}

export async function trelloGetCard(params: {
  config: PilotConfig;
  policy: PilotPolicy;
  principalId: string;
  cardId: string;
}): Promise<{
  id: string;
  name: string;
  desc: string;
  idList: string;
  due: string | null;
  idMembers: string[];
  url: string;
}> {
  const { config, policy, principalId, cardId } = params;
  const auth = getTrelloAuth(config);
  const url = `https://api.trello.com/1/cards/${encodeURIComponent(cardId)}?${auth.query}`;

  const res = await pilotFetch<{
    id: string;
    idBoard: string;
    name: string;
    desc: string;
    idList: string;
    due: string | null;
    idMembers: string[];
    url: string;
  }>(url, { method: 'GET' }, { secrets: auth.secrets, retries: 2 });

  const card = res.data;
  if (!card) {
    throw new Error('CARD_NOT_FOUND');
  }

  // Validate that the card belongs to our allowlisted board
  assertPilotAccess(policy, principalId, { kind: 'board', boardId: card.idBoard });

  return {
    id: card.id,
    name: card.name,
    desc: card.desc,
    idList: card.idList,
    due: card.due,
    idMembers: card.idMembers,
    url: card.url,
  };
}
