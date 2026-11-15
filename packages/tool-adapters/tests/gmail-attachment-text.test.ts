import { crc32 } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { extractAttachmentText } from '../src/gmail/attachment-text.js';

function workbook(entries: Record<string, string>) {
  const files: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [filename, xml] of Object.entries(entries)) {
    const name = Buffer.from(filename);
    const data = Buffer.from(xml);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    files.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    local.copy(central, 6, 4, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const index = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(directory.length / 2, 8);
  end.writeUInt16LE(directory.length / 2, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(offset, 16);
  return { filename: 'report.xlsx', mimeType: '', bytes: Buffer.concat([...files, index, end]) };
}

describe('Gmail XLSX attachment extraction', () => {
  it('stops expanding repeated shared text once the excerpt is full', () => {
    const productNotes = '📦'.repeat(5_000);
    const input = workbook({
      'xl/sharedStrings.xml': `<sst><si><t>${productNotes}</t></si></sst>`,
      'xl/worksheets/sheet1.xml': `<worksheet><row>${'<c t="s"><v>0</v></c>'.repeat(8)}</row></worksheet>`,
    });
    // The previous extractor materializes an array of code points for the entire rendered sheet.
    const arrayFrom = vi.spyOn(Array, 'from');
    const { result, renderSizes } = (() => {
      try {
        const result = extractAttachmentText(input);
        const renderSizes = arrayFrom.mock.calls.flatMap(([value]) => typeof value === 'string' ? [value.length] : []);
        return { result, renderSizes };
      } finally {
        arrayFrom.mockRestore();
      }
    })();
    expect(result).toEqual({ extracted: true, truncated: true, text: `${productNotes}\t${'📦'.repeat(2_999)}` });
    expect(renderSizes.every((size) => size <= 16_002)).toBe(true);
  });

  it('preserves worksheet labels, tabs, blank cells and row spacing', () => {
    expect(extractAttachmentText(workbook({
      'xl/worksheets/sheet1.xml': '<worksheet><row><c></c><c t="inlineStr"><is><t>Ref &amp; SKU  &#13;</t></is></c></row><row><c><v>7</v></c><c><v>21</v></c></row></worksheet>',
      'xl/worksheets/sheet2.xml': '<worksheet><row><c t="inlineStr"><is><t> Total </t></is></c></row></worksheet>',
    }))).toEqual({ extracted: true, truncated: false, text: '[sheet1]\n\tRef & SKU\n7\t21\n\n[sheet2]\n Total' });
  });

  it('counts exactly 8,000 code points followed by only whitespace as a complete excerpt', () => {
    const notes = '📦'.repeat(8_000);
    expect(extractAttachmentText(workbook({
      'xl/sharedStrings.xml': `<sst><si><t>${' '.repeat(5_000)}</t></si></sst>`,
      'xl/worksheets/sheet1.xml': `<worksheet><row><c><v>${notes}</v></c>${'<c t="s"><v>0</v></c>'.repeat(4)}</row></worksheet>`,
    }))).toEqual({ extracted: true, truncated: false, text: notes });
  });
});
