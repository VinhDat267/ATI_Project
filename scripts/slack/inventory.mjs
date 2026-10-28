import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SaxesParser } from 'saxes';

const INDEX_URL = 'https://docs.slack.dev/sitemap.xml';
const METHOD = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+$/;
const annotationKeys = ['planRequirement', 'roleRequirement', 'sideEffect', 'risk', 'disposition', 'reason', 'evidenceUrls', 'atiMapping', 'deliveryStatus'];
const digest = text => createHash('sha256').update(text).digest('hex');
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const timestamp = value => nonempty(value) && Number.isFinite(Date.parse(value));

function methodUrl(value, markdown = false) {
  const url = new URL(value);
  if (url.origin !== 'https://docs.slack.dev' || url.username || url.password || url.search || url.hash) throw new Error('Non-canonical documentation URL');
  const path = markdown ? url.pathname.replace(/\.md$/, '') : url.pathname.replace(/\/$/, '');
  const name = path.replace(/^\/reference\/methods\//, '');
  if (!path.startsWith('/reference/methods/') || !METHOD.test(name) || (markdown && !url.pathname.endsWith('.md'))) throw new Error('Not a method documentation URL');
  return { method: name, url: `https://docs.slack.dev/reference/methods/${name}` };
}

export function extractMethodLinks(xml) {
  const invalid = () => { throw new Error('Invalid sitemap XML'); };
  if (typeof xml !== 'string') invalid();
  const urls = new Set();
  const stack = [];
  let namespace;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', invalid);
  parser.on('opentag', tag => {
    if (!stack.length) {
      if (tag.local !== 'urlset' || !['', 'http://www.sitemaps.org/schemas/sitemap/0.9'].includes(tag.uri)) invalid();
      namespace = tag.uri;
    } else if (stack.length === 1 && (tag.local !== 'url' || tag.uri !== namespace)) invalid();
    if (stack.at(-1)?.location) invalid();
    const frame = { local: tag.local, uri: tag.uri, locations: 0 };
    if (stack.length === 2 && tag.local === 'loc' && tag.uri === namespace) {
      if (stack.at(-1).locations++) invalid();
      frame.location = true; frame.text = '';
    }
    stack.push(frame);
  });
  const text = value => {
    if (stack.at(-1)?.location) stack.at(-1).text += value;
    else if (stack.length <= 2 && value.trim()) invalid();
  };
  parser.on('text', text);
  parser.on('cdata', text);
  parser.on('closetag', () => {
    const frame = stack.pop();
    if (frame.location) {
      if (!frame.text.trim()) invalid();
      try { urls.add(methodUrl(frame.text.trim()).url); } catch { /* Non-method pages are expected in a sitemap. */ }
    }
    if (stack.length === 1 && frame.locations !== 1) invalid();
  });
  try { parser.write(xml).close(); } catch { invalid(); }
  if (!urls.size) throw new Error('Sitemap has no canonical method links');
  return [...urls].sort();
}

export function parseMethodFacts(markdown, sourceUrl) {
  const canonical = methodUrl(sourceUrl);
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!header) throw new Error(`Missing frontmatter: ${canonical.method}`);
  const fields = {};
  let section;
  for (const line of header[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const top = /^([a-z_]+):(?:\s+(.*))?$/.exec(line);
    const nested = /^  ([a-z_]+):\s+(.+)$/.exec(line);
    if (top) {
      section = undefined;
      if (Object.hasOwn(fields, top[1])) throw new Error(`Duplicate frontmatter field: ${canonical.method}`);
      if (top[2] === undefined) {
        if (top[1] !== 'scopes') throw new Error(`Unsupported frontmatter section: ${canonical.method}`);
        fields.scopes = {}; section = 'scopes';
      } else {
        try { fields[top[1]] = JSON.parse(top[2]); } catch { throw new Error(`Unsupported frontmatter scalar: ${canonical.method}`); }
      }
    } else if (nested && section === 'scopes') {
      if (Object.hasOwn(fields.scopes, nested[1])) throw new Error(`Duplicate scopes: ${canonical.method}`);
      let values;
      try { values = JSON.parse(nested[2]); } catch { throw new Error(`Unsupported scope metadata: ${canonical.method}`); }
      if (!Array.isArray(values) || !values.every(nonempty)) throw new Error(`Invalid scope list: ${canonical.method}`);
      fields.scopes[nested[1]] = values;
    } else throw new Error(`Unsupported frontmatter syntax: ${canonical.method}`);
  }
  if (fields.method_name !== canonical.method) throw new Error(`Mismatched method metadata: ${canonical.method}`);
  if (fields.url !== undefined && methodUrl(fields.url).method !== canonical.method) throw new Error(`Mismatched source URL: ${canonical.method}`);
  if (fields.http_method !== undefined && !['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(fields.http_method)) throw new Error(`Invalid HTTP metadata: ${canonical.method}`);
  if (fields.rate_limit !== undefined && !nonempty(fields.rate_limit)) throw new Error(`Invalid rate metadata: ${canonical.method}`);
  if (fields.scopes !== undefined && (!fields.scopes || typeof fields.scopes !== 'object' || Array.isArray(fields.scopes))) throw new Error(`Invalid scopes metadata: ${canonical.method}`);
  if (fields.scopes && !Object.values(fields.scopes).every(values => Array.isArray(values) && values.every(nonempty))) throw new Error(`Invalid scope list: ${canonical.method}`);
  const userScopes = fields.scopes?.user ?? null;
  return { method: canonical.method, sourceUrl: canonical.url, fetchedAt: new Date().toISOString(), sourceSha256: digest(markdown), httpMethod: fields.http_method ?? null, rateLimit: fields.rate_limit ?? null, userScopes, userToken: userScopes === null ? 'undetermined' : 'documented' };
}

export function validateInventory(snapshot) {
  const errors = [];
  if (!snapshot || snapshot.schemaVersion !== 1 || !timestamp(snapshot.collectedAt) || snapshot.index?.url !== INDEX_URL || !/^[a-f0-9]{64}$/.test(snapshot.index?.sha256 ?? '') || !Array.isArray(snapshot.index?.methods) || !snapshot.index.methods.length || !Array.isArray(snapshot.methods)) return ['Invalid inventory envelope'];
  const names = snapshot.index.methods;
  if (!names.every(name => typeof name === 'string' && METHOD.test(name)) || new Set(names).size !== names.length) errors.push('Invalid or duplicate method names in frozen index');
  const found = new Set();
  for (const row of snapshot.methods) {
    if (!row || !METHOD.test(row.method ?? '')) { errors.push('Invalid method row'); continue; }
    const fail = message => errors.push(`${row.method}: ${message}`);
    if (found.has(row.method)) fail('duplicate row');
    found.add(row.method);
    if (!names.includes(row.method)) fail('not in frozen index');
    try { if (methodUrl(row.sourceUrl).method !== row.method) fail('source mismatch'); } catch { fail('invalid source URL'); }
    if (!timestamp(row.fetchedAt) || !/^[a-f0-9]{64}$/.test(row.sourceSha256 ?? '')) fail('missing provenance');
    if (row.httpMethod !== null && !['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(row.httpMethod)) fail('invalid HTTP facts');
    if (row.rateLimit !== null && !nonempty(row.rateLimit)) fail('invalid rate facts');
    if (!['documented', 'undetermined'].includes(row.userToken) || (row.userToken === 'documented' ? !Array.isArray(row.userScopes) || !row.userScopes.every(nonempty) : row.userScopes !== null)) fail('inconsistent user-token evidence');
    if (!['read', 'write', 'undetermined'].includes(row.sideEffect) || !['low', 'medium', 'high', 'undetermined'].includes(row.risk)) fail('invalid side-effect/risk');
    if (!['candidate', 'excluded', 'probe_required'].includes(row.disposition)) fail('invalid disposition');
    if (![row.reason, row.planRequirement, row.roleRequirement].every(nonempty)) fail('missing decision or requirements');
    if (row.deliveryStatus !== 'not_implemented' || row.reviewState !== 'reviewed') fail('unreviewed/changed source or unsupported implementation claim');
    if (row.atiMapping !== null && !nonempty(row.atiMapping)) fail('invalid ATI mapping');
    if (!Array.isArray(row.evidenceUrls) || !row.evidenceUrls.length || !row.evidenceUrls.every(value => {
      try { const u = new URL(value); return u.protocol === 'https:' && ['docs.slack.dev', 'slack.com', 'api.slack.com'].includes(u.hostname) && !u.username && !u.password; } catch { return false; }
    })) fail('missing official evidence');
  }
  for (const name of names) if (!found.has(name)) errors.push(`${name}: omitted from inventory`);
  return errors;
}

export async function fetchDocumentation(value, { fetchImpl = fetch, signal } = {}) {
  const parsed = new URL(value);
  if (value !== INDEX_URL) methodUrl(value, true);
  if (parsed.origin !== 'https://docs.slack.dev' || parsed.username || parsed.password || parsed.hash || parsed.search) throw new Error('Disallowed documentation source');
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
    let response;
    try { response = await fetchImpl(value, { signal: requestSignal, redirect: 'error' }); }
    catch (error) { if (signal?.aborted || attempt === 2) throw error; continue; }
    if (response.status >= 300 && response.status < 400) throw new Error(`Documentation redirect rejected (${response.status})`);
    if (response.ok) {
      const text = await response.text();
      if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('Documentation response too large');
      return text;
    }
    if (attempt === 2 || (response.status !== 429 && response.status < 500)) throw new Error(`Documentation HTTP ${response.status}: ${parsed.pathname}`);
    const header = response.headers.get('retry-after');
    const wait = header === null ? 250 * (attempt + 1) : /^\d+$/.test(header) ? Number(header) * 1000 : Math.max(0, Date.parse(header) - Date.now());
    if (!Number.isFinite(wait) || wait > 30_000) throw new Error('Retry-After exceeds collection wait budget');
    await new Promise((resolveWait, rejectWait) => {
      const finish = () => { signal?.removeEventListener('abort', abort); resolveWait(); };
      const timer = setTimeout(finish, wait);
      const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); rejectWait(signal.reason); };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  throw new Error('Documentation collection failed');
}

export async function collectInventory({ fetchImpl = fetch, previous, onDocument } = {}) {
  const xml = await fetchDocumentation(INDEX_URL, { fetchImpl });
  const links = extractMethodLinks(xml);
  const old = new Map((previous?.methods ?? []).map(row => [row.method, row]));
  const rows = new Array(links.length);
  const controller = new AbortController();
  let next = 0;
  async function worker() {
    while (next < links.length) {
      controller.signal.throwIfAborted();
      const index = next++;
      const url = links[index];
      const markdown = await fetchDocumentation(url + '.md', { fetchImpl, signal: controller.signal });
      const facts = parseMethodFacts(markdown, url);
      const prior = old.get(facts.method);
      const row = { ...facts, planRequirement: 'Not established by metadata; native plan probe required.', roleRequirement: 'Not established by metadata; native role probe required.', sideEffect: 'undetermined', risk: 'undetermined', disposition: 'probe_required', reason: 'Documentation metadata collected; eligibility and behavior still require review and native probes.', evidenceUrls: [facts.sourceUrl], atiMapping: null, deliveryStatus: 'not_implemented', reviewState: 'unreviewed' };
      if (prior) {
        for (const key of annotationKeys) if (Object.hasOwn(prior, key)) row[key] = prior[key];
        row.reviewState = prior.sourceSha256 === facts.sourceSha256 ? prior.reviewState : 'source_changed';
      }
      rows[index] = row;
      await onDocument?.(facts, markdown);
    }
  }
  try { await Promise.all([worker(), worker()]); }
  catch (error) { controller.abort(error); throw error; }
  return { schemaVersion: 1, collectedAt: new Date().toISOString(), index: { url: INDEX_URL, sha256: digest(xml), methods: links.map(link => methodUrl(link).method) }, methods: rows };
}

async function main(args) {
  if (args.length !== 3 || !['collect', 'verify'].includes(args[0]) || args[1] !== (args[0] === 'collect' ? '--output' : '--input')) throw new Error('Usage: inventory.mjs collect --output <json> | verify --input <json>');
  const path = resolve(args[2]);
  if (args[0] === 'collect') {
    let previous;
    try { previous = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const inventory = await collectInventory({ previous });
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(inventory, null, 2) + '\n');
    await rename(temporary, path);
    console.log(JSON.stringify({ mode: 'documentation', methods: inventory.methods.length, reviewed: inventory.methods.filter(row => row.reviewState === 'reviewed').length, verifiedLive: false }));
  } else {
    const inventory = JSON.parse(await readFile(path, 'utf8'));
    const errors = validateInventory(inventory);
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(JSON.stringify({ mode: 'documentation', methods: inventory.methods.length, dispositions: Object.fromEntries(['candidate', 'excluded', 'probe_required'].map(state => [state, inventory.methods.filter(row => row.disposition === state).length])), verifiedLive: false }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
