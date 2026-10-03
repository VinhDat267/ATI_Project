/** Shared limits for free-text read results (W3-08). Lengths are UTF-16 code units, as stored in JSON. */
export const TRUNCATION_MARKER = '…[đã cắt]';
export const SHEETS_MAX_COLUMNS = 26;
export const SHEETS_MAX_CELL_CHARS = 500;
export const NOTION_MAX_PROPERTY_CHARS = 500;
export const CALENDAR_MAX_TITLE_CHARS = 200;

/** Shortens text to at most `max` units including the marker, never splitting a surrogate pair. */
export function clipText(value: string, max: number): { text: string; clipped: boolean } {
  if (value.length <= max) return { text: value, clipped: false };
  let end = Math.max(0, max - TRUNCATION_MARKER.length);
  const last = value.charCodeAt(end - 1);
  if (end > 0 && last >= 0xD800 && last <= 0xDBFF) end--;
  return { text: value.slice(0, end) + TRUNCATION_MARKER, clipped: true };
}
