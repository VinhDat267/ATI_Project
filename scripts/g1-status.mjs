/** Read-only runtime evidence for the dedicated local G1 services. Run after build/migrate/seed. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { openDatabase, G1_DATABASE_URL, DEMO_USER_ID } from '@wap/db';

const root = fileURLToPath(new URL('../', import.meta.url));
const engineProfile = process.env.ATI_TEST_EVIDENCE_PROFILE === 'engine';
const serverPath = path.join(root, 'apps/mcp-task-hub/dist/server.js');
const connection = openDatabase(G1_DATABASE_URL);
const client = new Client({name:'ati-g1-status',version:'1.0.0'});
const hashFile = p => createHash('sha256').update(readFileSync(path.join(root,p))).digest('hex');
try {
  await client.connect(new StdioClientTransport({
    command:process.execPath,args:[serverPath],cwd:root,
    env:{G1_DATABASE_URL,G1_USER_ID:DEMO_USER_ID},stderr:'pipe',
  }));
  const discovery = await client.listTools();
  const read = await client.callTool({name:'read_sheet_range',arguments:{spreadsheet_id:'source',range:'Progress!A1:B2'}});
  if (read.isError) throw new Error('Demo read failed');
  const docker = JSON.parse(execFileSync('docker',['inspect','ati-g1-postgres-1','ati-g1-redis-1'],{encoding:'utf8',windowsHide:true}));
  const runtime = {
    recorded_at:new Date().toISOString(),
    scope:'READ_ONLY_DEMO_SNAPSHOT; engine/controller integration is recorded separately; no HTTP/UI/LLM verification',
    node:process.version,
    launch:{command:process.execPath,args:[serverPath],cwd:root,principal:DEMO_USER_ID,db_host:'127.0.0.1',db_port:55532,db_name:'wap_g1'},
    containers:docker.map(c=>({name:c.Name,image:c.Config.Image,image_id:c.Image,status:c.State.Status,health:c.State.Health?.Status,ports:c.NetworkSettings.Ports})),
    redis_ping:execFileSync('docker',['exec','ati-g1-redis-1','redis-cli','ping'],{encoding:'utf8',windowsHide:true}).trim(),
    postgres:await connection.client`SELECT current_setting('server_version') AS version, (SELECT extversion FROM pg_extension WHERE extname='vector') AS vector_version`,
    migrations:await connection.client`SELECT name,checksum FROM schema_migrations ORDER BY name`,
    demo_sheets:await connection.client`SELECT workbook_id,sheet_name,cells FROM hub_sheets WHERE user_id=${DEMO_USER_ID} ORDER BY workbook_id,sheet_name`,
    demo_counts:await connection.client`SELECT (SELECT count(*)::int FROM hub_messages WHERE user_id=${DEMO_USER_ID}) AS messages,(SELECT count(*)::int FROM hub_receipts WHERE user_id=${DEMO_USER_ID}) AS receipts`,
    tools:discovery.tools,
    actual_demo_read:read.structuredContent,
    sha256:Object.fromEntries(['package-lock.json','compose.g1.yaml','testdata/tools.json','apps/mcp-task-hub/dist/server.js','apps/mcp-task-hub/dist/contracts.js','apps/mcp-task-hub/dist/service.js','apps/mcp-task-hub/dist/fingerprint.js',...(engineProfile ? ['packages/db/dist/connection.js','packages/engine/dist/cli.js','packages/engine/dist/store.js','packages/engine/dist/prepare.js','packages/engine/dist/approval.js','packages/engine/dist/execute.js','packages/engine/dist/attempts.js','packages/engine/dist/recovery.js','packages/engine/dist/gateway.js','packages/engine/dist/snapshot.js'] : [])].map(p=>[p,hashFile(p)])),
  };
  const existingDefaultDir = path.join(root, engineProfile ? 'docs/engine-evidence/2026-09-13' : 'docs/g1-evidence/2026-09-13');
  const requestedEvidence = process.env.ATI_EVIDENCE_DIR;
  const dir = requestedEvidence
    ? path.resolve(root, requestedEvidence)
    : existingDefaultDir;
  if (requestedEvidence) {
    const evidenceRoot = path.resolve(root, "docs/task-hub-evidence");
    const relative = path.relative(evidenceRoot, dir);
    if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
      throw new Error("ATI_EVIDENCE_DIR must name a batch directory under docs/task-hub-evidence");
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir,'runtime-snapshot.json'),JSON.stringify(runtime,null,2)+'\n');
  console.log(JSON.stringify({migrations:runtime.migrations.length,tools:discovery.tools.map(t=>t.name),redis:runtime.redis_ping,health:runtime.containers.map(c=>[c.name,c.health]),demo_read:runtime.actual_demo_read},null,2));
} finally {
  await client.close();
  await connection.close();
}
