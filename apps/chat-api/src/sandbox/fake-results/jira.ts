import type { FakeService } from './types.js';
export const JIRA_FAKE: FakeService = {
  id: 'jira', tools: {
    'jira.search_projects': () => [{ id: '10000', key: 'ATI', name: 'ATI Project' }],
    'jira.search_issues': () => ({ issues: [{ id: '10042', key: 'ATI-42', title: 'Login bug', status: 'Open', url: 'https://ati-test.atlassian.net/browse/ATI-42' }] }),
    'jira.create_issue': () => ({ id: '10042', key: 'ATI-42', url: 'https://ati-test.atlassian.net/browse/ATI-42' }),
    'jira.add_comment': args => ({ id: '900', issueKey: args.issueKey, url: 'https://ati-test.atlassian.net/browse/' + args.issueKey + '?focusedCommentId=900' }),
  },
};
