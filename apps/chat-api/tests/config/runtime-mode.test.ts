import { describe, it, expect, vi } from 'vitest';
import { validateEnv } from '../../src/config/env.js';

describe('runtime mode fail-closed boundaries', () => {
  it('requires an explicit database in live and rejects production sandbox', () => {
    const secure = { JWT_SECRET: 'secure-jwt-secret-for-test-at-least-32-chars', ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef', GEMINI_API_KEY: 'test-only-key' };
    expect(() => validateEnv({ ...secure, RUNTIME_MODE: 'live' })).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ ...secure, NODE_ENV: 'production', RUNTIME_MODE: 'sandbox', DATABASE_URL: 'postgresql://user:pass@localhost/db' })).toThrow(/RUNTIME_MODE/);
    expect(() => validateEnv({ ...secure, JWT_SECRET: 'short', RUNTIME_MODE: 'live', DATABASE_URL: 'postgresql://user:pass@localhost/db' })).toThrow(/JWT_SECRET/);
  });

  it('never resolves a real adapter in sandbox even if credentials exist', async () => {
    const { createRuntimeAdapterFactory } = await import('../../src/config/runtime-policy.js');
    const real = vi.fn().mockResolvedValue({ execute: vi.fn() });
    const sandbox = vi.fn().mockReturnValue({ execute: vi.fn() });
    const factory = createRuntimeAdapterFactory('sandbox', real, sandbox);
    await factory.getAdapterForService('trello');
    expect(real).not.toHaveBeenCalled();
    expect(sandbox).toHaveBeenCalledWith('trello');
  });

  it('never falls back to a mock planner or memory storage in live', async () => {
    const { createRuntimePlanner, mayUseMemoryStorage } = await import('../../src/config/runtime-policy.js');
    const primary = vi.fn().mockRejectedValue(new Error('provider down'));
    const backup = vi.fn().mockResolvedValue({ kind: 'plan' });
    const planner = createRuntimePlanner('live', primary, backup);
    await expect(planner.processMessage({ userMessage: 'x' })).rejects.toThrow('provider down');
    expect(backup).not.toHaveBeenCalled();
    expect(mayUseMemoryStorage('live')).toBe(false);
  });
});
