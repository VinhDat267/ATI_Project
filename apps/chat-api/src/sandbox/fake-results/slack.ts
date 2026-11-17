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
      if (typeof args?.channelId === 'string') {
        return channels.filter((ch) => ch.id === args.channelId);
      }
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
      const ts = Date.now() + '.000100';
      return {
        ok: true,
        channel: args.channel,
        text: args.text,
        ts,
        ...(args.threadTs ? { threadTs: args.threadTs } : {}),
        permalink: `https://sandbox.slack.com/archives/${args.channel}/p${ts.replace('.', '')}`,
      };
    },
    'slack.read_messages': (args) => ({
      channel: args.channel || 'C_GENERAL',
      messages: [
        {
          ts: '1700000001.000100',
          user: 'U_LEAD',
          text: 'Cần ưu tiên xử lý các PR tồn đọng và cập nhật biên bản họp Q4.',
          replyCount: 2,
          threadTs: '1700000001.000100',
        },
      ],
      scanned: 1,
      matched: 1,
      truncated: false,
    }),
    'slack.read_thread': (args) => ({
      channel: args.channel || 'C_GENERAL',
      threadTs: args.threadTs || '1700000001.000100',
      messages: [
        {
          ts: args.threadTs || '1700000001.000100',
          user: 'U_LEAD',
          text: 'Cần ưu tiên xử lý các PR tồn đọng và cập nhật biên bản họp Q4.',
          isParent: true,
        },
        {
          ts: '1700000002.000200',
          user: 'U_DEV',
          text: 'Mình nhận PR #42 và sẽ hoàn thành trước 17h hôm nay.',
          isParent: false,
        },
      ],
      scanned: 2,
      truncated: false,
    }),
    'slack.search_users': (args) => {
      const users = [
        { id: 'U_LEAD', name: 'lead', realName: 'Nguyễn Văn An', displayName: 'an.nguyen', email: 'an@ati.local' },
        { id: 'U_DEV', name: 'dev', realName: 'Trần Thị Bình', displayName: 'binh.tran', email: 'binh@ati.local' },
      ];
      const email = typeof args?.email === 'string' ? args.email.trim().toLowerCase() : '';
      if (email) {
        return users.filter((u) => u.email.toLowerCase() === email);
      }
      const query = typeof args?.query === 'string' ? args.query.trim().toLowerCase() : '';
      const matched = query
        ? users.filter(
            (u) =>
              u.id.toLowerCase() === query ||
              u.name.toLowerCase().includes(query) ||
              u.realName.toLowerCase().includes(query) ||
              u.displayName.toLowerCase().includes(query) ||
              u.email.toLowerCase().includes(query),
          )
        : users;
      const limit = typeof args?.limit === 'number' && args.limit > 0 ? args.limit : matched.length;
      return matched.slice(0, limit);
    },
  },
};
