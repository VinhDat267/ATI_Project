import { describe, expect, it, vi } from 'vitest';
import { encryptCredentials, GitHubAdapter } from '@wap/tool-adapters';
import { AdapterFactory } from '../../src/services/adapter-factory.js';

const key = 'test-only-encryption-key-with-32bytes';

describe('registered adapter factory', () => {
  it('constructs GitHub only from encrypted, scoped credentials', async () => {
    const config = encryptCredentials({ token: 'github-test-token', allowedScope: { repos: ['octo/repo'] } }, key);
    const getCredentials = vi.fn().mockResolvedValue({ config });
    const factory = new AdapterFactory({ credentialRepo: { getCredentials } as any, encryptionKey: key });
    const adapter = await factory.getAdapterForService('github');
    expect(adapter).toBeInstanceOf(GitHubAdapter);
    expect(adapter.service).toBe('github');
    expect(getCredentials).toHaveBeenCalledWith('github');
    expect(await factory.getAdapterForService('github')).toBe(adapter);
    expect(getCredentials).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported services and missing repository scope before adapter creation', async () => {
    const config = encryptCredentials({ token: 'github-test-token', allowedScope: { repos: [] } }, key);
    const getCredentials = vi.fn().mockResolvedValue({ config });
    const factory = new AdapterFactory({ credentialRepo: { getCredentials } as any, encryptionKey: key });
    await expect(factory.getAdapterForService('github')).rejects.toThrow('Allowed scope is required');
    await expect(factory.getAdapterForService('unknown')).rejects.toThrow('Unsupported service');
    expect(getCredentials).toHaveBeenCalledTimes(1);
  });
});
