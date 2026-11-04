// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import {
  RequestMoment,
  extractPlaybookVariables,
  applyPlaybookVariables,
} from '../../src/pages/Cockpit/RequestMoments';
import { toolDefinition } from '../../src/services/tool-definitions';
import presentation from '../../src/assets/cockpit-services.json';
import type { ServiceInfo } from '../../src/types';

describe('1-Click Parameterized Playbooks & Extended Slack/GitHub Catalog', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('extracts and applies {{biến_số}} placeholders cleanly', () => {
    const template =
      'Tạo cuộc họp Google Meet cho {{tên_dự_án}} mời {{email_khách}} và lưu vào thư mục {{tên_dự_án}}';
    expect(extractPlaybookVariables(template)).toEqual(['tên_dự_án', 'email_khách']);

    const partial = applyPlaybookVariables(template, { tên_dự_án: 'Fintech Q4' });
    expect(partial).toBe(
      'Tạo cuộc họp Google Meet cho Fintech Q4 mời {{email_khách}} và lưu vào thư mục Fintech Q4',
    );

    const full = applyPlaybookVariables(template, {
      tên_dự_án: 'Fintech Q4',
      email_khách: 'ceo@partner.vn',
    });
    expect(full).toBe(
      'Tạo cuộc họp Google Meet cho Fintech Q4 mời ceo@partner.vn và lưu vào thư mục Fintech Q4',
    );
  });

  it('resolves slack.read_messages and github.list_pull_requests in toolDefinition and cockpit-services.json', () => {
    expect(toolDefinition('slack.read_messages')?.service).toBe('slack');
    expect(toolDefinition('github.list_pull_requests')?.service).toBe('github');
    expect((presentation.operations as Record<string, any>)['slack.read_messages']).toBeDefined();
    expect((presentation.operations as Record<string, any>)['github.list_pull_requests']).toBeDefined();
  });

  it('renders Quick Variable Fill Bar when a parameterized playbook is selected and saves Custom Playbook 1-Click', () => {
    const services: ServiceInfo[] = [
      { id: 'mycalendar', name: 'Google Calendar', configured: true, connected: true, connectionStatus: 'healthy' },
      { id: 'mysheets', name: 'Google Sheets', configured: true, connected: true, connectionStatus: 'healthy' },
      { id: 'gmail', name: 'Gmail', configured: true, connected: true, connectionStatus: 'healthy' },
    ];
    let currentDraft = '';
    const onDraft = vi.fn((val: string) => {
      currentDraft = val;
    });
    const onSend = vi.fn();
    const inputRef = createRef<HTMLTextAreaElement>();

    const { rerender } = render(
      <RequestMoment
        services={services}
        loading={false}
        error={null}
        draft={currentDraft}
        planning={false}
        input={inputRef}
        onDraft={onDraft}
        onSend={onSend}
        onKeyDown={() => {}}
        onSettings={() => {}}
        navigate={() => {}}
        servicePrompt={(s) => `Dùng ${s.name}`}
      />,
    );

    const googlePlaybookBtn = screen.getByRole('button', {
      name: /Hệ sinh thái Google Workspace/i,
    });
    fireEvent.click(googlePlaybookBtn);
    expect(onDraft).toHaveBeenCalled();

    rerender(
      <RequestMoment
        services={services}
        loading={false}
        error={null}
        draft={currentDraft}
        planning={false}
        input={inputRef}
        onDraft={onDraft}
        onSend={onSend}
        onKeyDown={() => {}}
        onSettings={() => {}}
        navigate={() => {}}
        servicePrompt={(s) => `Dùng ${s.name}`}
      />,
    );

    expect(screen.getByTestId('playbook-variables-bar')).toBeDefined();
    const projectInput = screen.getByLabelText('Biến số tên_dự_án');
    fireEvent.change(projectInput, { target: { value: 'AI Hub 2026' } });
    expect(currentDraft).toContain('AI Hub 2026');

    // Save as custom 1-Click Playbook
    const saveBtn = screen.getByTestId('btn-save-playbook');
    fireEvent.click(saveBtn);

    const titleInput = screen.getByLabelText('Tên Playbook 1-Click');
    fireEvent.change(titleInput, { target: { value: 'Playbook Khởi động Dự án VIP' } });
    fireEvent.click(screen.getByTestId('btn-confirm-save-playbook'));

    expect(screen.getByTestId('custom-playbooks-section')).toBeDefined();
    expect(screen.getByText('Playbook Khởi động Dự án VIP')).toBeDefined();
  });
});
