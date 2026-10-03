import pg from 'pg';
import { createCloudWorkspaceApp } from './cloud-workspace-app.js';
import { readCloudWorkspaceConfig } from './config/cloud-workspace.js';

async function main() {
  const config = readCloudWorkspaceConfig();
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5, connectionTimeoutMillis: 15000, idleTimeoutMillis: 30000 });
  pool.on('error', () => console.error('[planora] Database connection interrupted.'));
  try { await pool.query('SELECT 1 FROM auth_sessions LIMIT 1'); }
  catch { await pool.end(); throw new Error('Database not ready; apply the v3 migrations before startup.'); }
  const server = createCloudWorkspaceApp(pool, config).listen(config.port, '0.0.0.0', () => {
    console.log(`[planora] Account/workspace API listening on ${config.port}. AI execution and email signup are disabled.`);
  });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 15000);
    deadline.unref();
    server.close(async () => { await pool.end(); clearTimeout(deadline); process.exit(0); });
    // SSE clients hold sockets open; terminate them so cleanup can finish.
    server.closeAllConnections();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main().catch((error) => {
  console.error(`[planora] Startup failed: ${error instanceof Error ? error.message : 'configuration or database error'}`);
  process.exitCode = 1;
});
