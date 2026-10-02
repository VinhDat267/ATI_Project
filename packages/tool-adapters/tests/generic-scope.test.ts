import { expect, it } from 'vitest';
import { BaseAdapter, StepError } from '../src/base-adapter.js';

class ScopedAdapter extends BaseAdapter {
  readonly service = 'demo';
  async execute(_tool: string, args: Record<string, any>) {
    this.assertAllowedScope(args.scopeKey, args.target);
    return { id: args.target };
  }
}

it('enforces arbitrary scope keys without a service branch', async () => {
  const adapter = new ScopedAdapter({ allowedScope: { projects: ['P1'] } });
  await expect(adapter.execute('demo.create_thing', { scopeKey: 'projects', target: 'P1' })).resolves.toEqual({ id: 'P1' });
  await expect(adapter.execute('demo.create_thing', { scopeKey: 'projects', target: 'P2' })).rejects.toMatchObject({
    category: 'AUTH_ERROR', statusCode: 403, retryable: false,
  });
});

it.each([['boards', 'board'], ['channels', 'channel'], ['repos', 'repo']])('keeps the legacy %s rejection format', async (scopeKey, label) => {
  const adapter = new ScopedAdapter({ allowedScope: { [scopeKey]: ['one', 'two'] } });
  await expect(adapter.execute('demo.create_thing', { scopeKey, target: 'other' })).rejects.toThrow(
    new StepError({ message: "Allowed scope restriction: " + label + " 'other' is not in allowed list [one, two]", category: 'AUTH_ERROR', statusCode: 403, retryable: false }),
  );
});

it('retains optional scope behavior for unscoped adapters', async () => {
  await expect(new ScopedAdapter().execute('demo.create_thing', { scopeKey: 'projects', target: 'P2' })).resolves.toEqual({ id: 'P2' });
});
