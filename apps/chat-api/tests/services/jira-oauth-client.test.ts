import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { JiraOAuthClient, JiraOAuthError } from '../../src/services/jira/jira-oauth-client.js';
import { createJiraOAuthTestFixture, type JiraOAuthFixture } from '../helpers/jira-oauth-test-fixture.js';
import { validateEnv } from '../../src/config/env.js';

describe('JiraOAuthClient (Atlassian 3LO HTTP Client)', () => {
  let fixture: JiraOAuthFixture;

  beforeAll(async () => {
    fixture = await createJiraOAuthTestFixture();
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(() => {
    fixture.clearOverrides();
  });

  // ==========================================================================
  // 1. Authorization URL Generation & Parameter Hygiene
  // ==========================================================================
  describe('Authorization URL', () => {
    it('generates authorization URL with exact audience and prompt=consent without client_secret or PKCE (identity mode)', () => {
      const client = new JiraOAuthClient({
        clientId: 'client-xyz',
        clientSecret: 'secret-xyz',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const url = new URL(client.authorizationUrl({ state: 'state-123', mode: 'identity' }));

      expect(url.searchParams.get('audience')).toBe('api.atlassian.com');
      expect(url.searchParams.get('client_id')).toBe('client-xyz');
      expect(url.searchParams.get('scope')).toBe('read:me offline_access');
      expect(url.searchParams.get('prompt')).toBe('consent');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('state')).toBe('state-123');
      expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:4187/callback');

      // Security invariants: MUST NOT leak secret or include unnecessary Google/PKCE parameters
      expect(url.searchParams.has('client_secret')).toBe(false);
      expect(url.searchParams.has('code_challenge')).toBe(false);
      expect(url.searchParams.has('code_challenge_method')).toBe(false);
      expect(url.searchParams.has('access_type')).toBe(false);
    });

    it('generates authorization URL for authorize_sites mode with Jira scopes and consent prompt', () => {
      const client = new JiraOAuthClient({
        clientId: 'client-xyz',
        clientSecret: 'secret-xyz',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const url = new URL(client.authorizationUrl({ state: 'state-sites-456', mode: 'authorize_sites' }));

      expect(url.searchParams.get('audience')).toBe('api.atlassian.com');
      expect(url.searchParams.get('client_id')).toBe('client-xyz');
      expect(url.searchParams.get('prompt')).toBe('consent');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('state')).toBe('state-sites-456');

      const scopes = url.searchParams.get('scope')?.split(' ') ?? [];
      expect(scopes).toContain('read:me');
      expect(scopes).toContain('read:jira-work');
      expect(scopes).toContain('write:jira-work');
      expect(scopes).toContain('offline_access');

      expect(url.searchParams.has('client_secret')).toBe(false);
      expect(url.searchParams.has('code_challenge')).toBe(false);
      expect(url.searchParams.has('access_type')).toBe(false);
    });

    it('fails closed when an invalid or unknown mode is passed to authorizationUrl at runtime', () => {
      const client = new JiraOAuthClient({
        clientId: 'client-xyz',
        clientSecret: 'secret-xyz',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      expect(() => client.authorizationUrl({ state: 'state-123', mode: 'malicious_mode' as any })).toThrowError(
        /INVALID_CONFIG/
      );
      expect(() => client.authorizationUrl({ state: 'state-123', mode: '' as any })).toThrowError(/INVALID_CONFIG/);
    });
  });

  // ==========================================================================
  // 2. Fixture vs Live Endpoint Restrictions
  // ==========================================================================
  describe('Endpoint and Config Restrictions', () => {
    it('rejects endpoint overrides in live mode', () => {
      expect(
        () =>
          new JiraOAuthClient({
            clientId: 'client-xyz',
            clientSecret: 'secret-xyz',
            redirectUri: 'https://app.example.com/callback',
            mode: 'live',
            fixtureBaseUrl: 'http://127.0.0.1:4187',
          })
      ).toThrowError(/INVALID_CONFIG/);
    });

    it('rejects non-loopback fixtureBaseUrl in fixture mode', () => {
      expect(
        () =>
          new JiraOAuthClient({
            clientId: 'client-xyz',
            clientSecret: 'secret-xyz',
            redirectUri: 'http://127.0.0.1:4187/callback',
            mode: 'fixture',
            fixtureBaseUrl: 'https://evil.external.host',
          })
      ).toThrowError(/INVALID_CONFIG/);

      expect(
        () =>
          new JiraOAuthClient({
            clientId: 'client-xyz',
            clientSecret: 'secret-xyz',
            redirectUri: 'http://127.0.0.1:4187/callback',
            mode: 'fixture',
            fixtureBaseUrl: 'http://192.168.1.100:4187',
          })
      ).toThrowError(/INVALID_CONFIG/);
    });

    it('rejects missing or empty required credentials', () => {
      expect(
        () =>
          new JiraOAuthClient({
            clientId: '',
            clientSecret: 'secret-xyz',
            redirectUri: 'http://127.0.0.1:4187/callback',
            mode: 'fixture',
            fixtureBaseUrl: fixture.baseUrl,
          })
      ).toThrowError(/INVALID_CONFIG/);

      expect(
        () =>
          new JiraOAuthClient({
            clientId: 'client-xyz',
            clientSecret: '',
            redirectUri: 'http://127.0.0.1:4187/callback',
            mode: 'fixture',
            fixtureBaseUrl: fixture.baseUrl,
          })
      ).toThrowError(/INVALID_CONFIG/);

      expect(
        () =>
          new JiraOAuthClient({
            clientId: 'client-xyz',
            clientSecret: 'secret-xyz',
            redirectUri: '',
            mode: 'fixture',
            fixtureBaseUrl: fixture.baseUrl,
          })
      ).toThrowError(/INVALID_CONFIG/);
    });

    it('allows valid live configuration without fixtureBaseUrl', () => {
      expect(
        () =>
          new JiraOAuthClient({
            clientId: 'client-xyz',
            clientSecret: 'secret-xyz',
            redirectUri: 'https://app.example.com/callback',
            mode: 'live',
          })
      ).not.toThrow();
    });

    it('fails fast when MYJIRA_ENABLED=on in live mode but required Jira credentials are missing', () => {
      const isolatedBaseEnv: Record<string, string | undefined> = {
        NODE_ENV: 'production',
        RUNTIME_MODE: 'live',
        DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:56534/ati_jira04',
        JWT_SECRET: 'a'.repeat(32),
        ENCRYPTION_KEY: 'abcdefghijklmnopqrstuvwxyz012345',
        GEMINI_API_KEY: 'test-key',
        MYJIRA_ENABLED: 'on',
        // Missing JIRA_OAUTH_CLIENT_ID, JIRA_OAUTH_CLIENT_SECRET, JIRA_OAUTH_REDIRECT_URI
      };

      expect(() => validateEnv(isolatedBaseEnv)).toThrowError(
        /JIRA_OAUTH_CLIENT_ID is required when MYJIRA_ENABLED=on in live mode/
      );
    });
  });

  // ==========================================================================
  // 3. Token Exchange and Rotating Refresh Tokens
  // ==========================================================================
  describe('Token Exchange & Rotation', () => {
    it('exchanges authorization code for access and rotating refresh tokens', async () => {
      const code = fixture.issueCode({
        accountId: 'acc-exchange-1',
        scopes: ['read:me', 'read:jira-work', 'offline_access'],
      });

      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const tokens = await client.exchangeCode(code);

      expect(tokens.accessToken).toBeDefined();
      expect(typeof tokens.accessToken).toBe('string');
      expect(tokens.accessToken.length).toBeGreaterThan(10);

      expect(tokens.refreshToken).toBeDefined();
      expect(typeof tokens.refreshToken).toBe('string');
      expect(tokens.refreshToken!.length).toBeGreaterThan(10);

      expect(tokens.expiresInSeconds).toBe(3600);
      expect(tokens.scopes).toContain('read:me');
      expect(tokens.scopes).toContain('read:jira-work');
      expect(tokens.scopes).toContain('offline_access');

      // Verify request payload recorded on fixture
      const exchangeReq = fixture.requests.find((r) => r.path === '/oauth/token' && r.body?.code === code);
      expect(exchangeReq).toBeDefined();
      expect(exchangeReq?.body?.grant_type).toBe('authorization_code');
      expect(exchangeReq?.body?.client_id).toBe('test-client');
      expect(exchangeReq?.body?.client_secret).toBe('SECRET_SENTINEL');
      expect(exchangeReq?.body?.redirect_uri).toBe('http://127.0.0.1:4187/callback');
    });

    it('rejects authorization code replay (consuming code a second time)', async () => {
      const code = fixture.issueCode({
        accountId: 'acc-replay-code',
        scopes: ['read:me', 'offline_access'],
      });

      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      // First consumption succeeds
      await client.exchangeCode(code);

      // Second consumption must fail closed
      await expect(client.exchangeCode(code)).rejects.toThrow();
    });

    it('rotates refresh token and invalidates the previous refresh token', async () => {
      const code = fixture.issueCode({
        accountId: 'acc-rotate-test',
        scopes: ['read:me', 'read:jira-work', 'offline_access'],
      });

      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const initialTokens = await client.exchangeCode(code);
      const firstRefreshToken = initialTokens.refreshToken!;

      // 1. Perform first refresh
      const refreshedTokens1 = await client.refreshToken(firstRefreshToken);
      expect(refreshedTokens1.accessToken).toBeDefined();
      expect(refreshedTokens1.refreshToken).toBeDefined();
      expect(refreshedTokens1.refreshToken).not.toBe(firstRefreshToken);

      // 2. Attempting to refresh again with old/consumed refresh token must be rejected
      await expect(client.refreshToken(firstRefreshToken)).rejects.toThrow();

      // 3. Refreshing with the newly issued rotating token succeeds and rotates again
      const refreshedTokens2 = await client.refreshToken(refreshedTokens1.refreshToken!);
      expect(refreshedTokens2.accessToken).toBeDefined();
      expect(refreshedTokens2.refreshToken).toBeDefined();
      expect(refreshedTokens2.refreshToken).not.toBe(refreshedTokens1.refreshToken);
    });
  });

  // ==========================================================================
  // 4. User Identity Profile (/me)
  // ==========================================================================
  describe('Profile (/me)', () => {
    it('fetches profile and maps accountId correctly', async () => {
      const code = fixture.issueCode({
        accountId: 'acc-profile-user-123',
        scopes: ['read:me', 'offline_access'],
      });

      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const tokens = await client.exchangeCode(code);
      const profile = await client.getProfile(tokens.accessToken);

      expect(profile).toBeDefined();
      expect(profile.accountId).toBe('acc-profile-user-123');

      // Verify Authorization Bearer header sent to fixture
      const meReq = fixture.requests.find((r) => r.path === '/me');
      expect(meReq?.headers['authorization']).toBe(`Bearer ${tokens.accessToken}`);
    });
  });

  // ==========================================================================
  // 5. Accessible Resources, Container Filtering & Deduplication
  // ==========================================================================
  describe('Accessible Resources & Container Filtering', () => {
    it('exchanges authorization code, filters non-Jira containers, and deduplicates identical sites', async () => {
      const code = fixture.issueCode({
        accountId: 'acc-abc',
        scopes: ['read:me', 'read:jira-work', 'offline_access'],
        sites: [
          { id: 'cloud-1', name: 'Site 1', url: 'https://site1.atlassian.net', scopes: ['read:jira-work'] },
          { id: 'cloud-1', name: 'Site 1', url: 'https://site1.atlassian.net', scopes: ['read:jira-work'] }, // Exact identical duplicate
          { id: 'cloud-conf', name: 'Confluence Only', url: 'https://conf.atlassian.net', scopes: ['read:confluence-content'] }, // Non-Jira
          { id: 'cloud-bb', name: 'Bitbucket Only', url: 'https://bb.atlassian.net', scopes: ['read:repository'] }, // Non-Jira
          { id: 'cloud-2', name: 'Site 2', url: 'https://site2.atlassian.net', scopes: ['write:jira-work', 'read:jira-work'] }, // Jira
        ],
      });

      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const tokens = await client.exchangeCode(code);
      const sites = await client.getAccessibleResources(tokens.accessToken);

      expect(sites).toHaveLength(2);

      const site1 = sites.find((s) => s.id === 'cloud-1');
      expect(site1).toBeDefined();
      expect(site1?.name).toBe('Site 1');
      expect(site1?.url).toBe('https://site1.atlassian.net');
      expect(site1?.scopes).toContain('read:jira-work');

      const site2 = sites.find((s) => s.id === 'cloud-2');
      expect(site2).toBeDefined();
      expect(site2?.name).toBe('Site 2');

      // Non-Jira containers must be filtered out
      expect(sites.find((s) => s.id === 'cloud-conf')).toBeUndefined();
      expect(sites.find((s) => s.id === 'cloud-bb')).toBeUndefined();
    });

    it('fails closed when accessible-resources returns conflicting definitions for the same cloudId', async () => {
      const code = fixture.issueCode({
        accountId: 'acc-conflicting',
        scopes: ['read:me', 'read:jira-work', 'offline_access'],
        sites: [
          { id: 'cloud-conflict', name: 'Site Alpha', url: 'https://alpha.atlassian.net', scopes: ['read:jira-work'] },
          { id: 'cloud-conflict', name: 'Site Beta', url: 'https://beta.atlassian.net', scopes: ['read:jira-work', 'write:jira-work'] }, // Conflicting
        ],
      });

      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const tokens = await client.exchangeCode(code);
      await expect(client.getAccessibleResources(tokens.accessToken)).rejects.toThrowError(/PROVIDER_RESPONSE/);
    });

    it('fails closed with PROVIDER_RESPONSE when a Jira resource has an insecure http URL', async () => {
      const sensitiveToken = 'sensitive-access-token-http';
      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const dangerousUrl = 'http://site.atlassian.net';
      fixture.setOverride('/oauth/token/accessible-resources', {
        status: 200,
        body: [
          {
            id: 'cloud-http-site',
            name: 'Insecure Site',
            url: dangerousUrl,
            scopes: ['read:jira-work'],
          },
        ],
      });

      try {
        await client.getAccessibleResources(sensitiveToken);
        expect.unreachable('getAccessibleResources should have failed closed for http URL');
      } catch (err: any) {
        expect(err).toBeInstanceOf(JiraOAuthError);
        expect(err.code).toBe('PROVIDER_RESPONSE');
        const errorContent = `${String(err)} ${err?.message ?? ''} ${JSON.stringify(err)}`;
        expect(errorContent).not.toContain(dangerousUrl);
        expect(errorContent).not.toContain(sensitiveToken);
      }
    });

    it('fails closed with PROVIDER_RESPONSE when a Jira resource has an evil.com or site.atlassian.net.evil.com domain', async () => {
      const sensitiveToken = 'sensitive-access-token-domain';
      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const dangerousDomains = [
        'https://evil.com',
        'https://site.atlassian.net.evil.com',
      ];

      for (const dangerousUrl of dangerousDomains) {
        fixture.setOverride('/oauth/token/accessible-resources', {
          status: 200,
          body: [
            {
              id: 'cloud-domain-spoof',
              name: 'Spoofed Domain Site',
              url: dangerousUrl,
              scopes: ['read:jira-work'],
            },
          ],
        });

        try {
          await client.getAccessibleResources(sensitiveToken);
          expect.unreachable(`getAccessibleResources should have failed closed for domain: ${dangerousUrl}`);
        } catch (err: any) {
          expect(err).toBeInstanceOf(JiraOAuthError);
          expect(err.code).toBe('PROVIDER_RESPONSE');
          const errorContent = `${String(err)} ${err?.message ?? ''} ${JSON.stringify(err)}`;
          expect(errorContent).not.toContain('evil.com');
          expect(errorContent).not.toContain(dangerousUrl);
          expect(errorContent).not.toContain(sensitiveToken);
        }
      }
    });

    it('fails closed with PROVIDER_RESPONSE when a Jira resource has a credential-bearing URL or nonstandard port', async () => {
      const sensitiveToken = 'sensitive-access-token-cred-port';
      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const dangerousUrls = [
        'https://user:pass@site.atlassian.net',
        'https://site.atlassian.net:8080',
      ];

      for (const dangerousUrl of dangerousUrls) {
        fixture.setOverride('/oauth/token/accessible-resources', {
          status: 200,
          body: [
            {
              id: 'cloud-cred-port',
              name: 'Invalid Port or Credential Site',
              url: dangerousUrl,
              scopes: ['read:jira-work'],
            },
          ],
        });

        try {
          await client.getAccessibleResources(sensitiveToken);
          expect.unreachable(`getAccessibleResources should have failed closed for url: ${dangerousUrl}`);
        } catch (err: any) {
          expect(err).toBeInstanceOf(JiraOAuthError);
          expect(err.code).toBe('PROVIDER_RESPONSE');
          const errorContent = `${String(err)} ${err?.message ?? ''} ${JSON.stringify(err)}`;
          expect(errorContent).not.toContain(dangerousUrl);
          expect(errorContent).not.toContain(sensitiveToken);
        }
      }
    });

    it('fails closed with PROVIDER_RESPONSE when a Jira resource has an unsafe cloud ID (path traversal or control chars)', async () => {
      const sensitiveToken = 'sensitive-access-token-cloud-id';
      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const dangerousCloudIds = [
        '../x',
        'cloud\x00id',
        'cloud\nid',
        'cloud\rid',
      ];

      for (const dangerousId of dangerousCloudIds) {
        fixture.setOverride('/oauth/token/accessible-resources', {
          status: 200,
          body: [
            {
              id: dangerousId,
              name: 'Unsafe Cloud ID Site',
              url: 'https://site.atlassian.net',
              scopes: ['read:jira-work'],
            },
          ],
        });

        try {
          await client.getAccessibleResources(sensitiveToken);
          expect.unreachable(`getAccessibleResources should have failed closed for cloudId: ${dangerousId}`);
        } catch (err: any) {
          expect(err).toBeInstanceOf(JiraOAuthError);
          expect(err.code).toBe('PROVIDER_RESPONSE');
          const errorContent = `${String(err)} ${err?.message ?? ''} ${JSON.stringify(err)}`;
          expect(errorContent).not.toContain(sensitiveToken);
        }
      }
    });

    it('accepts valid https://site.atlassian.net resources and does not fail closed', async () => {
      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      fixture.setOverride('/oauth/token/accessible-resources', {
        status: 200,
        body: [
          {
            id: 'valid-cloud-uuid-001',
            name: 'Valid Production Site',
            url: 'https://site.atlassian.net',
            scopes: ['read:jira-work'],
          },
        ],
      });

      const sites = await client.getAccessibleResources('valid-token');
      expect(sites).toHaveLength(1);
      expect(sites[0]!.id).toBe('valid-cloud-uuid-001');
      expect(sites[0]!.name).toBe('Valid Production Site');
      expect(sites[0]!.url).toBe('https://site.atlassian.net');
      expect(sites[0]!.scopes).toContain('read:jira-work');
    });
  });

  // ==========================================================================
  // 6. Malformed Responses & Response Body Limits (64 KB)
  // ==========================================================================
  describe('Malformed Responses & 64 KB Limit', () => {
    it('rejects non-JSON malformed responses from provider fail-closed', async () => {
      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      fixture.setOverride('/oauth/token', {
        status: 200,
        rawBody: '<html><body>502 Bad Gateway</body></html>',
        headers: { 'Content-Type': 'text/html' },
      });

      await expect(client.exchangeCode('dummy-code')).rejects.toThrowError(/PROVIDER_RESPONSE/);
    });

    it('rejects response missing access_token from token endpoint', async () => {
      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      fixture.setOverride('/oauth/token', {
        status: 200,
        body: { token_type: 'Bearer', expires_in: 3600 }, // Missing access_token
      });

      await expect(client.exchangeCode('dummy-code')).rejects.toThrowError(/PROVIDER_RESPONSE/);
    });

    it('rejects profile response missing account_id from /me endpoint', async () => {
      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      fixture.setOverride('/me', {
        status: 200,
        body: { name: 'User Without ID', email: 'user@example.test' }, // Missing account_id
      });

      await expect(client.getProfile('some-token')).rejects.toThrowError(/PROVIDER_RESPONSE/);
    });

    it('rejects non-array response from accessible-resources endpoint', async () => {
      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      fixture.setOverride('/oauth/token/accessible-resources', {
        status: 200,
        body: { sites: [] }, // Object instead of Array
      });

      await expect(client.getAccessibleResources('some-token')).rejects.toThrowError(/PROVIDER_RESPONSE/);
    });

    it('rejects response exceeding 64 KB limit to prevent resource exhaustion', async () => {
      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      // Construct a response body strictly greater than 64 KB (65,536 bytes)
      const oversizedPayload = {
        account_id: 'acc-oversized',
        padding: 'A'.repeat(70000),
      };

      fixture.setOverride('/me', {
        status: 200,
        body: oversizedPayload,
      });

      await expect(client.getProfile('some-token')).rejects.toThrowError(/PROVIDER_RESPONSE/);
    });

    it('explicitly cancels stream reader when response body exceeds 64 KB limit', async () => {
      let streamCancelled = false;
      const largeChunk = new Uint8Array(40000);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(largeChunk);
          controller.enqueue(largeChunk); // 80,000 bytes > 65,536 bytes
        },
        cancel() {
          streamCancelled = true;
        },
      });

      const mockFetch: typeof fetch = async () => {
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
        fetchFn: mockFetch,
      });

      await expect(client.getProfile('token-oversized-stream')).rejects.toThrowError(/PROVIDER_RESPONSE/);
      expect(streamCancelled).toBe(true);
    });
  });

  // ==========================================================================
  // 7. HTTP Errors & Redirect Prevention
  // ==========================================================================
  describe('HTTP Errors & Redirect Handling', () => {
    it('handles HTTP 400 invalid_grant error from token exchange', async () => {
      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      fixture.setOverride('/oauth/token', {
        status: 400,
        body: { error: 'invalid_grant', error_description: 'Code invalid or expired' },
      });

      await expect(client.exchangeCode('invalid-code')).rejects.toThrow();
    });

    it('handles HTTP 401 unauthorized from profile endpoint', async () => {
      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      fixture.setOverride('/me', {
        status: 401,
        body: { message: 'Unauthorized' },
      });

      await expect(client.getProfile('bad-token')).rejects.toThrow();
    });

    it('handles HTTP 403 forbidden from accessible-resources endpoint', async () => {
      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      fixture.setOverride('/oauth/token/accessible-resources', {
        status: 403,
        body: { message: 'Forbidden' },
      });

      await expect(client.getAccessibleResources('forbidden-token')).rejects.toThrow();
    });

    it('handles HTTP 500 internal server error from provider', async () => {
      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      fixture.setOverride('/oauth/token', {
        status: 500,
        body: { error: 'server_error', message: 'Atlassian internal error' },
      });

      await expect(client.exchangeCode('code-500')).rejects.toThrow();
    });

    it('rejects redirect responses to prevent forwarding Authorization header across domains', async () => {
      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      fixture.setOverride('/me', {
        status: 302,
        headers: { Location: 'https://thirdparty.attacker.com/leak' },
      });

      await expect(client.getProfile('token-leak-test')).rejects.toThrow();
    });

    it('classifies network-level transport rejections as NETWORK_ERROR rather than PROVIDER_RESPONSE', async () => {
      const failingFetch: typeof fetch = async () => {
        throw new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:4187');
      };
      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
        fetchFn: failingFetch,
      });

      await expect(client.getProfile('some-token')).rejects.toSatisfy((err: any) => {
        return err instanceof JiraOAuthError && err.code === 'NETWORK_ERROR' && err.message.includes('[NETWORK_ERROR]');
      });
    });

    it('bounds error message length when provider returns large non-JSON error markup', async () => {
      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const largeHtmlError = '<html><body>' + 'Bad Gateway Error '.repeat(500) + '</body></html>';
      fixture.setOverride('/oauth/token', {
        status: 502,
        rawBody: largeHtmlError,
        headers: { 'Content-Type': 'text/html' },
      });

      await expect(client.exchangeCode('dummy-code')).rejects.toSatisfy((err: any) => {
        return err instanceof JiraOAuthError && err.message.length <= 600;
      });
    });
  });

  // ==========================================================================
  // 8. Secret Redaction
  // ==========================================================================
  describe('Secret Redaction in Errors', () => {
    it('never leaks client_secret, authorization code, or refresh tokens in error messages or thrown objects', async () => {
      const sensitiveSecret = 'SUPER_SECRET_CLIENT_SECRET_ATLASSIAN_999';
      const sensitiveCode = 'SUPER_SECRET_AUTH_CODE_777';
      const sensitiveRefresh = 'SUPER_SECRET_REFRESH_TOKEN_888';

      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: sensitiveSecret,
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      fixture.setOverride('/oauth/token', {
        status: 400,
        body: { error: 'invalid_grant', error_description: 'Failed authorization' },
      });

      // 1. Code exchange failure
      try {
        await client.exchangeCode(sensitiveCode);
        expect.unreachable('exchangeCode should have thrown on 400 error');
      } catch (err: any) {
        const errorContent = `${String(err)} ${err?.message ?? ''} ${JSON.stringify(err)}`;
        expect(errorContent).not.toContain(sensitiveSecret);
        expect(errorContent).not.toContain(sensitiveCode);
      }

      // 2. Refresh token failure
      try {
        await client.refreshToken(sensitiveRefresh);
        expect.unreachable('refreshToken should have thrown on 400 error');
      } catch (err: any) {
        const errorContent = `${String(err)} ${err?.message ?? ''} ${JSON.stringify(err)}`;
        expect(errorContent).not.toContain(sensitiveSecret);
        expect(errorContent).not.toContain(sensitiveRefresh);
      }
    });

    it('redacts echoed bearer accessToken from profile and accessible-resources error messages', async () => {
      const sensitiveToken = 'CRITICAL_BEARER_TOKEN_SENTINEL_555';
      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      // Upstream echoes back the bearer token in error details
      fixture.setOverride('/me', {
        status: 401,
        body: { error: 'invalid_token', message: `Token ${sensitiveToken} has expired` },
      });

      try {
        await client.getProfile(sensitiveToken);
        expect.unreachable('getProfile should have thrown');
      } catch (err: any) {
        const errorContent = `${String(err)} ${err?.message ?? ''} ${JSON.stringify(err)}`;
        expect(errorContent).not.toContain(sensitiveToken);
      }

      fixture.setOverride('/oauth/token/accessible-resources', {
        status: 403,
        body: { error: 'forbidden', message: `Access denied for token ${sensitiveToken}` },
      });

      try {
        await client.getAccessibleResources(sensitiveToken);
        expect.unreachable('getAccessibleResources should have thrown');
      } catch (err: any) {
        const errorContent = `${String(err)} ${err?.message ?? ''} ${JSON.stringify(err)}`;
        expect(errorContent).not.toContain(sensitiveToken);
      }
    });
  });

  // ==========================================================================
  // 9. Actual AbortSignal Cancellation & Deadlines
  // ==========================================================================
  describe('AbortSignal Cancellation & Deadlines', () => {
    it('aborts response via AbortSignal when deadline triggers (PROVIDER_TIMEOUT)', async () => {
      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
        timeoutMs: 50,
      });

      fixture.setOverride('/me', { delayMs: 200, body: { account_id: 'slow' } });

      await expect(client.getProfile('token-xyz')).rejects.toThrowError(/PROVIDER_TIMEOUT/);
    });

    it('aborts response immediately when caller AbortSignal is cancelled mid-flight', async () => {
      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
        timeoutMs: 5000,
      });

      fixture.setOverride('/me', { delayMs: 500, body: { account_id: 'slow-caller' } });

      const controller = new AbortController();
      const profilePromise = client.getProfile('token-abort-midflight', controller.signal);

      // Abort after 20ms while the fixture delay is 500ms
      setTimeout(() => controller.abort(), 20);

      await expect(profilePromise).rejects.toThrow();
    });

    it('rejects immediately without sending network request if caller AbortSignal is already aborted', async () => {
      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });

      const reqCountBefore = fixture.requests.length;
      const controller = new AbortController();
      controller.abort();

      await expect(client.getProfile('token-preaborted', controller.signal)).rejects.toThrow();

      // No network request should have been dispatched to fixture
      expect(fixture.requests.length).toBe(reqCountBefore);
    });

    it('preserves caller AbortSignal rejection in exchangeCode without converting to PROVIDER_RESPONSE', async () => {
      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });
      fixture.setOverride('/oauth/token', { delayMs: 500, body: { access_token: 'slow' } });

      const controller = new AbortController();
      const exchangePromise = client.exchangeCode('code-abort-midflight', controller.signal);
      setTimeout(() => controller.abort(), 20);

      await expect(exchangePromise).rejects.toSatisfy((err: any) => {
        return (err?.name === 'AbortError' || err?.code === 'REQUEST_ABORTED') && err?.code !== 'PROVIDER_RESPONSE';
      });
    });

    it('preserves caller AbortSignal rejection in refreshToken without converting to PROVIDER_RESPONSE', async () => {
      const client = new JiraOAuthClient({
        clientId: 'test-client',
        clientSecret: 'SECRET_SENTINEL',
        redirectUri: 'http://127.0.0.1:4187/callback',
        mode: 'fixture',
        fixtureBaseUrl: fixture.baseUrl,
      });
      fixture.setOverride('/oauth/token', { delayMs: 500, body: { access_token: 'slow' } });

      const controller = new AbortController();
      const refreshPromise = client.refreshToken('refresh-abort-midflight', controller.signal);
      setTimeout(() => controller.abort(), 20);

      await expect(refreshPromise).rejects.toSatisfy((err: any) => {
        return (err?.name === 'AbortError' || err?.code === 'REQUEST_ABORTED') && err?.code !== 'PROVIDER_RESPONSE';
      });
    });
  });
});
