import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractMethodLinks, parseMethodFacts, validateInventory, fetchDocumentation, collectInventory } from './inventory.mjs';

const url = 'https://docs.slack.dev/reference/methods/chat.postMessage';
const markdown = '---\nmethod_name: "chat.postMessage"\nhttp_method: "POST"\nrate_limit: "t5"\nscopes:\n  bot: ["chat:write"]\n  user: ["chat:write"]\n---\n# chat.postMessage\n';
const xml = '<urlset><url><loc>' + url + '/</loc></url><url><loc>https://docs.slack.dev/reference/methods/auth.test/</loc></url></urlset>';
function snapshot() {
  const at = '2026-10-28T12:00:00.000Z';
  return { schemaVersion: 1, collectedAt: at, index: { url: 'https://docs.slack.dev/sitemap.xml', sha256: 'a'.repeat(64), methods: ['chat.postMessage'] }, methods: [{
    method: 'chat.postMessage', sourceUrl: url, fetchedAt: at, sourceSha256: 'b'.repeat(64), httpMethod: 'POST', rateLimit: 't5', userScopes: ['chat:write'], userToken: 'documented',
    planRequirement: 'Native availability requires a probe', roleRequirement: 'Native role requires a probe', sideEffect: 'write', risk: 'low', disposition: 'probe_required', reason: 'Documented user scopes; native behavior not tested', evidenceUrls: [url], atiMapping: null, deliveryStatus: 'not_implemented', reviewState: 'reviewed',
  }] };
}

