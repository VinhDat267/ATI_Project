export function isSlackMessageTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d*\.\d{6}$/.test(value.trim());
}
