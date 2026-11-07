import { describe, expect, it } from 'vitest';
import { validateEnv } from '../../src/config/env.js';
import { createApp } from '../../src/app.js';

const mailId = '111111111111-mail.apps.googleusercontent.com';
const base = {
  RUNTIME_MODE: 'live', DATABASE_URL: 'postgresql://local',
  JWT_SECRET: 'project-isolation-secret-at-least-32-chars', ENCRYPTION_KEY: 'a'.repeat(32), GEMINI_API_KEY: 'fixture',
  GMAIL_OAUTH_PROJECT_ID: 'ati-mail', GMAIL_OAUTH_CLIENT_ID: mailId,
  GMAIL_OAUTH_CLIENT_SECRET: 'fixture', GMAIL_OAUTH_REDIRECT_URI: 'https://ati.example/connections/gmail/callback',
};
const oauth = (clientId: string) => ({ clientId, clientSecret: 'fixture', redirectUri: 'https://ati.example/connections/gmail/callback',
  authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke', apiBaseUrl: 'https://gmail.googleapis.com' });

describe('Google project isolation at live ingress', () => {
  it.each(['on', 'off'])('rejects different Calendar clients with the Gmail numeric namespace even when flag=%s', (flag) => {
    expect(() => validateEnv({ ...base, MYCALENDAR_ENABLED: flag, MYCALENDAR_OAUTH_PROJECT_ID: 'ati-calendar',
      MYCALENDAR_OAUTH_CLIENT_ID: '111111111111-calendar.apps.googleusercontent.com', MYCALENDAR_OAUTH_CLIENT_SECRET: 'fixture',
      MYCALENDAR_OAUTH_REDIRECT_URI: 'https://ati.example/connections/mycalendar/callback' })).toThrow('separate Google Cloud projects');
  });
  it('includes the sign-in client even without its project declaration', () => {
    expect(() => validateEnv({ ...base, GOOGLE_OAUTH_CLIENT_ID: '111111111111-signin.apps.googleusercontent.com',
      GOOGLE_OAUTH_CLIENT_SECRET: 'fixture', GOOGLE_OAUTH_REDIRECT_URI: 'https://ati.example/auth/google/callback' })).toThrow('separate Google Cloud projects');
  });
  it('requires a declared project for inferred-on Gmail alone', () => {
    expect(() => validateEnv({ ...base, GMAIL_OAUTH_PROJECT_ID: '' })).toThrow('GMAIL_OAUTH_PROJECT_ID');
  });
  it.each(['gmail-client', 'mail.apps.googleusercontent.com', '111111111111-.apps.googleusercontent.com'])('rejects unverifiable live client %s', (clientId) => {
    expect(() => validateEnv({ ...base, GMAIL_OAUTH_CLIENT_ID: clientId })).toThrow('Google Web OAuth client');
  });
  it('accepts distinct numeric namespaces and declared projects', () => {
    expect(validateEnv({ ...base, MYCALENDAR_ENABLED: 'off', MYCALENDAR_OAUTH_PROJECT_ID: 'ati-calendar',
      MYCALENDAR_OAUTH_CLIENT_ID: '222222222222-calendar.apps.googleusercontent.com' }).GMAIL_ENABLED).toBe(true);
  });
  it('protects direct live composition including disabled options', () => {
    expect(() => createApp({ jwtSecret: base.JWT_SECRET, runtimeMode: 'live', gmail: { enabled: true, oauth: oauth(mailId) },
      mycalendar: { enabled: false, oauth: oauth('111111111111-calendar.apps.googleusercontent.com') } })).toThrow('separate Google Cloud projects');
  });
  it('protects direct live composition against a shared sign-in project', () => {
    expect(() => createApp({ jwtSecret: base.JWT_SECRET, runtimeMode: 'live', gmail: { enabled: true, oauth: oauth(mailId) },
      googleOAuth: { ...oauth('111111111111-signin.apps.googleusercontent.com'), jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs' } })).toThrow('separate Google Cloud projects');
  });
  it('keeps local fixture clients available in sandbox', () => {
    expect(() => createApp({ jwtSecret: base.JWT_SECRET, runtimeMode: 'sandbox', gmail: { enabled: true, oauth: oauth('fixture') } })).not.toThrow();
  });
  it('rejects a stale Picker project in direct live composition', () => {
    expect(() => createApp({ jwtSecret: base.JWT_SECRET, runtimeMode: 'live', mysheets: { enabled: true, oauth: oauth(mailId),
      picker: { apiKey: 'fixture', appId: '999999999999' } } })).toThrow('MYSHEETS_PICKER_APP_ID');
  });
});
