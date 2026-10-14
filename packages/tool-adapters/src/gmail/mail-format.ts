import { GMAIL_ADDRESS_PATTERN } from '@wap/tool-schemas';
import { StepError } from '../base-adapter.js';

export const cut = (text: string, length: number): string => Array.from(text).slice(0, length).join('');
export function safeHeader(value: string): string {
  if (/[\r\n\x00]/.test(value)) throw new StepError({ category: 'VALIDATION', message: 'Gmail header contains CR/LF or NUL' });
  return value;
}
export function bareAddress(value: string): string {
  safeHeader(value);
  if (!GMAIL_ADDRESS_PATTERN.test(value) || value.includes('${') || value.length > 320) {
    throw new StepError({ category: 'VALIDATION', message: 'Gmail requires a bare email address' });
  }
  return value.trim().toLowerCase();
}
export interface GmailMessage { id: string; internalDate?: string; labelIds?: string[]; snippet?: string; payload?: GmailPart }
export interface GmailPart { mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { data?: string; size?: number; attachmentId?: string }; parts?: GmailPart[] }
export interface GmailThread { id: string; messages?: GmailMessage[] }
export const header = (message: GmailMessage, name: string): string => message.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
/** Header addresses only. Display names, comments and quoted commas never become participants. */
export function headerAddresses(value: string): string[] {
  if (/[\r\n\x00]/.test(value)) return [];
  const found: string[] = [];
  const mailboxes: { text: string; quoted: boolean }[] = [];
  let text = '', quoted = false, inQuote = false, escaped = false, commentDepth = 0;
  for (const char of value) {
    if (escaped) { escaped = false; continue; }
    if ((inQuote || commentDepth > 0) && char === '\\') { escaped = true; continue; }
    if (commentDepth > 0) {
      if (char === '(') commentDepth++;
      if (char === ')') commentDepth--;
      continue;
    }
    if (char === '"') { inQuote = !inQuote; quoted = true; text += ' '; continue; }
    if (inQuote) continue;
    if (char === '(') { commentDepth = 1; text += ' '; continue; }
    if (char === ',') { mailboxes.push({ text, quoted }); text = ''; quoted = false; continue; }
    text += char;
  }
  if (inQuote || commentDepth > 0 || escaped) return [];
  mailboxes.push({ text, quoted });
  for (const mailbox of mailboxes) {
    const angle = /^[^<>]*<([^<>]+)>\s*$/.exec(mailbox.text);
    const candidate = angle?.[1] ?? (!mailbox.quoted && !/[<>]/.test(mailbox.text) ? mailbox.text : undefined);
    if (candidate === undefined) continue;
    try { const address = bareAddress(candidate); if (!found.includes(address)) found.push(address); } catch { /* untrusted/invalid header */ }
  }
  return found;
}
export function participants(messages: GmailMessage[]): string[] {
  return [...new Set(messages.flatMap(m => ['From', 'To', 'Cc'].flatMap(n => headerAddresses(header(m, n)))))].slice(0, 20);
}
export function messageText(message: GmailMessage): string {
  const plain: string[] = [], html: string[] = [];
  function visit(part?: GmailPart) {
    if (!part || part.filename || part.body?.attachmentId) return;
    if (part.body?.data && (part.mimeType === 'text/plain' || part.mimeType === 'text/html')) {
      const value = Buffer.from(part.body.data, 'base64url').toString('utf8');
      (part.mimeType === 'text/plain' ? plain : html).push(value);
    }
    part.parts?.forEach(visit);
  }
  visit(message.payload);
  return plain.length ? plain.join('\n') : html.join('\n').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/g, "'");
}
export function attachments(part?: GmailPart): { filename: string; size: number }[] {
  if (!part) return [];
  return [...(part.filename ? [{ filename: part.filename, size: part.body?.size ?? 0 }] : []), ...(part.parts?.flatMap(attachments) ?? [])];
}
function encodeSubject(subject: string): string {
  safeHeader(subject);
  if (/^[\x20-\x7e]*$/.test(subject)) return subject;
  const words: string[] = []; let chunk = '';
  for (const char of subject) {
    if (Buffer.byteLength(chunk + char) > 42) { words.push(`=?UTF-8?B?${Buffer.from(chunk).toString('base64')}?=`); chunk = ''; }
    chunk += char;
  }
  if (chunk) words.push(`=?UTF-8?B?${Buffer.from(chunk).toString('base64')}?=`);
  return words.join('\r\n ');
}
export function rawMessage(args: { to?: string[]; cc?: string[]; bcc?: string[]; subject: string; body: string; inReplyTo?: string; references?: string }): string {
  const headers = ['MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'];
  for (const [name, list] of [['To', args.to], ['Cc', args.cc], ['Bcc', args.bcc]] as const) {
    if (list?.length) headers.push(`${name}: ${list.join(', ')}`);
  }
  headers.push(`Subject: ${encodeSubject(args.subject)}`);
  if (args.inReplyTo) headers.push(`In-Reply-To: ${safeHeader(args.inReplyTo)}`);
  if (args.references) headers.push(`References: ${safeHeader(args.references)}`);
  const body = Buffer.from(args.body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? '';
  return Buffer.from(headers.join('\r\n') + '\r\n\r\n' + body, 'utf8').toString('base64url');
}
