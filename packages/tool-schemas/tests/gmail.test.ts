import { describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';
import {
  ALL_TOOLS, GMAIL_ADDRESS_PATTERN, GMAIL_MODIFY_SCOPE, GMAIL_SERVICE, GMAIL_TOOLS, SERVICE_REGISTRY, TOOL_MAP,
  getServiceDefinition, getToolDefinition,
} from '../src/index.js';

const tool = (name: string) => GMAIL_TOOLS.find((candidate) => candidate.name === name)!;
const ajv = new Ajv({ strict: false });

describe('Gmail tool catalog (kept outside ALL_TOOLS)', () => {
  it('publishes exactly the ten Gmail tools of the spec, none of which delete permanently', () => {
    expect(GMAIL_TOOLS.map((t) => t.name)).toEqual([
      'gmail.search_threads', 'gmail.get_thread', 'gmail.list_labels',
      'gmail.send_message', 'gmail.reply', 'gmail.forward', 'gmail.create_draft',
      'gmail.modify_thread_labels', 'gmail.trash_thread', 'gmail.create_label',
    ]);
    for (const t of GMAIL_TOOLS) {
      expect(t.service).toBe('gmail');
      ajv.compile(t.inputSchema); ajv.compile(t.outputSchema);
    }
    expect(GMAIL_TOOLS.filter((t) => t.sideEffect === 'read').map((t) => t.name))
      .toEqual(['gmail.search_threads', 'gmail.get_thread', 'gmail.list_labels']);
    expect(Object.fromEntries(GMAIL_TOOLS.filter((t) => t.sideEffect === 'write').map((t) => [t.name, t.riskLevel]))).toEqual({
      'gmail.send_message': 'high', 'gmail.reply': 'high', 'gmail.forward': 'high', 'gmail.create_draft': 'medium',
      'gmail.modify_thread_labels': 'low', 'gmail.trash_thread': 'medium', 'gmail.create_label': 'low',
    });
  });

  it('leaves the frozen 33-tool / 8-service catalog untouched', () => {
    expect(ALL_TOOLS).toHaveLength(33);
    expect(ALL_TOOLS.some((t) => t.service === 'gmail')).toBe(false);
    expect(Object.keys(TOOL_MAP).some((name) => name.startsWith('gmail.'))).toBe(false);
    expect(getToolDefinition('gmail.reply')).toBeUndefined();
    expect(SERVICE_REGISTRY).toHaveLength(8);
    expect(getServiceDefinition('gmail')).toBeUndefined();
    for (const service of SERVICE_REGISTRY) expect(service.connection, service.id).toBeUndefined();
  });

  it('keeps mail content out of working memory and out of the directory prefetch', () => {
    const search = tool('gmail.search_threads');
    expect(search).toMatchObject({ discovers: 'thread', observedFields: ['id', 'participants'] });
    expect(search.listable).not.toBe(true);
    const thread = tool('gmail.get_thread');
    expect(thread).toMatchObject({ discovers: 'thread', observedFields: ['id', 'participants'] });
    expect(thread.inputSchema.properties.threadId['x-resource']).toBe('thread');
    expect(tool('gmail.list_labels')).toMatchObject({ discovers: 'label', listable: true });
    // `title` and `name` are KEPT_FIELDS in the planner; Gmail outputs use `subject`.
    const summary = search.outputSchema.items.properties;
    for (const props of [summary, thread.outputSchema.properties, thread.outputSchema.properties.messages.items.properties]) {
      expect(props.subject).toBeDefined();
      expect(props.title).toBeUndefined();
      expect(props.name).toBeUndefined();
    }
    expect(summary.snippet.maxLength).toBe(200);
    expect(summary.participants).toMatchObject({ type: 'array', maxItems: 20 });
    expect(thread.outputSchema.properties.messages.maxItems).toBe(5);
    expect(thread.outputSchema.properties.messages.items.properties.body.maxLength).toBe(4000);
  });

  it('marks every recipient field as a literal-address list of at most 20', () => {
    const recipients: Record<string, string[]> = {
      'gmail.send_message': ['to', 'cc', 'bcc'], 'gmail.reply': ['to', 'cc'], 'gmail.forward': ['to', 'cc'],
      'gmail.create_draft': ['to', 'cc', 'bcc'],
    };
    for (const t of GMAIL_TOOLS) {
      const marked = Object.entries<Record<string, any>>(t.inputSchema.properties).filter(([, s]) => s['x-recipient']).map(([key]) => key);
      expect(marked, t.name).toEqual(recipients[t.name] ?? []);
      for (const key of marked) {
        expect(t.inputSchema.properties[key]).toMatchObject({ type: 'array', maxItems: 20, items: { type: 'string' } });
        expect(t.inputSchema.properties[key]['x-resource']).toBeUndefined();
      }
      expect(t.inputSchema.properties.from, t.name).toBeUndefined();
    }
    for (const name of ['gmail.reply', 'gmail.forward', 'gmail.modify_thread_labels', 'gmail.trash_thread']) {
      expect(tool(name).inputSchema.properties.threadId['x-resource'], name).toBe('thread');
    }
    const labels = tool('gmail.modify_thread_labels').inputSchema.properties;
    expect(labels.addLabelIds['x-resource']).toBe('label');
    expect(labels.removeLabelIds['x-resource']).toBe('label');
  });

  it('accepts bare addresses and rejects display names, header injection and oversized mail', () => {
    for (const address of ['a@example.com', '  Mixed.Case@Example.COM ']) expect(GMAIL_ADDRESS_PATTERN.test(address), address).toBe(true);
    for (const address of ['"Tên" <a@example.com>', 'Tên <a@example.com>', 'a@example.com\r\nBcc: x@evil.test', 'a@b', 'no-at-sign', 'a,b@example.com'])
      expect(GMAIL_ADDRESS_PATTERN.test(address), JSON.stringify(address)).toBe(false);
    const send = ajv.compile(tool('gmail.send_message').inputSchema);
    expect(send({ to: ['a@example.com'], subject: 'Lịch bảo trì 🛠', body: 'x'.repeat(20_000) })).toBe(true);
    for (const args of [
      { to: [], subject: 's', body: 'b' },
      { to: Array.from({ length: 21 }, (_, i) => `u${i}@example.com`), subject: 's', body: 'b' },
      { to: ['"Tên" <a@example.com>'], subject: 's', body: 'b' },
      { to: ['a@example.com'], subject: 's'.repeat(251), body: 'b' },
      { to: ['a@example.com'], subject: 's', body: 'x'.repeat(20_001) },
      { to: ['a@example.com'], subject: 's', body: 'b', from: 'boss@example.com' },
    ]) expect(send(args), JSON.stringify(args).slice(0, 80)).toBe(false);
    const modify = ajv.compile(tool('gmail.modify_thread_labels').inputSchema);
    expect(modify({ threadId: 't1', removeLabelIds: ['INBOX'] })).toBe(true);
    expect(modify({ threadId: 't1' })).toBe(false);
  });
});

describe('Gmail service definition', () => {
  it('is a personal connection with the single gmail.modify scope and no admin key fields', () => {
    expect(GMAIL_MODIFY_SCOPE).toBe('https://www.googleapis.com/auth/gmail.modify');
    expect(GMAIL_SERVICE).toMatchObject({
      id: 'gmail', name: 'Gmail', connection: 'personal', credentialFields: [],
      scopes: [GMAIL_MODIFY_SCOPE], scopeKey: 'mailbox', scopeLabel: 'Hộp thư Gmail của bạn',
      intentKeywords: ['gmail', 'email', 'e-mail', 'hộp thư', 'thư điện tử'],
    });
    expect(GMAIL_SERVICE.intentKeywords).not.toContain('thư');
    expect(GMAIL_SERVICE.fallbackIntentKeywords ?? []).toEqual([]);
  });

  it.each(['Gửi thư cho Lan', 'trả lời thư của khách', 'Chuyển tiếp thư này', 'có thư mới không', 'đọc thư chưa đọc'])(
    'selects Gmail for the mail phrase %s', (text) => {
      expect(GMAIL_SERVICE.intentPatterns!.some((pattern) => pattern.test(text))).toBe(true);
    });

  it.each(['mượn sách ở thư viện', 'gửi cho thư ký', 'nghe nhạc thư giãn', 'mở thư mục dự án'])(
    'does not select Gmail for the unrelated word %s', (text) => {
      expect(GMAIL_SERVICE.intentPatterns!.some((pattern) => pattern.test(text))).toBe(false);
      expect(GMAIL_SERVICE.intentKeywords.some((keyword) => text.toLowerCase().includes(keyword))).toBe(false);
    });
});
