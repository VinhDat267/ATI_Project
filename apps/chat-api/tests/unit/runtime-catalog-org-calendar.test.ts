import { describe, expect, it } from 'vitest';
import { encryptCredentials } from '@wap/tool-adapters';
import { runtimeToolCatalog } from '../../src/config/gmail-tools-runtime.js';

const key = '0123456789abcdef0123456789abcdef';

describe('runtimeToolCatalog organization calendar preservation', () => {
  it('keeps shared Org calendar tools when workspaceMode is organization even if personal mycalendar is connected', async () => {
    const sharedCalEncrypted = encryptCredentials(
      {
        clientEmail: 'sa@project.iam.gserviceaccount.com',
        privateKey: '-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----',
        allowedScope: { calendars: ['team@group.calendar.google.com'] },
      },
      key,
    );
    const personalCalEncrypted = encryptCredentials(
      {
        refreshToken: '1//personal-cal-refresh',
        email: 'user@example.com',
        selectedCalendars: [{ id: 'user@example.com', summary: 'Personal', timeZone: 'Asia/Ho_Chi_Minh', primary: true }],
        allowedScope: { calendars: ['user@example.com'] },
      },
      key,
    );

    const credRepo: any = {
      getCredentials: async (service: string, scopeId?: string) => {
        if (service === 'calendar' && scopeId === 'ws-org-1') {
          return { id: 'org-cal-1', service: 'calendar', config: sharedCalEncrypted };
        }
        return null;
      },
      getPersonalCredentials: async (service: string, userId: string) => {
        if (service === 'mycalendar' && userId === 'u1') {
          return { id: 'pers-cal-1', service: 'mycalendar', status: 'active', config: personalCalEncrypted };
        }
        return null;
      },
      getPersonalConnectionStatus: async () => null,
    };

    const orgCatalog = await runtimeToolCatalog('live', credRepo, key, {
      userId: 'u1',
      workspaceMode: 'organization',
      workspaceId: 'ws-org-1',
      gmailEnabled: false,
      mycalendarEnabled: true,
      mycalendarConnection: async () => ({
        status: 'connected',
        connection: {
          credentialId: 'pers-cal-1',
          email: 'user@example.com',
          allowedCalendars: ['user@example.com'],
        },
      }),
    });

    expect(orgCatalog.some((t) => t.service === 'mycalendar')).toBe(true);
    expect(orgCatalog.some((t) => t.service === 'calendar')).toBe(true);

    const legacyCatalog = await runtimeToolCatalog('live', credRepo, key, {
      userId: 'u1',
      workspaceMode: 'legacy',
      workspaceId: 'ws-org-1',
      gmailEnabled: false,
      mycalendarEnabled: true,
      mycalendarConnection: async () => ({
        status: 'connected',
        connection: {
          credentialId: 'pers-cal-1',
          email: 'user@example.com',
          allowedCalendars: ['user@example.com'],
        },
      }),
    });

    expect(legacyCatalog.some((t) => t.service === 'mycalendar')).toBe(true);
    expect(legacyCatalog.some((t) => t.service === 'calendar')).toBe(false);
  });
});
