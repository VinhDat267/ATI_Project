import { GMAIL_ADDRESS_PATTERN } from '@wap/tool-schemas';

export function normalizedRecipient(value: unknown): string | undefined {
  if (typeof value !== 'string' || /[\r\n]/.test(value) || value.includes('${') || !GMAIL_ADDRESS_PATTERN.test(value)) return undefined;
  return value.trim().toLowerCase();
}
/** Whole address tokens, never a substring of another mailbox or domain. */
export function userEmailAddresses(texts: string[]): Set<string> {
  const result = new Set<string>();
  for (const text of texts) for (const token of text.match(/[^\s@<>"',;:()\\[\]{}]+@[^\s@<>"',;:()\\[\]{}]+\.[^\s@<>"',;:()\\[\]{}]+/gu) ?? []) {
    const address = normalizedRecipient(token.replace(/[.!?]+$/u, ''));
    if (address) result.add(address);
  }
  return result;
}
export function observedThreads(memory: Record<string, any>): Array<{ id: string; participants: string[] }> {
  const threads = memory.__observed?.thread;
  if (!Array.isArray(threads)) return [];
  return threads.filter(t => t && typeof t.id === 'string' && Array.isArray(t.participants));
}
