import { expect, it } from 'vitest';
import { Ajv } from 'ajv';
import { ALL_TOOLS, getServiceDefinition } from '../src/index.js';

it('publishes only allowlisted chat discovery and a grounded plain-text send contract', () => {
  const tools = ALL_TOOLS.filter(t => t.service === 'telegram');
  expect(tools.map(t => t.name)).toEqual(['telegram.list_chats', 'telegram.send_message']);
  const ajv = new Ajv({ strict: false });
  for (const t of tools) { ajv.compile(t.inputSchema); ajv.compile(t.outputSchema); }
  expect(tools[0]).toMatchObject({ sideEffect: 'read', riskLevel: 'low', discovers: 'chat', listable: true });
  expect(tools[1]).toMatchObject({ sideEffect: 'write', riskLevel: 'medium' });
  expect(tools[1]!.inputSchema.properties.chatId['x-resource']).toBe('chat');
  const list = ajv.compile(tools[0]!.inputSchema);
  expect(list({ query: '', limit: 10 })).toBe(true);
  expect(list({ limit: 10 })).toBe(false); expect(list({ query: '', limit: 11 })).toBe(false);
  const send = ajv.compile(tools[1]!.inputSchema);
  expect(send({ chatId: '-1001234567890', text: 'x'.repeat(4096) })).toBe(true);
  for (const args of [{ chatId: '@outside', text: 'x' }, { chatId: '1', text: '' }, { chatId: '1', text: 'x'.repeat(4097) }, { chatId: '1', text: 'x', parse_mode: 'HTML' }]) expect(send(args)).toBe(false);
  const result = ajv.compile(tools[1]!.outputSchema);
  expect(result({ messageId: 42, chatId: '-1001234567890', date: 1791014400 })).toBe(true);
  expect(result({ messageId: 42, chatId: -1001234567890, date: 1791014400 })).toBe(false);
});

it('registers numeric Chat ID scope and only the explicit Telegram keyword', () => {
  const service = getServiceDefinition('telegram'); expect(service).toBeDefined();
  expect(service).toMatchObject({ scopeKey: 'chats', scopeLabel: 'Chat ID', intentKeywords: ['telegram'], credentialFields: [{ key: 'botToken', type: 'password' }] });
  expect(service!.fallbackIntentKeywords ?? []).toEqual([]);
  for (const id of ['123', '-1001234567890', '9'.repeat(20)]) expect(service!.scopePattern!.test(id)).toBe(true);
  for (const id of ['', '@test', '+12', '1.2', '1e3', '9'.repeat(21)]) expect(service!.scopePattern!.test(id)).toBe(false);
});
