import { expect, it } from 'vitest';
import { recoveryEditRequest } from '../../src/pages/Cockpit/recovery-request';
import type { ExecutionSnapshot } from '../../src/types';

const snapshot = {
  plan: { id: 'p1', convId: 'c1', status: 'stopped', summary: 'Tạo thẻ, gán người và báo nhóm', steps: [
    { id: 'step_1', tool: 'trello.create_card', description: 'Tạo thẻ', args: { name: 'Task' } },
    { id: 'step_2', tool: 'trello.add_member', description: 'Gán Minh vào thẻ', args: { cardId: { $ref: 'step_1.output.id' }, memberId: 'minh' } },
    { id: 'step_3', tool: 'slack.send_message', description: 'Thông báo Slack', args: { channel: '#ati-test', text: { $template: 'Thẻ ${step_1.output.url}, người ${step_2.output.fullName}' } } },
    { id: 'step_4', tool: 'sheets.append_rows', description: 'Ghi bảng theo dõi', args: { spreadsheetId: 'sheet-1', sheet: 'Tracker', rows: [['Task', 'Minh'], ['Hạn', 3]] } },
  ] },
  execution: { status: 'stopped' },
  steps: [
    { stepId: 'step_1', tool: 'trello.create_card', status: 'succeeded', output: { id: 'saved-card-123', url: 'https://trello.com/c/saved' } },
    { stepId: 'step_2', tool: 'trello.add_member', status: 'failed', error: 'Denied' },
    { stepId: 'step_3', tool: 'slack.send_message', status: 'pending' },
    { stepId: 'step_4', tool: 'sheets.append_rows', status: 'pending' },
  ],
  recoveryActions: [],
} as unknown as ExecutionSnapshot;

it('describes the corrected step and remaining work in plain Vietnamese with schema labels', () => {
  const text = recoveryEditRequest(snapshot, 'step_2', { cardId: 'saved-card-123', memberId: 'corrected-member' });
  expect(text.split('\n')[0]).toBe('Làm lại việc 2 (Gán Minh vào thẻ) của kế hoạch đã dừng, với nội dung đã sửa:');
  expect(text).toContain('- ID của thẻ Trello: saved-card-123');
  expect(text).toContain('- ID của thành viên Trello cần gán: corrected-member');
  expect(text).toContain('- Việc 3 (Thông báo Slack): ID kênh Slack nhận tin nhắn: #ati-test; Nội dung tin nhắn cần gửi: Thẻ https://trello.com/c/saved, người (kết quả của việc 2)');
  expect(text).toContain('- Việc 4 (Ghi bảng theo dõi): spreadsheetId: sheet-1; sheet: Tracker; rows: Task, Minh / Hạn, 3');
  expect(text).toContain('Không làm lại các việc đã xong.');
});

it('never exposes step ids, references or JSON, and adds an optional note last', () => {
  const unresolved = { ...snapshot, steps: snapshot.steps.map(step => step.stepId === 'step_1' ? { ...step, output: null } : step) } as ExecutionSnapshot;
  const text = recoveryEditRequest(unresolved, 'step_2', { cardId: { $ref: 'step_1.output.id' }, memberId: 'minh', extra: { nested: true } }, '  Gán cho người trực tuần này  ');
  expect(text).not.toMatch(/step_\d|\$ref|\$template|[{}]|\$\{/);
  expect(text).toContain('- ID của thẻ Trello: (kết quả của việc 1)');
  expect(text).toContain('- extra: nested: có');
  expect(text.trimEnd().split('\n').at(-1)).toBe('Ghi chú: Gán cho người trực tuần này');
});

it('omits the remaining-work section when nothing is pending and the note when blank', () => {
  const done = { ...snapshot, steps: snapshot.steps.map(step => step.status === 'pending' ? { ...step, status: 'skipped' } : step) } as ExecutionSnapshot;
  const text = recoveryEditRequest(done, 'step_2', { cardId: 'saved-card-123', memberId: 'minh' }, '   ');
  expect(text).not.toContain('Sau đó làm tiếp');
  expect(text).not.toContain('Ghi chú');
});
