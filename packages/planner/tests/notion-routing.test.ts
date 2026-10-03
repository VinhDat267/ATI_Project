import { expect, it } from 'vitest';
import { ALL_TOOLS } from '@wap/tool-schemas';
import { classifyIntent } from '../src/router.js';

it.each([
  ['Ghi một dòng vào trang tính ATI Test Tracker', ['sheets']],
  ['Tạo page trong Notion ghi biên bản họp rồi báo Slack', ['slack', 'notion']],
  ['Tìm ghi chú dự án', ['notion']],
])('routes %s against the complete registry', (prompt, services) => expect(classifyIntent(prompt, ALL_TOOLS)).toEqual(services));
it('preserves Slack document content when Notion is unavailable and refuses explicit Notion', () => {
  const without = ALL_TOOLS.filter(t => t.service !== 'notion');
  expect(classifyIntent('Gửi tài liệu hướng dẫn lên kênh ati-test', without)).toEqual(['slack']);
  expect(classifyIntent('Tạo page trong Notion', without)).toEqual([]);
});
