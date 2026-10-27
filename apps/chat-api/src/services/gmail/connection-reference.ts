import { decryptCredentials } from '@wap/tool-adapters';
import { CALENDAR_ID_PATTERN, type PlanConnections, type PlanResponse, type PlanStep } from '@wap/tool-schemas';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';

export type GmailConnectionReference = NonNullable<PlanConnections['gmail']>;
export type MyCalendarConnectionReference = NonNullable<PlanConnections['mycalendar']>;

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

export function planUsesMyCalendar(steps: readonly { tool: string }[]): boolean {
  return steps.some((step) => step.tool.startsWith('mycalendar.'));
}

export function planUsesGmail(steps: readonly { tool: string }[]): boolean {
  return steps.some((step) => step.tool.startsWith('gmail.'));
}

export function readPlanMyCalendarConnection(planJson: any): PlanConnections['mycalendar'] | null {
  const mycal = planJson?.connections?.mycalendar;
  if (!mycal || typeof mycal !== 'object') return null;
  const { credentialId, email, allowedCalendars } = mycal;
  if (typeof credentialId !== 'string' || !credentialId.trim()) return null;
  if (typeof email !== 'string' || !email.trim()) return null;
  if (!Array.isArray(allowedCalendars) || !allowedCalendars.length) return null;
  if (!allowedCalendars.every((id: any) => typeof id === 'string' && CALENDAR_ID_PATTERN.test(id))) return null;
  return { credentialId, email, allowedCalendars };
}

export function attachPlanConnections(planJson: PlanResponse, connections: PlanConnections): PlanResponse {
  const attached: PlanConnections = {};
  if (connections.gmail) attached.gmail = connections.gmail;
  if (connections.mycalendar) attached.mycalendar = connections.mycalendar;
  return Object.keys(attached).length > 0 ? { ...planJson, connections: attached } : planJson;
}
