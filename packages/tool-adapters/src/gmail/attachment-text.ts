import { inflateRawSync, inflateSync } from 'node:zlib';

export const MAX_ATTACHMENT_READ_BYTES = 5 * 1024 * 1024;
export const MAX_FORWARD_ATTACHMENTS_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_ZIP_UNCOMPRESSED_BYTES = 15 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 8000;

export interface ExtractedAttachmentText {
  extracted: boolean;
  truncated: boolean;
  text: string;
}

function cutCodepoints(text: string, maxChars: number): { text: string; truncated: boolean } {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return { text, truncated: false };
  return { text: chars.slice(0, maxChars).join(''), truncated: true };
}

function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, dec) => {
      const cp = Number(dec);
      return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const cp = parseInt(hex, 16);
      return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    });
}

function stripHtml(html: string): string {
  return normalizeText(
    decodeXmlEntities(
      html
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote|section|article|header|footer|table|ul|ol)\s*>/gi, '\n')
        .replace(/<t[dh][^>]*>/gi, ' ')
        .replace(/<[^>]*>/g, ''),
    ),
  );
}

/**
 * Minimal ZIP reader supporting stored (0) and deflate (8) OOXML entries with zip-bomb bounds.
 */
function extractZipEntries(buf: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  // Locate End of Central Directory (0x06054b50) from the tail (max comment 65535 + 22 bytes).
  const minOffset = Math.max(0, buf.length - 65557);
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= minOffset; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return entries;

  const entryCount = Math.min(buf.readUInt16LE(eocdOffset + 10), 2048);
  let cdOffset = buf.readUInt32LE(eocdOffset + 16);
  let totalUncompressed = 0;

  for (let idx = 0; idx < entryCount && cdOffset + 46 <= buf.length; idx++) {
    if (buf.readUInt32LE(cdOffset) !== 0x02014b50) break;
    const method = buf.readUInt16LE(cdOffset + 10);
    const compressedSize = buf.readUInt32LE(cdOffset + 20);
    const uncompressedSize = buf.readUInt32LE(cdOffset + 24);
    const nameLen = buf.readUInt16LE(cdOffset + 28);
    const extraLen = buf.readUInt16LE(cdOffset + 30);
    const commentLen = buf.readUInt16LE(cdOffset + 32);
    const localHeaderOffset = buf.readUInt32LE(cdOffset + 42);
    const name = buf.subarray(cdOffset + 46, cdOffset + 46 + nameLen).toString('utf8');
    cdOffset += 46 + nameLen + extraLen + commentLen;

    const remainingBudget = MAX_ZIP_UNCOMPRESSED_BYTES - totalUncompressed;
    if (remainingBudget <= 0) break;
    if (name.endsWith('/') || uncompressedSize > remainingBudget) continue;
    if (localHeaderOffset + 30 > buf.length || buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) continue;

    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buf.length) continue;

    const rawSlice = buf.subarray(dataStart, dataEnd);
    let data: Buffer;
    if (method === 0) {
      if (rawSlice.length > remainingBudget) break;
      data = rawSlice;
    } else if (method === 8) {
      try {
        data = inflateRawSync(rawSlice, { maxOutputLength: remainingBudget });
      } catch {
        break;
      }
    } else {
      continue;
    }

    totalUncompressed += data.length;
    if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) break;
    entries.set(name, data);
  }
  return entries;
}

function extractDocxText(buf: Buffer): string {
  const entries = extractZipEntries(buf);
  const docXml = entries.get('word/document.xml')?.toString('utf8');
  if (!docXml) return '';
  return normalizeText(
    decodeXmlEntities(
      docXml
        .replace(/<w:tab[^>]*\/>/gi, '\t')
        .replace(/<w:br[^>]*\/>/gi, '\n')
        .replace(/<\/w:(?:p|tr)>/gi, '\n')
        .replace(/<\/w:tc>/gi, '\t')
        .replace(/<[^>]+>/g, ''),
    ),
  );
}

