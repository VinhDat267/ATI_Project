import { NOTION_ID_PATTERN, normalizeNotionId } from '@wap/tool-schemas';
import { BaseAdapter, StepError, type BaseAdapterConfig } from '../base-adapter.js';
import { GlobalRateLimiter, waitWithSignal } from '../rate-limiter.js';
import { NOTION_MAX_PROPERTY_CHARS, clipText } from '../bounds.js';
import { zonedWallTimeToInstant } from '../calendar/time-utils.js';

export interface NotionAdapterConfig extends BaseAdapterConfig {
  credentials: { token: string };
  fetchFn?: typeof fetch;
  apiBaseUrl?: string;
  expectedDataSources?: ReadonlyMap<string, string>;
}
export const NOTION_VERSION = '2026-03-11';
const defaultApiBaseUrl = 'https://api.notion.com/v1';
const sharedLimiter = new GlobalRateLimiter({ maxRequests: 3, windowMs: 1000 });
const MAX_SEARCH_REQUESTS = 30;
const MAX_SEARCH_QUERIES_PER_SOURCE = 10;
function invalid(message: string): never { throw new StepError({ message: 'Notion ' + message, category: 'VALIDATION' }); }
function denied(): never { throw new StepError({ message: 'Notion resource is outside the allowed database scope', category: 'AUTH_ERROR', statusCode: 403 }); }
function badResponse(writing = false): never { throw new StepError({ message: 'Notion returned an invalid response', category: writing ? 'UNKNOWN' : 'SERVER_ERROR' }); }
function uuid(value: unknown, response = false, writing = false): string {
  if (typeof value !== 'string' || !NOTION_ID_PATTERN.test(value)) return response ? badResponse(writing) : invalid('resource id must be a UUID');
  return normalizeNotionId(value);
}
function text(value: unknown, max: number, nonempty = false): string {
  if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim())) invalid('text is outside its allowed size');
  return value;
}
function only(args: Record<string, any>, keys: string[]): void {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !keys.includes(key))) invalid('unexpected argument');
}
function limit(value: unknown, max: number): number {
  if (value === undefined) return max;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) invalid('limit is outside its allowed range');
  return value;
}
const textItem = (content: string) => ({ type: 'text', text: { content } });
const rich = (content: string) => [textItem(content)];
function chunkTextSafe(content: string, maxLen = 2000): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < content.length;) {
    let end = Math.min(start + maxLen, content.length);
    if (end < content.length && content.charCodeAt(end - 1) >= 0xD800 && content.charCodeAt(end - 1) <= 0xDBFF) end--;
    chunks.push(content.slice(start, end));
    start = end;
  }
  return chunks.length > 0 ? chunks : [''];
}
function paragraphs(content: string): object[] {
  return chunkTextSafe(content, 2000).map((chunk) => ({
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: rich(chunk) },
  }));
}
const NOTION_CODE_LANGUAGES = new Set([
  'abap', 'arduino', 'bash', 'basic', 'c', 'clojure', 'coffeescript', 'c++', 'c#', 'css', 'dart', 'diff',
  'docker', 'elixir', 'elm', 'erlang', 'flow', 'fortran', 'f#', 'gherkin', 'glsl', 'go', 'graphql', 'groovy',
  'haskell', 'html', 'java', 'javascript', 'json', 'julia', 'kotlin', 'latex', 'less', 'lisp', 'livescript',
  'lua', 'makefile', 'markdown', 'markup', 'matlab', 'mermaid', 'nix', 'objective-c', 'ocaml', 'pascal', 'perl',
  'php', 'plain text', 'powershell', 'prolog', 'protobuf', 'python', 'r', 'reason', 'ruby', 'rust', 'sass',
  'scala', 'scheme', 'scss', 'shell', 'sql', 'swift', 'typescript', 'vb.net', 'verilog', 'vhdl', 'visual basic',
  'webassembly', 'xml', 'yaml', 'java/c/c++/c#',
]);
function normalizeCodeLanguage(raw: string): string {
  const lower = raw.trim().toLowerCase();
  const mapped = lower === 'ts' ? 'typescript' : lower === 'js' ? 'javascript' : lower === 'py' ? 'python' : lower === 'sh' || lower === 'zsh' ? 'shell' : lower === 'yml' ? 'yaml' : lower;
  return NOTION_CODE_LANGUAGES.has(mapped) ? mapped : 'plain text';
}
function markdownToNotionBlocks(content: string): object[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: object[] = [];
  const blockRichText = (value: string) => chunkTextSafe(value).map(textItem);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    const fence = /^```([A-Za-z0-9_+.#-]*)\s*$/.exec(line.trim());
    if (fence) {
      const codeLines: string[] = [];
      let closed = false;
      for (let j = i + 1; j < lines.length; j++) {
        if (/^```\s*$/.test(lines[j]!.trim())) {
          i = j;
          closed = true;
          break;
        }
        codeLines.push(lines[j]!);
      }
      if (!closed) i = lines.length - 1;
      blocks.push({
        object: 'block',
        type: 'code',
        code: { language: normalizeCodeLanguage(fence[1] ?? ''), rich_text: blockRichText(codeLines.join('\n')) },
      });
      continue;
    }
    const trimmed = line.trim();
    if (/^-{3,}$/.test(trimmed)) {
      blocks.push({ object: 'block', type: 'divider', divider: {} });
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const level = heading[1]!.length as 1 | 2 | 3;
      const key = level === 1 ? 'heading_1' : level === 2 ? 'heading_2' : 'heading_3';
      blocks.push({ object: 'block', type: key, [key]: { rich_text: blockRichText(heading[2]!) } });
      continue;
    }
    const todo = /^[-*]\s+\[([ xX])\]\s+(.+)$/.exec(trimmed);
    if (todo) {
      blocks.push({
        object: 'block',
        type: 'to_do',
        to_do: { rich_text: blockRichText(todo[2]!), checked: todo[1]!.toLowerCase() === 'x' },
      });
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    if (bullet) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: blockRichText(bullet[1]!) },
      });
      continue;
    }
    const numbered = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (numbered) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: blockRichText(numbered[1]!) },
      });
      continue;
    }
    const calloutMatch = /^>\s*💡\s*(.+)$/.exec(trimmed);
    if (calloutMatch) {
      blocks.push({
        object: 'block',
        type: 'callout',
        callout: { rich_text: blockRichText(calloutMatch[1]!), icon: { type: 'emoji', emoji: '💡' } },
      });
      continue;
    }
    const quoteMatch = /^>\s+(.+)$/.exec(trimmed);
    if (quoteMatch) {
      blocks.push({
        object: 'block',
        type: 'quote',
        quote: { rich_text: blockRichText(quoteMatch[1]!) },
      });
      continue;
    }
    blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: blockRichText(line) } });
  }
  return blocks;
}
function plainRich(value: any): string {
  if (!Array.isArray(value)) badResponse();
  return value.map(item => typeof item?.plain_text === 'string' ? item.plain_text : typeof item?.text?.content === 'string' ? item.text.content : badResponse()).join('');
}
function dateEndpoint(raw: unknown, timeZone: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (typeof timeZone !== 'string' || !timeZone) return value;
  const wallTime = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!wallTime) return value;
  const [, day, hour, minute, second = '0', fraction = ''] = wallTime;
  try {
    const instant = zonedWallTimeToInstant(day!, Number(hour), Number(minute), Number(second), timeZone);
    if (!instant.nonexistentWallTime) return new Date(instant.ms + Number(fraction.padEnd(3, '0'))).toISOString();
  } catch {
    // Treat invalid provider dates consistently with other malformed responses.
  }
  return badResponse();
}
function propertyText(value: any): string {
  if (!value || typeof value.type !== 'string') badResponse();
  const data = value[value.type];
  switch (value.type) {
    case 'title': case 'rich_text': return plainRich(data);
    case 'select': case 'status': return data?.name ?? '';
    case 'multi_select': return Array.isArray(data) ? data.map(item => item.name).join(', ') : badResponse();
    case 'date': return data ? [dateEndpoint(data.start, data.time_zone), dateEndpoint(data.end, data.time_zone)].filter(Boolean).join(' → ') : '';
    case 'people': return Array.isArray(data) ? data.map(item => item.name ?? item.id).join(', ') : badResponse();
    case 'relation': return Array.isArray(data) ? data.map(item => item.id).join(', ') + (value.has_more === true ? ' [incomplete]' : '') : badResponse();
    case 'files': return Array.isArray(data) ? data.map(item => typeof item?.name === 'string' ? item.name : badResponse()).join(', ') : badResponse();
    case 'formula': return data ? propertyText(data) : '';
    case 'rollup': return data?.type === 'array' ? data.array.map(propertyText).join(', ') : data ? propertyText(data) : '';
    case 'number': case 'checkbox': case 'string': case 'boolean': case 'url': case 'email': case 'phone_number': case 'created_time': case 'last_edited_time': return data == null ? '' : String(data);
    case 'created_by': case 'last_edited_by': return data?.name ?? data?.id ?? '';
    case 'unique_id': return data ? [data.prefix, data.number].filter(item => item != null && item !== '').join('-') : '';
    case 'place': return data ? [data.name, data.address, typeof data.lat === 'number' && typeof data.lon === 'number' ? `${data.lat}, ${data.lon}` : null].filter(item => item != null && item !== '').join('; ') : '';
    case 'verification': return data ? [data.state, propertyText({ type: 'date', date: data.date }), data.verified_by?.name ?? data.verified_by?.id].filter(item => item != null && item !== '').join('; ') : '';
    case 'incomplete': return '[incomplete]';
    case 'button': return '[unavailable]';
    default: return '[unsupported]';
  }
}
function dateValue(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return false;
  const local = new Date(value.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(local.getTime()) || local.toISOString().slice(0, 10) !== value.slice(0, 10) || value.startsWith('0000-')) return false;
  if (value.length === 10) return true;
  const clock = new Date(value.slice(0, 19) + 'Z');
  return Number.isFinite(Date.parse(value)) && Number.isFinite(clock.getTime()) && clock.toISOString().slice(0, 19) === value.slice(0, 19);
}
function propertyValue(type: string, value: string | boolean | string[]): object {
  switch (type) {
    case 'rich_text': return { rich_text: rich(String(value)) };
    case 'select': {
      if (typeof value !== 'string' || !value.trim() || value.length > 100) invalid('select value is invalid');
      return { select: { name: value } };
    }
    case 'status': {
      if (typeof value !== 'string' || !value.trim() || value.length > 100) invalid('status value is invalid');
      return { status: { name: value } };
    }
    case 'multi_select': {
      const items = Array.isArray(value)
        ? value.map(v => typeof v === 'string' ? v.trim() : '').filter(Boolean)
        : typeof value === 'string'
          ? value.split(',').map(v => v.trim()).filter(Boolean)
          : [];
      if (items.length === 0 || items.length > 20 || items.some(item => item.length > 100)) invalid('multi_select value is invalid');
      return { multi_select: items.map(name => ({ name })) };
    }
    case 'checkbox': {
      if (value === true || value === 'true') return { checkbox: true };
      if (value === false || value === 'false') return { checkbox: false };
      return invalid('checkbox value must be true or false');
    }
    case 'date': if (typeof value !== 'string' || !dateValue(value)) invalid('date requires a valid ISO date or timezone-qualified instant'); return { date: { start: value } };
    case 'url': {
      if (typeof value !== 'string') invalid('url requires http or https');
      try { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol)) invalid('url requires http or https'); }
      catch { invalid('url requires http or https'); } return { url: value };
    }
    case 'number': {
      const strVal = String(value);
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(strVal) || !Number.isFinite(Number(strVal))) invalid('number value is invalid');
      return { number: Number(strVal) };
    }
    case 'email': {
      if (typeof value !== 'string' || !value.trim() || value.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
        invalid('email value is invalid');
      }
      return { email: value.trim() };
    }
    case 'phone_number': {
      if (typeof value !== 'string' || !value.trim() || value.length > 100) {
        invalid('phone_number value is invalid');
      }
      return { phone_number: value.trim() };
    }
    default: return invalid('property type is unsupported');
  }
}

