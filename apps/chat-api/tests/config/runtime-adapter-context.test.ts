import { describe, expect, it } from 'vitest';
import { createRuntimeAdapterFactory } from '../../src/config/runtime-policy.js';

describe('createRuntimeAdapterFactory forwards the adapter context', () => {
  it.each(['live', 'sandbox'] as const)('passes who and which connection to the %s factory', async (mode) => {
    const seen: unknown[] = [];
    const factory = createRuntimeAdapterFactory(mode,
      async (service: string, context?: unknown) => { seen.push(['real', service, context]); return {}; },
      (service: string, context?: unknown) => { seen.push(['sandbox', service, context]); return {}; });
    const context = { userId: 'user-a', phase: 'execution' as const, connections: { gmail: { credentialId: 'c1', email: 'a@example.test' } } };
    await factory.getAdapterForService('gmail', context);
    expect(seen).toEqual([[mode === 'live' ? 'real' : 'sandbox', 'gmail', context]]);
  });
});
