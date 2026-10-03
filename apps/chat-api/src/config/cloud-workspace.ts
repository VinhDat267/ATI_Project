export interface CloudWorkspaceConfig {
  databaseUrl: string;
  jwtSecret: string;
  encryptionKey: string;
  appBaseUrl: string;
  port: number;
}

/** Account/workspace deployment. This is deliberately not a sandbox or AI runtime. */
export function readCloudWorkspaceConfig(env: Record<string, string | undefined> = process.env): CloudWorkspaceConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  let database: URL;
  try { database = new URL(databaseUrl); } catch { throw new Error('DATABASE_URL must be a PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !database.hostname) {
    throw new Error('DATABASE_URL must be a PostgreSQL URL');
  }
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret || Buffer.byteLength(jwtSecret, 'utf8') < 32 || jwtSecret === 'default_jwt_secret_min_32_characters_long_for_dev') {
    throw new Error('JWT_SECRET must be a private secret of at least 32 bytes');
  }
  let encryptionKey = env.ENCRYPTION_KEY;
  // Render's generateValue creates a base64-encoded 256-bit secret.
  if (encryptionKey && /^[A-Za-z0-9+/]{43}=$/.test(encryptionKey)) {
    const decoded = Buffer.from(encryptionKey, 'base64');
    if (decoded.length === 32 && decoded.toString('base64') === encryptionKey) encryptionKey = decoded.toString('hex');
  }
  if (!encryptionKey || encryptionKey === '01234567890123456789012345678901' ||
      (Buffer.byteLength(encryptionKey, 'utf8') !== 32 && !/^[a-f\d]{64}$/i.test(encryptionKey))) {
    throw new Error('ENCRYPTION_KEY must be a private 32-byte key or 64 hex characters');
  }
  let frontend: URL;
  try { frontend = new URL(env.APP_BASE_URL || ''); } catch { throw new Error('APP_BASE_URL is required and must be HTTPS'); }
  if (frontend.protocol !== 'https:' || frontend.username || frontend.password) throw new Error('APP_BASE_URL must be HTTPS without credentials');
  const port = Number(env.PORT || 10000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');
  return { databaseUrl, jwtSecret, encryptionKey, appBaseUrl: frontend.href, port };
}
