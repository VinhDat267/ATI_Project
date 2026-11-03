import { createHash } from 'node:crypto';

export const SLACK_MESSAGE_TOMBSTONE = 'Slack content is unavailable.';
type Message = { content: string; metadata: any };
const own = (value: any, key: string) => value !== null && typeof value === 'object' && Object.hasOwn(value, key);
const decode = (value: string) => {
  const decoded = decodeURIComponent(value);
  if (!decoded || encodeURIComponent(decoded) !== value || ['__proto__', 'prototype', 'constructor'].includes(decoded)) throw new Error('unsupported_target');
  return decoded;
};
const metadataPaths: Record<string, string[]> = {
  'metadata.plan': ['plan'], 'metadata.proposal': ['proposal'], 'metadata.lookups': ['lookups'],
  'metadata.previous.name': ['previous', 'name'], 'metadata.previous.request': ['previous', 'request'],
  'metadata.previous.recurrence': ['previous', 'recurrence'], 'metadata.schedule.name': ['schedule', 'name'],
  'metadata.schedule.request': ['schedule', 'request'], 'metadata.schedule.recurrence': ['schedule', 'recurrence'],
  'metadata.schedule.lastRun.error': ['schedule', 'lastRun', 'error'], 'metadata.name': ['name'],
  // Runtime clarification/refusal metadata is flat. The selector retains the design's namespace.
  'metadata.clarification.options': ['options'], 'metadata.clarification.context': ['context'],
  'metadata.clarification.reason': ['reason'], 'metadata.refusal.reason': ['reason'], 'metadata.refusal.suggestion': ['suggestion'],
};
export function validateMessageSelector(kind: string, selector: string): void {
  if (kind === 'chat_history_message') {
    if (selector === 'content' || Object.hasOwn(metadataPaths, selector)) return;
    if (selector.startsWith('metadata.resourceLabels/')) { decode(selector.slice(24)); return; }
  }
  if (kind === 'working_memory_entity' && selector.startsWith('state:/')) {
    const path = selector.slice(7);
    if (path === '__gatherIntent' || path === '__gatherMissing') return;
    if (path === '__gatherPending/query') return;
    if (/^__(labels|gatherBindings)\/[^/]+$/.test(path)) { decode(path.split('/')[1]!); return; }
    const match = /^(?:__observed\/([^/]+)|__gatherPending\/candidates|([^/]+))#id=(.+)$/.exec(path);
    if (match) { if (match[1]) decode(match[1]); if (match[2]) decode(match[2]); decode(match[3]!); return; }
  }
  throw new Error('unsupported_target');
}
function pathFor(row: Message, kind: string, selector: string): string[] {
  validateMessageSelector(kind, selector);
  if (selector === 'content') return ['content'];
  if (kind === 'chat_history_message') {
    if (selector === 'metadata.name' && row.metadata?.type !== 'schedule_run') throw new Error('unsupported_target');
    if (selector.startsWith('metadata.clarification.') && row.metadata?.type !== 'clarification') throw new Error('unsupported_target');
    if (selector.startsWith('metadata.refusal.') && row.metadata?.type !== 'refusal') throw new Error('unsupported_target');
    return ['metadata', ...(selector.startsWith('metadata.resourceLabels/') ? ['resourceLabels', decode(selector.slice(24))] : metadataPaths[selector]!)];
  }
  if (row.metadata?.type !== 'working_memory') throw new Error('unsupported_target');
  const path = selector.slice(7), idAt = path.indexOf('#id=');
  if (idAt < 0) return ['metadata', 'state', ...path.split('/').map(decode)];
  const keys = path.slice(0, idAt).split('/').map(decode), id = decode(path.slice(idAt + 4));
  let array: any = row.metadata?.state;
  for (const key of keys) array = own(array, key) ? array[key] : undefined;
  if (array === undefined) return ['metadata', 'state', ...keys, '-1'];
  // Gather bindings store singular {id,...} entities; observations/members use arrays.
  if (!Array.isArray(array)) {
    if (!array || typeof array !== 'object' || typeof array.id !== 'string') throw new Error('stale_lineage');
    return ['metadata', 'state', ...keys, ...(array.id === id ? [] : ['-1'])];
  }
  const indices = array.flatMap((value, index) => value && value.id === id ? [String(index)] : []);
  if (indices.length > 1) throw new Error('stale_lineage');
  return ['metadata', 'state', ...keys, indices[0] ?? '-1'];
}
export function messageSelectorValue(row: Message, kind: string, selector: string): any {
  let value: any = row;
  for (const key of pathFor(row, kind, selector)) value = own(value, key) ? value[key] : undefined;
  return value;
}
export function messageSelectorKind(selector: string): 'working_memory_entity' | 'chat_history_message' {
  return selector.startsWith('state:/') ? 'working_memory_entity' : 'chat_history_message';
}
export function messageFingerprint(value: unknown, selector = 'content'): string {
  const canonical = (v: any): string => {
    if (v === undefined) return '{"__slack_absent__":true}';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    return `{${Object.keys(v).sort().map(key => `${JSON.stringify(key)}:${canonical(v[key])}`).join(',')}}`;
  };
  return createHash('sha256').update(selector === 'content' && typeof value === 'string' ? value : canonical(value), 'utf8').digest('hex');
}
/** Mutates only the selected field. Shared dictionaries and unrelated entities survive. */
export function eraseMessageSelector(row: Message, kind: string, selector: string): void {
  const path = pathFor(row, kind, selector);
  if (selector === 'content') { row.content = SLACK_MESSAGE_TOMBSTONE; return; }
  let parent: any = row;
  for (const key of path.slice(0, -1)) { if (!own(parent, key)) return; parent = parent[key]; }
  const key = path.at(-1)!;
  if (Array.isArray(parent)) { if (key !== '-1') parent.splice(Number(key), 1); }
  else if (parent && typeof parent === 'object') delete parent[key];
  if (selector === 'metadata.proposal') row.metadata.type = 'schedule_proposal_purged';
  if (selector.startsWith('state:/__gatherPending/') && row.metadata.state.__gatherPending?.candidates?.length === 0 &&
      !Object.hasOwn(row.metadata.state.__gatherPending, 'query')) delete row.metadata.state.__gatherPending;
}
export function hasSlackMarker(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== 'object') return false;
  if (depth > 40) return true;
  return Object.entries(value).some(([key, v]) => key === 'myslack' ||
    (key === 'slackUserId' && typeof v === 'string' && Object.hasOwn(value, 'workspaceId')) ||
    (key === 'service' && v === 'myslack') || hasSlackMarker(v, depth + 1));
}

