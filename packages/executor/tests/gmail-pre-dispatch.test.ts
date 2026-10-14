import { expect, it } from 'vitest';
import { StepRunner } from '../src/index.js';

it.each(['NETWORK', 'SERVER_ERROR', 'UNKNOWN'])('write error %s marked requestSent false is failed', async category => {
  const runner = new StepRunner({ getAdapter: () => ({ execute: async () => { throw Object.assign(new Error('Before dispatch'), { category, details: { requestSent: false } }); } }) });
  const result = await runner.executeStep({ id: 'send', tool: 'gmail.send_message', description: 'Send', dependsOn: [], args: {} }, new Map());
  expect(result.status).toBe('failed'); expect(result.error?.details).toEqual({ requestSent: false });
});
it.each([undefined, true, 'false'])('write network error with requestSent=%s remains unknown', async requestSent => {
  const runner = new StepRunner({ getAdapter: () => ({ execute: async () => { throw Object.assign(new Error('After dispatch'), { category: 'NETWORK', details: { requestSent } }); } }) });
  const result = await runner.executeStep({ id: 'send', tool: 'gmail.reply', description: 'Reply', dependsOn: [], args: {} }, new Map());
  expect(result.status).toBe('unknown');
});
