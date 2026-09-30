import { describe, it, expect, vi } from 'vitest';
import { validateEnv } from '../../src/config/env.js';

describe('runtime mode fail-closed boundaries', () => {
  it('creates a fresh private JWT secret for each sandbox process', () => {
    const first = validateEnv({ RUNTIME_MODE: 'sandbox' });
    const second = validateEnv({ RUNTIME_MODE: 'sandbox' });
    expect(first.JWT_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(second.JWT_SECRET).not.toBe(first.JWT_SECRET);
    expect(() => validateEnv({ RUNTIME_MODE: 'sandbox', JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('requires an explicit database in live and rejects production sandbox', () => {
    const secure = { JWT_SECRET: 'secure-jwt-secret-for-test-at-least-32-chars', ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef', GEMINI_API_KEY: 'test-only-key' };
    expect(() => validateEnv({ ...secure, RUNTIME_MODE: 'live' })).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ ...secure, NODE_ENV: 'production', RUNTIME_MODE: 'sandbox', DATABASE_URL: 'postgresql://user:pass@localhost/db' })).toThrow(/RUNTIME_MODE/);
    expect(() => validateEnv({ ...secure, JWT_SECRET: 'short', RUNTIME_MODE: 'live', DATABASE_URL: 'postgresql://user:pass@localhost/db' })).toThrow(/JWT_SECRET/);
  });

  it('requires the settings of the selected LLM provider in live', () => {
    const live = {
      RUNTIME_MODE: 'live', DATABASE_URL: 'postgresql://user:pass@localhost/db',
      JWT_SECRET: 'secure-jwt-secret-for-test-at-least-32-chars', ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
    };
    expect(() => validateEnv(live)).toThrow(/GEMINI_API_KEY/);
    const gateway = { ...live, LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: 'http://localhost:20128/v1', LLM_MODEL: 'ag/gemini-3.8-flash' };
    expect(validateEnv(gateway).LLM_PROVIDER).toBe('openai-compatible');
    expect(() => validateEnv({ ...gateway, LLM_MODEL: '' })).toThrow(/LLM_MODEL/);
    expect(() => validateEnv({ ...gateway, LLM_BASE_URL: '' })).toThrow(/LLM_BASE_URL/);
    expect(() => validateEnv({ ...live, LLM_PROVIDER: 'mystery', GEMINI_API_KEY: 'k' })).toThrow(/LLM_PROVIDER/);
  });

  it('searches with the model in live and with regex rules in sandbox unless overridden', () => {
    const live = {
      RUNTIME_MODE: 'live', DATABASE_URL: 'postgresql://user:pass@localhost/db', GEMINI_API_KEY: 'k',
      JWT_SECRET: 'secure-jwt-secret-for-test-at-least-32-chars', ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
    };
    expect(validateEnv(live).PLANNER_SEARCH_MODE).toBe('llm');
    expect(validateEnv({ RUNTIME_MODE: 'sandbox' }).PLANNER_SEARCH_MODE).toBe('regex');
    expect(validateEnv({ ...live, PLANNER_SEARCH_MODE: 'regex' }).PLANNER_SEARCH_MODE).toBe('regex');
    expect(validateEnv({ RUNTIME_MODE: 'sandbox', PLANNER_SEARCH_MODE: 'llm' }).PLANNER_SEARCH_MODE).toBe('llm');
    expect(() => validateEnv({ ...live, PLANNER_SEARCH_MODE: 'magic' })).toThrow(/PLANNER_SEARCH_MODE/);
  });

  it('defaults the planning time zone and rejects an unknown one at startup', () => {
    expect(validateEnv({ RUNTIME_MODE: 'sandbox' }).APP_TIME_ZONE).toBe('Asia/Ho_Chi_Minh');
    expect(validateEnv({ RUNTIME_MODE: 'sandbox', APP_TIME_ZONE: 'Europe/Berlin' }).APP_TIME_ZONE).toBe('Europe/Berlin');
    expect(() => validateEnv({ RUNTIME_MODE: 'sandbox', APP_TIME_ZONE: 'Mars/Olympus' })).toThrow(/APP_TIME_ZONE/);
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
