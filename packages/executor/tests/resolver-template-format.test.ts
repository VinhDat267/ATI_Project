import { describe, it, expect } from 'vitest';
import { resolveArgs } from '../src/index.js';

// Live audit 18/11/2026: notion.query_database pages interpolated into slack.send_message
// were delivered as "[object Object],[object Object]".
describe('resolveTemplate formats non-scalar step outputs readably', () => {
  const outputs = new Map<string, any>([
    ['q_notes', {
      pages: [
        { id: 'p1', url: 'https://app.notion.com/p/1', title: 'Remember to follow up', properties: { Name: 'Remember to follow up' } },
        { id: 'p2', url: 'https://app.notion.com/p/2', title: 'Q2 planning', properties: { Name: 'Q2 planning', 'Trạng thái': 'Mới' } },
      ],
    }],
    ['issues', [{ key: 'ATIT-1', title: 'Task 1', status: 'To Do', url: 'https://jira/ATIT-1' }]],
    ['empty', { pages: [] }],
    ['tags', { labels: ['bug', 'ui'] }],
    ['meta', { info: { a: 1 } }],
  ]);

  it('renders an array of objects as one line per item with title and url', () => {
    const { text } = resolveArgs({ text: { $template: 'Notes:\n${q_notes.output.pages}' } }, outputs);
    expect(text).not.toContain('[object Object]');
    expect(text).toBe('Notes:\n- Remember to follow up – https://app.notion.com/p/1\n- Q2 planning – https://app.notion.com/p/2');
  });

  it('includes key and status when present', () => {
    const { text } = resolveArgs({ text: { $template: '${issues.output}' } }, outputs);
    expect(text).toBe('- [ATIT-1] Task 1 (To Do) – https://jira/ATIT-1');
  });

  it('renders empty arrays explicitly and primitive arrays as a comma list', () => {
    expect(resolveArgs({ t: { $template: 'x: ${empty.output.pages}' } }, outputs).t).toBe('x: (không có mục nào)');
    expect(resolveArgs({ t: { $template: '${tags.output.labels}' } }, outputs).t).toBe('bug, ui');
  });

  it('falls back to JSON for objects without a readable label', () => {
    expect(resolveArgs({ t: { $template: '${meta.output.info}' } }, outputs).t).toBe('{"a":1}');
  });

  it('keeps $ref values structured', () => {
    expect(resolveArgs({ v: { $ref: 'tags.output.labels' } }, outputs).v).toEqual(['bug', 'ui']);
  });
});
