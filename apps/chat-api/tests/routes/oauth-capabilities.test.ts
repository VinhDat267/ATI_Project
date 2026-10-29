import { afterAll, beforeAll, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { SlackConnectionRepo } from '../../src/db/repositories/slack-connection-repo.js';
import { NotionConnectionRepo } from '../../src/db/repositories/notion-connection-repo.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
let db: Awaited<ReturnType<typeof createMigratedSchema>>;
const secret = 'two-oauth-services-fixture-secret-32chars', key = '0123456789abcdef0123456789abcdef';
beforeAll(async () => { db = await createMigratedSchema('oauth_capabilities'); });
afterAll(async () => { await db?.close(); });
it('advertises both setup capabilities together without registering personal content tools', async () => {
  const user = await db.person();
  const app = createApp({ jwtSecret: secret, userRepo: db.users, encryptionKey: key,
    myslack: { repo: new SlackConnectionRepo(db.pool), oauth: { clientId: 's', clientSecret: 'fixture', appId: 'A_TEST', redirectUri: 'https://ati.example/connections/myslack/callback', authorizationUrl: 'https://slack.com/oauth/v2/authorize', apiBaseUrl: 'https://slack.com/api' } },
    mynotion: { repo: new NotionConnectionRepo(db.pool), oauth: { clientId: 'n', clientSecret: 'fixture', redirectUri: 'https://ati.example/connections/mynotion/callback', authorizationUrl: 'https://api.notion.com/v1/oauth/authorize', apiBaseUrl: 'https://api.notion.com/v1' } },
  });
  const r = await request(app).get('/api/services').set('Authorization', 'Bearer ' + generateAccessToken(user, secret, user.sid).accessToken);
  expect(r.status).toBe(200); expect(r.body.personalOAuth).toEqual(['myslack', 'mynotion']);
  expect(r.body.services.some((s: any) => ['myslack', 'mynotion'].includes(s.id))).toBe(false);
});
it('leaves the baseline response shape unchanged with both flags off', async () => {
  const user = await db.person(), app = createApp({ jwtSecret: secret, userRepo: db.users, encryptionKey: key });
  const r = await request(app).get('/api/services').set('Authorization', 'Bearer ' + generateAccessToken(user, secret, user.sid).accessToken);
  expect(r.status).toBe(200); expect(r.body).not.toHaveProperty('personalOAuth');
});
