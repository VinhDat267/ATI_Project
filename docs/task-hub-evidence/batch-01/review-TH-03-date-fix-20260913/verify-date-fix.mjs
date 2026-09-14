// Independent Codex review. Run from repo root; only touches its own temporary DB.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = process.cwd(), out = path.dirname(fileURLToPath(import.meta.url));
const readJson = p => JSON.parse(readFileSync(path.resolve(root, p), 'utf8').replace(/^\uFEFF/, ''));
const hash = p => createHash('sha256').update(readFileSync(path.resolve(root, p))).digest('hex');
const save = (name, value) => writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
const baseline = readJson('docs/antigravity/task-hub-handoff-baseline.json');
const protectedHashes = {
  ...baseline.historical_evidence_sha256,
  ...Object.fromEntries(Object.entries(baseline.files_sha256).filter(([p]) => /migrations\/.+\.sql$/.test(p))),
};
assert.equal(Object.keys(protectedHashes).length, 29);
if (process.argv.includes('--capture')) {
  const folder = 'docs/task-hub-evidence/batch-01/review-TH-03-20260913-r2';
  save('before.json', {
    recorded_at: new Date().toISOString(),
    reproduction_hashes: Object.fromEntries(readdirSync(folder).map(p => [`${folder}/${p}`, hash(`${folder}/${p}`)])),
    unchanged_source_hashes: Object.fromEntries([
      'apps/mcp-task-hub/src/cards.ts', 'apps/mcp-task-hub/src/server.ts', 'apps/mcp-task-hub/src/service.ts',
      'packages/engine/src/attempts.ts', 'packages/engine/src/gateway.ts',
      'packages/engine/tests/controller.integration.test.ts', 'db/migrations/0004_task_hub_cards.sql',
      'package-lock.json',
    ].map(p => [p, hash(p)])),
  });
  console.log('Captured independent preservation baseline');
  process.exit(0);
}

const before = readJson(path.join(out, 'before.json'));
const allProtected = { ...protectedHashes, ...before.reproduction_hashes, ...before.unchanged_source_hashes };
for (const [p, expected] of Object.entries(allProtected)) assert.equal(hash(p), expected, `Preservation: ${p}`);

const { migrate, openDatabase, seedDemo } = await import(pathToFileURL(path.join(root, 'packages/db/dist/index.js')));
const { inputs, toolDefinitions, POLICY_VERSION } = await import(pathToFileURL(path.join(root, 'apps/mcp-task-hub/dist/contracts.js')));
const { validateToolCall } = await import(pathToFileURL(path.join(root, 'packages/dsl/dist/index.js')));
const definitions = toolDefinitions();
const catalog = readJson('testdata/tools.json').servers.find(s => s.slug === 'task_hub').tools;
const definition = definitions.find(t => t.name === 'list_cards');
const trusted = { ...definition, server: 'task_hub', sideEffect: 'read', policyVersion: POLICY_VERSION };
const catalogTool = { ...catalog.find(t => t.name === 'list_cards'), server: 'task_hub' };
assert.deepEqual(catalogTool.inputSchema, definition.inputSchema);
for (const old of baseline.old_three_tool_contracts) {
  const built = definitions.find(t => t.name === old.name);
  const entry = catalog.find(t => t.name === old.name);
  for (const field of ['inputSchema', 'outputSchema']) assert.deepEqual(built[field], old[field], `${old.name}: built ${field}`);
  for (const field of ['inputSchema', 'outputSchema', 'sideEffect', 'policyVersion']) assert.deepEqual(entry[field], old[field], `${old.name}: catalog ${field}`);
}
assert.equal(definitions.length, 6);
assert(!definitions.some(t => ['create_card', 'move_card'].includes(t.name)));

const address = new URL(process.env.G1_TEST_ADMIN_URL ?? 'postgresql://wap:wap@127.0.0.1:55432/wap_g1');
assert(['localhost', '127.0.0.1'].includes(address.hostname) && address.pathname === '/wap_g1');
const admin = postgres(address.href, { max: 1, onnotice: () => {} });
const database = 'g1_it_' + randomUUID().replaceAll('-', '');
assert.match(database, /^g1_it_[a-f0-9]{32}$/);
address.pathname = '/' + database;
let created = false, db, client;
const results = [];
try {
  await admin.unsafe(`CREATE DATABASE "${database}"`); created = true;
  await migrate(address.href); db = openDatabase(address.href);
  const userId = randomUUID(); await seedDemo(db, userId);
  client = new Client({ name: 'th03-date-fix-independent-review', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'apps/mcp-task-hub/dist/server.js')], cwd: root, env: { G1_DATABASE_URL: address.href, G1_USER_ID: userId }, stderr: 'pipe' }));
  const live = await client.listTools();
  for (const def of definitions) {
    const actual = live.tools.find(t => t.name === def.name);
    assert.deepEqual(actual.inputSchema, def.inputSchema);
    assert.deepEqual(actual.outputSchema, def.outputSchema);
  }
  for (const field of ['since', 'until']) {
    for (const date of ['0000-01-01', '0000-12-31', '0001-01-01', '9999-12-31', '2024-02-29', '2000-02-29', '1900-02-29', '2025-02-29', '2026-02-30', '10000-01-01', '-0001-01-01', '2026-13-01']) {
      const expected = ['0001-01-01', '9999-12-31', '2024-02-29', '2000-02-29'].includes(date);
      const args = { board_id: 'board_a', [field]: date };
      const zod = inputs.list_cards.safeParse(args).success;
      const exported = validateToolCall(trusted, args, 'dry_run');
      const reviewed = validateToolCall(catalogTool, args, 'dry_run');
      assert.equal(zod, expected, `Zod ${field}=${date}`);
      assert.equal(exported.ok, expected, `Exported ${field}=${date}: ${JSON.stringify(exported.issues)}`);
      assert.equal(reviewed.ok, expected, `Catalog ${field}=${date}: ${JSON.stringify(reviewed.issues)}`);
      for (const check of [exported, reviewed]) assert(!check.issues.some(i => /unsupported tool schema/.test(i.message)));
      const response = await client.callTool({ name: 'list_cards', arguments: args });
      const result = JSON.parse(response.content.find(c => c.type === 'text').text);
      if (expected) {
        assert.notEqual(response.isError, true, `${field}=${date}`);
        const expectedCount = field === 'since' ? (date === '9999-12-31' ? 0 : 2) : (date === '9999-12-31' ? 2 : 0);
        assert.equal(result.count, expectedCount, `Boundary query ${field}=${date}`);
      } else {
        assert.equal(response.isError, true);
        assert.equal(result.code, 'BAD_ARGS', `${field}=${date}`);
      }
      results.push({ args, expected_valid: expected, zod_accepted: zod, exported_accepted: exported.ok, catalog_accepted: reviewed.ok, result });
    }
  }
} finally {
  try { await client?.close(); } finally {
    try { await db?.close(); } finally {
      try { if (created) await admin.unsafe(`DROP DATABASE "${database}" WITH (FORCE)`); } finally { await admin.end(); }
    }
  }
}
for (const [p, expected] of Object.entries(allProtected)) assert.equal(hash(p), expected, `After probe preservation: ${p}`);
const report = { status: 'PASS', recorded_at: new Date().toISOString(), case_count: results.length, database, database_dropped: true, protected_baseline_hashes: 29, reproduction_preserved: true, unchanged_source_files: Object.keys(before.unchanged_source_hashes).length, old_tool_schemas_preserved: 3, live_schema_equality: 6, results };
save('verification.json', report);
console.log(JSON.stringify({ ...report, results: undefined }));