function extractSchema(properties: Record<string, any>): Array<{ name: string; type: string; options?: string[] }> {
  return Object.entries(properties).map(([name, def]) => {
    const type = typeof def?.type === 'string' ? def.type : 'unknown';
    const rawOpts = def?.[type]?.options;
    const options = Array.isArray(rawOpts)
      ? rawOpts.map((o: any) => o?.name).filter((n: any): n is string => typeof n === 'string' && n.length > 0)
      : undefined;
    return { name, type, ...(options && options.length > 0 ? { options } : {}) };
  });
}

function validateAndConvertProperties(
  source: { properties: Record<string, any>; title: string },
  values: Record<string, any>,
  titleOverride?: string,
): Record<string, object> {
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > 100) {
    invalid('properties must be a bounded string map');
  }
  const properties: Record<string, object> = {};
  if (titleOverride !== undefined) {
    Object.defineProperty(properties, source.title, { value: { title: rich(titleOverride) }, enumerable: true });
  }
  for (const [key, value] of Object.entries<any>(values)) {
    if (typeof value === 'string') {
      text(value, 2000);
    } else if (typeof value !== 'boolean') {
      invalid('text is outside its allowed size');
    }
    if (!Object.hasOwn(source.properties, key) || key === source.title) {
      invalid('property does not exist or would override the title');
    }
    const definition = source.properties[key];
    if (typeof definition?.type !== 'string') badResponse();
    if (definition.type === 'select' && (!Array.isArray(definition.select?.options) || !definition.select.options.some((option: any) => option?.name === value))) {
      invalid('select value must be an existing option');
    }
    if (definition.type === 'status' && Array.isArray(definition.status?.options) && definition.status.options.length > 0 && !definition.status.options.some((option: any) => option?.name === value)) {
      invalid('status value must be an existing option');
    }
    if (definition.type === 'multi_select' && Array.isArray(definition.multi_select?.options) && definition.multi_select.options.length > 0) {
      const items = typeof value === 'string' ? value.split(',').map(v => v.trim()).filter(Boolean) : [];
      if (items.some(item => !definition.multi_select.options.some((option: any) => option?.name === item))) {
        invalid('multi_select value must be an existing option');
      }
    }
    Object.defineProperty(properties, key, { value: propertyValue(definition.type, value), enumerable: true });
  }
  return properties;
}

