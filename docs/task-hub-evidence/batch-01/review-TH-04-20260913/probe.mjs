// Independent receiver verification, using synthetic approval fixtures only.
// Run from repo root after build/catalog sync. Never runs against the demo DB.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const root = process.cwd(), out = path.dirname(fileURLToPath(import.meta.url));
const json = p => JSON.parse(readFileSync(path.resolve(root, p), 'utf8').replace(/^\uFEFF/, ''));
const load = p => import(pathToFileURL(path.join(root, p)));
const { migrate, openDatabase, seedDemo } = await load('packages/db/dist/index.js');
const { inputs, toolDefinitions } = await load('apps/mcp-task-hub/dist/contracts.js');
const { writeFingerprint } = await load('apps/mcp-task-hub/dist/fingerprint.js');
const { validateToolCall } = await load('packages/dsl/dist/index.js');
const before = json(path.join(out, 'before.json'));
const verifyProtected = () => {
  for (const [p, sha] of Object.entries(before.protected_sha256)) {
    assert.equal(createHash('sha256').update(readFileSync(p)).digest('hex'), sha, `Protected file: ${p}`);
  }
};
verifyProtected();
const address = new URL(process.env.G1_TEST_ADMIN_URL ?? 'postgresql://wap:wap@127.0.0.1:55432/wap_g1');
assert(['127.0.0.1', 'localhost'].includes(address.hostname) && address.pathname === '/wap_g1');
const admin = postgres(address.href, { max: 1, onnotice: () => {} });
const database = 'g1_it_' + randomUUID().replaceAll('-', '');
assert.match(database, /^g1_it_[a-f0-9]{32}$/);
address.pathname = '/' + database;
const userId = randomUUID();
let created = false, db, raw, client;
const results = [];
const mark = (name, evidence) => results.push({ name, evidence, status: 'PASS' });
async function connect() {
  const c = new Client({ name: 'th04-independent-review', version: '1.0.0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'apps/mcp-task-hub/dist/server.js')], cwd: root, env: { G1_DATABASE_URL: address.href, G1_USER_ID: userId }, stderr: 'pipe' }));
  return c;
}
const invoke = async (args, auth) => {
  const response = await client.callTool({ name: 'create_card', arguments: args, ...(auth ? { _meta: { 'ati/authorization': auth } } : {}) });
  return { response, result: JSON.parse(response.content.find(c => c.type === 'text').text) };
};
const counts = async () => (await raw`SELECT (SELECT count(*)::int FROM hub_cards) AS cards, (SELECT count(*)::int FROM hub_receipts) AS receipts`)[0];
async function grant(args) {
  const workflow = randomUUID(), version = randomUUID(), run = randomUUID(), approval = randomUUID(), operation = randomUUID();
  const hash = writeFingerprint('create_card', args);
  const action = { step_id: 'create', operation_id: operation, server: 'task_hub', tool: 'create_card', policy_version: 'b-local-1', resolved_args: args, payload_hash: hash };
  const snapshot = createHash('sha256').update(JSON.stringify({ run, version, action })).digest('hex');
  const plan = { version: '1.0', name: 'Independent receiver fixture', source_prompt: 'Create review fixture', steps: [{ id: 'create', description: 'Create', tool: { server: 'task_hub', name: 'create_card', args }, side_effect: 'write', depends_on: [], idempotency_key: operation }], outputs: {} };
  await raw.begin(async tx => {
    await tx`INSERT INTO workflows(id,user_id,name,source_prompt) VALUES (${workflow},${userId},'Review fixture','Create review fixture')`;
    await tx`INSERT INTO workflow_versions(id,workflow_id,version_no,plan) VALUES (${version},${workflow},1,${tx.json(plan)})`;
    await tx`INSERT INTO runs(id,user_id,workflow_id,workflow_version_id,source_prompt,status) VALUES (${run},${userId},${workflow},${version},'Create review fixture','running')`;
    await tx`INSERT INTO approvals(id,run_id,workflow_version_id,snapshot_hash,preview,decision,expires_at) VALUES (${approval},${run},${version},${snapshot},${tx.json({ actions: [action] })},'approved',clock_timestamp()+interval '10 minutes')`;
    await tx`INSERT INTO tool_operations(operation_id,user_id,run_id,workflow_version_id,step_id,tool_server,tool_name,policy_version,intent_key,payload_hash,resolved_args,state,receiver_mode) VALUES (${operation},${userId},${run},${version},'create','task_hub','create_card','b-local-1',${operation},${hash},${tx.json(args)},'in_flight','local_transaction')`;
  });
  return { approval_id: approval, operation_id: operation, snapshot_hash: snapshot };
}
async function reject(args, auth, expected) {
  const old = await counts();
  const r = await invoke(args, auth);
  assert.equal(r.response.isError, true);
  assert.equal(r.result.code, expected);
  assert.deepEqual(await counts(), old);
  return r.result.code;
}
let failure;
try {
  await admin.unsafe(`CREATE DATABASE "${database}"`); created = true;
  await migrate(address.href); db = openDatabase(address.href);
  await seedDemo(db, userId);
  raw = postgres(address.href, { max: 3, onnotice: () => {} });
  client = await connect();
  const live = (await client.listTools()).tools;
  assert.deepEqual(live.map(t => t.name).sort(), ['append_sheet_rows', 'create_card', 'get_card', 'list_cards', 'list_members', 'read_sheet_range', 'send_slack_message']);
  const built = toolDefinitions();
  const hub = json('testdata/tools.json').servers.find(s => s.slug === 'task_hub');
  for (const t of live) {
    const definition = built.find(b => b.name === t.name), reviewed = hub.tools.find(b => b.name === t.name);
    for (const f of ['inputSchema', 'outputSchema', 'description']) {
      assert.deepEqual(t[f], definition[f]); assert.deepEqual(t[f], reviewed[f]);
    }
  }
  const historical = json('docs/antigravity/task-hub-handoff-baseline.json');
  for (const old of historical.old_three_tool_contracts) {
    const t = hub.tools.find(t => t.name === old.name);
    for (const f of ['inputSchema', 'outputSchema', 'sideEffect', 'policyVersion']) assert.deepEqual(t[f], old[f]);
  }
  mark('Seven live tools match built/catalog; old three schemas preserved', live.map(t => t.name));
  const args = { board_id: 'board_a', list_name: 'Backlog', title: 'Independent TH04', description: 'Preserve exact text', due_date: '0001-01-01', assignee_id: 'm2' };
  mark('Missing approval leaves no mutation', await reject(args, undefined, 'NOT_AUTHORIZED'));
  const tool = { ...hub.tools.find(t => t.name === 'create_card'), server: 'task_hub' };
  for (const date of ['0000-01-01', '0000-12-31', '1900-02-29', '2026-02-30', '10000-01-01', '0001-01-01', '9999-12-31', '2000-02-29', '2024-02-29']) {
    const input = { ...args, due_date: date };
    const valid = ['0001-01-01', '9999-12-31', '2000-02-29', '2024-02-29'].includes(date);
    assert.equal(inputs.create_card.safeParse(input).success, valid);
    const check = validateToolCall(tool, input, 'execution');
    assert(!check.issues.some(i => /unsupported tool schema/.test(i.message)));
    assert.equal(check.ok, valid);
    if (!valid) await reject(input, await grant(input), 'BAD_ARGS');
  }
  mark('Due-date domain agrees with reviewed schema and rejects invalid dates without writes', { valid: 4, invalid: 5 });
  const auth = await grant(args);
  const pair = await Promise.all([invoke(args, auth), invoke(args, auth)]);
  for (const r of pair) assert.notEqual(r.response.isError, true);
  assert.deepEqual(pair[0].result, pair[1].result);
  const id = pair[0].result.id;
  assert.match(id, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
  assert.deepEqual(await counts(), { cards: 3, receipts: 1 });
  const [stored] = await raw`SELECT board_id,list_name,title,description,due_date::text AS due_date,assignee_id FROM hub_cards WHERE user_id=${userId} AND card_id=${id}`;
  assert.deepEqual(stored, args);
  await client.close(); client = await connect();
  assert.deepEqual((await invoke(args, auth)).result, { id });
  assert.deepEqual(await counts(), { cards: 3, receipts: 1 });
  mark('Concurrent same-operation create and replay across restart produce one exact card/receipt', { id, stored, counts: await counts() });
  mark('Changed payload cannot reuse receipt', await reject({ ...args, title: 'Altered' }, auth, 'NOT_AUTHORIZED'));
  const second = await invoke(args, await grant(args));
  assert.notEqual(second.response.isError, true); assert.notEqual(second.result.id, id);
  assert.deepEqual(await counts(), { cards: 4, receipts: 2 });
  mark('Same payload with a distinct operation is a distinct intent', { first: id, second: second.result.id });
  const optional = { board_id: 'board_a', list_name: 'Backlog', title: 'Defaults review' };
  const defaultResult = await invoke(optional, await grant(optional));
  assert.notEqual(defaultResult.response.isError, true);
  const [defaults] = await raw`SELECT description,due_date,assignee_id FROM hub_cards WHERE user_id=${userId} AND card_id=${defaultResult.result.id}`;
  assert.deepEqual(defaults, { description: '', due_date: null, assignee_id: null });
  mark('Omitted args retain valid approval and map to storage defaults', defaults);
  const maxArgs = { ...optional, title: 'Year upper bound', due_date: '9999-12-31' };
  const maxResult = await invoke(maxArgs, await grant(maxArgs));
  assert.notEqual(maxResult.response.isError, true);
  assert.equal((await raw`SELECT due_date::text AS due FROM hub_cards WHERE card_id=${maxResult.result.id}`)[0].due, '9999-12-31');
  mark('Upper date boundary round-trips through PostgreSQL', '9999-12-31');
  await raw.unsafe("CREATE FUNCTION review_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tool_name='create_card' THEN RAISE EXCEPTION 'review receipt failure'; END IF; RETURN NEW; END $$");
  await raw.unsafe('CREATE TRIGGER review_fail_receipt BEFORE INSERT ON hub_receipts FOR EACH ROW EXECUTE FUNCTION review_fail_receipt()');
  try { mark('Receipt insertion failure rolls back inserted card', await reject(optional, await grant(optional), 'INTERNAL_ERROR')); }
  finally { await raw.unsafe('DROP TRIGGER review_fail_receipt ON hub_receipts'); await raw.unsafe('DROP FUNCTION review_fail_receipt()'); }
  await raw`UPDATE hub_receipts SET result='{}'::jsonb WHERE operation_id=${auth.operation_id}`;
  try { mark('Schema-invalid stored receipt maps to INTERNAL_ERROR', await reject(args, auth, 'INTERNAL_ERROR')); }
  finally { await raw`UPDATE hub_receipts SET result=${raw.json({ id })} WHERE operation_id=${auth.operation_id}`; }
} catch (error) { failure = { message: error.message, stack: error.stack }; }
finally {
  try { await client?.close(); } finally {
    try { await raw?.end(); await db?.close(); } finally {
      try { if (created) await admin.unsafe(`DROP DATABASE "${database}" WITH (FORCE)`); } finally { await admin.end(); }
    }
  }
}
verifyProtected();
const report = { status: failure ? 'FAIL' : 'PASS', recorded_at: new Date().toISOString(), database, database_dropped: true, approval_controller: 'SYNTHETIC_RECEIVER_FIXTURE', protected_hashes: Object.keys(before.protected_sha256).length, results, failure };
writeFileSync(path.join(out, `probe-${Date.now()}.json`), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (failure) process.exitCode = 1;
