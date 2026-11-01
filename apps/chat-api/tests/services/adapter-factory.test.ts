import { describe, expect, it, vi } from 'vitest';
import { encryptCredentials, NotionAdapter } from '@wap/tool-adapters';
import { AdapterFactory } from '../../src/services/adapter-factory.js';

const key = 'test-only-encryption-key-with-32bytes';

describe('registered adapter factory', () => {
  it('constructs shared service adapter only from encrypted, scoped credentials', async () => {
    const config = encryptCredentials(
      { token: 'ntn_test_token_123456', allowedScope: { databases: ['00000000-0000-0000-0000-000000000001'] } },
      key,
    );
    const getCredentials = vi.fn().mockResolvedValue({ config });
    const factory = new AdapterFactory({ credentialRepo: { getCredentials } as any, encryptionKey: key });
    const adapter = await factory.getAdapterForService('notion');
    expect(adapter).toBeInstanceOf(NotionAdapter);
    expect(adapter.service).toBe('notion');
    expect(getCredentials).toHaveBeenCalledWith('notion');
    expect(await factory.getAdapterForService('notion')).toBe(adapter);
    expect(getCredentials).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported services and missing resource scope before adapter creation', async () => {
    const config = encryptCredentials({ token: 'ntn_test_token_123456', allowedScope: { databases: [] } }, key);
    const getCredentials = vi.fn().mockResolvedValue({ config });
    const factory = new AdapterFactory({ credentialRepo: { getCredentials } as any, encryptionKey: key });
    await expect(factory.getAdapterForService('notion')).rejects.toThrow('Allowed scope is required');
    await expect(factory.getAdapterForService('unknown')).rejects.toThrow('Unsupported service');
    expect(getCredentials).toHaveBeenCalledTimes(1);
  });
});
