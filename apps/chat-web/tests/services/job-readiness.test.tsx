import { describe, it, expect } from 'vitest';
import {
  evaluateJobReadiness,
  CORE_JOBS,
} from '../../src/services/job-readiness';
import type { ServiceInfo } from '../../src/types';

describe('Job Readiness Evaluation (FLOW-04)', () => {
  it('defines the 6 core jobs with required services and metadata', () => {
    expect(CORE_JOBS).toHaveLength(6);
    const ids = CORE_JOBS.map((j) => j.id);
    expect(ids).toEqual(['OFF-02', 'OFF-03', 'PM-01', 'PM-03', 'DEV-02', 'DEV-04']);
  });

  it('does NOT mark a 9-service playbook as ready when only 2 services are connected', () => {
    const services: ServiceInfo[] = [
      { id: 'mycalendar', name: 'Google Calendar', configured: true, connected: true, connectionStatus: 'healthy' },
      { id: 'myslack', name: 'Slack', configured: true, connected: true, connectionStatus: 'healthy' },
      { id: 'mysheets', name: 'Google Sheets', configured: false, connected: false, connectionStatus: 'unconfigured' },
      { id: 'github', name: 'GitHub', configured: false, connected: false, connectionStatus: 'unconfigured' },
      { id: 'trello', name: 'Trello', configured: false, connected: false, connectionStatus: 'unconfigured' },
      { id: 'myjira', name: 'Jira', configured: false, connected: false, connectionStatus: 'unconfigured' },
      { id: 'notion', name: 'Notion', configured: false, connected: false, connectionStatus: 'unconfigured' },
      { id: 'gmail', name: 'Gmail', configured: false, connected: false, connectionStatus: 'unconfigured' },
      { id: 'telegram', name: 'Telegram', configured: false, connected: false, connectionStatus: 'unconfigured' },
    ];

    const nineServiceReqs = ['calendar', 'jira', 'github', 'trello', 'notion', 'sheets', 'gmail', 'telegram', 'slack'];
    const readiness = evaluateJobReadiness(nineServiceReqs, services);

    expect(readiness.status).toBe('needs_connection');
    expect(readiness.missingServices.length).toBe(7);
    expect(readiness.isReady).toBe(false);
  });

  it('marks OFF-03 as ready when Sheets and Slack are fully configured and healthy', () => {
    const services: ServiceInfo[] = [
      {
        id: 'mysheets',
        name: 'Google Sheets',
        configured: true,
        connected: true,
        connectionStatus: 'healthy',
        tools: ['mysheets.read_sheet', 'mysheets.list_spreadsheets'],
      },
      {
        id: 'myslack',
        name: 'Slack',
        configured: true,
        connected: true,
        connectionStatus: 'healthy',
        tools: ['myslack.chat_postMessage'],
      },
    ];

    const off03Job = CORE_JOBS.find((j) => j.id === 'OFF-03')!;
    const readiness = evaluateJobReadiness(off03Job.requiredServices, services);

    expect(readiness.status).toBe('ready');
    expect(readiness.isReady).toBe(true);
    expect(readiness.missingServices).toHaveLength(0);
  });

  it('reports needs_reauth when an existing connection is unhealthy or expired', () => {
    const services: ServiceInfo[] = [
      {
        id: 'github',
        name: 'GitHub',
        configured: true,
        connected: false,
        connectionStatus: 'unhealthy',
      },
      {
        id: 'myslack',
        name: 'Slack',
        configured: true,
        connected: true,
        connectionStatus: 'healthy',
      },
    ];

    const dev02Job = CORE_JOBS.find((j) => j.id === 'DEV-02')!;
    const readiness = evaluateJobReadiness(dev02Job.requiredServices, services);

    expect(readiness.status).toBe('needs_reauth');
    expect(readiness.isReady).toBe(false);
    expect(readiness.unhealthyServices).toContain('github');
  });

  it('reports needs_resource when a connected service lacks selected resources', () => {
    const services: ServiceInfo[] = [
      {
        id: 'trello',
        name: 'Trello',
        configured: true,
        connected: true,
        connectionStatus: 'healthy',
        personalStatus: 'needs_scope',
      },
      {
        id: 'myslack',
        name: 'Slack',
        configured: true,
        connected: true,
        connectionStatus: 'healthy',
      },
    ];

    const pm01Job = CORE_JOBS.find((j) => j.id === 'PM-01')!;
    const readiness = evaluateJobReadiness(pm01Job.requiredServices, services);

    expect(readiness.status).toBe('needs_resource');
    expect(readiness.isReady).toBe(false);
    expect(readiness.missingResourceServices).toContain('trello');
  });
});