function extractBlockText(type: string, data: any): string {
  if (Array.isArray(data?.rich_text)) return plainRich(data.rich_text);
  const caption = Array.isArray(data?.caption) ? plainRich(data.caption) : '';
  switch (type) {
    case 'child_page':
    case 'child_database':
      return String(data?.title || '');
    case 'table_row':
      return Array.isArray(data?.cells)
        ? data.cells.map((cell: unknown) => (Array.isArray(cell) ? plainRich(cell) : '')).join(' | ')
        : '';
    case 'equation':
      return String(data?.expression || '');
    case 'bookmark':
    case 'embed':
    case 'link_preview':
      return [caption, String(data?.url || '')].filter(Boolean).join(' - ');
    case 'image':
    case 'video':
    case 'file':
    case 'pdf': {
      const summary = [caption, String(data?.external?.url || '')].filter(Boolean).join(' - ');
      return summary || `[${type}]`;
    }
    case 'divider':
      return '---';
    default:
      return '';
  }
}

function formatBlockMarkdown(type: string, textContent: string, checked?: boolean, data?: any): string {
  switch (type) {
    case 'heading_1': return `# ${textContent}`;
    case 'heading_2': return `## ${textContent}`;
    case 'heading_3': return `### ${textContent}`;
    case 'bulleted_list_item': return `- ${textContent}`;
    case 'numbered_list_item': return `1. ${textContent}`;
    case 'to_do': return `- [${checked ? 'x' : ' '}] ${textContent}`;
    case 'quote': return `> ${textContent}`;
    case 'callout': return `> 💡 ${textContent}`;
    case 'toggle': return `▸ ${textContent}`;
    case 'code': return `\`\`\`${data?.language || ''}\n${textContent}\n\`\`\``;
    case 'divider': return '---';
    case 'table_row': return `| ${textContent} |`;
    default: return textContent;
  }
}

async function preWrite<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (err && typeof err === 'object') {
      err.details = { ...(err.details && typeof err.details === 'object' ? err.details : {}), requestSent: false };
    }
    throw err;
  }
}

function parseDateBoundMs(value: string, upper: boolean): number {
  if (value.length === 10) {
    return Date.parse(value + (upper ? 'T23:59:59.999Z' : 'T00:00:00.000Z'));
  }
  return Date.parse(value);
}
function retryDelay(header: string | null): number {
  if (header == null) return 1000;
  const value = header.trim(); const seconds = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : NaN;
  const delay = Number.isFinite(seconds) ? seconds : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : 1000;
}
const NOTION_HOSTS = ['app.notion.com', 'www.notion.so', 'notion.so'];
function link(value: any, writing = false): string {
  if (typeof value?.url !== 'string') badResponse(writing);
  // app.notion.com observed from the live API on 04/10/2026 (W3-07); notion.so kept for older links.
  try { const url = new URL(value.url); if (url.protocol !== 'https:' || !NOTION_HOSTS.includes(url.hostname) || url.username || url.password) badResponse(writing); }
  catch { badResponse(writing); }
  return value.url;
}

