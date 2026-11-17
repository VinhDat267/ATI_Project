import { SlackAdapter, type SlackCredentials } from '@wap/tool-adapters';
import type { ServiceTransport } from './types.js';
import { listSlackCandidateChannels } from '../slack/slack-candidate-channels.js';

export const SLACK_TRANSPORT: ServiceTransport = {
    id: 'slack',
    createAdapter: (config, allowedScope) => new SlackAdapter({ credentials: config as unknown as SlackCredentials, allowedScope }),
    checkConnection: async (config, fetchFn, signal) => {
      const response = await fetchFn('https://slack.com/api/auth.test', {
        method: 'POST', headers: { Authorization: `Bearer ${config.botToken}` }, signal,
      });
      const body = await response.json().catch(() => ({})) as { ok?: unknown };
      return response.ok && body.ok === true;
    },
    listScopeCandidates: async (config, fetchFn, signal) => {
      const result = await listSlackCandidateChannels(String(config.botToken ?? ''), fetchFn, undefined, signal);
      if (!result.ok) return result;
      return {
        ok: true,
        truncated: result.truncated,
        items: result.channels.map(ch => ({
          id: ch.id,
          label: `${ch.isPrivate ? '🔒 ' : '#'}${ch.name}`,
          ...(ch.isMember ? {} : { warning: 'Bot chưa ở trong kênh: gõ /invite @tên-bot trong kênh này' }),
        })),
      };
    },
  };
