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

  it('throws a clean domain error and logs a warning without leaking secrets when shared credentials cannot be decrypted, while healthy services still work', async () => {
    const foreignKey = 'another-encryption-key-of-32-bytes!';
    const foreignNotionConfig = encryptCredentials(
      { token: 'ntn_secret_token_do_not_leak', allowedScope: { databases: ['00000000-0000-0000-0000-000000000001'] } },
      foreignKey,
    );
    const healthySlackConfig = encryptCredentials(
      { botToken: 'xoxb-valid-token', allowedScope: { channels: ['C01234567'] } },
      key,
    );
    const getCredentials = vi.fn().mockImplementation(async (service: string) => {
      if (service === 'notion') return { config: foreignNotionConfig };
      if (service === 'slack') return { config: healthySlackConfig };
      return null;
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const factory = new AdapterFactory({ credentialRepo: { getCredentials } as any, encryptionKey: key });

      let caught: Error | undefined;
      try {
        await factory.getAdapterForService('notion');
      } catch (err: any) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).toMatch(/cannot be decrypted/i);
      expect(caught!.message).toContain('notion');
      expect(caught!.message).not.toContain('ntn_secret_token_do_not_leak');
      expect(caught!.message).not.toContain(foreignNotionConfig);
      expect(caught!.message).not.toContain(key);

      expect(warnSpy).toHaveBeenCalled();
      const warnText = warnSpy.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(warnText).toContain('notion');
      expect(warnText).not.toContain('ntn_secret_token_do_not_leak');
      expect(warnText).not.toContain(foreignNotionConfig);
      expect(warnText).not.toContain(key);

      const slackAdapter = await factory.getAdapterForService('slack');
      expect(slackAdapter.service).toBe('slack');
    } finally {
      warnSpy.mockRestore();
    }
  });
});
