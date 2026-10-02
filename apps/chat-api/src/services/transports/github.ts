import { GitHubAdapter } from '@wap/tool-adapters';
import type { ServiceTransport } from './types.js';

export const GITHUB_TRANSPORT: ServiceTransport = {
    id: 'github',
    createAdapter: (config, allowedScope) => new GitHubAdapter({ credentials: { token: String(config.token) }, allowedScope }),
    checkConnection: async (config, fetchFn, signal) => {
      const response = await fetchFn('https://api.github.com/user', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal,
      });
      const body = await response.json().catch(() => ({})) as { id?: unknown; login?: unknown };
      return response.ok && (typeof body.id === 'number' || typeof body.id === 'string') && typeof body.login === 'string';
    },
  };
