import { afterEach, describe, expect, it } from 'vitest';
import { startFakeGoogleGmail, type FakeGoogleGmail } from '../../../../scripts/fake-google-gmail.mjs';
import { GmailOAuthClient, GmailOAuthError } from '../../src/services/gmail/oauth-client.js';

let google: FakeGoogleGmail;
afterEach(async () => { await google?.close(); });

async function profileError(status: number, error: unknown) {
  google = await startFakeGoogleGmail({ settings: { profileResponse: { status, body: { error } } } });
  const client = new GmailOAuthClient({ clientId: 'gmail-test.apps.googleusercontent.com', clientSecret: 'fixture-secret',
    redirectUri: 'http://127.0.0.1:5174/connections/gmail/callback', ...google.endpoints });
  try { await client.profileEmail('fixture-access-token', AbortSignal.timeout(2000)); }
  catch (failure) {
    expect(failure).toBeInstanceOf(GmailOAuthError);
    return failure as GmailOAuthError & { reason?: string };
  }
  throw new Error('The profile request unexpectedly succeeded');
}

describe('Gmail OAuth provider errors through real HTTP', () => {
  it.each([
    { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED', domain: 'googleapis.com' }] },
    { errors: [{ reason: 'accessNotConfigured' }] },
  ])('preserves only the recognized disabled-service reason: %j', async providerError => {
    const failure = await profileError(403, { code: 403, status: 'PERMISSION_DENIED', message: 'SENSITIVE_PROVIDER_TEXT',
      ...providerError });
    expect(failure).toMatchObject({ kind: 'rejected', status: 403, reason: 'SERVICE_DISABLED' });
    expect(`${failure.stack}\n${JSON.stringify(failure)}`).not.toContain('SENSITIVE_PROVIDER_TEXT');
  });

  it.each([
    { status: 403, error: { errors: [{ reason: 'insufficientPermissions' }] } },
    { status: 403, error: { details: [{ reason: 'SERVICE_DISABLED', domain: 'untrusted.example' }] } },
    { status: 403, error: { details: 'SERVICE_DISABLED', errors: { reason: 'accessNotConfigured' } } },
    { status: 503, error: { errors: [{ reason: 'accessNotConfigured' }] } },
    { status: 401, error: { errors: [{ reason: 'accessNotConfigured' }] } },
  ])('does not label unrelated or malformed failures as a disabled API: %j', async ({ status, error }) => {
    const failure = await profileError(status, error);
    expect(failure.status).toBe(status);
    expect(failure.reason).toBeUndefined();
  });
});
