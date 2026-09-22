export const SOURCE_COLUMNS = [
  'request_id',
  'client_ref',
  'request_type',
  'raw_request',
  'deliverable',
  'due_date',
  'decision_status',
  'source_note',
] as const;

export type SourceColumn = typeof SOURCE_COLUMNS[number];
export type SourceRow = Record<SourceColumn, string>;

export function parseRequest(values: unknown, requestId: string): SourceRow {
  if (!Array.isArray(values)) throw new Error('VALUES_TYPE');
  if (values.length > 101) throw new Error('ROW_LIMIT');
  const header: unknown = values[0];
  if (
    !Array.isArray(header) ||
    header.length !== SOURCE_COLUMNS.length ||
    !SOURCE_COLUMNS.every((name, index) => header[index] === name)
  ) {
    throw new Error('HEADERS');
  }

  const ids = new Set<string>();
  const parsed: SourceRow[] = [];

  for (let index = 1; index < values.length; index++) {
    const raw: unknown = values[index];
    if (!Array.isArray(raw)) throw new Error('ROW_TYPE');
    if (raw.length > SOURCE_COLUMNS.length) throw new Error('EXTRA_COLUMNS');

    const cells: string[] = [];
    let characters = 0;
    for (const cell of raw as unknown[]) {
      if (typeof cell !== 'string') throw new Error('CELL_TYPE');
      for (const _character of cell) {
        characters += 1;
        if (characters > 16000) throw new Error('TEXT_LIMIT');
      }
      cells.push(cell);
    }

    if (cells.every((c) => c === '')) continue;

    const row = Object.fromEntries(
      SOURCE_COLUMNS.map((c, i) => [c, cells[i] ?? '']),
    ) as SourceRow;

    if (!row.request_id || row.request_id !== row.request_id.trim()) {
      throw new Error('INVALID_ID');
    }
    if (ids.has(row.request_id)) throw new Error('DUPLICATE_ID');
    ids.add(row.request_id);

    if (!['web_change', 'design_asset'].includes(row.request_type)) {
      throw new Error('REQUEST_TYPE');
    }

    parsed.push(row);
  }

  const selected = parsed.find((row) => row.request_id === requestId);
  if (!selected) throw new Error('NOT_FOUND');
  return selected;
}
