import { expect, it } from 'vitest';
import { SERVICE_REGISTRY, type ServiceDefinition } from '../src/index.js';

const banned = new Set(['lịch', 'bảng', 'trang', 'tin nhắn', 'message', 'thông báo', 'báo', 'kênh', 'channel', 'issue', 'issues', 'task', 'tasks', 'chat', 'nhóm', 'page', 'database', 'sprint', 'board', 'list', 'note', 'dòng', 'row']);
// Existing intent behavior is the routing baseline. Only these exact old words are grandfathered.
const legacy: Record<string, { words: string[]; reason: string }> = {
  trello: { words: ['board', 'list', 'task', 'tasks'], reason: 'Existing work-item and board routing; changing it invalidates golden comparisons.' },
  slack: { words: ['channel', 'kênh', 'tin nhắn', 'message', 'thông báo', 'báo'], reason: 'Existing messaging and fallback routing.' },
  github: { words: ['issue', 'issues'], reason: 'Existing source-code issue routing.' },
};

function problems(registry: ServiceDefinition[]): string[] {
  const owners = new Map<string, string>();
  const errors: string[] = [];
  for (const service of registry) {
    const phrases = new Set([service.id, service.name, ...service.intentKeywords, ...(service.fallbackIntentKeywords ?? [])].map(word => word.toLowerCase()));
    for (const phrase of phrases) {
      if (owners.has(phrase) && owners.get(phrase) !== service.id) errors.push('duplicate: ' + phrase);
      owners.set(phrase, service.id);
      if (banned.has(phrase) && !legacy[service.id]?.words.includes(phrase)) errors.push('banned: ' + phrase);
    }
  }
  return errors;
}

it('has unambiguous complete phrases and preserves only the documented legacy broad keywords', () => {
  expect(problems(SERVICE_REGISTRY)).toEqual([]);
  for (const service of SERVICE_REGISTRY) expect(service.scopeLabel, service.id).toBeTruthy();
});

it.each(['intentKeywords', 'fallbackIntentKeywords', 'id', 'name'])('rejects cross-service duplicates through %s', field => {
  const other = { ...SERVICE_REGISTRY[0]!, id: 'demo', name: 'Demo', intentKeywords: [], fallbackIntentKeywords: [], [field]: field.endsWith('Keywords') ? ['TrElLo'] : 'TrElLo' };
  expect(problems([SERVICE_REGISTRY[0]!, other])).toContain('duplicate: trello');
});

it.each([...banned])('rejects new-service generic phrase %s but permits longer specific phrases', phrase => {
  const other = { ...SERVICE_REGISTRY[0]!, id: 'demo', name: 'Demo', intentKeywords: [phrase], fallbackIntentKeywords: [] };
  expect(problems([other])).toEqual(['banned: ' + phrase]);
  expect(problems([{ ...other, intentKeywords: ['lên lịch', 'demo ' + phrase] }])).toEqual([]);
});
