import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toolDefinition } from '../src/services/tool-definitions';
import { resourceDestination } from '../src/components/Cockpit';
import { PlanMoment } from '../src/pages/Cockpit/PlanMoment';
import { ReceiptMoment } from '../src/pages/Cockpit/ReceiptMoment';
import { PreviewContents } from '../src/pages/Cockpit/PreviewContents';
import { RefusalMoment } from '../src/pages/Responses/ResponseMoment';
import { JiraConnection } from '../src/pages/Settings/JiraConnection';
import { jiraApi } from '../src/services/jira-api';
import * as jiraConn from '../src/services/jira-connection';
import { authStorage } from '../src/services/auth-storage';
import type { ActivePlan, PlanStep, User } from '../src/types';

describe('JIRA-09B: Jira Cockpit UI integration', () => {
  const user: User = {
    id: 'user-1',
    email: 'admin@ati.test',
    name: 'Admin User',
    role: 'admin',
    status: 'active',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    authStorage.setStoredTokens({
      accessToken: 'test-jira-token',
      refreshToken: 'test-jira-refresh',
      user,
    });
  });

  afterEach(() => {
    authStorage.clearStoredTokens();
    vi.restoreAllMocks();
  });

  it('resolves MYJIRA_TOOLS via toolDefinition()', () => {
    expect(toolDefinition('myjira.list_sites')?.service).toBe('myjira');
    expect(toolDefinition('myjira.search_projects')?.service).toBe('myjira');
    expect(toolDefinition('myjira.search_issues')?.service).toBe('myjira');
    expect(toolDefinition('myjira.create_issue')?.service).toBe('myjira');
    expect(toolDefinition('myjira.create_issue')?.sideEffect).toBe('write');
    expect(toolDefinition('myjira.add_comment')?.service).toBe('myjira');
    expect(toolDefinition('myjira.add_comment')?.sideEffect).toBe('write');
  });

  it('formats resourceDestination for myjira steps with siteId, projectKey, and issueKey', () => {
    const createStep: PlanStep = {
      id: 's1',
      tool: 'myjira.create_issue',
      description: 'Tạo issue mới trên dự án ENG',
      args: {
        siteId: 'site-1',
        projectKey: 'ENG',
        summary: 'Sửa lỗi OAuth 3LO',
      },
    };
    const commentStep: PlanStep = {
      id: 's2',
      tool: 'myjira.add_comment',
      description: 'Thêm bình luận vào ENG-42',
      args: {
        siteId: 'site-1',
        issueKey: 'ENG-42',
        body: 'Đã kiểm tra xong',
      },
    };

    const labels = {
      'jira_site:site-1': 'Acme Jira (https://acme.atlassian.net)',
    };

    expect(resourceDestination(createStep, labels)).toBe('Acme Jira (https://acme.atlassian.net) · ENG');
    expect(resourceDestination(commentStep, labels)).toBe('Acme Jira (https://acme.atlassian.net) · ENG-42');
  });

  it('renders PreviewContents for myjira.create_issue and myjira.add_comment', () => {
    const createStep: PlanStep = {
      id: 's1',
      tool: 'myjira.create_issue',
      description: 'Tạo issue',
      args: {
        siteId: 'site-1',
        projectKey: 'ENG',
        issueType: 'Bug',
        summary: 'Lỗi đăng nhập Jira',
        description: 'Chi tiết lỗi đăng nhập',
      },
    };
    const commentStep: PlanStep = {
      id: 's2',
      tool: 'myjira.add_comment',
      description: 'Bình luận issue',
      args: {
        siteId: 'site-1',
        issueKey: 'ENG-42',
        body: 'Đã khắc phục xong trên nhánh main',
      },
    };

    const { unmount } = render(
      <PreviewContents
        step={createStep}
        destination={resourceDestination(createStep, { 'jira_site:site-1': 'Acme Jira' })}
      />
    );
    expect(screen.getByText(/Acme Jira · ENG/i)).toBeInTheDocument();
    expect(screen.getByText(/Lỗi đăng nhập Jira/i)).toBeInTheDocument();
    expect(screen.getByText(/Chi tiết lỗi đăng nhập/i)).toBeInTheDocument();
    expect(screen.getByText(/Loại issue:/i)).toBeInTheDocument();
    expect(screen.getByText('Bug')).toBeInTheDocument();
    unmount();

    render(
      <PreviewContents
        step={commentStep}
        destination={resourceDestination(commentStep, { 'jira_site:site-1': 'Acme Jira' })}
      />
    );
    expect(screen.getByText(/Acme Jira · ENG-42/i)).toBeInTheDocument();
    expect(screen.getByText(/Đã khắc phục xong trên nhánh main/i)).toBeInTheDocument();
  });

  it('renders PlanMoment with myjira connection account, workspace, and bound site/project', () => {
    const step: PlanStep = {
      id: 's1',
      tool: 'myjira.create_issue',
      description: 'Tạo issue trên dự án ENG',
      args: {
        siteId: 'site-1',
        projectKey: 'ENG',
        summary: 'Triển khai JIRA-09B',
      },
    };
    const plan: ActivePlan = {
      id: 'plan-jira-1',
      summary: 'Tạo issue trên dự án ENG',
      steps: [step],
      resourceLabels: {
        'jira_site:site-1': 'Acme Jira',
        'jira_project:ENG': 'Engineering (ENG)',
      },
      connections: {
        myjira: {
          atiUserId: 'user-1',
          jiraAccountId: 'jira-acc-1',
          atlassianAccountId: 'atl-alice-99',
          workspaceId: 'ws-eng-1',
          workspaceVersion: 1,
          membershipVersion: 2,
          grantId: 'grant-1',
          identityVersion: 3,
          siteSteps: {
            s1: {
              siteId: 'site-1',
              cloudId: 'cloud-1',
              sitePolicyVersion: 4,
              projectId: '10001',
              projectPolicyVersion: 1,
            },
          },
        },
      },
    };

    render(
      <PlanMoment
        runtimeMode="sandbox"
        plan={plan}
        services={[{ id: 'myjira', name: 'Atlassian Jira', connected: true, configured: true, personalStatus: 'connected' }]}
        destination={resourceDestination}
        onPreview={() => {}}
        onApprove={() => {}}
        onCancel={() => {}}
        onEdit={() => {}}
        inlineComposer={null}
      />
    );

    expect(screen.getByText(/atl-alice-99/i)).toBeInTheDocument();
    expect(screen.getByText(/ws-eng-1/i)).toBeInTheDocument();
    expect(screen.getByText(/Site đích: Acme Jira · Dự án: ENG/i)).toBeInTheDocument();
  });

  it('renders ReceiptMoment with myjira connection account, workspace, and bound site/project', () => {
    const step: PlanStep = {
      id: 's1',
      tool: 'myjira.create_issue',
      description: 'Tạo issue trên dự án ENG',
      args: {
        siteId: 'site-1',
        projectKey: 'ENG',
        summary: 'Triển khai JIRA-09B',
      },
    };
    const myjiraConnection: NonNullable<ActivePlan['connections']>['myjira'] = {
      atiUserId: 'user-1',
      jiraAccountId: 'jira-acc-1',
      atlassianAccountId: 'atl-alice-99',
      workspaceId: 'ws-eng-1',
      workspaceVersion: 1,
      membershipVersion: 2,
      grantId: 'grant-1',
      identityVersion: 3,
      siteSteps: {
        s1: {
          siteId: 'site-1',
          cloudId: 'cloud-1',
          sitePolicyVersion: 4,
          projectId: '10001',
          projectPolicyVersion: 1,
        },
      },
    };

    render(
      <ReceiptMoment
        request="Tạo issue Jira"
        steps={[
          {
            id: 's1',
            tool: 'myjira.create_issue',
            description: 'Tạo issue trên dự án ENG',
            status: 'succeeded',
            duration: '0,4 giây',
            output: { key: 'ENG-101', url: 'https://acme.atlassian.net/browse/ENG-101' },
          },
        ]}
        planSteps={[step]}
        services={[{ id: 'myjira', name: 'Atlassian Jira', connected: true, configured: true, personalStatus: 'connected' }]}
        labels={{ 'jira_site:site-1': 'Acme Jira' }}
        myjiraConnection={myjiraConnection}
        destination={resourceDestination}
        onNewConversation={() => {}}
        onFollowup={() => {}}
      />
    );

    expect(screen.getByText('ENG-101')).toBeInTheDocument();
    expect(screen.getByText(/atl-alice-99/i)).toBeInTheDocument();
    expect(screen.getByText(/ws-eng-1/i)).toBeInTheDocument();
    expect(screen.getByText(/Site đích: Acme Jira · Dự án: ENG/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Mở trong Jira/i })).toHaveAttribute(
      'href',
      'https://acme.atlassian.net/browse/ENG-101'
    );
  });

  it('handles myjira in RefusalMoment: starts OAuth when disconnected and links to /settings#jira when scope_required', async () => {
    const startSpy = vi.spyOn(jiraApi, 'start').mockResolvedValue({ authUrl: 'https://auth.atlassian.com/authorize?state=st-1' });
    const redirectSpy = vi.spyOn(jiraConn, 'redirectToJira').mockImplementation(() => {});
    const navSpy = vi.fn();

    const convId = '11111111-1111-4111-8111-111111111111';
    const { unmount } = render(
      <RefusalMoment
        request="Tạo issue Jira trên dự án ENG"
        conversationId={convId}
        message={{
          id: 'msg-refusal-1',
          role: 'assistant',
          content: 'Từ chối yêu cầu: Bạn cần kết nối Jira trước khi tạo issue.',
          metadata: {
            reason: 'Bạn cần kết nối Jira trước khi tạo issue.',
            unavailableServices: [{ id: 'myjira', name: 'Atlassian Jira' }],
          },
        }}
        services={[{ id: 'myjira', name: 'Atlassian Jira', connected: false, configured: false, personalStatus: 'disconnected' }]}
        canConfigure={true}
        navigate={navSpy}
        onEdit={() => {}}
      />
    );

    const connectBtn = screen.getByRole('link', { name: /Kết nối Atlassian Jira/i });
    fireEvent.click(connectBtn);

    await waitFor(() => {
      expect(startSpy).toHaveBeenCalledWith('identity', `/c/${convId}`);
      expect(redirectSpy).toHaveBeenCalledWith('https://auth.atlassian.com/authorize?state=st-1');
    });
    unmount();

    render(
      <RefusalMoment
        request="Tạo issue Jira trên dự án ENG"
        conversationId={convId}
        message={{
          id: 'msg-refusal-2',
          role: 'assistant',
          content: 'Từ chối yêu cầu: Bạn cần cấp quyền site Jira.',
          metadata: {
            reason: 'Bạn cần cấp quyền site Jira.',
            unavailableServices: [{ id: 'myjira', name: 'Atlassian Jira' }],
          },
        }}
        services={[{ id: 'myjira', name: 'Atlassian Jira', connected: false, configured: false, personalStatus: 'scope_required' }]}
        canConfigure={true}
        navigate={navSpy}
        onEdit={() => {}}
      />
    );

    expect(screen.getByText('Cần cấp quyền site')).toBeInTheDocument();
    const scopeLink = screen.getByRole('link', { name: /Cấp quyền site Atlassian Jira/i });
    expect(scopeLink).toHaveAttribute('href', '/settings#jira');
    fireEvent.click(scopeLink);
    expect(navSpy).toHaveBeenCalledWith('/settings#jira');
  });

  it('enables #jira-start-conversation in JiraConnection when connected with active workspace and capability sites', async () => {
    const navSpy = vi.fn();
    vi.spyOn(jiraApi, 'connection').mockResolvedValue({
      connected: true,
      connectionState: 'connected',
      jiraAccountId: 'jira-123',
      atlassianAccountId: 'atl-123',
      displayName: 'Alice Atlassian',
      sites: [{ cloudId: 'cloud-1', name: 'Acme Jira', url: 'https://acme.atlassian.net' }],
    });
    vi.spyOn(jiraApi, 'workspaces').mockResolvedValue({
      workspaces: [
        {
          id: 'ws-active-1',
          name: 'Dev Team',
          slug: 'dev-team',
          role: 'member',
          membershipStatus: 'active',
          workspaceVersion: 1,
          membershipVersion: 1,
        },
      ],
    });
    vi.spyOn(jiraApi, 'capabilities').mockResolvedValue({
      workspaceId: 'ws-active-1',
      sites: [
        {
          siteId: 'site-1',
          cloudId: 'cloud-1',
          name: 'Acme Jira',
          url: 'https://acme.atlassian.net',
          projects: [{ id: '10001', key: 'ENG', name: 'Engineering' }],
        },
      ],
    });

    render(<JiraConnection user={user} navigate={navSpy} />);

    await waitFor(() => {
      const cta = screen.getByRole('button', { name: /bắt đầu hội thoại jira/i });
      expect(cta).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /bắt đầu hội thoại jira/i }));
    expect(navSpy).toHaveBeenCalledWith('/');
  });
});
