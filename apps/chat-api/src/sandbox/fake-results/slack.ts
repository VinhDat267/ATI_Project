import type { FakeService } from './types.js';

export const SLACK_FAKE: FakeService = {
  id: 'slack',
  tools: {
    'slack.search_channels': (_args, scenario) => {
      if (scenario === 'schedule') {
        return [
          { id: 'C_GENERAL', name: 'general' },
          { id: 'C_ATI_TEST', name: 'ati-test' },
        ];
      }
      return [];
    },
    'slack.send_message': (args, scenario) => {
      if (scenario === 'partial_failure') throw Object.assign(new Error('Sandbox: invalid Slack channel before send'), { category: 'VALIDATION' });
      return { ok: true, channel: args.channel, text: args.text, ts: Date.now() + '.000100' };
    },
  },
};
