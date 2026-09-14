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
  const c = new Client({ name: 'th05-independent-review', version: '1.0.0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'apps/mcp-task-hub/dist/server.js')], cwd: root, env: { G1_DATABASE_URL: address.href, G1_USER_ID: userId }, stderr: 'pipe' }));
  return c;
}
const invoke = async (args, auth) => {
  const response = await client.callTool({ name: 'move_card', arguments: args, ...(auth ? { _meta: { 'ati/authorization': auth } } : {}) });
  return { response, result: JSON.parse(response.content.find(c => c.type === 'text').text) };
};
const counts = async () => (await raw`SELECT (SELECT count(*)::int FROM hub_cards) AS cards, (SELECT count(*)::int FROM hub_receipts) AS receipts`)[0];
const allCards = async () => [...await raw`SELECT user_id,card_id,board_id,list_name,title,updated_at::text AS updated_at FROM hub_cards ORDER BY user_id,card_id`];
const card = async () => (await allCards()).find(c => c.user_id === userId && c.card_id === 'c1');
const workload = async () => {
  const r = await client.callTool({name:'list_members',arguments:{board_id:'board_a'}});
  assert.notEqual(r.isError,true);
  return JSON.parse(r.content.find(c=>c.type==='text').text);
};
async function grant(args) {
  const workflow = randomUUID(), version = randomUUID(), run = randomUUID(), approval = randomUUID(), operation = randomUUID();
  const hash = writeFingerprint('move_card', args);
  const action = { step_id: 'create', operation_id: operation, server: 'task_hub', tool: 'move_card', policy_version: 'b-local-1', resolved_args: args, payload_hash: hash };
  const snapshot = createHash('sha256').update(JSON.stringify({ run, version, action })).digest('hex');
  const plan = { version: '1.0', name: 'Independent receiver fixture', source_prompt: 'Move review fixture', steps: [{ id: 'create', description: 'Create', tool: { server: 'task_hub', name: 'move_card', args }, side_effect: 'write', depends_on: [], idempotency_key: operation }], outputs: {} };
  await raw.begin(async tx => {
    await tx`INSERT INTO workflows(id,user_id,name,source_prompt) VALUES (${workflow},${userId},'Review fixture','Move review fixture')`;
    await tx`INSERT INTO workflow_versions(id,workflow_id,version_no,plan) VALUES (${version},${workflow},1,${tx.json(plan)})`;
    await tx`INSERT INTO runs(id,user_id,workflow_id,workflow_version_id,source_prompt,status) VALUES (${run},${userId},${workflow},${version},'Move review fixture','running')`;
    await tx`INSERT INTO approvals(id,run_id,workflow_version_id,snapshot_hash,preview,decision,expires_at) VALUES (${approval},${run},${version},${snapshot},${tx.json({ actions: [action] })},'approved',clock_timestamp()+interval '10 minutes')`;
    await tx`INSERT INTO tool_operations(operation_id,user_id,run_id,workflow_version_id,step_id,tool_server,tool_name,policy_version,intent_key,payload_hash,resolved_args,state,receiver_mode) VALUES (${operation},${userId},${run},${version},'create','task_hub','move_card','b-local-1',${operation},${hash},${tx.json(args)},'in_flight','local_transaction')`;
  });
  return { approval_id: approval, operation_id: operation, snapshot_hash: snapshot };
}
async function reject(args, auth, expected) {
  const old = await counts();
  const oldCards = await allCards();
  const r = await invoke(args, auth);
  assert.equal(r.response.isError, true);
  assert.equal(r.result.code, expected);
  assert.deepEqual(await counts(), old);
  assert.deepEqual(await allCards(), oldCards);
  return r.result.code;
}
let failure;
try {
  await admin.unsafe(`CREATE DATABASE "${database}"`); created = true;
  await migrate(address.href); db = openDatabase(address.href);
  await seedDemo(db, userId); raw = postgres(address.href, {max:3,onnotice:()=>{}});
  client = await connect();
  const live = (await client.listTools()).tools, built = toolDefinitions();
  const hub = json('testdata/tools.json').servers.find(s=>s.slug==='task_hub');
  assert.deepEqual(live.map(t=>t.name).sort(), ['append_sheet_rows','create_card','get_card','list_cards','list_members','move_card','read_sheet_range','send_slack_message']);
  for(const t of live) {
    for(const field of ['inputSchema','outputSchema','description']) {
      assert.deepEqual(t[field],built.find(b=>b.name===t.name)[field]);
      assert.deepEqual(t[field],hub.tools.find(b=>b.name===t.name)[field]);
    }
  }
  for(const old of json('docs/antigravity/task-hub-handoff-baseline.json').old_three_tool_contracts) {
    for(const field of ['inputSchema','outputSchema','sideEffect','policyVersion']) assert.deepEqual(hub.tools.find(t=>t.name===old.name)[field],old[field]);
  }
  mark('Eight live tools agree with built/catalog; three original schemas preserved', live.map(t=>t.name));
  const args = {card_id:'c1',target_list:'Done'};
  mark('Missing approval, including same-target intent, cannot move or change timestamp', [await reject(args,undefined,'NOT_AUTHORIZED'),await reject({card_id:'c1',target_list:'Doing'},undefined,'NOT_AUTHORIZED')]);
  const tool={...hub.tools.find(t=>t.name==='move_card'),server:'task_hub'};
  for(const invalid of [{...args,board_id:'board_b'},{...args,target_list:''},{...args,target_list:null}]) {
    assert.equal(inputs.move_card.safeParse(invalid).success,false);
    assert.equal(validateToolCall(tool,invalid,'execution').ok,false);
    await reject(invalid,await grant(invalid),'BAD_ARGS');
  }
  assert.equal(validateToolCall(tool,args,'execution').ok,true);
  mark('Invalid args rejected without altering any card or receipt', 3);
  const original = await card(), auth = await grant(args);
  const moved = await invoke(args,auth);
  assert.notEqual(moved.response.isError,true); assert.deepEqual(moved.result,{id:'c1',list_name:'Done'});
  const done = await card(); assert.equal(done.board_id,original.board_id); assert.equal(done.list_name,'Done'); assert.notEqual(done.updated_at,original.updated_at);
  assert.deepEqual(await workload(),{members:[{id:'m1',name:'An',task_count:0},{id:'m2',name:'Bình',task_count:0}]});
  assert.deepEqual(await counts(),{cards:2,receipts:1});
  mark('Doing to Done changes timestamp and exact workload, with one receipt', {original,done});
  const noOpAuth=await grant(args), noOp=await invoke(args,noOpAuth);
  assert.notEqual(noOp.response.isError,true); assert.deepEqual(await card(),done);
  assert.deepEqual(await counts(),{cards:2,receipts:2});
  await client.close();client=await connect();
  const replay=await invoke(args,auth);assert.deepEqual(replay.result,moved.result);assert.deepEqual(await card(),done);
  assert.deepEqual(await counts(),{cards:2,receipts:2});
  mark('Same-target new intent gets its own receipt; restart replay leaves exact timestamp intact', {noOpOperation:noOpAuth.operation_id,replayedOperation:auth.operation_id,timestamp:done.updated_at});
  const concurrentArgs={card_id:'c1',target_list:'Backlog'}, concurrentAuth=await grant(concurrentArgs);
  const pair=await Promise.all([invoke(concurrentArgs,concurrentAuth),invoke(concurrentArgs,concurrentAuth)]);
  pair.forEach(r=>assert.notEqual(r.response.isError,true));assert.deepEqual(pair[0].result,pair[1].result);
  assert.deepEqual(await counts(),{cards:2,receipts:3});
  const backlog=await card();assert.equal(backlog.list_name,'Backlog');
  const oldReplay=await invoke(args,auth);assert.deepEqual(oldReplay.result,{id:'c1',list_name:'Done'});assert.deepEqual(await card(),backlog);
  mark('Concurrent duplicate moves create one receipt; replaying an older intent never undoes a newer move', {backlog,oldReplay:oldReplay.result});
  mark('Payload drift cannot reuse an operation',await reject({...args,target_list:'Doing'},auth,'NOT_AUTHORIZED'));
  const doingArgs={card_id:'c1',target_list:'Doing'};
  assert.notEqual((await invoke(args,await grant(args))).response.isError,true);
  assert.deepEqual(await workload(),{members:[{id:'m1',name:'An',task_count:0},{id:'m2',name:'Bình',task_count:0}]});
  const beforeReturn=await card();assert.equal(beforeReturn.list_name,'Done');
  assert.notEqual((await invoke(doingArgs,await grant(doingArgs))).response.isError,true);
  assert.notEqual((await card()).updated_at,beforeReturn.updated_at);
  assert.deepEqual(await workload(),{members:[{id:'m1',name:'An',task_count:1},{id:'m2',name:'Bình',task_count:0}]});
  mark('Approved return to Doing restores exact workload',await workload());
  // Hold A after its UPDATE but before commit; prove B waits on A, not just arrival order.
  let barrier, promiseA, promiseB;
  const awaitRow=async query=>{
    const deadline=Date.now()+5000;
    while(Date.now()<deadline){const rows=await query();if(rows.length)return rows[0];await new Promise(r=>setTimeout(r,25));}
    throw Error('Timed out waiting for the expected blocking backend');
  };
  try {
    barrier=postgres(address.href,{max:1,onnotice:()=>{}});
    const [{pid:barrierPid}]=await barrier`SELECT pg_backend_pid() AS pid`;
    await barrier`SELECT pg_advisory_lock(197612)`;
    await raw.unsafe("CREATE FUNCTION review_move_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.card_id='c1' AND NEW.list_name='Done' THEN PERFORM pg_advisory_xact_lock(197612); END IF; RETURN NEW; END $$");
    await raw.unsafe('CREATE TRIGGER review_move_barrier AFTER UPDATE ON hub_cards FOR EACH ROW EXECUTE FUNCTION review_move_barrier()');
    const authA=await grant(args), argsB={card_id:'c1',target_list:'Doing'}, authB=await grant(argsB);
    const beforeConcurrent=await card(), beforeCounts=await counts();
    promiseA=invoke(args,authA);
    const waitingA=await awaitRow(()=>raw`SELECT a.pid,pg_blocking_pids(a.pid) AS blockers FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.datname=${database} AND l.locktype='advisory' AND l.objid=197612 AND NOT l.granted AND ${barrierPid}=ANY(pg_blocking_pids(a.pid))`);
    assert.deepEqual(await card(),beforeConcurrent,'A must still be uncommitted');
    promiseB=invoke(argsB,authB);
    const waitingB=await awaitRow(()=>raw`SELECT pid,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE datname=${database} AND ${waitingA.pid}=ANY(pg_blocking_pids(pid))`);
    await barrier`SELECT pg_advisory_unlock(197612)`;
    const [a,b]=await Promise.all([promiseA,promiseB]);
    assert.notEqual(a.response.isError,true);assert.notEqual(b.response.isError,true);
    assert.deepEqual(a.result,{id:'c1',list_name:'Done'});assert.deepEqual(b.result,{id:'c1',list_name:'Doing'});
    const finalCard=await card();assert.equal(finalCard.list_name,'Doing');assert.notEqual(finalCard.updated_at,beforeConcurrent.updated_at);
    assert.deepEqual(await counts(),{cards:beforeCounts.cards,receipts:beforeCounts.receipts+2});
    const committed=await raw`SELECT operation_id,result FROM hub_receipts WHERE operation_id IN (${authA.operation_id},${authB.operation_id}) ORDER BY operation_id`;
    assert.equal(committed.length,2);
    assert.deepEqual(await workload(),{members:[{id:'m1',name:'An',task_count:1},{id:'m2',name:'Bình',task_count:0}]});
    mark('Two distinct overlapping operations serialize on the same card, preserving both receipts', {barrierPid,waitingA,waitingB,finalCard,receipts:[...committed]});
  } finally {
    try {if(barrier)await barrier`SELECT pg_advisory_unlock_all()`;} finally {await barrier?.end();}
    await Promise.allSettled([promiseA,promiseB]);
    await raw.unsafe('DROP TRIGGER IF EXISTS review_move_barrier ON hub_cards');
    await raw.unsafe('DROP FUNCTION IF EXISTS review_move_barrier()');
  }
  await raw`INSERT INTO hub_boards(user_id,board_id,name) VALUES (${userId},'board_b','B')`;
  await raw`INSERT INTO hub_lists(user_id,board_id,list_name) VALUES (${userId},'board_b','OnlyB')`;
  const other=randomUUID();await raw`INSERT INTO users(id,email,password_hash) VALUES (${other},${other+'@example.com'},'fixture')`;
  await raw`INSERT INTO hub_boards(user_id,board_id,name) VALUES (${other},'board_a','Other A')`;
  await raw`INSERT INTO hub_lists(user_id,board_id,list_name) VALUES (${other},'board_a','OnlyOther')`;
  await raw`INSERT INTO hub_cards(user_id,card_id,board_id,list_name,title) VALUES (${other},'foreign_card','board_a','OnlyOther','Foreign')`;
  for(const input of [{card_id:'c1',target_list:'OnlyB'},{card_id:'c1',target_list:'OnlyOther'},{card_id:'missing',target_list:'Done'},{card_id:'foreign_card',target_list:'Done'}]) await reject(input,await grant(input),'NOT_FOUND');
  mark('Cross-board and cross-owner targets/cards are isolated with every card preserved',4);
  await raw.unsafe("CREATE FUNCTION review_fail_move_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tool_name='move_card' THEN RAISE EXCEPTION 'review receipt failure'; END IF; RETURN NEW; END $$");
  await raw.unsafe('CREATE TRIGGER review_fail_move_receipt BEFORE INSERT ON hub_receipts FOR EACH ROW EXECUTE FUNCTION review_fail_move_receipt()');
  try { mark('Receipt failure rolls back exact list and timestamp',await reject(args,await grant(args),'INTERNAL_ERROR')); }
  finally {await raw.unsafe('DROP TRIGGER review_fail_move_receipt ON hub_receipts');await raw.unsafe('DROP FUNCTION review_fail_move_receipt()');}
  await raw`UPDATE hub_receipts SET result='{}'::jsonb WHERE operation_id=${auth.operation_id}`;
  try {mark('Corrupt move receipt returns INTERNAL_ERROR without state change',await reject(args,auth,'INTERNAL_ERROR'));}
  finally {await raw`UPDATE hub_receipts SET result=${raw.json(moved.result)} WHERE operation_id=${auth.operation_id}`;}
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
