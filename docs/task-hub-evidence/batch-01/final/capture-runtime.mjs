import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openDatabase, migrate, seedDemo, G1_DATABASE_URL, DEMO_USER_ID } from '@wap/db';
import { openLocalGateway } from '@wap/engine';
import { normalizeToolResult } from '@wap/dsl';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const name = 'engine_it_' + randomUUID().replaceAll('-', '');
const address = new URL(G1_DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(address.hostname)) {
  throw new Error('Local test database required');
}
address.pathname = '/' + name;
const url = address.href;
const admin = postgres(G1_DATABASE_URL, { max: 1, onnotice: () => {} });

let db;
let gateway;
let created = false;
let snapshot;

try {
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  created = true;
  await migrate(url);
  db = openDatabase(url);
  await seedDemo(db);

  gateway = await openLocalGateway({ root, databaseUrl: url, userId: DEMO_USER_ID });

  const reads = [
    ['read_sheet_range', { spreadsheet_id: 'source', range: 'Progress!A1:B2' }],
    ['get_card', { card_id: 'c1' }],
    ['list_cards', { board_id: 'board_a' }],
    ['list_members', { board_id: 'board_a' }],
  ];

  const outputs = {};
  for (const [tool, args] of reads) {
    const definition = gateway.tools.find((t) => t.name === tool);
    if (!definition) throw new Error('Missing tool ' + tool);
    const result = normalizeToolResult(
      definition,
      await gateway.call(tool, args, undefined, 10000, { timeZone: 'Asia/Ho_Chi_Minh' }),
    );
    if (!result.ok) throw new Error('Read/schema failed: ' + tool);
    outputs[tool] = result.output;
  }

  // Assert actual read results match seeded data
  if (
    outputs.read_sheet_range?.row_count !== 2 ||
    outputs.read_sheet_range?.values?.[0]?.[0] !== 'API' ||
    outputs.read_sheet_range?.values?.[0]?.[1] !== 'Done'
  ) {
    throw new Error('read_sheet_range output does not match seeded rows');
  }

  if (
    outputs.get_card?.id !== 'c1' ||
    outputs.get_card?.title !== 'Viết API' ||
    outputs.get_card?.list_name !== 'Doing'
  ) {
    throw new Error('get_card output does not match seeded card c1');
  }

  if (
    !Array.isArray(outputs.list_cards?.cards) ||
    outputs.list_cards.cards.length !== 2 ||
    !outputs.list_cards.cards.some((c) => c.id === 'c1' && c.list_name === 'Doing') ||
    !outputs.list_cards.cards.some((c) => c.id === 'c2' && c.list_name === 'Done')
  ) {
    throw new Error('list_cards output does not match seeded cards');
  }

  if (
    !Array.isArray(outputs.list_members?.members) ||
    outputs.list_members.members.length !== 2 ||
    !outputs.list_members.members.some((m) => m.id === 'm1' && m.name === 'An') ||
    !outputs.list_members.members.some((m) => m.id === 'm2' && m.name === 'Bình')
  ) {
    throw new Error('list_members output does not match seeded members');
  }

  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

  snapshot = {
    recorded_at: new Date().toISOString(),
    scope: 'ISOLATED_SEEDED_DB_READ_ONLY_MCP_CALLS',
    node: process.version,
    sdk: lock.packages['node_modules/@modelcontextprotocol/sdk'].version,
    database: name,
    database_dropped: false,
    principal: DEMO_USER_ID,
    live_discovery_validated: true,
    read_assertions_verified: true,
    tools: gateway.tools,
    outputs,
    postgres: await db.client`SELECT current_setting('server_version') AS version`,
    migrations: await db.client`SELECT name,checksum FROM schema_migrations ORDER BY name`,
  };

  if (snapshot.tools.length !== 8 || snapshot.migrations.length !== 4) {
    throw new Error('Final catalog/migration count differs');
  }

  writeFileSync(new URL('task-hub-runtime.json', import.meta.url), JSON.stringify(snapshot, null, 2) + '\n');
} finally {
  await gateway?.close();
  await db?.close();
  let dropped = false;
  if (created) {
    await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    dropped = true;
  }
  await admin.end();
  if (snapshot) {
    snapshot.database_dropped = dropped;
    writeFileSync(new URL('task-hub-runtime.json', import.meta.url), JSON.stringify(snapshot, null, 2) + '\n');
    console.log(
      JSON.stringify({
        tools: snapshot.tools.map((t) => t.name),
        migrations: snapshot.migrations.map((m) => m.name),
        read_assertions_verified: snapshot.read_assertions_verified,
        database_dropped: snapshot.database_dropped,
      }),
    );
  }
}
