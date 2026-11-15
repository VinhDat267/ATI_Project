import { describe, expect, it } from 'vitest';
import { createGmailToolAdapter } from '../src/gmail/gmail-adapter.js';

const to = ['lan@example.com'];
const plainDraft = (body: string) => `To: ${to[0]}\r\nSubject: Original\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`;
const raw = (mime: string) => Buffer.from(mime).toString('base64url');

function fixture(mime = plainDraft('Approved draft')) {
  const requests: { path: string; method: string; body: any }[] = [];
  const delivered = (id: string, body: string, withAttachment = false) => ({
    id,
    labelIds: ['INBOX'],
    payload: {
      headers: [{ name: 'Subject', value: 'Original' }, { name: 'From', value: 'source@example.com' }],
      parts: [
        { mimeType: 'text/plain', body: { data: raw(body) } },
        ...(withAttachment ? [{ mimeType: 'text/plain', filename: `${id}.txt`, body: { size: 5, data: raw('hello') } }] : []),
      ],
    },
  });
  const original = delivered('message-1', 'Approved forwarded body', true);
  const state = {
    draftId: 'draft-1', revision: 'revision-1', mime, messages: [original],
    afterDraftRead: undefined as (() => void) | undefined,
  };
  const adapter = createGmailToolAdapter({
    tokens: { getAccessToken: async () => 'fixture-token' },
    fetchFn: async (url, init) => {
      const parsed = new URL(String(url));
      const path = parsed.pathname.split('/users/me/')[1]!;
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ path, method, body });
      if (path === 'threads/thread-1') return Response.json({ id: 'thread-1', messages: state.messages });
      if (path === 'drafts/draft-1' && method === 'GET') {
        const result = Response.json({ id: state.draftId, message: {
          ...delivered(state.revision, 'Approved draft', false), threadId: 'thread-1', raw: raw(state.mime),
        } });
        state.afterDraftRead?.();
        return result;
      }
      if (method === 'PUT') return Response.json({ id: 'draft-1', message: { id: 'revision-2', threadId: 'thread-1' } });
      return Response.json({ id: 'sent-1', threadId: 'thread-1' });
    },
  });
  return { adapter, state, requests, delivered };
}

describe('approved Gmail message versions', () => {
  it('checks the approved draft revision and sends the exact approved MIME', async () => {
    const { adapter, state, requests } = fixture();
    const args = { draftId: 'draft-1', to };
    const approvedSource = await adapter.execute('gmail.prepare_write', { tool: 'gmail.send_draft', args });
    expect(approvedSource).toMatchObject({ messageId: 'revision-1', subject: 'Original', body: 'Approved draft' });

    state.revision = 'revision-2';
    state.mime = plainDraft('Different content with the same recipient');
    await expect(adapter.execute('gmail.send_draft', { ...args, approvedSource })).rejects.toMatchObject({
      category: 'VALIDATION', details: { requestSent: false },
    });
    expect(requests.every(request => request.method === 'GET')).toBe(true);

    state.revision = 'revision-1';
    const approvedMime = plainDraft('Approved draft');
    state.mime = approvedMime;
    state.afterDraftRead = () => {
      state.revision = 'revision-3';
      state.mime = plainDraft('Changed while sending').replace(to[0]!, 'other@example.com');
    };
    await adapter.execute('gmail.send_draft', { ...args, approvedSource });
    expect(requests.at(-1)).toMatchObject({
      path: 'drafts/send', method: 'POST', body: { id: 'draft-1', message: { raw: raw(approvedMime) } },
    });
  });

  it('forwards the previewed message and attachment when a new message arrives', async () => {
    const { adapter, state, requests, delivered } = fixture();
    const args = { threadId: 'thread-1', to, includeAttachments: true };
    const approvedSource = await adapter.execute('gmail.prepare_write', { tool: 'gmail.forward', args });
    expect(approvedSource).toMatchObject({ messageId: 'message-1', attachments: [{ filename: 'message-1.txt', size: 5 }] });
    state.messages.push(delivered('message-2', 'Other body', true));

    await adapter.execute('gmail.forward', { ...args, approvedSource });
    const mime = Buffer.from(requests.at(-1)?.body.raw, 'base64url').toString();
    expect(mime).toContain('filename="message-1.txt"');
    expect(mime).not.toContain('message-2.txt');
  });

  it('updates just the requested headers, preserving the multipart draft body byte for byte', async () => {
    const parts = [
      '--bound', 'Content-Type: text/html; charset=utf-8', '', '<b>Styled body</b>',
      '--bound', 'Content-Type: image/png', 'Content-ID: <image>', 'Content-Disposition: inline; filename="photo.png"',
      'Content-Transfer-Encoding: base64', '', 'SGVsbG8=', '--bound--', '',
    ].join('\r\n');
    const { adapter, requests } = fixture(
      `To: ${to[0]}\r\nBcc: keep@example.com\r\nSubject: Original\r\nContent-Type: multipart/related; boundary="bound"\r\n\r\n${parts}`,
    );
    const args = { draftId: 'draft-1', subject: 'Updated' };
    const approvedSource = await adapter.execute('gmail.prepare_write', { tool: 'gmail.update_draft', args });
    await adapter.execute('gmail.update_draft', { ...args, approvedSource });
    const mime = Buffer.from(requests.at(-1)?.body.message.raw, 'base64url').toString();
    expect(mime.slice(mime.indexOf('\r\n\r\n') + 4)).toBe(parts);
    expect(mime).toContain('Subject: Updated\r\n');
    expect(mime).toContain('Bcc: keep@example.com\r\n');
  });

  it('updates the body parts in a multipart draft and keeps the attachment and reply headers', async () => {
    const attachment = [
      '--outer', 'Content-Type: text/plain; name="attachment.txt"', 'Content-Disposition: attachment; filename="attachment.txt"',
      'Content-Transfer-Encoding: base64', '', 'dGV4dA==', '--outer--', '',
    ].join('\r\n');
    const mime = [
      `To: ${to[0]}`, 'Subject: Original', 'In-Reply-To: <original@example.com>',
      'Content-Type: multipart/mixed; boundary="outer"', '', '--outer',
      'Content-Type: multipart/alternative; boundary="alternative"', '',
      '--alternative', 'Content-Type: text/plain', '', 'old text',
      '--alternative', 'Content-Type: text/html', '', '<b>old text</b>',
      '--alternative--', attachment,
    ].join('\r\n');
    const { adapter, requests } = fixture(mime);
    const args = { draftId: 'draft-1', body: 'New <message>' };
    const approvedSource = await adapter.execute('gmail.prepare_write', { tool: 'gmail.update_draft', args });
    await adapter.execute('gmail.update_draft', { ...args, approvedSource });
    const updated = Buffer.from(requests.at(-1)?.body.message.raw, 'base64url').toString();
    expect(updated).toContain('In-Reply-To: <original@example.com>');
    expect(updated).toContain(Buffer.from(args.body).toString('base64'));
    expect(updated).toContain(Buffer.from('<pre>New &lt;message&gt;</pre>').toString('base64'));
    expect(updated).not.toContain('old text');
    expect(updated.endsWith(attachment)).toBe(true);
  });
});
