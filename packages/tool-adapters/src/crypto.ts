import crypto from 'node:crypto';

function getKeyBuffer(key: string | Buffer): Buffer {
  if (Buffer.isBuffer(key)) return key;
  if (key.length === 64 && /^[0-9a-fA-F]+$/.test(key)) {
    return Buffer.from(key, 'hex');
  }
  const buf = Buffer.from(key, 'utf8');
  if (buf.length === 32) return buf;
  return crypto.createHash('sha256').update(key).digest();
}

/**
 * Encrypts arbitrary JSON-serializable credentials with AES-256-GCM.
 * Format: v1:${base64(iv)}:${base64(auth_tag)}:${base64(ciphertext)}
 */
export function encryptCredentials(raw: Record<string, any>, secretKey: string | Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKeyBuffer(secretKey), iv);
  const plaintext = JSON.stringify(raw);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypts authenticated AES-256-GCM encrypted credentials string.
 * Throws an error if tampered, corrupted, or formatted incorrectly.
 */
export function decryptCredentials<T = Record<string, any>>(
  encrypted: string,
  secretKey: string | Buffer
): T {
  if (!encrypted || typeof encrypted !== 'string') {
    throw new Error('Invalid encrypted credentials format: expected string');
  }

  const parts = encrypted.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted credentials format: expected v1:iv:tag:ciphertext');
  }

  const [, ivB64, tagB64, dataB64] = parts;
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid encrypted credentials format: missing token parts');
  }

  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', getKeyBuffer(secretKey), iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8')) as T;
}
