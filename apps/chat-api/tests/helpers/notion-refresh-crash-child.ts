import pg from 'pg';
import { NotionConnectionRepo } from '../../src/db/repositories/notion-connection-repo.js';
import { NotionOAuthClient, NotionOAuthError } from '../../src/services/notion/oauth-client.js';
import { NotionTokenManager } from '../../src/services/notion/token-manager.js';
import { assertAssignedNotionTestDatabaseUrl } from './notion-oauth-test-env.js';

async function main() {
  assertAssignedNotionTestDatabaseUrl();
  const [
    ,
    ,
    schemaDatabaseUrl,
    userId,
    connectionId,
    versionStr,
    appId,
    loopbackBaseUrl,
    encryptionKey,
    modeArg,
  ] = process.argv;

  if (
    !schemaDatabaseUrl ||
    !userId ||
    !connectionId ||
    !versionStr ||
    !appId ||
    !loopbackBaseUrl ||
    !encryptionKey
  ) {
    process.stderr.write('Missing child arguments\n');
    process.exit(2);
  }

  const mode = modeArg === 'check' ? 'check' : 'execute';
  const pool = new pg.Pool({ connectionString: schemaDatabaseUrl, max: 2 });
  const repo = new NotionConnectionRepo(pool);
  const oauth = new NotionOAuthClient({
    clientId: appId,
    clientSecret: 'synthetic-client-secret-only',
    redirectUri: `${loopbackBaseUrl}/callback`,
    authorizationUrl: `${loopbackBaseUrl}/oauth/authorize`,
    apiBaseUrl: loopbackBaseUrl,
  });
  const manager = new NotionTokenManager(repo, oauth, encryptionKey);

  try {
    if (mode === 'check') {
      await manager.checkConnection(userId, connectionId, Number(versionStr), (tok, bId) =>
        oauth.verify(tok, bId, AbortSignal.timeout(10_000)),
      );
    } else {
      await manager.execute(userId, connectionId, Number(versionStr), async () => {
        throw new NotionOAuthError('HTTP 401 unauthorized', true);
      });
    }
  } finally {
    await pool.end().catch(() => {});
  }
}

void main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
