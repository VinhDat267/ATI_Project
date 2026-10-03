import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import { AIPlanner, WorkingMemory, validatePlan } from '@wap/planner';
import { createApp } from '../../src/app.js';
import { generateTokens } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { getConfiguredToolCatalog, normalizeAllowedScope } from '../../src/services/registered-services.js';
import { getServiceDefinition } from '@wap/tool-schemas';

it('integrates Jira SQL encryption, HTTP SSRF gates, conditional catalog, factory and project/issue key grounding', async () => {
  const schema = 'w305_' + randomUUID().replaceAll('-', '');
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=' + schema });
  const key = 'test-only-encryption-key-with-32bytes'; const secret = 'fixture-jwt-secret-at-least-32-characters';
  const credentials = { siteUrl: 'https://ati-test.atlassian.net', email: 'fixture@example.test', apiToken: 'synthetic-jira-private-token' };
  const calls: Array<{ url: string; method: string }> = [];
  const project = { id: '10000', key: 'ATI', name: 'ATI Project' };
  const issue = { id: '10042', key: 'ATI-42', fields: { project, summary: 'Login bug', status: { name: 'Open' } } };
  const fetchFn = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), method: init.method }); expect(String(url)).toMatch(/^https:\/\/ati-test\.atlassian\.net\/rest\/api\/3\//);
    const result = String(url).includes('/myself') ? { accountId: 'fixture' }
      : String(url).includes('createmeta') ? { startAt: 0, maxResults: 50, total: 1, issueTypes: [{ id: '2', name: 'Task', subtask: false }] }
      : String(url).includes('/search/jql') ? { issues: [issue] }
      : String(url).includes('/comment') ? { id: '900' } : String(url).includes('/issue') ? issue : project;
    return new Response(JSON.stringify(result));
  }) as unknown as typeof fetch;
  try {
    await admin.query('CREATE SCHEMA ' + schema); await admin.query('CREATE TABLE ' + schema + '.service_credentials (LIKE public.service_credentials INCLUDING ALL)');
    const repo = new CredentialRepo(pool);
    const headers = { Authorization: 'Bearer ' + generateTokens({ id: 'fixture-admin', email: 'fixture@example.test', name: 'Fixture' }, secret).accessToken };
    const app = createApp({ jwtSecret: secret, encryptionKey: key, credentialRepo: repo, serviceAdminUserIds: ['fixture-admin'], serviceFetchFn: fetchFn });
    expect(await getConfiguredToolCatalog(repo, key)).toEqual([]);
    const initial = (await request(app).get('/api/services').set(headers)).body.services.find((s: any) => s.id === 'jira');
    expect(initial).toMatchObject({ configured: false, scopeLabel: 'Project key', credentialFields: [{ key: 'siteUrl', type: 'text' }, { key: 'email', type: 'text' }, { key: 'apiToken', type: 'password' }] });
    for (const siteUrl of ['http://ati.atlassian.net', 'https://ati.atlassian.net/', 'https://ati.atlassian.net:443', 'https://evil.com', 'https://x.atlassian.net.evil.com', 'https://a@ati.atlassian.net', 'https://ati.atlassian.net?q=1', 'https://ati-test.atlassian.net\n']) {
      expect((await request(app).post('/api/services/jira/credentials').set(headers).send({ credentials: { ...credentials, siteUrl }, allowedScope: ['ATI'] })).status).toBe(400);
    }
    expect(await repo.getCredentials('jira')).toBeNull(); expect(calls).toEqual([]);
    for (const allowedScope of [[], ['ati'], ['ATI', 'A-B']]) expect((await request(app).post('/api/services/jira/credentials').set(headers).send({ credentials, allowedScope })).status).toBe(400);
    expect(normalizeAllowedScope(getServiceDefinition('jira')!, [' ATI ', 'ATI'])).toEqual({ projects: ['ATI'] });
    expect((await request(app).post('/api/services/jira/credentials').set(headers).send({ credentials, allowedScope: [' ATI ', 'ATI'] })).status).toBe(200);
    const stored = (await repo.getCredentials('jira'))!; expect(stored.config).not.toContain(credentials.apiToken); expect(stored.config).not.toContain(credentials.email);
    expect(decryptCredentials(stored.config, key)).toEqual({ ...credentials, allowedScope: { projects: ['ATI'] } });
    const metadata = (await request(app).get('/api/services').set(headers)).body; expect(JSON.stringify(metadata)).not.toContain(credentials.apiToken); expect(JSON.stringify(metadata)).not.toContain(credentials.email);
    expect((await request(app).post('/api/services/jira/test').set(headers).send({})).body.healthy).toBe(true); expect(calls.map(c => c.url.split('/').at(-1))).toEqual(['myself']);
    const catalog = await getConfiguredToolCatalog(repo, key); expect(catalog.map(t => t.name)).toEqual(['jira.search_projects', 'jira.search_issues', 'jira.create_issue', 'jira.add_comment']);
    vi.stubGlobal('fetch', fetchFn); const factory = new AdapterFactory({ credentialRepo: repo, encryptionKey: key }); const adapter = await factory.getAdapterForService('jira');
    const seen: any[] = [];
    const plan = { kind: 'plan', thinking: 'Use observed project key', summary: 'Create ticket', warnings: [], steps: [{ id: 'create', tool: 'jira.create_issue', description: 'Create', args: { projectKey: 'ATI', summary: 'Login bug' }, dependsOn: [] }] };
    const planner = new AIPlanner({ toolCatalog: catalog, searchMode: 'llm', gatherSearch: ({ tool, args, signal }) => adapter.execute(tool, args, { signal }), provider: { name: 'scripted-contract', async generatePlan(input) { seen.push(input); return JSON.stringify(plan); } } });
    expect((await planner.processMessage({ userMessage: 'Tạo ticket Jira cho lỗi đăng nhập', memory: new WorkingMemory() })).kind).toBe('plan');
    expect(seen[0].workingMemory.__observed.project).toEqual([project]);
    const grounding = { memory: { project: seen[0].workingMemory.__observed.project }, userTexts: [] }; const validated = validatePlan(JSON.stringify(plan), catalog, { grounding }); expect(validated.valid, JSON.stringify(validated)).toBe(true);
    const forged = structuredClone(plan); forged.steps[0]!.args.projectKey = 'OTHER'; expect(validatePlan(JSON.stringify(forged), catalog, { grounding }).valid).toBe(false);
    const before = calls.length; await expect(adapter.execute('jira.create_issue', forged.steps[0]!.args)).rejects.toMatchObject({ category: 'AUTH_ERROR' }); expect(calls).toHaveLength(before);
    const comment = { kind: 'plan', thinking: 'Use observed issue key', summary: 'Comment', warnings: [], steps: [{ id: 'comment', tool: 'jira.add_comment', description: 'Comment', args: { issueKey: 'ATI-42', body: 'Plain' }, dependsOn: [] }] };
    const memory = new WorkingMemory(); let round = 0; const commentInputs: any[] = [];
    const commentPlanner = new AIPlanner({ toolCatalog: catalog, searchMode: 'llm', gatherSearch: ({ tool, args, signal }) => adapter.execute(tool, args, { signal }), provider: { name: 'scripted-search-comment', async generatePlan(input) {
      commentInputs.push(structuredClone(input));
      return JSON.stringify(round++ === 0 ? { kind: 'search', calls: [{ tool: 'jira.search_issues', args: { projectKey: 'ATI', query: 'Login' } }] } : comment);
    } } });
    expect((await commentPlanner.processMessage({ userMessage: 'Add a comment to the Jira ticket for the login bug', memory })).kind).toBe('plan');
    expect(commentInputs).toHaveLength(2);
    const observed = memory.getEntity<{ jira_issue: unknown[] }>('__observed')!.jira_issue;
    expect(observed).toEqual([{ id: '10042', key: 'ATI-42', title: 'Login bug', url: credentials.siteUrl + '/browse/ATI-42' }]);
    expect(commentInputs[1].conversationHistory.at(-1).content).toContain('ATI-42');
    const commentGrounding = { memory: { jira_issue: observed }, userTexts: [] };
    expect(validatePlan(JSON.stringify(comment), catalog, { grounding: commentGrounding }).valid).toBe(true);
    const forgedComment = structuredClone(comment); forgedComment.steps[0]!.args.issueKey = 'ATI-999';
    expect(validatePlan(JSON.stringify(forgedComment), catalog, { grounding: commentGrounding }).valid).toBe(false);
    expect(await adapter.execute('jira.create_issue', plan.steps[0]!.args)).toEqual({ id: '10042', key: 'ATI-42', url: credentials.siteUrl + '/browse/ATI-42' });
    // Simulate stale credentials bypassing the save boundary: unavailable, no SSRF check, factory rejects.
    await repo.saveCredentials('jira', encryptCredentials({ ...credentials, siteUrl: 'https://evil.com', allowedScope: { projects: ['ATI'] } }, key)); factory.clearCache('jira');
    expect(await getConfiguredToolCatalog(repo, key)).toEqual([]); expect((await request(app).get('/api/services').set(headers)).body.services.find((s: any) => s.id === 'jira').configured).toBe(false);
    await expect(factory.getAdapterForService('jira')).rejects.toThrow();
    const precheck = calls.length; expect((await request(app).post('/api/services/jira/test').set(headers).send({})).status).toBe(502); expect(calls).toHaveLength(precheck);
  } finally {
    vi.unstubAllGlobals(); await pool.end(); if (!/^w305_[a-f0-9]{32}$/.test(schema)) throw new Error('Unexpected schema');
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await admin.end();
  }
});