function extractXlsxText(buf: Buffer): string {
  const entries = extractZipEntries(buf);
  const sharedStrings: string[] = [];
  const sharedXml = entries.get('xl/sharedStrings.xml')?.toString('utf8');
  if (sharedXml) {
    const siMatches = sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi);
    for (const match of siMatches) {
      const runs = [...match[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((m) => decodeXmlEntities(m[1] ?? ''));
      sharedStrings.push(runs.join(''));
    }
  }

  const sheetNames = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const sections: string[] = [];
  for (const sheetPath of sheetNames) {
    const xml = entries.get(sheetPath)?.toString('utf8');
    if (!xml) continue;
    const rows: string[] = [];
    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
      const cells: string[] = [];
      for (const cellMatch of rowMatch[1]!.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
        const attrs = cellMatch[1] ?? '';
        const body = cellMatch[2] ?? '';
        const typeMatch = /\bt="([^"]+)"/i.exec(attrs)?.[1];
        if (typeMatch === 'inlineStr') {
          const text = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((m) => decodeXmlEntities(m[1] ?? '')).join('');
          cells.push(text);
        } else {
          const val = /<v\b[^>]*>([\s\S]*?)<\/v>/i.exec(body)?.[1] ?? '';
          if (typeMatch === 's') {
            const idx = Number(val);
            cells.push(Number.isInteger(idx) && sharedStrings[idx] !== undefined ? sharedStrings[idx]! : val);
          } else {
            cells.push(decodeXmlEntities(val));
          }
        }
      }
      if (cells.some((c) => c.length > 0)) rows.push(cells.join('\t'));
    }
    if (rows.length > 0) {
      const label = sheetPath.replace(/^xl\/worksheets\//i, '').replace(/\.xml$/i, '');
      sections.push(sheetNames.length > 1 ? `[${label}]\n${rows.join('\n')}` : rows.join('\n'));
    }
  }
  return normalizeText(sections.join('\n\n'));
}

function decodePdfLiteralString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next == null) break;
    i++;
    if (next === 'n') out += '\n';
    else if (next === 'r') out += '\r';
    else if (next === 't') out += '\t';
    else if (next === 'b') out += '\b';
    else if (next === 'f') out += '\f';
    else if (next === '\r' || next === '\n') {
      if (next === '\r' && raw[i + 1] === '\n') i++;
    } else if (/[0-7]/.test(next)) {
      let oct = next;
      if (raw[i + 1] && /[0-7]/.test(raw[i + 1]!)) { oct += raw[i + 1]; i++; }
      if (raw[i + 1] && /[0-7]/.test(raw[i + 1]!)) { oct += raw[i + 1]; i++; }
      out += String.fromCharCode(parseInt(oct, 8));
    } else {
      out += next;
    }
  }
  return out;
}

function decodePdfHexString(hexRaw: string): string {
  const clean = hexRaw.replace(/[^0-9a-fA-F]/g, '');
  if (!clean) return '';
  const padded = clean.length % 2 === 1 ? `${clean}0` : clean;
  const bytes = Buffer.from(padded, 'hex');
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
    }
    return out;
  }
  return bytes.toString('latin1');
}

