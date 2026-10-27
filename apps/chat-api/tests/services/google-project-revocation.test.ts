import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeGoogleGmail, type FakeGoogleGmail } from '../../../../scripts/fake-google-gmail.mjs';
import { GmailOAuthClient } from '../../src/services/gmail/oauth-client.js';

const gmailId = 'gmail-test.apps.googleusercontent.com';
const calendarId = 'mycalendar-test.apps.googleusercontent.com';
let google: FakeGoogleGmail;
afterEach(async () => { await google?.close(); });

async function grant(clientId: string, email = 'owner@example.test') {
  google.settings.email = email;
  const calendar = clientId === calendarId;
  const client = new GmailOAuthClient({
    clientId, clientSecret: calendar ? 'fake-mycalendar-secret' : 'fake-gmail-secret',
    redirectUri: `http://127.0.0.1:5174/connections/${calendar ? 'mycalendar' : 'gmail'}/callback`, ...google.endpoints,
  });
  const verifier = 'v'.repeat(43);
  const scope = calendar
    ? 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly'
    : 'https://www.googleapis.com/auth/gmail.modify';
  const url = client.authorizationUrl({ state: 'state-for-project-test', codeChallenge: createHash('sha256').update(verifier).digest('base64url'), scope });
  const response = await fetch(url, { redirect: 'manual' });
  expect(response.status).toBe(302);
  const code = new URL(response.headers.get('location')!).searchParams.get('code')!;
  return { client, tokens: await client.exchangeCode(code, verifier, AbortSignal.timeout(2000)) };
}

describe('Google project-wide revocation through real fixture HTTP', () => {
  it.each(['refreshToken', 'accessToken'] as const)('revoking %s invalidates peer clients in the same project only', async (tokenKind) => {
    google = await startFakeGoogleGmail({
      clientIds: ['gmail-peer'],
      clientProjects: { [gmailId]: 'mail-project', 'gmail-peer': 'mail-project', [calendarId]: 'calendar-project' },
    });
    const mail = await grant(gmailId);
    const peer = await grant('gmail-peer');
    const calendar = await grant(calendarId);
    const otherUser = await grant(gmailId, 'another@example.test');
    await mail.client.revoke(mail.tokens[tokenKind]!, AbortSignal.timeout(2000));
    await expect(peer.client.refresh(peer.tokens.refreshToken!, AbortSignal.timeout(2000))).rejects.toMatchObject({ kind: 'invalid_grant' });
    await expect(peer.client.profileEmail(peer.tokens.accessToken, AbortSignal.timeout(2000))).rejects.toMatchObject({ status: 401 });
    await expect(calendar.client.refresh(calendar.tokens.refreshToken!, AbortSignal.timeout(2000))).resolves.toHaveProperty('accessToken');
    await expect(otherUser.client.refresh(otherUser.tokens.refreshToken!, AbortSignal.timeout(2000))).resolves.toHaveProperty('accessToken');
  });

  it('also revokes Gmail when the Calendar client is placed in the same project', async () => {
    google = await startFakeGoogleGmail({ clientProjects: { [gmailId]: 'shared-project', [calendarId]: 'shared-project' } });
    const mail = await grant(gmailId);
    const calendar = await grant(calendarId);
    await calendar.client.revoke(calendar.tokens.refreshToken!, AbortSignal.timeout(2000));
    await expect(mail.client.refresh(mail.tokens.refreshToken!, AbortSignal.timeout(2000))).rejects.toMatchObject({ kind: 'invalid_grant' });
  });
});
