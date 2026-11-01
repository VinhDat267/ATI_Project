import type { FakeService } from './types.js';

export const GITHUB_FAKE: FakeService = {
  id: 'github',
  tools: {
    'github.search_repos': () => [
      { id: '100', name: 'repo', fullName: 'owner/repo', url: 'https://github.com/owner/repo' },
      { id: '101', name: 'ati', fullName: 'nhom/ati', url: 'https://github.com/nhom/ati' },
      { id: '102', name: 'repo', fullName: 'octo/repo', url: 'https://github.com/octo/repo' },
      { id: '103', name: 'platform', fullName: 'wap/platform', url: 'https://github.com/wap/platform' },
    ],
    'github.search_issues': (args) => {
      const repo = args.repo || 'owner/repo';
      const query = String(args.query || '');
      if (query.includes('is:pr')) {
        return [
          {
            id: 'pr_12',
            number: 12,
            title: 'Feat: OAuth PKCE',
            state: 'open',
            labels: ['enhancement'],
            assignees: ['octo'],
            createdAt: '2026-10-25T08:00:00Z',
            url: 'https://github.com/' + repo + '/pull/12',
          },
        ];
      }
      if (query.includes('no:assignee')) {
        return [
          {
            id: 'issue_42',
            number: 42,
            title: 'Fix responsive CSS',
            state: 'open',
            labels: ['bug'],
            assignees: [],
            url: 'https://github.com/' + repo + '/issues/42',
          },
        ];
      }
      return [
        {
          id: 'issue_42',
          number: 42,
          title: 'Fix responsive CSS',
          state: 'open',
          labels: ['bug'],
          assignees: [],
          url: 'https://github.com/' + repo + '/issues/42',
        },
      ];
    },
    'github.get_issue': (args) => {
      const repo = args.repo || 'owner/repo';
      const num = args.issueNumber ?? 42;
      return {
        id: 'issue_' + num,
        number: num,
        title: 'Issue hiện có',
        body: 'Chi tiết issue',
        state: 'open',
        labels: ['bug'],
        assignees: [],
        url: 'https://github.com/' + repo + '/issues/' + num,
      };
    },
    'github.create_issue': (args) => {
      const repo = args.repo || 'owner/repo';
      return {
        id: 'issue_' + Date.now(),
        number: 42,
        title: args.title,
        url: 'https://github.com/' + repo + '/issues/42',
        repo: args.repo,
      };
    },
    'github.add_label': (args) => ({
      ok: true,
      issueNumber: args.issueNumber ?? 42,
      labels: args.labels ?? [],
    }),
  },
};
