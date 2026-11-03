import { GMAIL_ADDRESS_PATTERN } from '@wap/tool-schemas';

export function normalizedRecipient(value: unknown): string | undefined {
  if (typeof value !== 'string' || /[\r\n]/.test(value) || value.includes('${') || !GMAIL_ADDRESS_PATTERN.test(value)) return undefined;
  return value.trim().toLowerCase();
}
/** Whole address tokens, never a substring of another mailbox or domain. */
export function userEmailAddresses(texts: string[]): Set<string> {
  const result = new Set<string>();
  for (const text of texts) for (const token of text.match(/[^\s@<>",;:()\\[\]]+@[^\s@<>",;:()\\[\]]+\.[^\s@<>",;:()\\[\]]+/gu) ?? []) {
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
export const WORKSPACE_RECIPIENT_SERVICES: Record<string, string> = {
  sheets: 'Google Sheets',
  mysheets: 'Google Sheets của bạn',
  notion: 'Notion',
  trello: 'Trello',
  jira: 'Jira',
  myjira: 'Jira của bạn',
};
export function extractWorkspaceRecipients(service: string, raw: unknown): Array<{ id: string; service: string }> {
  if (!Object.hasOwn(WORKSPACE_RECIPIENT_SERVICES, service) || raw == null) return [];
  const texts: string[] = [];
  const collect = (value: unknown) => {
    if (typeof value === 'string') texts.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(raw);
  return [...userEmailAddresses(texts)].map(id => ({ id, service }));
}
export function observedWorkspaceRecipients(memory: Record<string, any>): Map<string, string> {
  const recipients = memory.__observed?.recipient;
  const result = new Map<string, string>();
  if (!Array.isArray(recipients)) return result;
  for (const entry of recipients) {
    if (!entry || typeof entry !== 'object') continue;
    const address = normalizedRecipient(entry.id);
    const service = typeof entry.service === 'string' && Object.hasOwn(WORKSPACE_RECIPIENT_SERVICES, entry.service)
      ? WORKSPACE_RECIPIENT_SERVICES[entry.service]!
      : undefined;
    if (address && service) result.set(address, service);
  }
  return result;
}