/** Pinned Notion REST version; query POST is a read, all indeterminate writes stop. */
export class NotionAdapter extends BaseAdapter {
  readonly service = 'notion';
  private readonly token: string;
  private readonly fetchFn: typeof fetch;
  private readonly apiBaseUrl: string;
  private readonly expectedDataSources?: ReadonlyMap<string, string>;
  constructor(config: NotionAdapterConfig) {
    super(config); this.token = config.credentials.token; this.fetchFn = config.fetchFn ?? globalThis.fetch;
    this.apiBaseUrl = (config.apiBaseUrl ?? defaultApiBaseUrl).replace(/\/$/, '');
    this.expectedDataSources = config.expectedDataSources;
  }
  private databaseIds(): string[] {
    const values = this.allowedScope?.databases;
    if (!Array.isArray(values) || !values.length || values.some(id => typeof id !== 'string' || !NOTION_ID_PATTERN.test(id))) denied();
    const ids = [...new Set(values.map(normalizeNotionId))];
    this.allowedScope = { ...this.allowedScope, databases: ids }; return ids;
  }
  private checkedDatabase(value: unknown): string {
    const id = uuid(value); this.databaseIds(); this.assertAllowedScope('databases', id); return id;
  }
  private async request(path: string, signal?: AbortSignal, method = 'GET', body?: object, writing = false): Promise<any> {
    if (typeof this.token !== 'string' || !this.token.trim()) denied();
    let networkRetries = 0; let serverRetries = 0; let rateRetries = 0;
    for (;;) {
      if (signal?.aborted) throw new StepError({ message: 'Notion request cancelled before dispatch', category: 'NETWORK', details: { requestSent: false } });
      try { await this.waitForTransportSlot(this.rateLimiter ?? sharedLimiter, 'notion:' + this.token, signal); }
      catch (error) { throw new StepError({ message: 'Notion request stopped before dispatch', category: error instanceof StepError ? error.category : 'NETWORK', details: { requestSent: false } }); }
      if (signal?.aborted) throw new StepError({ message: 'Notion request cancelled before dispatch', category: 'NETWORK', details: { requestSent: false } });
      let response: Response;
      try { response = await this.fetchFn(this.apiBaseUrl + '/' + path, { method, signal, redirect: 'error', headers: {
        Authorization: 'Bearer ' + this.token, 'Notion-Version': NOTION_VERSION, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); }
      catch {
        if (!writing && !signal?.aborted && networkRetries++ < 2) continue;
        throw new StepError({ message: 'Notion transport failed', category: writing ? 'UNKNOWN' : 'NETWORK', retryable: !writing });
      }
      if (response.status === 429) {
        let blocked = false; try { blocked = (await response.json())?.code === 'public_api_request_blocked'; } catch { /* Never surface provider errors. */ }
        const delay = retryDelay(response.headers.get('Retry-After'));
        if (!blocked && rateRetries++ === 0 && delay <= 30_000) {
          try { await waitWithSignal(delay, signal); } catch { throw new StepError({ message: 'Notion rate-limit retry cancelled', category: 'RATE_LIMIT', statusCode: 429 }); }
          continue;
        }
        throw new StepError({ message: 'Notion rate limit reached; try again after the provider wait', category: 'RATE_LIMIT', statusCode: 429 });
      }
      if (!writing && response.status >= 500 && serverRetries++ === 0) {
        if (response.status === 529) {
          const delay = retryDelay(response.headers.get('Retry-After'));
          if (delay > 30_000) throw new StepError({ message: 'Notion read overload exceeds the retry budget', category: 'SERVER_ERROR', statusCode: 529 });
          try { await waitWithSignal(delay, signal); } catch { throw new StepError({ message: 'Notion read retry cancelled', category: 'NETWORK' }); }
        }
        continue;
      }
      if (!response.ok) {
        const status = response.status;
        const category = status === 401 || status === 403 ? 'AUTH_ERROR' : status === 404 ? 'NOT_FOUND' : status >= 400 && status < 500 ? 'VALIDATION' : writing ? 'UNKNOWN' : 'SERVER_ERROR';
        throw new StepError({ message: 'Notion request failed with HTTP ' + status, category, statusCode: status, retryable: !writing && status >= 500 });
      }
      try { return await response.json(); } catch { return badResponse(writing); }
    }
  }
  private resource(value: any, object: string, id: string, allowTrashed = false): void {
    if (value?.object !== object || uuid(value.id, true) !== id) badResponse();
    if (!allowTrashed && (value.in_trash === true || value.archived === true)) denied();
  }
  private async database(id: string, signal?: AbortSignal): Promise<any> {
    const value = await this.request('databases/' + id, signal); this.resource(value, 'database', id); return value;
  }
  private async dataSource(id: string, signal?: AbortSignal): Promise<any> {
    const value = await this.request('data_sources/' + id, signal); this.resource(value, 'data_source', id);
    if (value.parent?.type !== 'database_id') denied();
    const databaseId = uuid(value.parent.database_id, true); this.checkedDatabase(databaseId); return value;
  }
  private async schema(id: string, signal?: AbortSignal): Promise<{ id: string; properties: Record<string, any>; title: string; db: any }> {
    const db = await this.database(id, signal);
    if (!Array.isArray(db.data_sources) || db.data_sources.length !== 1) invalid('database must have exactly one data source; choose an unambiguous database');
    const sourceId = uuid(db.data_sources[0]?.id, true);
    const source = await this.sourceSchema(id, sourceId, signal);
    return { ...source, db };
  }
  private async sourceSchema(id: string, sourceId: string, signal?: AbortSignal): Promise<{ id: string; properties: Record<string, any>; title: string }> {
    if (this.expectedDataSources && this.expectedDataSources.get(id) !== sourceId) denied();
    const source = await this.dataSource(sourceId, signal);
    if (uuid(source.parent.database_id, true) !== id) denied();
    if (!source.properties || typeof source.properties !== 'object' || Array.isArray(source.properties)) badResponse();
    const titles = Object.entries<any>(source.properties).filter(([, value]) => value?.type === 'title');
    if (titles.length !== 1) badResponse();
    return { id: sourceId, properties: source.properties, title: titles[0]![0] };
  }
  private async verifyPageInScope(id: string, signal?: AbortSignal, allowTrashed = false): Promise<{ page: any; source: any; titleKey: string; url: string }> {
    this.databaseIds();
    const page = await this.request('pages/' + id, signal); this.resource(page, 'page', id, allowTrashed);
    if (page.parent?.type !== 'data_source_id') denied();
    const sourceId = uuid(page.parent.data_source_id, true);
    const source = await this.dataSource(sourceId, signal);
    const databaseId = uuid(source.parent.database_id, true);
    if (this.expectedDataSources && this.expectedDataSources.get(databaseId) !== sourceId) denied();
    if (!source.properties || typeof source.properties !== 'object' || Array.isArray(source.properties)) badResponse();
    const titles = Object.entries<any>(source.properties).filter(([, value]) => value?.type === 'title');
    if (titles.length !== 1) badResponse();
    return { page, source, titleKey: titles[0]![0], url: link(page) };
  }
  async checkConnection(signal?: AbortSignal): Promise<boolean> {
    const id = this.databaseIds()[0]!; this.assertAllowedScope('databases', id);
    const value = await this.database(id, signal); plainRich(value.title); return true;
  }
  async execute(toolName: string, args: Record<string, any>, context?: { signal?: AbortSignal }): Promise<any> {
    const signal = context?.signal;
    if (toolName === 'notion.search_databases') {
      only(args, ['query', 'limit']); const query = text(args.query, 2000).trim().toLowerCase(); const maximum = limit(args.limit, 10); const result = [];
      for (const id of this.databaseIds()) {
        this.assertAllowedScope('databases', id); const value = await this.database(id, signal); const title = plainRich(value.title) || '(Không có tiêu đề)';
        if (title.toLowerCase().includes(query)) result.push({ id, title, url: link(value) });
        if (result.length >= maximum) break;
      }
      return result;
    }
    if (toolName === 'notion.get_database') {
      only(args, ['databaseId']); const id = this.checkedDatabase(args.databaseId);
      const source = await this.schema(id, signal);
      const dbUrl = typeof source.db.url === 'string' ? link(source.db) : '';
      return { id, title: plainRich(source.db.title) || '(Không có tiêu đề)', url: dbUrl, schema: extractSchema(source.properties) };
    }
    if (toolName === 'notion.query_database') {
      only(args, ['databaseId', 'query', 'status', 'dateOnOrAfter', 'dateOnOrBefore', 'dateProperty', 'sortDirection', 'limit']);
      const id = this.checkedDatabase(args.databaseId); const maximum = limit(args.limit, 20);
      const query = args.query === undefined ? '' : text(args.query, 2000);
      const statusFilter = args.status === undefined ? '' : text(args.status, 200).trim();
      const dateOnOrAfter = args.dateOnOrAfter === undefined ? '' : text(args.dateOnOrAfter, 64).trim();
      const dateOnOrBefore = args.dateOnOrBefore === undefined ? '' : text(args.dateOnOrBefore, 64).trim();
      if (dateOnOrAfter && !dateValue(dateOnOrAfter)) invalid('dateOnOrAfter requires a valid ISO date or timezone-qualified instant');
      if (dateOnOrBefore && !dateValue(dateOnOrBefore)) invalid('dateOnOrBefore requires a valid ISO date or timezone-qualified instant');
      const afterMs = dateOnOrAfter ? parseDateBoundMs(dateOnOrAfter, false) : undefined;
      const beforeMs = dateOnOrBefore ? parseDateBoundMs(dateOnOrBefore, true) : undefined;
      if (afterMs !== undefined && beforeMs !== undefined && afterMs > beforeMs) {
        invalid('dateOnOrAfter must not be after dateOnOrBefore');
      }
      if (args.sortDirection !== undefined && args.sortDirection !== 'ascending' && args.sortDirection !== 'descending') {
        invalid('sortDirection must be ascending or descending');
      }
      const source = await this.schema(id, signal);
      const schema = extractSchema(source.properties);
      const propEntries = Object.entries<any>(source.properties);
      const selectEntries = propEntries.filter(
        ([, def]) => def?.type === 'select' && Array.isArray(def?.select?.options),
      );
      const statusEntry =
        propEntries.find(([, def]) => def?.type === 'status') ??
        selectEntries.find(([name]) => /^(?:status|trạng\s*thái|state|stage|tình\s*trạng)$/i.test(name.trim())) ??
        (selectEntries.length === 1 ? selectEntries[0] : undefined);
      if (statusFilter && !statusEntry) {
        throw new StepError({ message: 'Notion database has no status property to filter by', category: 'VALIDATION', retryable: false });
      }
      const dateEntries = propEntries.filter(([, def]) => def?.type === 'date');
      const dateProperty = args.dateProperty === undefined ? undefined : text(args.dateProperty, 200, true);
      const dateEntry = dateProperty
        ? dateEntries.find(([name]) => name === dateProperty)
        : dateEntries.length === 1 ? dateEntries[0] : undefined;
      if ((dateOnOrAfter || dateOnOrBefore) && !dateEntry) {
        throw new StepError({
          message: dateEntries.length === 0 ? 'Notion database has no date property to filter by' : 'Specify dateProperty using a date column from the Notion database schema',
          category: 'VALIDATION',
          retryable: false,
        });
      }
      const clauses: object[] = [];
      if (query) clauses.push({ property: source.title, title: { contains: query } });
      if (statusFilter && statusEntry) {
        const [colName, colDef] = statusEntry;
        clauses.push({ property: colName, [colDef.type]: { equals: statusFilter } });
      }
      if (dateOnOrAfter && dateEntry) clauses.push({ property: dateEntry[0], date: { on_or_after: dateOnOrAfter } });
      if (dateOnOrBefore && dateEntry) clauses.push({ property: dateEntry[0], date: { on_or_before: dateOnOrBefore } });
      const filter: object | undefined = clauses.length === 1 ? clauses[0] : clauses.length > 1 ? { and: clauses } : undefined;
      const sorts = args.sortDirection ? [{ timestamp: 'last_edited_time', direction: args.sortDirection }] : undefined;
      const pages = []; const cursors = new Set<string>(); let cursor: string | undefined; let truncated = false;
      for (let index = 0; index < 20; index++) {
        const value = await this.request('data_sources/' + source.id + '/query', signal, 'POST', { page_size: maximum - pages.length,
          ...(filter ? { filter } : {}), ...(sorts ? { sorts } : {}), ...(cursor ? { start_cursor: cursor } : {}),
        });
        if (value?.object !== 'list' || !Array.isArray(value.results) || typeof value.has_more !== 'boolean') badResponse();
        for (const item of value.results) {
          if (item?.in_trash === true || item?.archived === true) continue;
          if (item?.object !== 'page' || item.parent?.type !== 'data_source_id' || uuid(item.parent.data_source_id, true) !== source.id || !item.properties || Array.isArray(item.properties)) badResponse();
          if ((afterMs !== undefined || beforeMs !== undefined) && dateEntry) {
            const date = item.properties[dateEntry[0]]?.date;
            const start = dateEndpoint(date?.start, date?.time_zone);
            if (!start) continue;
            const end = dateEndpoint(date?.end, date?.time_zone) || start;
            const itemStartMs = parseDateBoundMs(start, false);
            const itemEndMs = parseDateBoundMs(end, true);
            if (!Number.isFinite(itemStartMs) || !Number.isFinite(itemEndMs)) continue;
            if (afterMs !== undefined && itemEndMs < afterMs) continue;
            if (beforeMs !== undefined && itemStartMs > beforeMs) continue;
          }
          if (pages.length >= maximum) {
            truncated = true;
            break;
          }
          const properties = Object.fromEntries(Object.entries(item.properties).map(([key, prop]) => {
            const clipped = clipText(propertyText(prop), NOTION_MAX_PROPERTY_CHARS);
            if (clipped.clipped) truncated = true;
            return [key, clipped.text];
          }));
          pages.push({
            id: uuid(item.id, true),
            title: properties[source.title] || '(Không có tiêu đề)',
            url: link(item),
            properties,
            ...(typeof item.last_edited_time === 'string' ? { lastEditedTime: item.last_edited_time } : {}),
          });
        }
        if (pages.length >= maximum || !value.has_more || index === 19) {
          if (value.has_more) truncated = true;
          return { pages, schema, ...(truncated ? { truncated: true } : {}) };
        }
        if (typeof value.next_cursor !== 'string' || !value.next_cursor || cursors.has(value.next_cursor)) badResponse();
        const nextCursor: string = value.next_cursor; cursor = nextCursor; cursors.add(nextCursor);
      }
      return { pages, schema, truncated: true };
    }
    if (toolName === 'notion.search_pages') {
      only(args, ['query', 'databaseId', 'limit']);
      const query = text(args.query, 2000).trim();
      const maximum = limit(args.limit, 20);
      const allowedDbs = args.databaseId === undefined ? this.databaseIds() : [this.checkedDatabase(args.databaseId)];
      const sources: Array<{ databaseId: string; sourceId: string }> = [];
      let remainingRequests = MAX_SEARCH_REQUESTS;
      for (const dbId of allowedDbs) {
        if (remainingRequests === 0) return { pages: [], truncated: true };
        remainingRequests--;
        const db = await this.database(dbId, signal);
        if (!Array.isArray(db.data_sources)) badResponse();
        const sourceIds = new Set<string>(db.data_sources.map((source: any) => uuid(source?.id, true)));
        for (const sourceId of sourceIds) {
          sources.push({ databaseId: dbId, sourceId });
        }
      }
      const pages: Array<{ id: string; databaseId: string; title: string; url: string; lastEditedTime?: string }> = [];
      const seenPageIds = new Set<string>();
      let truncated = false;
      for (const { databaseId, sourceId } of sources) {
        if (pages.length >= maximum || remainingRequests < 2) return { pages, truncated: true };
        remainingRequests--;
        const source = await this.sourceSchema(databaseId, sourceId, signal);
        const cursors = new Set<string>();
        let cursor: string | undefined;
        for (let index = 0; index < MAX_SEARCH_QUERIES_PER_SOURCE; index++) {
          remainingRequests--;
          const value = await this.request('data_sources/' + source.id + '/query', signal, 'POST', {
            page_size: maximum - pages.length,
            result_type: 'page',
            ...(query ? { filter: { property: source.title, title: { contains: query } } } : {}),
            ...(cursor ? { start_cursor: cursor } : {}),
          });
          if (value?.object !== 'list' || !Array.isArray(value.results) || typeof value.has_more !== 'boolean') badResponse();
          if (value.request_status?.type === 'incomplete') truncated = true;
          for (const item of value.results) {
            if (item?.in_trash === true || item?.archived === true) continue;
            if (item?.object !== 'page' || item.parent?.type !== 'data_source_id' || uuid(item.parent.data_source_id, true) !== source.id ||
                (item.parent.database_id !== undefined && uuid(item.parent.database_id, true) !== databaseId) ||
                !item.properties || typeof item.properties !== 'object' || Array.isArray(item.properties)) badResponse();
            const id = uuid(item.id, true);
            if (seenPageIds.has(id)) continue;
            if (pages.length >= maximum) return { pages, truncated: true };
            seenPageIds.add(id);
            const title = item.properties[source.title] ? propertyText(item.properties[source.title]) : '';
            pages.push({
              id,
              databaseId,
              title: title || '(Không có tiêu đề)',
              url: link(item),
              ...(typeof item.last_edited_time === 'string' ? { lastEditedTime: item.last_edited_time } : {}),
            });
          }
          if (!value.has_more) break;
          if (pages.length >= maximum || remainingRequests === 0 || index + 1 === MAX_SEARCH_QUERIES_PER_SOURCE) {
            truncated = true;
            break;
          }
          const nextCursor = value.next_cursor;
          if (typeof nextCursor !== 'string' || !nextCursor || cursors.has(nextCursor)) return badResponse();
          cursor = nextCursor;
          cursors.add(nextCursor);
        }
      }
      return { pages, ...(truncated ? { truncated: true } : {}) };
    }
    if (toolName === 'notion.create_page') {
      const { source, properties, content } = await preWrite(async () => {
        only(args, ['databaseId', 'title', 'content', 'properties']); const id = this.checkedDatabase(args.databaseId);
        const title = text(args.title, 200, true); const bodyContent = args.content === undefined ? '' : text(args.content, 4000);
        const values = args.properties === undefined ? {} : args.properties;
        if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > 100) invalid('properties must be a bounded string map');
        for (const value of Object.values(values)) if (typeof value !== 'boolean') text(value, 2000);
        const src = await this.schema(id, signal);
        const conv = validateAndConvertProperties(src, values, title);
        return { source: src, properties: conv, content: bodyContent };
      });
      const result = await this.request('pages', signal, 'POST', { parent: { type: 'data_source_id', data_source_id: source.id }, properties,
        ...(content ? { children: paragraphs(content) } : {}),
      }, true);
      if (result?.object !== 'page') badResponse(true);
      return { id: uuid(result.id, true, true), url: link(result, true) };
    }
    if (toolName === 'notion.get_page') {
      only(args, ['pageId']); const id = uuid(args.pageId);
      const { page, titleKey, url } = await this.verifyPageInScope(id, signal);
      if (!page.properties || typeof page.properties !== 'object' || Array.isArray(page.properties)) badResponse();
      let truncated = false;
      const properties = Object.fromEntries(Object.entries(page.properties).map(([key, prop]) => {
        const clipped = clipText(propertyText(prop), NOTION_MAX_PROPERTY_CHARS);
        if (clipped.clipped) truncated = true;
        return [key, clipped.text];
      }));
      const blockRes = await this.request('blocks/' + id + '/children', signal);
      if (blockRes?.object !== 'list' || !Array.isArray(blockRes.results)) badResponse();
      const blocks: Array<{ id: string; type: string; text: string; checked?: boolean }> = [];
      const lines: string[] = [];
      let childFetchCount = 0;
      for (const blk of blockRes.results) {
        if (!blk || blk.object !== 'block' || typeof blk.type !== 'string') continue;
        const blkId = uuid(blk.id, true);
        const data = blk[blk.type];
        const rawText = extractBlockText(blk.type, data);
        const clippedBlk = clipText(rawText, NOTION_MAX_PROPERTY_CHARS);
        if (clippedBlk.clipped) truncated = true;
        const checked = blk.type === 'to_do' ? Boolean(data?.checked) : undefined;
        blocks.push({ id: blkId, type: blk.type, text: clippedBlk.text, ...(checked !== undefined ? { checked } : {}) });
        if (clippedBlk.text || blk.type === 'to_do' || blk.type === 'divider') {
          lines.push(formatBlockMarkdown(blk.type, clippedBlk.text, checked, data));
        }
        if (blk.has_children === true) {
          if (childFetchCount >= 5) {
            truncated = true;
          } else {
            childFetchCount++;
            const childRes = await this.request('blocks/' + blkId + '/children', signal);
            if (childRes?.object === 'list' && Array.isArray(childRes.results)) {
              for (const childBlk of childRes.results) {
                if (!childBlk || childBlk.object !== 'block' || typeof childBlk.type !== 'string') continue;
                const childId = uuid(childBlk.id, true);
                const childData = childBlk[childBlk.type];
                const childRawText = extractBlockText(childBlk.type, childData);
                const clippedChild = clipText(childRawText, NOTION_MAX_PROPERTY_CHARS);
                if (clippedChild.clipped) truncated = true;
                const childChecked = childBlk.type === 'to_do' ? Boolean(childData?.checked) : undefined;
                blocks.push({
                  id: childId,
                  type: childBlk.type,
                  text: clippedChild.text,
                  ...(childChecked !== undefined ? { checked: childChecked } : {}),
                });
                if (clippedChild.text || childBlk.type === 'to_do' || childBlk.type === 'divider') {
                  lines.push('  ' + formatBlockMarkdown(childBlk.type, clippedChild.text, childChecked, childData));
                }
                if (childBlk.has_children === true) truncated = true;
              }
              if (childRes.has_more === true) truncated = true;
            }
          }
        }
      }
      const joinedContent = clipText(lines.join('\n'), 4000);
      if (joinedContent.clipped) truncated = true;
      return {
        id,
        title: properties[titleKey] || '(Không có tiêu đề)',
        url,
        properties,
        content: joinedContent.text,
        blocks,
        ...(typeof page.last_edited_time === 'string' ? { lastEditedTime: page.last_edited_time } : {}),
        ...(truncated || blockRes.has_more === true ? { truncated: true } : {}),
      };
    }
    if (toolName === 'notion.update_page') {
      const { id, converted, body } = await preWrite(async () => {
        only(args, ['pageId', 'title', 'properties', 'archived']);
        const pageId = uuid(args.pageId);
        const title = args.title === undefined ? undefined : text(args.title, 200, true);
        const values = args.properties === undefined ? {} : args.properties;
        if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > 100) invalid('properties must be a bounded string map');
        for (const value of Object.values(values)) if (typeof value !== 'boolean') text(value, 2000);
        if (args.archived !== undefined && typeof args.archived !== 'boolean') invalid('archived must be a boolean');
        if (title === undefined && Object.keys(values).length === 0 && args.archived === undefined) {
          invalid('update_page requires at least one of title, properties, or archived');
        }
        const { source, titleKey } = await this.verifyPageInScope(pageId, signal, args.archived === false);
        const conv = validateAndConvertProperties({ properties: source.properties, title: titleKey }, values, title);
        const reqBody: Record<string, any> = {};
        if (Object.keys(conv).length > 0) reqBody.properties = conv;
        if (typeof args.archived === 'boolean') reqBody.in_trash = args.archived;
        return { id: pageId, converted: conv, body: reqBody };
      });
      const result = await this.request('pages/' + id, signal, 'PATCH', body, true);
      if (result?.object !== 'page') badResponse(true);
      return {
        id: uuid(result.id, true, true),
        url: link(result, true),
        updatedProperties: Object.keys(converted),
        ...(typeof args.archived === 'boolean' ? { archived: args.archived } : {}),
      };
    }
    if (toolName === 'notion.append_text') {
      const { id, content, url } = await preWrite(async () => {
        only(args, ['pageId', 'text']); const pageId = uuid(args.pageId); const bodyContent = text(args.text, 2000, true);
        const verified = await this.verifyPageInScope(pageId, signal);
        return { id: pageId, content: bodyContent, url: verified.url };
      });
      const result = await this.request('blocks/' + id + '/children', signal, 'PATCH', { children: paragraphs(content) }, true);
      if (result?.object !== 'list' || !Array.isArray(result.results) || result.results.length !== 1 || result.results[0]?.object !== 'block') badResponse(true);
      return { pageId: id, blockIds: result.results.map((item: any) => uuid(item.id, true, true)), url };
    }
    if (toolName === 'notion.append_blocks') {
      const { id, children, url } = await preWrite(async () => {
        only(args, ['pageId', 'content']); const pageId = uuid(args.pageId); const rawContent = text(args.content, 4000, true);
        const parsedBlocks = markdownToNotionBlocks(rawContent);
        if (parsedBlocks.length === 0) invalid('content must contain at least one block');
        if (parsedBlocks.length > 50) invalid('content must contain at most 50 blocks');
        const verified = await this.verifyPageInScope(pageId, signal);
        return { id: pageId, children: parsedBlocks, url: verified.url };
      });
      const result = await this.request('blocks/' + id + '/children', signal, 'PATCH', { children }, true);
      if (result?.object !== 'list' || !Array.isArray(result.results) || result.results.length !== children.length || result.results.some((item: any) => item?.object !== 'block')) badResponse(true);
      const blockIds = result.results.map((item: any) => uuid(item.id, true, true));
      return { pageId: id, blockIds, blockCount: blockIds.length, url };
    }
    if (toolName === 'notion.list_comments') {
      only(args, ['pageId', 'limit']); const id = uuid(args.pageId); const maximum = limit(args.limit, 20);
      await this.verifyPageInScope(id, signal);
      const comments: Array<{ id: string; pageId: string; author: string; text: string; createdTime?: string }> = [];
      const cursors = new Set<string>(); let cursor: string | undefined; let truncated = false;
      for (let index = 0; index < 3; index++) {
        const qs = new URLSearchParams({ block_id: id, page_size: String(maximum - comments.length) });
        if (cursor) qs.set('start_cursor', cursor);
        const value = await this.request('comments?' + qs.toString(), signal);
        if (value?.object !== 'list' || !Array.isArray(value.results) || typeof value.has_more !== 'boolean') badResponse();
        for (const item of value.results) {
          if (item?.object !== 'comment') continue;
          if (comments.length >= maximum) { truncated = true; break; }
          const clipped = clipText(plainRich(item.rich_text), NOTION_MAX_PROPERTY_CHARS);
          if (clipped.clipped) truncated = true;
          comments.push({
            id: uuid(item.id, true),
            pageId: id,
            author: String(item.created_by?.name ?? item.created_by?.id ?? 'Unknown'),
            text: clipped.text,
            ...(typeof item.created_time === 'string' ? { createdTime: item.created_time } : {}),
          });
        }
        if (comments.length >= maximum || !value.has_more || index === 2) {
          if (value.has_more) truncated = true;
          return { comments, ...(truncated ? { truncated: true } : {}) };
        }
        const nextCursor = value.next_cursor;
        if (typeof nextCursor !== 'string' || !nextCursor || cursors.has(nextCursor)) return badResponse();
        cursor = nextCursor; cursors.add(nextCursor);
      }
      return { comments, truncated: true };
    }
    if (toolName === 'notion.add_comment') {
      const { id, commentText, url } = await preWrite(async () => {
        only(args, ['pageId', 'text']); const pageId = uuid(args.pageId); const bodyText = text(args.text, 2000, true);
        const verified = await this.verifyPageInScope(pageId, signal);
        return { id: pageId, commentText: bodyText, url: verified.url };
      });
      const result = await this.request('comments', signal, 'POST', { parent: { page_id: id }, rich_text: rich(commentText) }, true);
      if (result?.object !== 'comment') badResponse(true);
      return {
        id: uuid(result.id, true, true),
        pageId: id,
        url,
        ...(typeof result.created_time === 'string' ? { createdTime: result.created_time } : {}),
      };
    }
    return invalid('tool is unsupported');
  }
}
