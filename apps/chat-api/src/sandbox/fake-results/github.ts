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
            repo,
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
            repo,
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
          repo,
        },
      ];
    },
    'github.list_issues': (args) => {
      const repo = args.repo || 'owner/repo';
      return [
        {
          id: 'issue_42',
          number: 42,
          title: 'Fix responsive CSS',
          state: args.state || 'open',
          labels: ['bug'],
          assignees: [],
          url: 'https://github.com/' + repo + '/issues/42',
          repo,
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
        repo,
      };
    },
    'github.get_pull_request': (args) => {
      const repo = args.repo || 'owner/repo';
      const num = args.issueNumber ?? 12;
      return {
        id: 'pr_' + num,
        number: num,
        title: 'Feat: OAuth PKCE',
        body: 'Chi tiết pull request',
        state: 'open',
        labels: ['enhancement'],
        isPullRequest: true,
        url: 'https://github.com/' + repo + '/pull/' + num,
        repo,
      };
    },
    'github.list_pull_requests': (args) => {
      const repo = args.repo || 'owner/repo';
      return [
        {
          id: 'pr_12',
          number: 12,
          title: 'Feat: OAuth PKCE',
          state: args.state || 'open',
          author: 'octo',
          draft: false,
          url: 'https://github.com/' + repo + '/pull/12',
          repo,
        },
      ];
    },
    'github.create_issue': (args) => {
      const repo = args.repo || 'owner/repo';
      return {
        id: 'issue_' + Date.now(),
        number: 42,
        title: args.title,
        url: 'https://github.com/' + repo + '/issues/42',
        repo,
        ...(Array.isArray(args.labels) ? { labels: args.labels } : {}),
        ...(Array.isArray(args.assignees) ? { assignees: args.assignees } : {}),
      };
    },
    'github.update_issue': (args) => {
      const repo = args.repo || 'owner/repo';
      const num = args.issueNumber ?? 42;
      return {
        id: 'issue_' + num,
        number: num,
        title: args.title ?? 'Issue hiện có',
        state: args.state ?? 'open',
        labels: Array.isArray(args.labels) ? args.labels : ['bug'],
        assignees: Array.isArray(args.assignees) ? args.assignees : [],
        url: 'https://github.com/' + repo + '/issues/' + num,
        repo,
      };
    },
    'github.add_comment': (args) => {
      const repo = args.repo || 'owner/repo';
      const num = args.issueNumber ?? 42;
      return {
        id: 'comment_9001',
        issueNumber: num,
        body: args.body ?? '',
        repo,
        url: `https://github.com/${repo}/issues/${num}#issuecomment-9001`,
      };
    },
    'github.add_label': (args) => {
      const repo = args.repo || 'owner/repo';
      const num = args.issueNumber ?? 42;
      const labels = Array.isArray(args.labels)
        ? args.labels
        : typeof args.label === 'string'
          ? [args.label]
          : [];
      return {
        ok: true,
        number: num,
        issueNumber: num,
        labels,
        repo,
        url: `https://github.com/${repo}/issues/${num}`,
      };
    },
    'github.list_comments': (args) => {
      const repo = args.repo || 'owner/repo';
      const num = args.issueNumber ?? 42;
      return [
        {
          id: 'comment_8001',
          issueNumber: num,
          author: 'octocat',
          body: 'Đã kiểm tra log và tái hiện được nguyên nhân gốc.',
          url: `https://github.com/${repo}/issues/${num}#issuecomment-8001`,
          repo,
          createdAt: '2026-10-25T09:00:00Z',
        },
      ];
    },
    'github.create_pull_request': (args) => {
      const repo = args.repo || 'owner/repo';
      return {
        id: 'pr_' + Date.now(),
        number: 101,
        title: args.title,
        state: 'open',
        draft: Boolean(args.draft),
        headRef: args.head ?? 'feat/update',
        baseRef: args.base ?? 'main',
        url: `https://github.com/${repo}/pull/101`,
        repo,
      };
    },
    'github.request_reviewers': (args) => {
      const repo = args.repo || 'owner/repo';
      const num = args.issueNumber ?? 12;
      const reviewers = Array.isArray(args.reviewers)
        ? args.reviewers.map((r: unknown) => String(r).trim().replace(/^@+/, '')).filter(Boolean)
        : [];
      return {
        number: num,
        reviewers,
        repo,
        url: `https://github.com/${repo}/pull/${num}`,
      };
    },
  },
};
