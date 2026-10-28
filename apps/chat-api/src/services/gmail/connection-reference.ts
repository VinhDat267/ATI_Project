import { decryptCredentials } from '@wap/tool-adapters';
import type { PersonalSpreadsheetItem, PlanConnections } from '@wap/tool-schemas';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';

export type GmailConnectionReference = NonNullable<PlanConnections['gmail']>;
export type MyCalendarConnectionReference = NonNullable<PlanConnections['mycalendar']>;
export type MySheetsConnectionReference = NonNullable<PlanConnections['mysheets']>;
export type MySheetsConnectionLookupResult = MySheetsConnectionReference & {
  selectedSpreadsheets: PersonalSpreadsheetItem[];
};

/** The caller's active Gmail connection as a plan stores it, or null when none is usable. */
export function createGmailConnectionLookup(credentials: Pick<CredentialRepo, 'getPersonalCredentials'>, encryptionKey: string) {
  return async (userId: string): Promise<GmailConnectionReference | null> => {
    const record = await credentials.getPersonalCredentials('gmail', userId);
    if (!record || record.status !== 'active') return null;
    try {
      const email = decryptCredentials(record.config, encryptionKey).email;
      return typeof email === 'string' && email ? { credentialId: record.id, email } : null;
    } catch {
      return null;
    }
  };
}

/** The caller's active MyCalendar connection as a plan stores it, or null when none is usable or no calendars selected. */
export function createMyCalendarConnectionLookup(credentials: Pick<CredentialRepo, 'getPersonalCredentials'>, encryptionKey: string) {
  return async (userId: string): Promise<MyCalendarConnectionReference | null> => {
    const record = await credentials.getPersonalCredentials('mycalendar', userId);
    if (!record || record.status !== 'active') return null;
    try {
      const config = decryptCredentials(record.config, encryptionKey);
      const email = config.email;
      const calendars: string[] = Array.isArray(config.allowedScope?.calendars)
        ? config.allowedScope.calendars
        : Array.isArray(config.selectedCalendars)
          ? config.selectedCalendars.map((c: any) => c.id)
          : [];
      if (!calendars.length) return null;
      return typeof email === 'string' && email ? { credentialId: record.id, email, allowedCalendars: calendars } : null;
    } catch {
      return null;
    }
  };
}

/** The caller's active MySheets connection as a plan stores it, or null when none is usable or no spreadsheets selected. */
export function createMySheetsConnectionLookup(credentials: Pick<CredentialRepo, 'getPersonalCredentials'>, encryptionKey: string) {
  return async (userId: string): Promise<MySheetsConnectionLookupResult | null> => {
    const record = await credentials.getPersonalCredentials('mysheets', userId);
    if (!record || record.status !== 'active') return null;
    try {
      const config = decryptCredentials(record.config, encryptionKey);
      const email = config.email;
      const selectedSpreadsheets: PersonalSpreadsheetItem[] = Array.isArray(config.selectedSpreadsheets)
        ? config.selectedSpreadsheets
        : [];
      const spreadsheets: string[] = Array.isArray(config.allowedScope?.spreadsheets)
        ? config.allowedScope.spreadsheets
        : selectedSpreadsheets.map((s: any) => s.id);
      if (!spreadsheets.length) return null;
      return typeof email === 'string' && email
        ? { credentialId: record.id, email, allowedSpreadsheets: spreadsheets, selectedSpreadsheets }
        : null;
    } catch {
      return null;
    }
  };
}
