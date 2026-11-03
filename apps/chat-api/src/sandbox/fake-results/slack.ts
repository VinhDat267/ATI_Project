import type { FakeService } from './types.js';

const DEFAULT_SANDBOX_CHANNELS = [
  { id: 'C_GENERAL', name: 'general', isPrivate: false },
  { id: 'C_DEV', name: 'dev', isPrivate: false },
  { id: 'C_ALERTS', name: 'alerts', isPrivate: false },
  { id: 'C_ATI_TEST', name: 'ati-test', isPrivate: false },
];

export const SLACK_FAKE: FakeService = {
  id: 'slack',
  tools: {
    'slack.search_channels': (args, scenario) => {
      const channels =
        scenario === 'schedule'
          ? [
              { id: 'C_GENERAL', name: 'general' },
              { id: 'C_ATI_TEST', name: 'ati-test' },
            ]
          : DEFAULT_SANDBOX_CHANNELS;
      const rawQuery =
        typeof args?.query === 'string' ? args.query.trim().replace(/^#/, '').toLowerCase() : '';
      const filtered = rawQuery
        ? channels.filter(
            (ch) =>
              ch.name.toLowerCase().includes(rawQuery) || ch.id.toLowerCase() === rawQuery,
          )
        : [...channels];
      const limit =
        typeof args?.limit === 'number' && args.limit > 0 ? args.limit : filtered.length;
      return filtered.slice(0, limit);
    },
    'slack.send_message': (args, scenario) => {
      if (scenario === 'partial_failure') throw Object.assign(new Error('Sandbox: invalid Slack channel before send'), { category: 'VALIDATION' });
      return { ok: true, channel: args.channel, text: args.text, ts: Date.now() + '.000100' };
    },
  },
};
