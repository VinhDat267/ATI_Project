import type { FakeService } from './types.js';

export const GITHUB_FAKE: FakeService = {
  id: 'github',
  tools: {
    'github.create_issue': args => ({
      id: 'issue_' + Date.now(), number: 42, title: args.title,
      url: 'https://github.com/owner/repo/issues/42', repo: args.repo,
    }),
  },
};
