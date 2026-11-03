import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, SERVICE_REGISTRY, MYJIRA_SERVICE, MYJIRA_TOOLS } from '@wap/tool-schemas';
import { routeIntent } from '../src/router.js';

const services = [...SERVICE_REGISTRY, MYJIRA_SERVICE];
const enabled = [...ALL_TOOLS.filter(tool => tool.service !== 'jira'), ...MYJIRA_TOOLS];

describe('personal Jira routing', () => {
  it.each([
    'Tạo ticket Jira',
    'Thêm bình luận vào ticket ATI-12 trên Jira',
    'Tạo ticket trên jira cá nhân',
    'Kiểm tra my jira',
    'Cập nhật tiến độ trên jira riêng của mình',
    'Tạo ticket mới cho sprint',
  ])('routes %s through myjira when enabled', message => {
    expect(routeIntent(message, enabled, services)).toEqual({ services: ['myjira'], unavailable: [] });
  });

  it('retains Slack in a mixed workflow', () => {
    expect(routeIntent('Tạo ticket Jira rồi báo Slack', enabled, services).services).toEqual(['slack', 'myjira']);
  });

  it('retains Trello in a mixed workflow', () => {
    expect(routeIntent('Tạo card Trello rồi liên kết ticket Jira', enabled, services).services).toEqual(['trello', 'myjira']);
  });

  it('does not silently route back to legacy Jira when personal Jira is unavailable', () => {
    expect(routeIntent('Tạo ticket Jira', ALL_TOOLS, services)).toEqual({
      services: [],
      unavailable: [{ id: 'myjira', name: 'Jira' }],
    });
  });

  it('reports both unavailable services when Jira and another service are not connected', () => {
    const toolsWithoutJiraOrSlack = ALL_TOOLS.filter(t => t.service !== 'jira' && t.service !== 'slack');
    const result = routeIntent('Tạo ticket Jira rồi báo Slack', toolsWithoutJiraOrSlack, services);
    expect(result.services).toEqual([]);
    expect(result.unavailable).toEqual([
      { id: 'slack', name: 'Slack' },
      { id: 'myjira', name: 'Jira' },
    ]);
  });

  it('preserves legacy routing when the personal service is not registered', () => {
    expect(routeIntent('Tạo ticket Jira', ALL_TOOLS, SERVICE_REGISTRY).services).toEqual(['jira']);
    expect(routeIntent('Thêm comment vào ticket ATI-12', ALL_TOOLS, SERVICE_REGISTRY).services).toEqual(['jira']);
  });
});
