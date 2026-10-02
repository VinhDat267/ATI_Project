import type { FakeService } from './types.js';

export const SLACK_FAKE: FakeService = {
  id: 'slack',
  tools: {
    'slack.send_message': (args, scenario) => {
      if (scenario === 'partial_failure') throw Object.assign(new Error('Sandbox: invalid Slack channel before send'), { category: 'VALIDATION' });
      return { ok: true, channel: args.channel, text: args.text, ts: Date.now() + '.000100' };
    },
  },
};