test('sitemap extraction preserves exact methods, normalizes, deduplicates and excludes foreign/off-method URLs', () => {
  const extra = '<url><loc>' + url + '</loc></url><url><loc>https://evil.test/reference/methods/chat.delete</loc></url><url><loc>https://docs.slack.dev/reference/events/message</loc></url>';
  assert.deepEqual(extractMethodLinks(xml.replace('</urlset>', extra + '</urlset>')), ['https://docs.slack.dev/reference/methods/auth.test', url]);
  assert.throws(() => extractMethodLinks('<urlset></urlset>'), /method|empty/i);
  assert.throws(() => extractMethodLinks('not XML'), /sitemap|XML/i);
});
test('sitemap extraction decodes XML character references and respects namespace prefixes', () => {
  const namespaced = '<?xml version="1.0"?><s:urlset xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9"><s:url><s:loc>https://docs.slack.dev/reference/methods/auth&#46;test</s:loc></s:url></s:urlset>';
  assert.deepEqual(extractMethodLinks(namespaced), ['https://docs.slack.dev/reference/methods/auth.test']);
});
test('malformed XML and invalid sitemap structure never become partial successful indexes', async t => {
  const first = '<url><loc>' + url + '</loc></url>';
  const cases = {
    'unclosed location': '<urlset>' + first + '<url><loc>https://docs.slack.dev/reference/methods/auth.test</urlset>',
    'unclosed entry': '<urlset>' + first + '<url><loc>https://docs.slack.dev/reference/methods/auth.test</loc></urlset>',
    'trailing garbage': '<urlset>' + first + '</urlset>garbage',
    'multiple roots': '<urlset>' + first + '</urlset><urlset>' + first + '</urlset>',
    'undeclared entity': '<urlset>' + first + '<url><loc>https://docs.slack.dev/&undefined;</loc></url></urlset>',
    'missing location': '<urlset>' + first + '<url><lastmod>2026-10-29</lastmod></url></urlset>',
    'duplicate location': '<urlset><url><loc>' + url + '</loc><loc>' + url + '</loc></url></urlset>',
    'nested location markup': '<urlset>' + first + '<url><loc><b>https://docs.slack.dev/</b></loc></url></urlset>',
  };
  for (const [name, invalid] of Object.entries(cases)) await t.test(name, () => assert.throws(() => extractMethodLinks(invalid), /sitemap|XML/i));
});
test('CLI collection rejects a malformed HTTP sitemap without overwriting the previous snapshot', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ati-slack-inventory-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, 'inventory.json');
  const preload = join(directory, 'relay.mjs');
  const auth = 'https://docs.slack.dev/reference/methods/auth.test';
  let malformed = false;
  const server = createServer((request, response) => {
    response.writeHead(200);
    if (request.url === '/sitemap.xml') return response.end(malformed
      ? '<urlset><url><loc>' + auth + '</loc></url><url><loc>' + url + '</urlset>'
      : '<urlset><url><loc>' + auth + '</loc></url><url><loc>' + url + '</loc></url></urlset>');
    response.end(request.url.endsWith('auth.test.md') ? markdown.replaceAll('chat.postMessage', 'auth.test') : markdown);
  });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  t.after(async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const before = await collectInventory({ fetchImpl: (target, options) => fetch(origin + new URL(target).pathname, options) });
  for (const row of before.methods) row.reviewState = 'reviewed';
  assert.deepEqual(validateInventory(before), []);
  const original = Buffer.from(JSON.stringify(before) + '\n');
  await writeFile(output, original);
  await writeFile(preload, 'const nativeFetch=globalThis.fetch;globalThis.fetch=(url,options)=>nativeFetch(' + JSON.stringify(origin) + '+new URL(url).pathname,options);');
  malformed = true;
  const result = await new Promise((done, fail) => {
    const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, 'scripts/slack/inventory.mjs', 'collect', '--output', output], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.resume(); child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', fail); child.once('close', code => done({ code, stderr }));
  });
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /sitemap|XML/i);
  assert.deepEqual(await readFile(output), original);
});
test('method facts record actual source hash and documented user scopes', () => {
  const facts = parseMethodFacts(markdown, url);
  assert.equal(facts.method, 'chat.postMessage');
  assert.equal(facts.sourceUrl, url);
  assert.equal(facts.sourceSha256, createHash('sha256').update(markdown).digest('hex'));
  assert.deepEqual(facts.userScopes, ['chat:write']);
  assert.equal(facts.userToken, 'documented');
  assert.equal(facts.httpMethod, 'POST');
  assert.equal(facts.rateLimit, 't5');
  assert.ok(Number.isFinite(Date.parse(facts.fetchedAt)));
});
test('absence of user metadata does not claim unsupported or supported', () => {
  const facts = parseMethodFacts(markdown.replace('  user: ["chat:write"]\n', ''), url);
  assert.equal(facts.userScopes, null);
  assert.equal(facts.userToken, 'undetermined');
});
test('an explicit empty user scope list is different from missing metadata', () => {
  const facts = parseMethodFacts(markdown.replace('user: ["chat:write"]', 'user: []'), url);
  assert.deepEqual(facts.userScopes, []);
  assert.equal(facts.userToken, 'documented');
});
test('inline scopes cannot bypass scope-list type checks', () => {
  for (const scopes of [{ user: 'chat:write' }, { user: [1] }, { user: null }]) {
    const invalid = markdown.replace(/scopes:[\s\S]*?\n---/, 'scopes: ' + JSON.stringify(scopes) + '\n---');
    assert.throws(() => parseMethodFacts(invalid, url), /scope/i);
  }
});
test('malformed, unsupported or mismatched facts never become a successful empty row', () => {
  for (const invalid of ['no frontmatter', markdown.replace('"chat.postMessage"', '"chat.delete"'), markdown.replace('["chat:write"]', '[bad yaml]'), markdown.replace('  user: ["chat:write"]', '  user: !!js/function bad')]) assert.throws(() => parseMethodFacts(invalid, url));
  assert.throws(() => parseMethodFacts(markdown, 'https://evil.test/reference/methods/chat.postMessage'));
});
test('offline inventory verification accepts reviewed probe-required rows without pretending live support', () => {
  assert.deepEqual(validateInventory(snapshot()), []);
});
test('the checked-in snapshot satisfies the frozen-index coverage contract in CI', async () => {
  const data = JSON.parse(await readFile(new URL('../../docs/slack/method-inventory.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateInventory(data), []);
});
test('offline verification catches omitted, extra and duplicate rows against the frozen index', () => {
  const missing = snapshot(); missing.methods = [];
  assert.ok(validateInventory(missing).length);
  const duplicate = snapshot(); duplicate.methods.push(structuredClone(duplicate.methods[0]));
  assert.ok(validateInventory(duplicate).length);
  const extra = snapshot(); extra.index.methods = ['auth.test'];
  assert.ok(validateInventory(extra).length);
  const duplicateIndex = snapshot(); duplicateIndex.index.methods.push('chat.postMessage');
  assert.ok(validateInventory(duplicateIndex).length);
});
test('verification rejects missing provenance/reason and unreviewed or changed source', () => {
  for (const [key, value] of [['sourceSha256', ''], ['sourceUrl', 'https://evil.test/a'], ['reason', ''], ['evidenceUrls', []], ['deliveryStatus', 'implemented'], ['reviewState', 'unreviewed'], ['reviewState', 'source_changed'], ['userToken', 'unsupported'], ['sideEffect', 'unknown-value']]) {
    const data = snapshot(); data.methods[0][key] = value;
    assert.ok(validateInventory(data).length, key);
  }
  assert.ok(validateInventory({}).length);
});
test('documentation fetch rejects non-allowlisted URLs before transport and never follows redirects', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response('', { status: 302, headers: { location: 'https://evil.test' } }); };
  for (const bad of ['http://docs.slack.dev/sitemap.xml', 'https://evil.test/sitemap.xml', 'https://user:pass@docs.slack.dev/sitemap.xml', 'https://docs.slack.dev/not-a-source']) await assert.rejects(fetchDocumentation(bad, { fetchImpl }));
  assert.equal(calls, 0);
  await assert.rejects(fetchDocumentation(url + '.md', { fetchImpl }), /redirect|302/i);
  assert.equal(calls, 1);
});
test('documentation fetch bounds retries and honors a zero Retry-After without exposing API credentials', async () => {
  let calls = 0;
  const result = await fetchDocumentation(url + '.md', { fetchImpl: async (_url, options) => {
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    calls++;
    return calls < 3 ? new Response('', { status: 429, headers: { 'retry-after': '0' } }) : new Response(markdown);
  } });
  assert.equal(result, markdown);
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(fetchDocumentation(url + '.md', { fetchImpl: async () => { calls++; return new Response('', { status: 503 }); } }));
  assert.equal(calls, 3);
});
test('collection preserves reviewed annotations only for identical source hashes', async () => {
  const indexXml = '<urlset><url><loc>' + url + '</loc></url></urlset>';
  const fetchImpl = async target => new Response(target.endsWith('sitemap.xml') ? indexXml : markdown);
  const first = await collectInventory({ fetchImpl });
  assert.equal(first.methods[0].reviewState, 'unreviewed');
  first.methods[0].reviewState = 'reviewed'; first.methods[0].reason = 'Previously inspected';
  const same = await collectInventory({ fetchImpl, previous: first });
  assert.equal(same.methods[0].reviewState, 'reviewed');
  assert.equal(same.methods[0].reason, 'Previously inspected');
  const changed = await collectInventory({ fetchImpl: async target => new Response(target.endsWith('sitemap.xml') ? indexXml : markdown + '\nChanged'), previous: first });
  assert.equal(changed.methods[0].reviewState, 'source_changed');
  assert.ok(validateInventory(changed).length);
});
