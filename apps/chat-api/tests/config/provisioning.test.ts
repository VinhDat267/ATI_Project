import { describe, it, expect } from 'vitest';
import { readProvisioningConfig } from '../../src/config/provisioning.js';

describe('v3 user provisioning configuration', () => {
  it('requires explicit database, email, and a strong password', () => {
    expect(() => readProvisioningConfig({})).toThrow(/DATABASE_URL/);
    expect(() => readProvisioningConfig({ DATABASE_URL: 'postgresql://local/db', CHAT_ADMIN_EMAIL: 'a@example.test', CHAT_ADMIN_PASSWORD: 'short' })).toThrow(/CHAT_ADMIN_PASSWORD/);
    expect(() => readProvisioningConfig({ DATABASE_URL: 'postgresql://local/db', CHAT_ADMIN_EMAIL: 'not-an-email', CHAT_ADMIN_PASSWORD: 'long-enough-password' })).toThrow(/CHAT_ADMIN_EMAIL/);
    expect(() => readProvisioningConfig({ DATABASE_URL: 'postgresql://local/db', CHAT_ADMIN_EMAIL: 'a@example.test', CHAT_ADMIN_PASSWORD: 'a'.repeat(129) })).toThrow(/CHAT_ADMIN_PASSWORD/);
  });

  it('normalizes the email and returns only explicitly supplied values', () => {
    expect(readProvisioningConfig({
      DATABASE_URL: 'postgresql://local/db', CHAT_ADMIN_EMAIL: ' Admin@Example.Test ',
      CHAT_ADMIN_PASSWORD: 'long-enough-password', CHAT_ADMIN_NAME: 'Team Admin',
    })).toEqual({ databaseUrl: 'postgresql://local/db', email: 'admin@example.test', password: 'long-enough-password', name: 'Team Admin' });
  });
});
