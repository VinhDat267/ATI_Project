import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { GmailConnectionRepo } from '../../src/db/repositories/gmail-connection-repo.js';
import { GmailTokenManager } from '../../src/services/gmail/token-manager.js';
import { GmailOAuthError } from '../../src/services/gmail/oauth-client.js';
import { createMySheetsConnectionLookup } from '../../src/services/gmail/connection-reference.js';
import { encryptCredentials } from '@wap/tool-adapters';
import { startFakeGoogleGmail, DRIVE_FILE_SCOPE } from '../../../../scripts/fake-google-gmail.mjs';

const encryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Task 4 Backend & Fake Google Sheets/Drive', () => {
  describe('GmailConnectionRepo for mysheets', () => {
    it('initializes with service mysheets and mode connect_mysheets', () => {
      const mockPool: any = {};
      const repo = new GmailConnectionRepo(mockPool, 'mysheets');
      expect(repo.service).toBe('mysheets');
      expect(repo.mode).toBe('connect_mysheets');
    });
  });

  describe('GmailTokenManager for mysheets', () => {
    it('uses Google Sheets as label for error messages', async () => {
      const manager = new GmailTokenManager({
        client: {
          refresh: async () => {
            throw new GmailOAuthError('invalid_grant', 400);
          },
        },
        credentials: {
          markReconnectRequired: async () => true,
        },
        service: 'mysheets',
      });

      const provider = manager.forConnection('usr_1', 'cred_1', 'ref_1');
      await expect(provider.getAccessToken()).rejects.toMatchObject({
        message: 'Google Sheets cần được kết nối lại.',
        category: 'AUTH_ERROR',
      });
    });
  });

  describe('createMySheetsConnectionLookup', () => {
    it('returns null if no credentials or status not active', async () => {
      const credRepo: any = {
        getPersonalCredentials: async () => null,
      };
      const lookup = createMySheetsConnectionLookup(credRepo, encryptionKey);
      expect(await lookup('usr_1')).toBeNull();
    });

    it('returns null if empty spreadsheets', async () => {
      const encrypted = encryptCredentials(
        {
          email: 'user@example.com',
          selectedSpreadsheets: [],
          allowedScope: { spreadsheets: [] },
        },
        encryptionKey
      );
      const credRepo: any = {
        getPersonalCredentials: async () => ({
          id: 'cred_1',
          status: 'active',
          config: encrypted,
        }),
      };
      const lookup = createMySheetsConnectionLookup(credRepo, encryptionKey);
      expect(await lookup('usr_1')).toBeNull();
    });

    it('returns credentialId, email, allowedSpreadsheets, and selectedSpreadsheets when active with sheets', async () => {
      const selected = [
        { id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', title: 'Tasks', canEdit: true },
        { id: '2CyiNWs1YSB6oGNeLwCeCAkhnVVrqumct85PhwF3vqnt', title: 'Budget', canEdit: false },
      ];
      const encrypted = encryptCredentials(
        {
          email: 'user@example.com',
          selectedSpreadsheets: selected,
          allowedScope: { spreadsheets: selected.map((s) => s.id) },
        },
        encryptionKey
      );
      const credRepo: any = {
        getPersonalCredentials: async () => ({
          id: 'cred_1',
          status: 'active',
          config: encrypted,
        }),
      };
      const lookup = createMySheetsConnectionLookup(credRepo, encryptionKey);
      const result = await lookup('usr_1');
      expect(result).toEqual({
        credentialId: 'cred_1',
        email: 'user@example.com',
        allowedSpreadsheets: [
          '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
          '2CyiNWs1YSB6oGNeLwCeCAkhnVVrqumct85PhwF3vqnt',
        ],
        selectedSpreadsheets: selected,
      });
    });
  });

  describe('fake-google-gmail Drive, Sheets, and Fake Picker endpoints', () => {
    let fake: any;
    let token: string;
    const testSpreadsheetId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

    beforeAll(async () => {
      fake = await startFakeGoogleGmail();
      const verifier = randomBytes(32).toString('base64url');
      const challenge = createHash('sha256').update(verifier).digest('base64url');

      const authUrl = new URL(fake.endpoints.authorizationUrl);
      authUrl.searchParams.set('client_id', 'mysheets-test.apps.googleusercontent.com');
      authUrl.searchParams.set('redirect_uri', 'http://127.0.0.1:5174/connections/mysheets/callback');
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', DRIVE_FILE_SCOPE);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('code_challenge', challenge);
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');
      authUrl.searchParams.set('state', 'test_state');

      const authRes = await fetch(authUrl.href, { redirect: 'manual' });
      expect(authRes.status).toBe(302);
      const location = authRes.headers.get('location')!;
      const code = new URL(location).searchParams.get('code')!;

      const tokenRes = await fetch(fake.endpoints.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: 'mysheets-test.apps.googleusercontent.com',
          client_secret: 'fake-mysheets-secret',
          code_verifier: verifier,
          redirect_uri: 'http://127.0.0.1:5174/connections/mysheets/callback',
        }),
      });
      expect(tokenRes.status).toBe(200);
      const tokenBody = await tokenRes.json();
      token = tokenBody.access_token;
      expect(token).toBeTruthy();
    });

    afterAll(async () => {
      await fake?.close();
    });

    it('GET /drive/v3/about returns user email', async () => {
      const res = await fetch(`${fake.origin}/drive/v3/about?fields=user(emailAddress)`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.user?.emailAddress).toBe('gmail-owner@example.test');
    });

    it('GET /fake-picker/files returns file list with CORS', async () => {
      const res = await fetch(`${fake.origin}/fake-picker/files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      const data = await res.json();
      expect(Array.isArray(data.files)).toBe(true);
      const readOnly = data.files.find((f: any) => f.capabilities?.canEdit === false);
      expect(readOnly).toBeDefined();
      const nonSheet = data.files.find((f: any) => f.mimeType !== 'application/vnd.google-apps.spreadsheet');
      expect(nonSheet).toBeDefined();
    });

    it('GET /drive/v3/files/:id returns 404 before grant', async () => {
      const res = await fetch(`${fake.origin}/drive/v3/files/${testSpreadsheetId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(404);
    });

    it('POST /fake-picker/grant grants file access and enables Drive and Sheets endpoints', async () => {
      // Grant
      const grantRes = await fetch(`${fake.origin}/fake-picker/grant`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileId: testSpreadsheetId }),
      });
      expect(grantRes.status).toBe(200);

      // Now Drive files:id returns 200
      const driveRes = await fetch(`${fake.origin}/drive/v3/files/${testSpreadsheetId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(driveRes.status).toBe(200);
      const driveFile = await driveRes.json();
      expect(driveFile.id).toBe(testSpreadsheetId);
      expect(driveFile.name).toBe('Việc của tôi');
      expect(driveFile.mimeType).toBe('application/vnd.google-apps.spreadsheet');
      expect(driveFile.capabilities.canEdit).toBe(true);

      // Now Sheets /v4/spreadsheets returns 200
      const sheetsRes = await fetch(`${fake.origin}/v4/spreadsheets/${testSpreadsheetId}?fields=properties.title`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(sheetsRes.status).toBe(200);
      const sheetData = await sheetsRes.json();
      expect(sheetData.properties?.title).toBe('Việc của tôi');
    });
  });
});
