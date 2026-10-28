import { describe, expect, it } from 'vitest';
import { validateEnv } from '../../src/config/env.js';

const liveBase = {
  RUNTIME_MODE: 'live',
  DATABASE_URL: 'postgresql://local',
  JWT_SECRET: 'project-isolation-test-secret-at-least-32',
  ENCRYPTION_KEY: 'a'.repeat(32),
  GEMINI_API_KEY: 'fixture',
};

const liveSheets = {
  ...liveBase,
  MYSHEETS_ENABLED: 'on',
  MYSHEETS_OAUTH_CLIENT_ID: 'sheets-client',
  MYSHEETS_OAUTH_CLIENT_SECRET: 'sheets-secret',
  MYSHEETS_OAUTH_REDIRECT_URI: 'https://ati.example/connections/mysheets/callback',
  MYSHEETS_OAUTH_PROJECT_ID: 'ati-sheets',
  MYSHEETS_PICKER_API_KEY: 'AIzaSyFakeKeyForPickerApi123456789',
  MYSHEETS_PICKER_APP_ID: '123456789012',
};

describe('MYSHEETS configuration and live project isolation', () => {
  it('defaults MYSHEETS_ENABLED to off', () => {
    const config = validateEnv(liveBase);
    expect(config.MYSHEETS_ENABLED).toBe(false);
    expect(config.MYSHEETS_OAUTH).toBeUndefined();
    expect(config.MYSHEETS_PICKER).toBeUndefined();
  });

  it('rejects invalid MYSHEETS_ENABLED values', () => {
    expect(() => validateEnv({ ...liveBase, MYSHEETS_ENABLED: 'true' })).toThrow('MYSHEETS_ENABLED must be on or off');
  });

  it('requires MYSHEETS_OAUTH_CLIENT_ID, SECRET and REDIRECT_URI in live mode', () => {
    expect(() => validateEnv({ ...liveSheets, MYSHEETS_OAUTH_CLIENT_ID: '' })).toThrow('MYSHEETS_OAUTH_CLIENT_ID is required');
    expect(() => validateEnv({ ...liveSheets, MYSHEETS_OAUTH_CLIENT_SECRET: '' })).toThrow('MYSHEETS_OAUTH_CLIENT_SECRET is required');
    expect(() => validateEnv({ ...liveSheets, MYSHEETS_OAUTH_REDIRECT_URI: 'http://insecure.example' })).toThrow('MYSHEETS_OAUTH_REDIRECT_URI');
  });

  it('requires MYSHEETS_PICKER_API_KEY and numeric MYSHEETS_PICKER_APP_ID in live mode', () => {
    expect(() => validateEnv({ ...liveSheets, MYSHEETS_PICKER_API_KEY: '' })).toThrow('MYSHEETS_PICKER_API_KEY');
    expect(() => validateEnv({ ...liveSheets, MYSHEETS_PICKER_APP_ID: '' })).toThrow('MYSHEETS_PICKER_APP_ID');
    expect(() => validateEnv({ ...liveSheets, MYSHEETS_PICKER_APP_ID: 'non-numeric' })).toThrow('numeric');
  });

  it('requires MYSHEETS_OAUTH_PROJECT_ID in live mode', () => {
    expect(() => validateEnv({ ...liveSheets, MYSHEETS_OAUTH_PROJECT_ID: '' })).toThrow('MYSHEETS_OAUTH_PROJECT_ID');
  });

  it('rejects duplicate Google Cloud projects between MySheets and MyCalendar / Gmail', () => {
    const withCalendar = {
      ...liveSheets,
      MYCALENDAR_ENABLED: 'on',
      MYCALENDAR_OAUTH_CLIENT_ID: 'calendar-client',
      MYCALENDAR_OAUTH_CLIENT_SECRET: 'calendar-secret',
      MYCALENDAR_OAUTH_REDIRECT_URI: 'https://ati.example/connections/mycalendar/callback',
      MYCALENDAR_OAUTH_PROJECT_ID: 'ati-sheets', // duplicate with MYSHEETS
    };
    expect(() => validateEnv(withCalendar)).toThrow('must use separate Google Cloud projects');

    const withGmail = {
      ...liveSheets,
      GMAIL_ENABLED: 'on',
      GMAIL_OAUTH_CLIENT_ID: 'gmail-client',
      GMAIL_OAUTH_CLIENT_SECRET: 'gmail-secret',
      GMAIL_OAUTH_REDIRECT_URI: 'https://ati.example/connections/gmail/callback',
      GMAIL_OAUTH_PROJECT_ID: 'ati-sheets', // duplicate with MYSHEETS
    };
    expect(() => validateEnv(withGmail)).toThrow('must use separate Google Cloud projects');
  });

  it('rejects duplicate OAuth clients between MySheets and other services', () => {
    const duplicateClient = {
      ...liveSheets,
      MYCALENDAR_ENABLED: 'on',
      MYCALENDAR_OAUTH_CLIENT_ID: 'sheets-client', // duplicate client
      MYCALENDAR_OAUTH_CLIENT_SECRET: 'calendar-secret',
      MYCALENDAR_OAUTH_REDIRECT_URI: 'https://ati.example/connections/mycalendar/callback',
      MYCALENDAR_OAUTH_PROJECT_ID: 'ati-calendar',
    };
    expect(() => validateEnv(duplicateClient)).toThrow('must use different OAuth clients');
  });

  it('accepts valid live configuration with distinct projects and clients', () => {
    const valid = validateEnv({
      ...liveSheets,
      MYCALENDAR_ENABLED: 'on',
      MYCALENDAR_OAUTH_CLIENT_ID: 'calendar-client',
      MYCALENDAR_OAUTH_CLIENT_SECRET: 'calendar-secret',
      MYCALENDAR_OAUTH_REDIRECT_URI: 'https://ati.example/connections/mycalendar/callback',
      MYCALENDAR_OAUTH_PROJECT_ID: 'ati-calendar',
      GMAIL_ENABLED: 'on',
      GMAIL_OAUTH_CLIENT_ID: 'gmail-client',
      GMAIL_OAUTH_CLIENT_SECRET: 'gmail-secret',
      GMAIL_OAUTH_REDIRECT_URI: 'https://ati.example/connections/gmail/callback',
      GMAIL_OAUTH_PROJECT_ID: 'ati-gmail',
    });
    expect(valid.MYSHEETS_ENABLED).toBe(true);
    expect(valid.MYSHEETS_OAUTH?.clientId).toBe('sheets-client');
    expect(valid.MYSHEETS_PICKER?.appId).toBe('123456789012');
  });
});
