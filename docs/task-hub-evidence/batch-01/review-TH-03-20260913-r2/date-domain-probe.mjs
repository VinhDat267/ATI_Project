// Review reproduction; only creates/seeds/drops its own g1_it_UUID database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const root = process.cwd(), out = path.dirname(fileURLToPath(import.meta.url));
const { migrate, openDatabase, seedDemo } = await import(pathToFileURL(path.join(root, 'packages/db/dist/index.js')));
const { inputs } = await import(pathToFileURL(path.join(root, 'apps/mcp-task-hub/dist/contracts.js')));
const address = new URL('postgresql://wap:wap@127.0.0.1:55432/wap_g1');
const admin = postgres(address.href, {max:1,onnotice:()=>{}});
const database = 'g1_it_' + randomUUID().replaceAll('-', '');
assert.match(database, /^g1_it_[a-f0-9]{32}$/);
address.pathname = '/' + database;
let created = false, db, client;
const results = [];
let pgDateError;
try {
  await admin.unsafe(`CREATE DATABASE "${database}"`); created = true;
  await migrate(address.href); db = openDatabase(address.href);
  const userId = randomUUID(); await seedDemo(db, userId);
  client = new Client({name:'th03-date-domain-review',version:'1.0.0'});
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'apps/mcp-task-hub/dist/server.js')],cwd:root,env:{G1_DATABASE_URL:address.href,G1_USER_ID:userId},stderr:'pipe'}));
  for (const dates of [{}, {since:'0001-01-01'}, {since:'0000-01-01'}, {until:'0000-12-31'}, {since:'2026-02-30'}, {until:'9999-12-31'}]) {
    const args = {board_id:'board_a',...dates};
    const response = await client.callTool({name:'list_cards',arguments:args});
    const content = JSON.parse(response.content.find(item=>item.type==='text').text);
    results.push({args,schemaAccepted:inputs.list_cards.safeParse(args).success,isError:response.isError===true,result:content});
  }
  assert.equal(results[0].result.count,2,'Seed control must succeed');
  assert.equal(results[1].result.count,2,'Year 0001 control must succeed');
  assert.equal(results[4].result.code,'BAD_ARGS','Impossible-date control');
  assert.equal(results[5].result.count,2,'Year 9999 control must succeed');
  try { await db.client`SELECT ${'0000-01-01'}::date`; }
  catch (error) { pgDateError = {code:error.code,message:error.message}; }
} finally {
  try { await client?.close(); } finally {
    try { await db?.close(); } finally {
      try { if(created) await admin.unsafe(`DROP DATABASE "${database}" WITH (FORCE)`); } finally { await admin.end(); }
    }
  }
}
const reproduced = results.slice(2,4).every(r=>r.schemaAccepted&&r.isError&&r.result.code==='INTERNAL_ERROR');
const report={recorded_at:new Date().toISOString(),status:reproduced?'REPRODUCED':'NOT_REPRODUCED',description:'Year zero passes the input schema but PostgreSQL date casts fail and MCP reports INTERNAL_ERROR',database,database_dropped:true,results,pgDateError};
writeFileSync(path.join(out,'date-domain-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
