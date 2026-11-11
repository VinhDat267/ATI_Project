import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { routeIntent, WorkingMemory } from '@wap/planner';
import { MYJIRA_SERVICE, MYJIRA_G2A_TOOLS, type PlanResponse } from '@wap/tool-schemas';
import {
  serviceRegistryForRuntime,
  runtimeToolCatalog,
  createToolRuntimeFactory,
  mayFallbackToShared,
} from '../../src/config/gmail-tools-runtime.js';
import { getToolCatalogFor } from '../../src/services/registered-services.js';
import { createServicesRoutes } from '../../src/routes/services-routes.js';
import { resourceLabels } from '../../src/services/resource-labels.js';

describe('JIRA-08 Runtime Catalog, Factory, Legacy Route Lock & Resource Labels', () => {
  const fakeCredRepo: any = {
    getCredentials: vi.fn().mockResolvedValue(null),
    getPersonalCredentials: vi.fn().mockResolvedValue(null),
    getPersonalConnectionStatus: vi.fn().mockResolvedValue(null),
  };

  it('includes MYJIRA_SERVICE when myjiraEnabled is true and retires legacy jira unconditionally outside synthetic sandbox scenarios', () => {
    const offRegistry = serviceRegistryForRuntime(false, false, false, false);
    expect(offRegistry.some((s) => s.id === 'jira')).toBe(false);
    expect(offRegistry.some((s) => s.id === 'myjira')).toBe(false);

    const onRegistry = serviceRegistryForRuntime(false, false, false, true);
    expect(onRegistry.some((s) => s.id === 'myjira')).toBe(true);
    expect(onRegistry.find((s) => s.id === 'myjira')).toEqual(MYJIRA_SERVICE);
    expect(onRegistry.some((s) => s.id === 'jira')).toBe(false);
  });

  it('adds MYJIRA_G2A_TOOLS and strips legacy jira.* tools in getToolCatalogFor and runtimeToolCatalog when myjiraEnabled is true', async () => {
    const fakeJiraWorkspaceRepo = {
      getCapabilities: vi.fn().mockResolvedValue({
        workspaceId: 'ws-1',
        sites: [
          {
            siteId: 'site-1',
            cloudId: 'cloud-1',
            siteName: 'Acme Cloud',
            siteUrl: 'https://acme.atlassian.net',
            projects: [{ id: '10001', key: 'ENG', name: 'Engineering' }],
          },
        ],
      }),
    };

    const liveCatalog = await getToolCatalogFor(fakeCredRepo, '0'.repeat(64), {
      userId: 'user-1',
      workspaceMode: 'organization',
      workspaceId: 'ws-1',
      gmailEnabled: false,
      myjiraEnabled: true,
      jiraWorkspaceRepo: fakeJiraWorkspaceRepo,
    });

    expect(liveCatalog.some((t) => t.service === 'jira')).toBe(false);
    expect(liveCatalog.filter((t) => t.service === 'myjira').map((t) => t.name)).toEqual(
      MYJIRA_G2A_TOOLS.map((t) => t.name)
    );

    const sandboxCatalog = await runtimeToolCatalog('sandbox', fakeCredRepo, '0'.repeat(64), {
      userId: 'user-1',
      workspaceMode: 'organization',
      workspaceId: 'ws-1',
      gmailEnabled: false,
      myjiraEnabled: true,
      jiraWorkspaceRepo: fakeJiraWorkspaceRepo,
    });

    expect(sandboxCatalog.some((t) => t.service === 'jira')).toBe(false);
    expect(sandboxCatalog.filter((t) => t.service === 'myjira').map((t) => t.name)).toEqual(
      MYJIRA_G2A_TOOLS.map((t) => t.name)
    );
  });

  it.each(['four_service', 'five_service', 'nine_service'])(
    'sandbox scenario %s still routes Jira to jira.create_issue when MyJira is enabled',
    async (scenario) => {
      const previous = process.env.SANDBOX_SCENARIO;
      process.env.SANDBOX_SCENARIO = scenario;
      try {
        const catalog = await runtimeToolCatalog('sandbox', fakeCredRepo, '0'.repeat(64), {
          userId: 'user-1',
          workspaceMode: 'personal',
          workspaceId: 'personal-1',
          gmailEnabled: true,
          myjiraEnabled: true,
          jiraWorkspaceRepo: {
            getCapabilities: async () => ({ sites: [{ siteId: 'site-1' }] }),
          },
        });
        const registry = serviceRegistryForRuntime(true, false, false, true);
        const route = routeIntent('Tạo ticket sự cố trên Jira và báo Slack', catalog, registry);
        expect(catalog.some((tool) => tool.name === 'jira.create_issue')).toBe(true);
        expect(route.unavailable).toEqual([]);
        expect(route.services).toContain('jira');
      } finally {
        if (previous === undefined) delete process.env.SANDBOX_SCENARIO;
        else process.env.SANDBOX_SCENARIO = previous;
      }
    },
  );

  it('routes myjira to personal adapter factory even in sandbox mode', async () => {
    const personal = vi.fn().mockResolvedValue({ execute: vi.fn() });
    const sandbox = vi.fn().mockImplementation((name: string) => {
      throw new Error(`Unexpected sandbox fallback for ${name}`);
    });
    const factory = createToolRuntimeFactory('sandbox', personal, sandbox as any);

    await factory.getAdapterForService('myjira', {
      userId: 'user-1',
      workspaceId: 'ws-1',
      workspaceMode: 'organization',
      phase: 'planning',
    });

    expect(personal).toHaveBeenCalledWith('myjira', expect.objectContaining({ userId: 'user-1', workspaceId: 'ws-1' }));
    expect(sandbox).not.toHaveBeenCalled();
  });

  it('prevents fallback to shared planner whenever prompt targets Jira regardless of myjiraEnabled', () => {
    const allowedWhenOff = mayFallbackToShared(
      {
        userMessage: 'Tìm các dự án trên Jira site Acme',
        history: [],
        memory: new WorkingMemory(),
      },
      false,
      false,
      false,
      false
    );
    expect(allowedWhenOff).toBe(false);

    const allowedWhenOn = mayFallbackToShared(
      {
        userMessage: 'Tìm các dự án trên Jira site Acme',
        history: [],
        memory: new WorkingMemory(),
      },
      false,
      false,
      false,
      true
    );
    expect(allowedWhenOn).toBe(false);
  });

  it('blocks legacy shared /api/services/jira test and credential routes with 410 when myjiraAvailable is true', async () => {
    const fetchSpy = vi.fn();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { id: 'admin-1', email: 'admin@example.com' };
      req.workspace = { mode: 'organization', workspaceId: 'ws-1', role: 'admin' };
      next();
    });
    app.use(
      '/api/services',
      createServicesRoutes({
        credentialRepo: fakeCredRepo,
        encryptionKey: '0'.repeat(64),
        fetchFn: fetchSpy as any,
        adminUserIds: ['admin-1'],
        myjiraAvailable: true,
      })
    );

    const testRes = await request(app).post('/api/services/jira/test').send({});
    expect(testRes.status).toBe(410);
    expect(fetchSpy).not.toHaveBeenCalled();

    const saveRes = await request(app)
      .post('/api/services/jira/credentials')
      .send({ credentials: { domain: 'acme.atlassian.net', email: 'a@b.com', apiToken: 'tok' }, allowedScope: ['ENG'] });
    expect(saveRes.status).toBe(410);

    const listRes = await request(app).get('/api/services');
    expect(listRes.status).toBe(200);
    expect(listRes.body.services.some((s: any) => s.id === 'jira')).toBe(false);
    expect(listRes.body.services.some((s: any) => s.id === 'myjira')).toBe(true);
  });

  it('resolves resourceLabels for myjira steps from WorkingMemory', () => {
    const memory = new WorkingMemory();
    memory.setEntity('__observed', {
      jira_site: [{ id: 'site-1', siteId: 'site-1', name: 'Acme Jira Cloud' }],
      jira_project: [{ id: 'ENG', key: 'ENG', siteId: 'site-1', name: 'Engineering Platform' }],
    });

    const plan: PlanResponse = {
      kind: 'plan',
      thinking: '',
      summary: 'Tạo issue Jira',
      warnings: [],
      steps: [
        {
          id: 'step_1',
          tool: 'myjira.create_issue',
          description: 'Tạo issue trên Engineering Platform',
          dependsOn: [],
          args: {
            siteId: 'site-1',
            projectKey: 'ENG',
            summary: 'Fix OAuth redirect',
          },
        },
      ],
    };

    const labels = resourceLabels(plan, memory);
    expect(labels['site-1']).toBe('Acme Jira Cloud');
    expect(labels['ENG']).toBe('Engineering Platform');
  });
});
