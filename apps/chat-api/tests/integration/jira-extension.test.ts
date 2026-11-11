import { expect, it, vi } from 'vitest';
import request from 'supertest';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import { createApp } from '../../src/app.js';
import { generateTokens } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { getConfiguredToolCatalog, normalizeAllowedScope } from '../../src/services/registered-services.js';
import { getServiceDefinition } from '@wap/tool-schemas';
import { createIsolatedTestSchema } from '../helpers/jira-test-db.js';

it('retires legacy shared Basic-Auth Jira routes, catalog, and adapter factory fail-closed in G2A while preserving encryption helpers', async () => {
  const ctx = await createIsolatedTestSchema();
  const key = 'test-only-encryption-key-with-32bytes';
  const secret = 'fixture-jwt-secret-at-least-32-characters';
  const credentials = {
    siteUrl: 'https://ati-test.atlassian.net',
    email: 'fixture@example.test',
    apiToken: 'synthetic-jira-private-token',
  };
  const calls: Array<{ url: string; method: string }> = [];
  const fetchFn = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' });
    return new Response(JSON.stringify({ accountId: 'fixture' }));
  }) as unknown as typeof fetch;

  try {
    await ctx.runAllMigrations();
    const repo = new CredentialRepo(ctx.pool);
    const headers = {
      Authorization:
        'Bearer ' +
        generateTokens({ id: 'fixture-admin', email: 'fixture@example.test', name: 'Fixture' }, secret).accessToken,
    };
    const app = createApp({
      jwtSecret: secret,
      encryptionKey: key,
      credentialRepo: repo,
      serviceAdminUserIds: ['fixture-admin'],
      serviceFetchFn: fetchFn,
    });

    expect(normalizeAllowedScope(getServiceDefinition('jira')!, [' ATI ', 'ATI'])).toEqual({ projects: ['ATI'] });

    // 1. Legacy shared Jira routes unconditionally return 410 JIRA_LEGACY_SHARED_DISABLED
    const postCreds = await request(app)
      .post('/api/services/jira/credentials')
      .set(headers)
      .send({ credentials, allowedScope: ['ATI'] });
    expect(postCreds.status).toBe(410);
    expect(postCreds.body.code).toBe('JIRA_LEGACY_SHARED_DISABLED');

    const postTest = await request(app).post('/api/services/jira/test').set(headers).send({});
    expect(postTest.status).toBe(410);
    expect(postTest.body.code).toBe('JIRA_LEGACY_SHARED_DISABLED');

    const delCreds = await request(app).delete('/api/services/jira/credentials').set(headers);
    expect(delCreds.status).toBe(410);
    expect(delCreds.body.code).toBe('JIRA_LEGACY_SHARED_DISABLED');

    // 2. Even if stale encrypted Basic-Auth credentials exist in service_credentials, catalog & factory refuse 'jira'
    const cipher = encryptCredentials({ ...credentials, allowedScope: { projects: ['ATI'] } }, key);
    await repo.saveCredentials('jira', cipher);
    const stored = (await repo.getCredentials('jira'))!;
    expect(stored.config).not.toContain(credentials.apiToken);
    expect(decryptCredentials(stored.config, key)).toEqual({ ...credentials, allowedScope: { projects: ['ATI'] } });

    expect(await getConfiguredToolCatalog(repo, key)).toEqual([]);
    const factory = new AdapterFactory({ credentialRepo: repo, encryptionKey: key });
    await expect(factory.getAdapterForService('jira')).rejects.toThrow(/JIRA_LEGACY_SHARED_DISABLED/);
    expect(calls).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
}, 20_000);
