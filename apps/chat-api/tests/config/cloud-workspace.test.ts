import { describe, expect, it } from 'vitest';
import { readCloudWorkspaceConfig } from '../../src/config/cloud-workspace.js';

const valid = {
  DATABASE_URL: 'postgresql://test:test@db.example.test/planora?sslmode=require',
  JWT_SECRET: 'unit-test-only-secret-0123456789abcdefgh',
  ENCRYPTION_KEY: 'a'.repeat(64),
  APP_BASE_URL: 'https://planora.example.test/',
  PORT: '10000',
};

describe('cloud account/workspace configuration', () => {
  it('does not require an AI provider or SMTP to serve real accounts', () => {
    expect(readCloudWorkspaceConfig(valid)).toMatchObject({ port: 10000, appBaseUrl: valid.APP_BASE_URL });
  });
  it.each(['DATABASE_URL', 'JWT_SECRET', 'ENCRYPTION_KEY', 'APP_BASE_URL'])('requires %s', (key) => {
    expect(() => readCloudWorkspaceConfig({ ...valid, [key]: undefined })).toThrow(key);
  });
  it('rejects insecure development secrets and invalid ports', () => {
    expect(() => readCloudWorkspaceConfig({ ...valid, JWT_SECRET: 'short' })).toThrow('JWT_SECRET');
    expect(() => readCloudWorkspaceConfig({ ...valid, ENCRYPTION_KEY: '01234567890123456789012345678901' })).toThrow('ENCRYPTION_KEY');
    expect(() => readCloudWorkspaceConfig({ ...valid, PORT: '100000' })).toThrow('PORT');
  });
  it('requires an HTTPS frontend and rejects non-Postgres database URLs', () => {
    expect(() => readCloudWorkspaceConfig({ ...valid, APP_BASE_URL: 'http://localhost:5175' })).toThrow('APP_BASE_URL');
    expect(() => readCloudWorkspaceConfig({ ...valid, DATABASE_URL: 'https://example.test/db' })).toThrow('DATABASE_URL');
  });
  it('does not accept embedded credentials in the public frontend URL', () => {
    expect(() => readCloudWorkspaceConfig({ ...valid, APP_BASE_URL: 'https://secret:secret@example.test/' })).toThrow('APP_BASE_URL');
  });
  it('normalizes Render-generated base64 keys without changing their entropy', () => {
    const bytes = Buffer.alloc(32, 123);
    expect(readCloudWorkspaceConfig({ ...valid, ENCRYPTION_KEY: bytes.toString('base64') }).encryptionKey).toBe(bytes.toString('hex'));
  });
});
