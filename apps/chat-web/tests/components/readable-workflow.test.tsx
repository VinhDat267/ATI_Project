/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PlanPreview } from '../../src/components/PlanPreview';
import { ExecutionProgress } from '../../src/components/ExecutionProgress';
import { ChatContainer } from '../../src/components/ChatContainer';
import { getToolDefinition } from '@wap/tool-schemas';
afterEach(cleanup);
it.each([
  ['trello.search_boards', [{ id: 'b1', name: 'Board frontend', url: 'https://trello.com/b/b1' }], 'Board frontend', 'https://trello.com/b/b1'],
  ['github.search_issues', [{ id: 'i1', number: 42, title: 'Issue frontend', repo: 'b/repo', url: 'https://github.com/b/repo/issues/42' }], 'Issue frontend', 'https://github.com/b/repo/issues/42'],
  ['jira.search_issues', { issues: [{ id: 'i1', key: 'ATI-42', title: 'Issue Jira', status: 'Open', url: 'https://ati.atlassian.net/browse/ATI-42' }] }, 'Issue Jira', 'https://ati.atlassian.net/browse/ATI-42'],
  ['notion.query_database', { pages: [{ id: 'p1', title: 'Page review', properties: {}, url: 'https://www.notion.so/p1' }], truncated: true }, 'Page review', 'https://www.notion.so/p1'],
  ['calendar.list_events', { events: [{ id: 'e1', title: 'Event review', start: '2026-10-04T06:24:00Z', end: '2026-10-04T07:24:00Z', url: 'https://calendar.google.com/e1' }] }, 'Event review', 'https://calendar.google.com/e1'],
] as const)('renders names and usable links for the registered %s read output', (tool, output, name, url) => {
  expect(getToolDefinition(tool)?.sideEffect).toBe('read');
  render(<ExecutionProgress steps={[{ id: 's1', tool, description: 'Đọc', status: 'succeeded', output }]} />);
  expect(screen.getByText(name)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: url })).toHaveAttribute('href', url);
  expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getByText('Chi tiết').closest('details')).not.toHaveAttribute('open');
  expect(screen.getByText('Chi tiết').closest('details')?.textContent).toContain(JSON.stringify(output, null, 2));
  if (tool === 'calendar.list_events') expect(document.querySelector('time[datetime="2026-10-04T06:24:00Z"]')).not.toBeNull();
});
it('keeps unsafe collection URLs as text while linking only absolute HTTP or HTTPS', () => {
  render(<ExecutionProgress steps={[{ id: 's1', tool: 'trello.search_boards', description: 'Đọc', status: 'succeeded', output: ['javascript:alert(1)', 'data:text/html,bad', '//example.test', 'https://trello.com/b/good'].map((url, index) => ({ id: String(index), name: `Board ${index}`, url })) }]} />);
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link')).toHaveAttribute('href', 'https://trello.com/b/good');
  expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument();
});
it('keeps an unlabelled resource whose ID is an object prototype property readable', () => {
  render(<PlanPreview plan={{ summary: 'Tạo thẻ', resourceLabels: {}, steps: [{ id: 's1', tool: 'trello.create_card', description: 'Tạo thẻ', args: { listId: '__proto__', title: 'Task' } }] }} />);
  expect(screen.getByTestId('arg-listId')).toHaveTextContent('__proto__');
});
it('shows resource labels with the raw ID and catalog read/write risk', () => {
  render(<PlanPreview plan={{ summary: 'Tạo thẻ', resourceLabels: { L1: 'Cần làm (board Frontend)' }, steps: [{ id: 's1', tool: 'trello.create_card', description: 'Tạo thẻ', args: { listId: 'L1', title: 'L1' } }] }} />);
  expect(screen.getByText('Cần làm (board Frontend)')).toBeDefined();
  expect(screen.getAllByText('L1')).toHaveLength(2);
  expect(screen.getByText('Ghi')).toBeDefined();
  expect(screen.getByText(/Rủi ro/)).toBeDefined();
});
it('renders structured result with a safe link, completion summary and collapsed full JSON', () => {
  render(<ExecutionProgress status="completed" steps={[{ id: 's1', tool: 'trello.create_card', description: 'Tạo thẻ', status: 'succeeded', output: { id: 'C1', name: 'Sửa CSS', url: 'https://trello.com/c/C1', extra: 'evidence' }, completedAt: '2026-10-04T06:24:00Z' }]} />);
  expect(screen.getByRole('link')).toHaveAttribute('href', 'https://trello.com/c/C1');
  expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getByText('Sửa CSS')).toBeDefined();
  expect(screen.getByText(/Đã hoàn thành 1\/1 bước/)).toBeDefined();
  expect(screen.getByText('Chi tiết').closest('details')).not.toHaveAttribute('open');
});
it.each(['javascript:alert(1)', 'data:text/html,hello', '//example.com'])('does not link unsafe result %s', url => {
  render(<ExecutionProgress steps={[{ id: 's1', tool: 'x', description: 'X', status: 'succeeded', output: { url } }]} />);
  expect(screen.queryByRole('link')).toBeNull();
});
it('supports a growing textarea, Shift+Enter, Enter send and planning guard with a live log', () => {
  const send = vi.fn();
  const view = render(<ChatContainer messages={[]} onSendMessage={send} />);
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  expect(input.tagName).toBe('TEXTAREA');
  expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'polite');
  fireEvent.change(input, { target: { value: 'Một\nHai' } });
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  expect(send).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(send).toHaveBeenCalledWith('Một\nHai');
  view.rerender(<ChatContainer messages={[]} onSendMessage={send} isPlanning />);
  fireEvent.change(input, { target: { value: 'Trùng' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(send).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Gửi' })).toBeDisabled();
  expect(screen.getByText('Đang lập kế hoạch…')).toBeDefined();
});
