import { expect, it } from 'vitest';
import { GMAIL_TOOLS } from '@wap/tool-schemas';
import { validatePlan } from '../src/index.js';

const plan = (to: any, extra: any = {}) => JSON.stringify({ kind: 'plan', thinking: 'Gửi', summary: 'Gửi', warnings: [],
  steps: [{ id: 'send', tool: 'gmail.send_message', description: 'Gửi', args: { to, subject: 'Họp', body: 'OK', ...extra }, dependsOn: [] }] });
const validate = (to: any, memory: any = {}, userTexts: string[] = [], extra: any = {}) => validatePlan(plan(to, extra), GMAIL_TOOLS, { grounding: { memory, userTexts } });
it.each([[{ $ref: 'draft.output.email' }], [{ $template: '${draft.output.email}' }], ['${draft.output.email}'], { $ref: 'draft.output.recipients' }])('rejects dynamic recipients even without grounding: %j', to => {
  expect(validatePlan(plan(to), GMAIL_TOOLS).valid).toBe(false);
});
it.each(['to', 'cc', 'bcc'])('rejects a dynamic address in %s even when user typed the placeholder', key => {
  expect(validatePlan(plan(['lan@example.com'], { [key]: ['${draft.output.email}'] }), GMAIL_TOOLS, { grounding: { memory: {}, userTexts: ['${draft.output.email} lan@example.com'] } }).valid).toBe(false);
});
it('accepts only exact addresses from real user messages, ignoring case and outer spaces', () => {
  expect(validate([' Lan@EXAMPLE.com '], {}, ['Gửi EMAIL cho lan@example.COM nhé.']).valid).toBe(true);
  expect(validate(['lan@example.com'], {}, ['Gửi cho evil+lan@example.com']).valid).toBe(false);
  expect(validate(['lan@example.com'], {}, ['Gửi cho lan@example.com.evil']).valid).toBe(false);
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