function extractTextFromPdfContentStream(content: string): string {
  const chunks: string[] = [];
  for (const block of content.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)) {
    const body = block[1] ?? '';
    const lineParts: string[] = [];
    // Parse (...) Tj / [...] TJ / '...' / "..." text drawing operators sequentially.
    let i = 0;
    while (i < body.length) {
      const ch = body[i]!;
      if (ch === '(') {
        let depth = 1;
        let start = i + 1;
        i++;
        while (i < body.length && depth > 0) {
          if (body[i] === '\\') { i += 2; continue; }
          if (body[i] === '(') depth++;
          else if (body[i] === ')') depth--;
          i++;
        }
        const literal = decodePdfLiteralString(body.slice(start, i - 1));
        const rest = body.slice(i).trimStart();
        if (/^(?:Tj|['"])\b/.test(rest) || rest.startsWith("'") || rest.startsWith('"')) {
          lineParts.push(literal);
        }
        continue;
      }
      if (ch === '<' && body[i + 1] !== '<') {
        const end = body.indexOf('>', i + 1);
        if (end !== -1) {
          const hex = decodePdfHexString(body.slice(i + 1, end));
          i = end + 1;
          const rest = body.slice(i).trimStart();
          if (/^Tj\b/.test(rest)) lineParts.push(hex);
          continue;
        }
      }
      if (ch === '[') {
        const arrayStart = i + 1;
        i++;
        const arrayStrings: string[] = [];
        while (i < body.length && body[i] !== ']') {
          if (body[i] === '(') {
            const sStart = i + 1;
            let depth = 1;
            i++;
            while (i < body.length && depth > 0) {
              if (body[i] === '\\') { i += 2; continue; }
              if (body[i] === '(') depth++;
              else if (body[i] === ')') depth--;
              i++;
            }
            arrayStrings.push(decodePdfLiteralString(body.slice(sStart, i - 1)));
          } else if (body[i] === '<' && body[i + 1] !== '<') {
            const hEnd = body.indexOf('>', i + 1);
            if (hEnd !== -1) {
              arrayStrings.push(decodePdfHexString(body.slice(i + 1, hEnd)));
              i = hEnd + 1;
            } else i++;
          } else {
            i++;
          }
        }
        if (i < body.length && body[i] === ']') i++;
        if (body.slice(i).trimStart().startsWith('TJ') && arrayStart >= 0) {
          lineParts.push(arrayStrings.join(''));
        }
        continue;
      }
      i++;
    }
    const line = lineParts.join('').trim();
    if (line) chunks.push(line);
  }
  return normalizeText(chunks.join('\n'));
}

function isZlibBudgetError(err: unknown): boolean {
  return err instanceof RangeError || (err as { code?: string } | null)?.code === 'ERR_BUFFER_TOO_LARGE';
}

function inflatePdfStream(
  rawBytes: Buffer,
  maxOutputLength: number,
): { data: Buffer | null; budgetExceeded: boolean } {
  if (maxOutputLength <= 0) return { data: null, budgetExceeded: true };
  try {
    return { data: inflateSync(rawBytes, { maxOutputLength }), budgetExceeded: false };
  } catch (err) {
    if (isZlibBudgetError(err)) return { data: null, budgetExceeded: true };
    try {
      return { data: inflateRawSync(rawBytes, { maxOutputLength }), budgetExceeded: false };
    } catch (innerErr) {
      return { data: null, budgetExceeded: isZlibBudgetError(innerErr) };
    }
  }
}

function extractPdfText(buf: Buffer): string {
  const latin = buf.toString('latin1');
  const collected: string[] = [];
  let totalInflatedBytes = 0;

  for (const match of latin.matchAll(/<<([\s\S]*?)>>\s*stream\r?\n([\s\S]*?)endstream/g)) {
    const remainingBudget = MAX_ZIP_UNCOMPRESSED_BYTES - totalInflatedBytes;
    if (remainingBudget <= 0) break;
    const dict = match[1] ?? '';
    const streamStartInMatched = match[0].indexOf(match[2]!);
    if (streamStartInMatched === -1 || match.index === undefined) continue;
    const rawOffset = match.index + streamStartInMatched;
    let rawBytes = buf.subarray(rawOffset, rawOffset + match[2]!.length);
    // Trim trailing EOL right before endstream.
    if (rawBytes.length >= 2 && rawBytes[rawBytes.length - 2] === 0x0d && rawBytes[rawBytes.length - 1] === 0x0a) {
      rawBytes = rawBytes.subarray(0, rawBytes.length - 2);
    } else if (rawBytes.length >= 1 && (rawBytes[rawBytes.length - 1] === 0x0a || rawBytes[rawBytes.length - 1] === 0x0d)) {
      rawBytes = rawBytes.subarray(0, rawBytes.length - 1);
    }

    let decodedText = '';
    if (/\/FlateDecode\b/.test(dict)) {
      const inflated = inflatePdfStream(rawBytes, remainingBudget);
      if (inflated.budgetExceeded) break;
      if (inflated.data) {
        totalInflatedBytes += inflated.data.length;
        decodedText = inflated.data.toString('latin1');
      }
    } else {
      decodedText = rawBytes.toString('latin1');
    }
    if (decodedText.includes('BT') && decodedText.includes('ET')) {
      const part = extractTextFromPdfContentStream(decodedText);
      if (part) collected.push(part);
    }
  }

  // Fallback for plain/uncompressed BT..ET blocks outside dictionary-prefixed stream regex
  if (collected.length === 0 && latin.includes('BT') && latin.includes('ET')) {
    const fallback = extractTextFromPdfContentStream(latin);
    if (fallback) collected.push(fallback);
  }
  return normalizeText(collected.join('\n'));
}

export function extractAttachmentText(input: {
  filename: string;
  mimeType: string;
  bytes: Buffer;
}): ExtractedAttachmentText {
  const lowerName = input.filename.trim().toLowerCase();
  const mime = input.mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  let rawText = '';

  if (lowerName.endsWith('.docx') || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    rawText = extractDocxText(input.bytes);
  } else if (lowerName.endsWith('.xlsx') || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    rawText = extractXlsxText(input.bytes);
  } else if (lowerName.endsWith('.pdf') || mime === 'application/pdf') {
    rawText = extractPdfText(input.bytes);
  } else if (lowerName.endsWith('.html') || lowerName.endsWith('.htm') || mime === 'text/html') {
    rawText = stripHtml(input.bytes.toString('utf8'));
  } else if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/csv' ||
    /\.(?:txt|csv|tsv|md|markdown|json|xml|log|yaml|yml)$/i.test(lowerName)
  ) {
    rawText = normalizeText(input.bytes.toString('utf8'));
  } else {
    return {
      extracted: false,
      truncated: false,
      text: '[Định dạng tệp đính kèm không hỗ trợ trích xuất văn bản trực tiếp.]',
    };
  }

  if (!rawText) {
    return {
      extracted: false,
      truncated: false,
      text: '[Không trích xuất được văn bản từ tệp này (PDF dạng ảnh quét hoặc tệp rỗng).]',
    };
  }

  const cut = cutCodepoints(rawText, MAX_EXTRACTED_CHARS);
  return { extracted: true, truncated: cut.truncated, text: cut.text };
}
