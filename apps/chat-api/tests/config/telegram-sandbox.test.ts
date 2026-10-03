import { expect, it } from 'vitest';
import { createSandboxAdapter } from '../../src/sandbox/index.js';
import { createSandboxProvider } from '../../src/sandbox/scenarios.js';
import { readLiveConfig } from '../../../../evaluations/live-execution/harness.js';

it('publishes sandbox chat resources and Telegram-to-Slack messageId dependency', async () => {
  const adapter = createSandboxAdapter('telegram', 'telegram_slack');
  expect(await adapter.execute('telegram.list_chats', { query: '', limit: 10 })).toEqual([{ id: '-1001234567890', title: 'ATI Test', type: 'supergroup' }]);
  const plan = JSON.parse(await createSandboxProvider('telegram_slack').generatePlan({} as any));
  expect(plan.steps.map((s: any) => s.tool)).toEqual(['telegram.send_message', 'slack.send_message']);
  expect(await adapter.execute(plan.steps[0].tool, plan.steps[0].args)).toEqual({ messageId: 42, chatId: '-1001234567890', date: 1791014400 });
  expect(plan.steps[1].dependsOn).toEqual(['step_1']); expect(plan.steps[1].args.text.$template).toContain('${step_1.output.messageId}');
});
it('requires live bot credentials and an explicit signed numeric chat scope without network calls', () => {
  const env = { TELEGRAM_BOT_TOKEN: '123456789:synthetic_bot_token_abcdefghijkl', LIVE_TELEGRAM_CHAT_IDS: '-1001234567890,42' };
  expect(readLiveConfig(env).services.telegram).toEqual({ credentials: { botToken: env.TELEGRAM_BOT_TOKEN }, allowedScope: { chats: ['-1001234567890', '42'] } });
  for (const value of ['', '@outside', '42,bad']) expect(readLiveConfig({ ...env, LIVE_TELEGRAM_CHAT_IDS: value }).services.telegram).toBeUndefined();
  expect(readLiveConfig({ ...env, TELEGRAM_BOT_TOKEN: '' }).services.telegram).toBeUndefined();
});
