import { StepError } from '../base-adapter.js';
import { encodeSubject, headerAddresses } from './mail-format.js';

type Header = { name: string; line: string };
type Recipients = { to?: string[]; cc?: string[]; bcc?: string[] };
const recipientFields = ['to', 'cc', 'bcc'] as const;
const headerNames = { to: 'To', cc: 'Cc', bcc: 'Bcc' };

function invalidMime(): never {
  throw new StepError({
    category: 'VALIDATION',
    message: 'Không thể chỉnh sửa hoặc xác minh định dạng thư nháp này. Hãy mở thư nháp trong Gmail.',
  });
}

// Latin-1 is only used as a reversible byte representation. MIME payloads and
// folded headers that were not edited are copied without re-encoding.
function splitEntity(entity: string) {
  const separator = /\r\n\r\n|\n\n/.exec(entity);
  if (!separator) invalidMime();
  const eol = separator[0].startsWith('\r') ? '\r\n' : '\n';
  const headers = entity.slice(0, separator.index).split(/\r?\n(?![\t ])/).map(line => {
    const name = /^([\x21-\x39\x3b-\x7e]+):/.exec(line)?.[1]?.toLowerCase();
    if (!name) invalidMime();
    return { name, line };
  });
  return { headers, eol, body: entity.slice(separator.index + separator[0].length) };
}

function getHeader(headers: Header[], name: string): string {
  const matches = headers.filter(header => header.name === name);
  if (matches.length > 1) invalidMime();
  return matches[0]?.line.slice(name.length + 1).replace(/\r?\n[\t ]+/g, ' ').trim() ?? '';
}

function setHeader(headers: Header[], name: string, line?: string): void {
  const lower = name.toLowerCase();
  getHeader(headers, lower);
  const index = headers.findIndex(header => header.name === lower);
  const replacement = line === undefined ? [] : [{ name: lower, line: `${name}: ${line}` }];
  if (index >= 0) headers.splice(index, 1, ...replacement);
  else headers.push(...replacement);
}

function assemble({ headers, eol, body }: ReturnType<typeof splitEntity>): string {
  return headers.map(header => header.line).join(eol) + eol + eol + body;
}

export function verifyDraftRecipients(raw: Buffer, approved: Recipients): void {
  const { headers } = splitEntity(raw.toString('latin1'));
  if (headers.some(({ name }) => /^resent-(?:to|cc|bcc)$/.test(name))) invalidMime();
  for (const field of recipientFields) {
    const value = Buffer.from(getHeader(headers, field), 'latin1').toString('utf8');
    const actual = new Set(headerAddresses(value, true));
    const expected = new Set(approved[field] ?? []);
    if (actual.size !== expected.size || [...actual].some(address => !expected.has(address))) {
      throw new StepError({ category: 'VALIDATION', message: 'Người nhận trong thư nháp Gmail không khớp với bản xem trước.' });
    }
  }
}

function rewriteText(entity: ReturnType<typeof splitEntity>, text: string, depth = 0): string {
  if (depth > 32) invalidMime();
  const contentType = getHeader(entity.headers, 'content-type');
  const mime = contentType.split(';')[0]?.trim().toLowerCase() || 'text/plain';
  const disposition = getHeader(entity.headers, 'content-disposition');
  if (/^attachment\b|;\s*filename\*?\s*=/i.test(disposition) || /;\s*name\*?\s*=/i.test(contentType)) invalidMime();
  if (mime === 'text/plain' || mime === 'text/html') {
    const content = mime === 'text/plain' ? text : `<pre>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
    setHeader(entity.headers, 'Content-Type', `${mime}; charset=UTF-8`);
    setHeader(entity.headers, 'Content-Transfer-Encoding', 'base64');
    return Buffer.from(content.replace(/\r?\n/g, '\r\n')).toString('base64').match(/.{1,76}/g)?.join(entity.eol) ?? '';
  }

  if (!['multipart/mixed', 'multipart/alternative', 'multipart/related'].includes(mime)) invalidMime();
  const boundaryMatch = /;\s*boundary\s*=\s*(?:"([^"\\\r\n]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary || boundary.length > 70) invalidMime();
  const escapedBoundary = boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const markers = [...entity.body.matchAll(new RegExp(`^--${escapedBoundary}(--)?[\\t ]*(?:\\r?\\n|$)`, 'gm'))];
  const closing = markers.findIndex(marker => marker[1]);
  if (closing < 1) invalidMime();
  const startMatch = /;\s*start\s*=\s*(?:"([^"\r\n]+)"|([^;\s]+))/i.exec(contentType);
  const startId = startMatch?.[1] ?? startMatch?.[2];
  const partsToEdit = mime === 'multipart/alternative' ? closing : 1;
  let out = '';
  let offset = 0;
  for (let i = 0; i < partsToEdit; i++) {
    const marker = markers[i]!;
    const start = marker.index + marker[0].length;
    const end = markers[i + 1]!.index;
    const part = entity.body.slice(start, end);
    const ending = /\r?\n$/.exec(part)?.[0] ?? '';
    const parsed = splitEntity(ending ? part.slice(0, -ending.length) : part);
    if (mime === 'multipart/related' && startId && getHeader(parsed.headers, 'content-id') !== startId) invalidMime();
    parsed.body = rewriteText(parsed, text, depth + 1);
    out += entity.body.slice(offset, start) + assemble(parsed) + ending;
    offset = end;
  }
  return out + entity.body.slice(offset);
}

export function patchDraftMime(raw: Buffer, patch: Recipients & { subject?: string; body?: string }): string {
  const entity = splitEntity(raw.toString('latin1'));
  for (const field of recipientFields) {
    if (patch[field] === undefined) continue;
    const value = Buffer.from(patch[field].join(', '), 'utf8').toString('latin1');
    setHeader(entity.headers, headerNames[field], value || undefined);
  }
  if (patch.subject !== undefined) setHeader(entity.headers, 'Subject', encodeSubject(patch.subject));
  if (patch.body !== undefined) entity.body = rewriteText(entity, patch.body);
  return Buffer.from(assemble(entity), 'latin1').toString('base64url');
}
