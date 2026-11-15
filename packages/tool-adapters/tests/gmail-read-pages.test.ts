import { expect, it } from 'vitest';
import { startFakeGoogleGmail } from '../../../scripts/fake-google-gmail.mjs';
import { createGmailToolAdapter, GMAIL_SEARCH_PAGE_TOOL } from '../src/gmail/gmail-adapter.js';

it('returns the provider cursor to retrieve a second page of Gmail threads', async () => {
  const server = await startFakeGoogleGmail();
  try {
    const refreshToken = server.mintRefreshToken();
    const tokenResponse = await fetch(server.endpoints.tokenUrl, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: 'gmail-test.apps.googleusercontent.com', client_secret: 'fake-gmail-secret',
        grant_type: 'refresh_token', refresh_token: refreshToken,
      }),
    });
    const { access_token } = await tokenResponse.json();
    const adapter = createGmailToolAdapter({
      tokens: { getAccessToken: async () => access_token }, baseUrl: server.origin,
    });
    const legacy = await adapter.execute('gmail.search_threads', { query: 'họp', limit: 1 });
    expect(legacy).toEqual([expect.objectContaining({ id: 'thread-1' })]);
    const first = await adapter.execute(GMAIL_SEARCH_PAGE_TOOL, { query: 'họp', limit: 1 });
    expect(first).toMatchObject({ threads: [{ id: 'thread-1' }], nextPageToken: expect.any(String) });

    const second = await adapter.execute(GMAIL_SEARCH_PAGE_TOOL, {
      query: 'họp', limit: 1, pageToken: first.nextPageToken,
    });
    expect(second).toMatchObject({ threads: [{ id: 'draft-only' }] });
    expect(second).not.toHaveProperty('nextPageToken');
  } finally {
    await server.close();
  }
});
