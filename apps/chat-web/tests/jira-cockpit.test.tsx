/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toolDefinition } from '../src/services/tool-definitions';
import { resourceDestination } from '../src/components/Cockpit';
import { PlanMoment } from '../src/pages/Cockpit/PlanMoment';
import { ReceiptMoment } from '../src/pages/Cockpit/ReceiptMoment';
import { PreviewContents } from '../src/pages/Cockpit/PreviewContents';
import { RequestMoment } from '../src/pages/Cockpit/RequestMoments';
import { RecoveryMoment } from '../src/pages/Cockpit/RecoveryMoment';
import { ScheduleMoment } from '../src/pages/Cockpit/ScheduleMoment';
import { recoveryFieldLabel } from '../src/pages/Cockpit/recovery-labels';
import { ExecutionProgress } from '../src/components/ExecutionProgress';
import { RefusalMoment } from '../src/pages/Responses/ResponseMoment';
import { JiraConnection } from '../src/pages/Settings/JiraConnection';
import { GUIDE_OAUTH_SHOWCASE_CARDS, SERVICE_GUIDES } from '../src/pages/Guide/data';
import { jiraApi } from '../src/services/jira-api';
import { apiClient } from '../src/services/api-client';
import * as jiraConn from '../src/services/jira-connection';
import { authStorage } from '../src/services/auth-storage';
import {
  getActiveWorkspaceId,
  getActiveWorkspaceSummary,
  resetWorkspaceStorage,
  setActiveWorkspaceId,
  setCachedOrganizations,
} from '../src/services/workspace-storage';
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
    cleanup();
    resetWorkspaceStorage();
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

    expect(screen.getByTestId('jira-setup-steps')).toBeInTheDocument();
    expect(screen.getByText(/Bước 1: Tài khoản Atlassian/i)).toBeInTheDocument();
    expect(screen.getByText(/Bước 2: Jira Workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/Bước 3: Site & Projects/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /bắt đầu hội thoại jira/i }));
    expect(getActiveWorkspaceId()).toBe('ws-active-1');
    expect(getActiveWorkspaceSummary().name).toBe('Dev Team');
    expect(navSpy).toHaveBeenCalledWith('/');
  });

  it('sends jiraContext: true in apiClient.createConversation and falls back cleanly on 400', async () => {
    const reqSpy = vi
      .spyOn(apiClient as any, 'request')
      .mockRejectedValueOnce(Object.assign(new Error('Invalid Jira context'), { status: 400 }))
      .mockResolvedValueOnce({ conversation: { id: 'conv-fallback-1' } });

    const res = await apiClient.createConversation(undefined, { jiraContext: true });
    expect(res.conversation.id).toBe('conv-fallback-1');
    expect(reqSpy).toHaveBeenNthCalledWith(1, '/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ jiraContext: true }),
    });
    expect(reqSpy).toHaveBeenNthCalledWith(2, '/api/conversations', {
      method: 'POST',
      body: undefined,
    });
  });

  it('renders jira-context-ready-pill and multi-service playbooks for myjira in RequestMoment', () => {
    setCachedOrganizations([{ id: 'ws-eng-1', name: 'Engineering Org', role: 'admin', status: 'active' }]);
    setActiveWorkspaceId('ws-eng-1');

    render(
      <RequestMoment
        services={[
          { id: 'myjira', name: 'Atlassian Jira', connected: true, configured: true, personalStatus: 'connected' },
          { id: 'gmail', name: 'Gmail', connected: true, configured: true, personalStatus: 'connected' },
          { id: 'slack', name: 'Slack', connected: true, configured: true },
        ]}
        loading={false}
        error={null}
        draft=""
        planning={false}
        input={{ current: null }}
        onDraft={() => {}}
        onSend={() => {}}
        onKeyDown={() => {}}
        onSettings={() => {}}
        navigate={() => {}}
        servicePrompt={(s) => s.name}
      />
    );

    expect(screen.getByTestId('jira-context-ready-pill')).toHaveTextContent('Jira: Sẵn sàng làm việc');
    expect(screen.getByTestId('multi-service-playbooks')).toBeInTheDocument();
    expect(screen.getByText(/Xử lý lỗi khách hàng & điều phối Jira Sprint/i)).toBeInTheDocument();
  });

  it('renders inline myjira-step-pills on PlanMoment cards', () => {
    const plan: ActivePlan = {
      id: 'plan-jira-pills',
      summary: 'Cập nhật và chuyển trạng thái Jira',
      steps: [
        {
          id: 's1',
          tool: 'myjira.create_issue',
          description: 'Tạo bug ưu tiên cao',
          args: {
            siteId: 'site-1',
            projectKey: 'ENG',
            issueType: 'Bug',
            priority: 'High',
            assigneeAccountId: 'acc-alice',
            dueDate: '2026-11-15',
            parentKey: 'ENG-10',
            summary: 'Sửa lỗi memory leak',
          },
        },
        {
          id: 's2',
          tool: 'myjira.transition_issue',
          description: 'Chuyển ENG-42 sang In Progress',
          args: {
            siteId: 'site-1',
            issueKey: 'ENG-42',
            targetStatus: 'In Progress',
          },
        },
      ],
      resourceLabels: {
        'acc-alice': 'Alice Nguyễn',
      },
    };

    render(
      <PlanMoment
        runtimeMode="sandbox"
        plan={plan}
        services={[{ id: 'myjira', name: 'Atlassian Jira', connected: true, configured: true }]}
        destination={resourceDestination}
        onPreview={() => {}}
        onApprove={() => {}}
        onCancel={() => {}}
        onEdit={() => {}}
        inlineComposer={null}
      />
    );

    const pillGroups = screen.getAllByTestId('myjira-step-pills');
    expect(pillGroups).toHaveLength(2);
    expect(screen.getByText(/⚡ Ưu tiên: High/i)).toBeInTheDocument();
    expect(screen.getByText(/🏷️ Bug/i)).toBeInTheDocument();
    expect(screen.getByText(/👤 Phụ trách: Alice Nguyễn/i)).toBeInTheDocument();
    expect(screen.getByText(/📅 Hạn: 2026-11-15/i)).toBeInTheDocument();
    expect(screen.getByText(/🔗 Epic: ENG-10/i)).toBeInTheDocument();
    expect(screen.getByText(/🎫 ENG-42/i)).toBeInTheDocument();
    expect(screen.getByText(/🔄 → In Progress/i)).toBeInTheDocument();
  });

  it('renders rich Jira output fields in ExecutionProgress and ReceiptMoment', () => {
    const { unmount } = render(
      <ExecutionProgress
        steps={[
          {
            id: 's1',
            tool: 'myjira.get_issue',
            description: 'Đọc chi tiết ENG-42',
            status: 'succeeded',
            output: {
              id: '10042',
              key: 'ENG-42',
              summary: 'Khắc phục lỗi OAuth callback',
              status: 'In Progress',
              priority: 'High',
              issueType: 'Bug',
              assignee: 'Alice Nguyễn',
              dueDate: '2026-11-20',
              comments: [{ id: 'c1', author: 'Bob', body: 'Đã kiểm tra', createdAt: '2026-11-01' }],
              subtasks: [],
              url: 'https://acme.atlassian.net/browse/ENG-42',
            },
          },
        ]}
      />
    );

    expect(screen.getByText('Khắc phục lỗi OAuth callback')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Alice Nguyễn')).toBeInTheDocument();
    expect(screen.getByText('2026-11-20')).toBeInTheDocument();
    expect(screen.getByText('1 bình luận')).toBeInTheDocument();
    unmount();

    const transition = render(
      <ReceiptMoment
        request="Chuyển trạng thái ENG-42"
        steps={[
          {
            id: 's1',
            tool: 'myjira.transition_issue',
            description: 'Chuyển ENG-42 sang Done',
            status: 'succeeded',
            output: {
              issueKey: 'ENG-42',
              previousStatus: 'In Progress',
              newStatus: 'Done',
              url: 'https://acme.atlassian.net/browse/ENG-42',
            },
          },
        ]}
        planSteps={[
          {
            id: 's1',
            tool: 'myjira.transition_issue',
            description: 'Chuyển ENG-42 sang Done',
            args: { siteId: 'site-1', issueKey: 'ENG-42', targetStatus: 'Done' },
          },
        ]}
        services={[{ id: 'myjira', name: 'Atlassian Jira', connected: true, configured: true }]}
        destination={resourceDestination}
        onNewConversation={() => {}}
        onFollowup={() => {}}
      />
    );

    expect(screen.getByTestId('myjira-receipt-metrics')).toHaveTextContent('🔄 Trạng thái: In Progress → Done');
    transition.unmount();

    render(
      <ReceiptMoment
        request="Chuyển trạng thái ENG-42"
        steps={[
          {
            id: 's1',
            tool: 'myjira.transition_issue',
            description: 'Chuyển ENG-42 sang Done',
            status: 'succeeded',
            output: { siteId: 'site-1', id: '10042', key: 'ENG-42', status: 'Done', url: 'https://acme.atlassian.net/browse/ENG-42' },
          },
        ]}
        planSteps={[
          {
            id: 's1',
            tool: 'myjira.transition_issue',
            description: 'Chuyển ENG-42 sang Done',
            args: { siteId: 'site-1', issueKey: 'ENG-42', status: 'Done' },
          },
        ]}
        services={[{ id: 'myjira', name: 'Atlassian Jira', connected: true, configured: true }]}
        destination={resourceDestination}
        onNewConversation={() => {}}
        onFollowup={() => {}}
      />
    );
    expect(screen.getByTestId('myjira-receipt-metrics')).toHaveTextContent('🔄 Trạng thái: Done');
  });

  it('supports Vietnamese recovery labels, Moment 8 check link, ScheduleMoment myjira_digest, and Guide OAuth card', () => {
    expect(recoveryFieldLabel('myjira.transition_issue', 'targetStatus')).toBe('Trạng thái chuyển tới');
    expect(recoveryFieldLabel('myjira.create_issue', 'assigneeAccountId')).toBe('Người phụ trách (Account ID)');

    const { unmount } = render(
      <RecoveryMoment
        moment={8}
        snapshot={{
          execution: { id: 'ex-1', planId: 'p-1', status: 'paused', pausedStepId: 's1' } as any,
          plan: {
            id: 'p-1',
            convId: 'conv-1',
            status: 'paused',
            summary: 'Tạo issue Jira',
            steps: [
              {
                id: 's1',
                tool: 'myjira.create_issue',
                description: 'Tạo issue ENG',
                args: { siteId: 'site-1', projectKey: 'ENG', summary: 'Task 1' },
              },
            ],
            connections: {
              myjira: {
                atiUserId: 'user-1',
                jiraAccountId: 'jira-1',
                atlassianAccountId: 'atl-alice',
                workspaceId: 'ws-1',
                workspaceVersion: 1,
                membershipVersion: 1,
                grantId: 'g-1',
                identityVersion: 1,
                siteSteps: {},
              },
            },
          },
          steps: [{ stepId: 's1', status: 'unknown' } as any],
          recoveryActions: ['skip', 'stop'],
        }}
        steps={[
          {
            id: 's1',
            tool: 'myjira.create_issue',
            description: 'Tạo issue ENG',
            status: 'unknown',
          },
        ]}
        services={[{ id: 'myjira', name: 'Atlassian Jira', connected: true, configured: true }]}
        controls={{
          busy: false,
          error: null,
          onRetry: () => {},
          onSkip: () => {},
          onStop: () => {},
          onContinue: () => {},
          onEdit: () => {},
        }}
      />
    );

    expect(screen.getByRole('link', { name: /Mở Jira kiểm tra/i })).toHaveAttribute(
      'href',
      'https://www.atlassian.com/software/jira'
    );
    unmount();

    render(
      <ScheduleMoment
        digestCandidate={{
          kind: 'myjira_digest',
          canAutoDigest: true,
          summary: 'Bản tin Standup Jira mỗi sáng',
          config: {
            workspaceId: 'ws-1',
            grantId: 'g-1',
            atlassianAccountId: 'atl-alice',
            projects: [{ siteId: 'site-1', siteName: 'Acme Jira', projectKey: 'ENG' }],
            channelId: 'C123',
            channelName: 'eng-standup',
          },
        }}
      />
    );

    expect(screen.getByText(/Tự gửi bản tin Standup & Blocker Jira, không cần duyệt lại/i)).toBeInTheDocument();
    expect(screen.getByText(/Dự án Jira: Acme Jira · ENG/i)).toBeInTheDocument();

    expect(GUIDE_OAUTH_SHOWCASE_CARDS.some((c) => c.service === 'jira')).toBe(true);
    expect(SERVICE_GUIDES.jira.keys.join(' ')).toContain('Site URL');
  });

  it('renders G2A read-only and D09-LLM-OFF policy banner in JiraConnection settings without breaking direct directory UI', async () => {
    vi.spyOn(jiraApi, 'connection').mockResolvedValue({
      connected: true,
      connectionState: 'connected',
      atlassianAccountId: 'atl-1',
      displayName: 'Alice',
      sites: [{ cloudId: 'c1', name: 'Acme', url: 'https://acme.atlassian.net', scopes: ['read:jira-work'] }],
    } as any);
    vi.spyOn(jiraApi, 'workspaces').mockResolvedValue({ workspaces: [] } as any);

    render(<JiraConnection user={user} />);
    await waitFor(() => {
      expect(screen.getByTestId('jira-g2a-policy-banner')).toBeInTheDocument();
    });
    expect(screen.getByTestId('jira-g2a-policy-banner')).toHaveTextContent(/D09-LLM-OFF/i);
    expect(screen.getByTestId('jira-g2a-policy-banner')).toHaveTextContent(/read:jira-work/i);
  });
});