/** Server enumeration of the actual runtime metadata, never a model-supplied path list. */
export function messageOutputSelectors(row: Message): string[] {
  const selectors = row.content ? ['content'] : [];
  for (const selector of Object.keys(metadataPaths)) {
    try { if (messageSelectorValue(row, 'chat_history_message', selector) !== undefined) selectors.push(selector); } catch { /* wrong metadata type */ }
  }
  for (const key of Object.keys(row.metadata?.resourceLabels ?? {})) selectors.push(`metadata.resourceLabels/${encodeURIComponent(key)}`);
  return selectors;
}

export function memoryOutputSelectors(state: Record<string, any>): string[] {
  const result: string[] = [];
  const array = (prefix: string, values: any) => {
    if (values && typeof values === 'object' && !Array.isArray(values) && typeof values.id === 'string' && values.id) {
      result.push(`state:/${prefix}#id=${encodeURIComponent(values.id)}`); return;
    }
    if (!Array.isArray(values) || values.some(v => !v || typeof v.id !== 'string' || !v.id)) throw new Error('SLACK_MEMORY_PROVENANCE_REQUIRED');
    for (const v of values) result.push(`state:/${prefix}#id=${encodeURIComponent(v.id)}`);
  };
  for (const [key, value] of Object.entries(state)) {
    if (key === '__gatherIntent' || key === '__gatherMissing') result.push(`state:/${key}`);
    else if (key === '__labels' || key === '__gatherBindings') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SLACK_MEMORY_PROVENANCE_REQUIRED');
      for (const entry of Object.keys(value)) result.push(`state:/${key}/${encodeURIComponent(entry)}`);
    } else if (key === '__observed') {
      for (const [type, values] of Object.entries(value ?? {})) array(`__observed/${encodeURIComponent(type)}`, values);
    } else if (key === '__gatherPending') {
      array('__gatherPending/candidates', value?.candidates);
      if (value && Object.hasOwn(value,'query')) result.push('state:/__gatherPending/query');
    }
    else array(encodeURIComponent(key), value);
  }
  return result;
}
