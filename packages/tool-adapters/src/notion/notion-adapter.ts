import { NOTION_ID_PATTERN, normalizeNotionId } from '@wap/tool-schemas';
import { BaseAdapter, StepError, type BaseAdapterConfig } from '../base-adapter.js';
import { GlobalRateLimiter, waitWithSignal } from '../rate-limiter.js';
import { NOTION_MAX_PROPERTY_CHARS, clipText } from '../bounds.js';

export interface NotionAdapterConfig extends BaseAdapterConfig { credentials: { token: string }; fetchFn?: typeof fetch }
export const NOTION_VERSION = '2026-03-11';
const apiBase = 'https://api.notion.com/v1/';
const sharedLimiter = new GlobalRateLimiter({ maxRequests: 3, windowMs: 1000 });
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
const rich = (content: string) => [{ type: 'text', text: { content } }];
function paragraphs(content: string): object[] {
  const result = [];
  for (let start = 0; start < content.length;) {
    let end = Math.min(start + 2000, content.length);
    if (end < content.length && content.charCodeAt(end - 1) >= 0xD800 && content.charCodeAt(end - 1) <= 0xDBFF) end--;
    result.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: rich(content.slice(start, end)) } });
    start = end;
  }
  return result;
}
function plainRich(value: any): string {
  if (!Array.isArray(value)) badResponse();
  return value.map(item => typeof item?.plain_text === 'string' ? item.plain_text : typeof item?.text?.content === 'string' ? item.text.content : badResponse()).join('');
}
function propertyText(value: any): string {
  if (!value || typeof value.type !== 'string') badResponse();
  const data = value[value.type];
  switch (value.type) {
    case 'title': case 'rich_text': return plainRich(data);
    case 'select': case 'status': return data?.name ?? '';
    case 'multi_select': return Array.isArray(data) ? data.map(item => item.name).join(', ') : badResponse();
    case 'date': return data ? [data.start, data.end].filter(Boolean).join(' → ') : '';
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
function propertyValue(type: string, value: string): object {
  switch (type) {
    case 'rich_text': return { rich_text: rich(value) };
    case 'select': if (!value.trim() || value.length > 100) invalid('select value is invalid'); return { select: { name: value } };
    case 'date': if (!dateValue(value)) invalid('date requires a valid ISO date or timezone-qualified instant'); return { date: { start: value } };
    case 'url': {
      try { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol)) invalid('url requires http or https'); }
      catch { invalid('url requires http or https'); } return { url: value };
    }
    case 'number': {
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(Number(value))) invalid('number value is invalid');
      return { number: Number(value) };
    }
    default: return invalid('property type is unsupported');
  }
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
  constructor(config: NotionAdapterConfig) {
    super(config); this.token = config.credentials.token; this.fetchFn = config.fetchFn ?? globalThis.fetch;
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
      if (signal?.aborted) throw new StepError({ message: 'Notion request cancelled before dispatch', category: 'NETWORK' });
      try { await this.waitForTransportSlot(this.rateLimiter ?? sharedLimiter, 'notion:' + this.token, signal); }
      catch (error) { throw new StepError({ message: 'Notion request stopped before dispatch', category: error instanceof StepError ? error.category : 'NETWORK' }); }
      if (signal?.aborted) throw new StepError({ message: 'Notion request cancelled before dispatch', category: 'NETWORK' });
      let response: Response;
      try { response = await this.fetchFn(apiBase + path, { method, signal, redirect: 'error', headers: {
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
  private resource(value: any, object: string, id: string): void {
    if (value?.object !== object || uuid(value.id, true) !== id) badResponse();
    if (value.in_trash === true) denied();
  }
  private async database(id: string, signal?: AbortSignal): Promise<any> {
    const value = await this.request('databases/' + id, signal); this.resource(value, 'database', id); return value;
  }
  private async dataSource(id: string, signal?: AbortSignal): Promise<any> {
    const value = await this.request('data_sources/' + id, signal); this.resource(value, 'data_source', id);
    if (value.parent?.type !== 'database_id') denied();
    const databaseId = uuid(value.parent.database_id, true); this.checkedDatabase(databaseId); return value;
  }
  private async schema(id: string, signal?: AbortSignal): Promise<{ id: string; properties: Record<string, any>; title: string }> {
    const db = await this.database(id, signal);
    if (!Array.isArray(db.data_sources) || db.data_sources.length !== 1) invalid('database must have exactly one data source; choose an unambiguous database');
    const sourceId = uuid(db.data_sources[0]?.id, true); const source = await this.dataSource(sourceId, signal);
    if (uuid(source.parent.database_id, true) !== id) denied();
    if (!source.properties || typeof source.properties !== 'object' || Array.isArray(source.properties)) badResponse();
    const titles = Object.entries<any>(source.properties).filter(([, value]) => value?.type === 'title');
    if (titles.length !== 1) badResponse();
    return { id: sourceId, properties: source.properties, title: titles[0]![0] };
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
    if (toolName === 'notion.query_database') {
      only(args, ['databaseId', 'query', 'limit']); const id = this.checkedDatabase(args.databaseId); const maximum = limit(args.limit, 20);
      const query = args.query === undefined ? '' : text(args.query, 2000); const source = await this.schema(id, signal);
      const pages = []; const cursors = new Set<string>(); let cursor: string | undefined; let truncated = false;
      for (let index = 0; index < 20; index++) {
        const value = await this.request('data_sources/' + source.id + '/query', signal, 'POST', { page_size: maximum - pages.length,
          ...(query ? { filter: { property: source.title, title: { contains: query } } } : {}), ...(cursor ? { start_cursor: cursor } : {}),
        });
        if (value?.object !== 'list' || !Array.isArray(value.results) || typeof value.has_more !== 'boolean') badResponse();
        for (const item of value.results) {
          if (item?.in_trash === true) continue;
          if (item?.object !== 'page' || item.parent?.type !== 'data_source_id' || uuid(item.parent.data_source_id, true) !== source.id || !item.properties || Array.isArray(item.properties)) badResponse();
          const properties = Object.fromEntries(Object.entries(item.properties).map(([key, prop]) => {
            const clipped = clipText(propertyText(prop), NOTION_MAX_PROPERTY_CHARS);
            if (clipped.clipped) truncated = true;
            return [key, clipped.text];
          }));
          pages.push({ id: uuid(item.id, true), title: properties[source.title] || '(Không có tiêu đề)', url: link(item), properties });
          if (pages.length >= maximum) break;
        }
        if (pages.length >= maximum || !value.has_more) return { pages, ...(truncated ? { truncated: true } : {}) };
        if (typeof value.next_cursor !== 'string' || !value.next_cursor || cursors.has(value.next_cursor)) badResponse();
        const nextCursor: string = value.next_cursor; cursor = nextCursor; cursors.add(nextCursor);
      }
      throw new StepError({ message: 'Notion query pagination exceeded its read budget; narrow the query', category: 'SERVER_ERROR' });
    }
    if (toolName === 'notion.create_page') {
      only(args, ['databaseId', 'title', 'content', 'properties']); const id = this.checkedDatabase(args.databaseId);
      const title = text(args.title, 200, true); const content = args.content === undefined ? '' : text(args.content, 4000);
      const values = args.properties === undefined ? {} : args.properties;
      if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > 100) invalid('properties must be a bounded string map');
      for (const value of Object.values(values)) text(value, 2000);
      const source = await this.schema(id, signal); const properties: Record<string, object> = Object.fromEntries([[source.title, { title: rich(title) }]]);
      for (const [key, value] of Object.entries<string>(values)) {
        if (!Object.hasOwn(source.properties, key) || key === source.title) invalid('property does not exist or would override the title');
        const definition = source.properties[key];
        if (typeof definition?.type !== 'string') badResponse();
        // A new select name would change the source schema implicitly, beyond creating a page.
        if (definition.type === 'select' && (!Array.isArray(definition.select?.options) || !definition.select.options.some((option: any) => option?.name === value))) invalid('select value must be an existing option');
        Object.defineProperty(properties, key, { value: propertyValue(definition.type, value), enumerable: true });
      }
      const result = await this.request('pages', signal, 'POST', { parent: { type: 'data_source_id', data_source_id: source.id }, properties,
        ...(content ? { children: paragraphs(content) } : {}),
      }, true);
      if (result?.object !== 'page') badResponse(true);
      return { id: uuid(result.id, true, true), url: link(result, true) };
    }
    if (toolName === 'notion.append_text') {
      only(args, ['pageId', 'text']); const id = uuid(args.pageId); const content = text(args.text, 2000, true); this.databaseIds();
      const page = await this.request('pages/' + id, signal); this.resource(page, 'page', id);
      if (page.parent?.type !== 'data_source_id') denied();
      await this.dataSource(uuid(page.parent.data_source_id, true), signal); const url = link(page);
      const result = await this.request('blocks/' + id + '/children', signal, 'PATCH', { children: paragraphs(content) }, true);
      if (result?.object !== 'list' || !Array.isArray(result.results) || result.results.length !== 1 || result.results[0]?.object !== 'block') badResponse(true);
      return { pageId: id, blockIds: result.results.map((item: any) => uuid(item.id, true, true)), url };
    }
    return invalid('tool is unsupported');
  }
}
