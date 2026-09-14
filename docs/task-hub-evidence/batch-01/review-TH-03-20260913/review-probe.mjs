// Codex review artifact. Mutates only its own g1_it_UUID database.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const root = process.cwd(), out = path.dirname(fileURLToPath(import.meta.url));
const baseline = JSON.parse(readFileSync('docs/antigravity/task-hub-handoff-baseline.json', 'utf8'));
const { toolDefinitions } = await import(pathToFileURL(path.join(root, 'apps/mcp-task-hub/dist/contracts.js')));
const { migrate, openDatabase, seedDemo } = await import(pathToFileURL(path.join(root, 'packages/db/dist/index.js')));
const catalog = JSON.parse(readFileSync('testdata/tools.json', 'utf8'));
const hub = catalog.servers.find(s => s.slug === 'task_hub');
const names = ['append_sheet_rows','get_card','list_cards','list_members','read_sheet_range','send_slack_message'];
assert.equal(hub.status, 'PARTIAL_6_OF_8_IMPLEMENTED');
for (const name of ['create_card','move_card']) assert.equal(hub.tools.find(t => t.name === name).evidence, 'SPEC_ONLY');
const preserved = {...baseline.historical_evidence_sha256};
for (const [file, hash] of Object.entries(baseline.files_sha256)) if (/^db\/migrations\/000[1-3]_/.test(file)) preserved[file] = hash;
for (const [file, hash] of Object.entries(preserved)) assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), hash, file);
const dbName = 'g1_it_' + randomUUID().replaceAll('-', '');
assert.match(dbName, /^g1_it_[a-f0-9]{32}$/);
const adminUrl = 'postgresql://wap:wap@127.0.0.1:55432/wap_g1';
const address = new URL(adminUrl); address.pathname = '/' + dbName;
const admin = postgres(adminUrl, {max:1,onnotice:()=>{}});
let created = false, db, client;
const observations = [];
try {
  await admin.unsafe(`CREATE DATABASE "${dbName}"`); created = true;
  await migrate(address.href); db = openDatabase(address.href);
  const userId = randomUUID(); await seedDemo(db, userId);
  const snapshot = async () => {
    const sql = db.client;
    return {cards:Array.from(await sql`SELECT * FROM hub_cards ORDER BY user_id,card_id`),
      receipts:Array.from(await sql`SELECT * FROM hub_receipts ORDER BY user_id,operation_id`),
      messages:Array.from(await sql`SELECT * FROM hub_messages ORDER BY id`),
      sheets:Array.from(await sql`SELECT * FROM hub_sheets ORDER BY user_id,workbook_id,sheet_name`)};
  };
  const before = await snapshot();
  client = new Client({name:'codex-th03-review',version:'1.0.0'});
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'apps/mcp-task-hub/dist/server.js')],cwd:root,env:{G1_DATABASE_URL:address.href,G1_USER_ID:userId},stderr:'pipe'}));
  const live = (await client.listTools()).tools;
  assert.deepEqual(live.map(t=>t.name).sort(),names);
  for (const tool of live) {
    for (const expected of [toolDefinitions().find(t=>t.name===tool.name),hub.tools.find(t=>t.name===tool.name)]) {
      assert.deepEqual(tool.inputSchema,expected.inputSchema);
      assert.deepEqual(tool.outputSchema,expected.outputSchema);
    }
  }
  for (const original of baseline.old_three_tool_contracts) {
    const actual = live.find(t=>t.name===original.name);
    assert.deepEqual(actual.inputSchema,original.inputSchema);
    assert.deepEqual(actual.outputSchema,original.outputSchema);
  }
  for (const [name,args] of [['create_card',{board_id:'board_a',list_name:'Backlog',title:'Probe'}],['move_card',{card_id:'c1',target_list:'Done'}]]) {
    for (const auth of [undefined,{approval_id:randomUUID(),operation_id:randomUUID(),snapshot_hash:'a'.repeat(64)}]) {
      const res = await client.callTool({name,arguments:args,...(auth?{_meta:{'ati/authorization':auth}}:{})});
      assert.equal(res.isError,true); const error=JSON.parse(res.content.find(c=>c.type==='text').text);
      assert.equal(error.code,'BAD_ARGS'); observations.push({name,authorization:auth?'nonexistent':'absent',code:error.code});
    }
  }
  for (const runtime of [null,{}, {time_zone:'UTC',unexpected:true}]) {
    const res = await client.callTool({name:'list_cards',arguments:{board_id:'board_a'},_meta:{'ati/runtime':runtime}});
    assert.equal(res.isError,true); assert.equal(JSON.parse(res.content.find(c=>c.type==='text').text).code,'BAD_ARGS');
  }
  assert.deepEqual(await snapshot(),before,'Rejected calls must leave all business rows unchanged');
} finally {
  try { await client?.close(); } finally {
    try { await db?.close(); } finally {
      try { if(created) await admin.unsafe(`DROP DATABASE "${dbName}" WITH (FORCE)`); } finally { await admin.end(); }
    }
  }
}
const report={recorded_at:new Date().toISOString(),status:'PASS',live_tools:names,live_schemas_match_built_and_catalog:true,old_three_schemas_unchanged:true,preserved_hashes:Object.keys(preserved).length,disabled_calls:observations,malformed_runtime_rejections:3,business_rows_unchanged:true,isolated_database:dbName,database_dropped:true};
writeFileSync(path.join(out,'probe-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
