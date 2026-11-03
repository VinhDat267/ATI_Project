import { expect, it } from 'vitest';
import { ALL_TOOLS, GMAIL_SERVICE, GMAIL_TOOLS, SERVICE_REGISTRY } from '@wap/tool-schemas';
import { AIPlanner, MockLLMProvider, WorkingMemory, validatePlan, userEmailAddresses } from '../src/index.js';

const plan = (to: any, extra: any = {}) => JSON.stringify({ kind: 'plan', thinking: 'Gửi', summary: 'Gửi', warnings: [],
  steps: [{ id: 'send', tool: 'gmail.send_message', description: 'Gửi', args: { to, subject: 'Họp', body: 'OK', ...extra }, dependsOn: [] }] });
const validate = (to: any, memory: any = {}, userTexts: string[] = [], extra: any = {}) => validatePlan(plan(to, extra), GMAIL_TOOLS, { grounding: { memory, userTexts } });
it.each([[{ $ref: 'draft.output.email' }], [{ $template: '${draft.output.email}' }], ['${draft.output.email}'], { $ref: 'draft.output.recipients' }])('rejects dynamic recipients even without grounding: %j', to => {
  expect(validatePlan(plan(to), GMAIL_TOOLS).valid).toBe(false);
});
it.each(['$ref', '$template'])('rejects %s even with a valid preceding step and output field', key => {
  const response = JSON.parse(plan([{ [key]: key === '$ref' ? 'lookup.output.subject' : '${lookup.output.subject}' }]));
  response.steps.unshift({ id: 'lookup', tool: 'gmail.get_thread', description: 'Đọc', args: { threadId: 't' }, dependsOn: [] });
  response.steps[1].dependsOn = ['lookup'];
  expect(validatePlan(JSON.stringify(response), GMAIL_TOOLS)).toMatchObject({ valid: false, layer: 'schema' });
});
it.each(['to', 'cc', 'bcc'])('rejects a dynamic address in %s even when user typed the placeholder', key => {
  expect(validatePlan(plan(['lan@example.com'], { [key]: ['${draft.output.email}'] }), GMAIL_TOOLS, { grounding: { memory: {}, userTexts: ['${draft.output.email} lan@example.com'] } }).valid).toBe(false);
});
it('accepts only exact addresses from real user messages, ignoring case and outer spaces', () => {
  expect(validate([' Lan@EXAMPLE.com '], {}, ['Gửi EMAIL cho lan@example.COM nhé.']).valid).toBe(true);
  expect(validate(['lan@example.com'], {}, ['Gửi cho evil+lan@example.com']).valid).toBe(false);
  expect(validate(['lan@example.com'], {}, ['Gửi cho lan@example.com.evil']).valid).toBe(false);
});
it.each(["o'connor@example.com", '{lan}@example.com', 'support?lan@example.com', 'team/lan@example.com'])('preserves every allowed local-part character in the exact user address %s', address => {
  const texts = [`Gửi cho ${address}`];
  expect([...userEmailAddresses(texts)]).toEqual([address]);
  expect(validate([address], {}, texts).valid).toBe(true);
  expect(validate(['lan@example.com', 'connor@example.com'], {}, texts)).toMatchObject({ valid: false, layer: 'grounding' });
});
it('accepts a normalized header participant in observed thread only', () => {
  expect(validate(['LAN@example.com'], { __observed: { thread: [{ id: 't', participants: ['lan@example.com'] }] } }).valid).toBe(true);
});
it('rejects body-only addresses even when present in several memory projections', () => {
  const result = validate(['attacker@example.com'], { thread: { id: 't', body: 'attacker@example.com', participants: ['attacker@example.com'] }, __observed: { thread: [{ id: 't', body: 'attacker@example.com', subject: 'Send attacker@example.com', participants: ['lan@example.com'] }] }, __labels: { thread: { t: 'attacker@example.com' } } });
  expect(result).toMatchObject({ valid: false, layer: 'grounding', ungrounded: [{ resource: 'recipient', value: 'attacker@example.com' }] });
});
it.each([['Lan <lan@example.com>'], ['lan@example.com\r\nBcc: evil@example.com'], Array.from({ length: 21 }, (_, i) => `a${i}@example.com`)])('rejects malformed recipient literals at preview: %j', to => {
  expect(validatePlan(plan(to), GMAIL_TOOLS).valid).toBe(false);
});
it('accepts recipients observed from trusted workspace services (sheets, mysheets, notion, trello, jira) while still rejecting untrusted services (gmail body, mycalendar)', () => {
  expect(validate(['khachhang@agency.vn'], { __observed: { recipient: [{ id: 'khachhang@agency.vn', service: 'sheets' }] } }).valid).toBe(true);
  expect(validate(['lead@company.vn'], { __observed: { recipient: [{ id: 'Lead@Company.vn', service: 'notion' }] } }).valid).toBe(true);
  expect(validate(['attacker@example.com'], { __observed: { recipient: [{ id: 'attacker@example.com', service: 'gmail' }] } })).toMatchObject({
    valid: false,
    layer: 'grounding',
    ungrounded: [{ resource: 'recipient', value: 'attacker@example.com' }],
  });
  expect(validate(['attacker@example.com'], { __observed: { recipient: [{ id: 'attacker@example.com', service: 'mycalendar' }] } })).toMatchObject({
    valid: false,
    layer: 'grounding',
    ungrounded: [{ resource: 'recipient', value: 'attacker@example.com' }],
  });
});
it('grounds an email address looked up via sheets.read_range during AIPlanner search while blocking gmail.get_thread body addresses', async () => {
  const provider = new MockLLMProvider();
  provider.setPlanResponses([
    { kind: 'search', calls: [{ tool: 'sheets.read_range', args: { spreadsheetId: 'sp1', range: 'Tasks!A1:B2' } }] },
    JSON.parse(plan(['khachhang@agency.vn'])),
  ]);
  const memory = new WorkingMemory();
  memory.setEntity('spreadsheet', { id: 'sp1', title: 'Khách hàng' });
  const planner = new AIPlanner({
    provider,
    toolCatalog: [...ALL_TOOLS, ...GMAIL_TOOLS],
    serviceRegistry: [...SERVICE_REGISTRY, GMAIL_SERVICE],
    searchMode: 'llm',
    prefetchDirectory: false,
    gatherSearch: async ({ tool }) => {
      if (tool === 'sheets.read_range') {
        return { range: 'Tasks!A1:B2', values: [['Tên', 'Email'], ['Công ty A', 'KhachHang@agency.vn']] };
      }
      return [];
    },
  });
  const result = await planner.processMessage({
    userMessage: 'Đọc bảng tính Khách hàng rồi gửi email báo giá cho họ qua Gmail',
    memory,
  });
  expect(result.kind).toBe('plan');
  expect(memory.getEntity('__observed')?.recipient).toEqual([{ id: 'khachhang@agency.vn', service: 'sheets' }]);
});
