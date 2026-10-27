import { describe, expect, it } from 'vitest';
import { validateEnv } from '../../src/config/env.js';

const live = {
  RUNTIME_MODE: 'live', DATABASE_URL: 'postgresql://local',
  JWT_SECRET: 'project-isolation-test-secret-at-least-32', ENCRYPTION_KEY: 'a'.repeat(32), GEMINI_API_KEY: 'fixture',
  MYCALENDAR_ENABLED: 'on', MYCALENDAR_OAUTH_CLIENT_ID: 'calendar-client', MYCALENDAR_OAUTH_CLIENT_SECRET: 'calendar-secret',
  MYCALENDAR_OAUTH_REDIRECT_URI: 'https://ati.example/connections/mycalendar/callback',
};
const separate = { MYCALENDAR_OAUTH_PROJECT_ID: 'ati-calendar', GMAIL_OAUTH_PROJECT_ID: 'ati-gmail', GMAIL_OAUTH_CLIENT_ID: 'gmail-client' };

describe('live personal Google project isolation', () => {
  it('requires the Calendar project identity before enabling live Calendar', () => {
    expect(() => validateEnv(live)).toThrow('MYCALENDAR_OAUTH_PROJECT_ID');
  });
  it('requires the Gmail project identity even when Gmail is disabled but its client is configured', () => {
    expect(() => validateEnv({ ...live, ...separate, GMAIL_ENABLED: 'off', GMAIL_OAUTH_PROJECT_ID: '' })).toThrow('GMAIL_OAUTH_PROJECT_ID');
  });
  it('rejects two different clients declared in the same project', () => {
    expect(() => validateEnv({ ...live, ...separate, GMAIL_OAUTH_PROJECT_ID: 'ati-calendar' })).toThrow('separate Google Cloud projects');
  });
  it('rejects the same client even if the declared project IDs differ', () => {
    expect(() => validateEnv({ ...live, ...separate, GMAIL_OAUTH_CLIENT_ID: 'calendar-client' })).toThrow('different OAuth clients');
  });
  it('accepts separate projects and a standalone Calendar project', () => {
    expect(validateEnv({ ...live, ...separate }).MYCALENDAR_OAUTH?.clientId).toBe('calendar-client');
    expect(validateEnv({ ...live, MYCALENDAR_OAUTH_PROJECT_ID: 'ati-calendar' }).MYCALENDAR_ENABLED).toBe(true);
  });
  it('ignores these new declarations when Calendar is off or uses fake sandbox endpoints', () => {
    expect(validateEnv({ ...live, MYCALENDAR_ENABLED: 'off' }).MYCALENDAR_ENABLED).toBe(false);
    expect(validateEnv({ ...live, RUNTIME_MODE: 'sandbox' }).MYCALENDAR_OAUTH).toBeUndefined();
  });
});
