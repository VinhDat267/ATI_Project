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
  expect(text).toContain('- Việc 3 (Thông báo Slack): ID kênh Slack nhận tin nhắn: #ati-test; Nội dung tin nhắn cần gửi: Thẻ https://trello.com/c/saved, người (tên đầy đủ của việc 2)');
  expect(text).toContain('- Việc 4 (Ghi bảng theo dõi): ID bảng tính: sheet-1; Tên trang tính: Tracker; Các dòng cần thêm: Dòng 1: cột 1: “Task”; cột 2: “Minh”\nDòng 2: cột 1: “Hạn”; cột 2: 3');
  expect(text).toContain('Không làm lại các việc đã xong.');
});

it('never exposes step ids, references or JSON, and adds an optional note last', () => {
  const unresolved = { ...snapshot, steps: snapshot.steps.map(step => step.stepId === 'step_1' ? { ...step, output: null } : step) } as ExecutionSnapshot;
  const text = recoveryEditRequest(unresolved, 'step_2', { cardId: { $ref: 'step_1.output.id' }, memberId: 'minh', extra: { nested: true } }, '  Gán cho người trực tuần này  ');
  expect(text).not.toMatch(/step_\d|\$ref|\$template|[{}]|\$\{/);
  expect(text).toContain('- ID của thẻ Trello: (mã định danh của việc 1)');
  expect(text).toContain('- extra: thuộc tính “nested”: có');
  expect(text.trimEnd().split('\n').at(-1)).toBe('Ghi chú: Gán cho người trực tuần này');
});

it('omits the remaining-work section when nothing is pending and the note when blank', () => {
  const done = { ...snapshot, steps: snapshot.steps.map(step => step.status === 'pending' ? { ...step, status: 'skipped' } : step) } as ExecutionSnapshot;
  const text = recoveryEditRequest(done, 'step_2', { cardId: 'saved-card-123', memberId: 'minh' }, '   ');
  expect(text).not.toContain('Sau đó làm tiếp');
  expect(text).not.toContain('Ghi chú');
});

it('preserves literal Sheets cells and row boundaries when cells contain separators', () => {
  const oneRow = recoveryEditRequest(snapshot, 'step_4', { spreadsheetId: 'sheet-1', sheet: 'Tracker', rows: [['A, B', 'C / D', '']] });
  const twoRows = recoveryEditRequest(snapshot, 'step_4', { spreadsheetId: 'sheet-1', sheet: 'Tracker', rows: [['A', 'B', 'C'], ['D']] });
  expect(oneRow).not.toBe(twoRows);
  expect(oneRow).toContain('Dòng 1: cột 1: “A, B”; cột 2: “C / D”; cột 3: “”');
  expect(twoRows).toContain('Dòng 2: cột 1: “D”');
});

it('preserves literal template-looking content rather than treating it as a plan reference', () => {
  const text = recoveryEditRequest(snapshot, 'step_3', { channel: '#ati-test', text: 'Hướng dẫn: ${customer.name}' });
  expect(text).toContain('Hướng dẫn: ${customer.name}');
});

it('keeps the meaning of unresolved id, url and name output fields without technical paths', () => {
  const unresolved = { ...snapshot, steps: snapshot.steps.map(step => ({ ...step, output: null })) } as ExecutionSnapshot;
  const text = recoveryEditRequest(unresolved, 'step_3', { channel: '#ati-test', text: { $template: 'Mã ${step_2.output.id}; Link ${step_2.output.url}; Người ${step_2.output.fullName}' } });
  expect(text).toContain('Mã (mã định danh của việc 2); Link (liên kết của việc 2); Người (tên đầy đủ của việc 2)');
  expect(text).not.toMatch(/step_\d|\$template|\.output\.|fullName/);
});

it.each([
  [['member-a', 'member-b'], 'member-a,member-b'],
  [true, 'true'],
  [null, ''],
  [{ name: 'Minh' }, '[object Object]'],
  [2, '2'],
] as const)('uses executor interpolation for saved template output %j', (output, expected) => {
  const saved = {
    ...snapshot,
    plan: { ...snapshot.plan, steps: [
      { id: 'step_1', tool: 'trello.add_member', description: 'Đã gán người', args: {} },
      { id: 'step_2', tool: 'trello.create_card', description: 'Sửa thẻ', args: {} },
      { id: 'step_3', tool: 'slack.send_message', description: 'Báo nhóm', args: { channel: '#ati-test', text: { $template: 'Người: ${step_1.output.idMembers}.' } } },
    ] },
    steps: [
      { stepId: 'step_1', tool: 'trello.add_member', status: 'succeeded', output: { idMembers: output } },
      { stepId: 'step_2', tool: 'trello.create_card', status: 'failed' },
      { stepId: 'step_3', tool: 'slack.send_message', status: 'pending' },
    ],
  } as unknown as ExecutionSnapshot;
  const text = recoveryEditRequest(saved, 'step_2', { title: 'Thẻ đã sửa' });
  expect(text).toContain(`Nội dung tin nhắn cần gửi: Người: ${expected}.`);
});

it('keeps structured direct references distinct from template string interpolation', () => {
  const saved = { ...snapshot, steps: snapshot.steps.map(step => step.stepId === 'step_1' ? { ...step, output: { idMembers: ['member-a', 'member-b'] } } : step) } as ExecutionSnapshot;
  const text = recoveryEditRequest(saved, 'step_2', { idMembers: { $ref: 'step_1.output.idMembers' } });
  expect(text).toContain('mục 1: “member-a”; mục 2: “member-b”');
});

it.each([
  ['sheets.append_rows', { spreadsheetId: 'sheet-1', sheet: 'Tracker', rows: [['Task']] }, ['ID bảng tính', 'Tên trang tính', 'Các dòng cần thêm']],
  ['calendar.create_event', { calendarId: 'calendar-1', summary: 'Họp', start: '2026-10-08T09:00:00Z', end: '2026-10-08T10:00:00Z' }, ['ID lịch', 'Tiêu đề sự kiện', 'Thời gian bắt đầu', 'Thời gian kết thúc']],
  ['notion.create_page', { databaseId: 'database-1', title: 'Task', properties: { Status: 'Ready' } }, ['ID cơ sở dữ liệu Notion', 'Tiêu đề', 'Các thuộc tính']],
  ['telegram.send_message', { chatId: 'chat-1', text: 'Task' }, ['ID cuộc trò chuyện Telegram', 'Nội dung tin nhắn']],
  ['jira.create_issue', { projectKey: 'ATI', summary: 'Task', issueType: 'Bug' }, ['Mã dự án Jira', 'Tiêu đề công việc', 'Loại công việc']],
] as const)('uses human labels for %s without schema descriptions', (tool, args, labels) => {
  const saved = { ...snapshot, plan: { ...snapshot.plan, steps: [{ id: 'step_1', tool, description: 'Việc cần sửa', args: {} }] }, steps: [{ stepId: 'step_1', tool, status: 'failed' }] } as ExecutionSnapshot;
  const text = recoveryEditRequest(saved, 'step_1', args);
  for (const label of labels) expect(text).toContain(`- ${label}:`);
  expect(text).not.toMatch(/spreadsheetId:|calendarId:|databaseId:|chatId:|projectKey:|issueType:/);
});
