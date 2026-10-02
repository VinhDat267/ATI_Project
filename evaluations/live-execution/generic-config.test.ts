import { expect, it } from 'vitest';
import { readLiveConfig } from './harness.js';

it('reads additional live services from data without changing env names or the harness', async () => {
  const module = await import('./live-services.js').catch(() => null);
  expect(module, 'live service env mapping must be separated from harness').not.toBeNull();
  const demo: any = {
    id: 'demo', credentials: { secret: 'DEMO_SECRET' }, scopeKey: 'things', scopeEnv: 'LIVE_DEMO_THINGS',
    missingCredentials: 'DEMO_SECRET is required', missingScope: 'LIVE_DEMO_THINGS must list thing ids',
    scopePattern: /^T\d+$/, invalidScope: 'LIVE_DEMO_THINGS entries must be thing ids',
  };
  module!.LIVE_SERVICES.push(demo);
  try {
    expect(readLiveConfig({ DEMO_SECRET: 'fixture', LIVE_DEMO_THINGS: ' T1,T1,T2 ' }).services.demo)
      .toEqual({ credentials: { secret: 'fixture' }, allowedScope: { things: ['T1', 'T2'] } });
    expect(readLiveConfig({ DEMO_SECRET: 'fixture', LIVE_DEMO_THINGS: 'wrong' }).skipped.demo).toBe('LIVE_DEMO_THINGS entries must be thing ids');
  } finally { module!.LIVE_SERVICES.splice(module!.LIVE_SERVICES.indexOf(demo), 1); }
});
