import { expect, it } from 'vitest';
import { ALL_TOOLS } from '@wap/tool-schemas';
import { classifyIntent } from '../src/router.js';

it.each([
  ['Tạo issue trong repo ati-test', ['github']],
  ['Phát hành Sprint từ Trello sang Slack', ['trello', 'slack']],
  ['Tạo ticket Jira cho lỗi đăng nhập và báo Slack', ['slack', 'jira']],
  ['Tạo issue Jira trong project ATI', ['github', 'jira']],
  ['Tạo ticket trong project ATI', ['jira']],
])('routes %s with the whole registry', (message, expected) => expect(classifyIntent(message, ALL_TOOLS)).toEqual(expected));

it('preserves Trello/GitHub when Jira unavailable and refuses explicit Jira', () => {
  const catalog = ALL_TOOLS.filter(t => t.service !== 'jira');
  expect(classifyIntent('Phát hành Sprint từ Trello sang Slack', catalog)).toEqual(['trello', 'slack']);
  expect(classifyIntent('Tạo issue trong repo ati-test', catalog)).toEqual(['github']);
  expect(classifyIntent('Tạo ticket Jira và báo Slack', catalog)).toEqual([]);
});
