/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { LandingPage } from '../src/pages/Landing/LandingPage';
import { Cockpit } from '../src/components/Cockpit';
import { apiClient } from '../src/services/api-client';
import { useChatStore } from '../src/store/chat-store';

describe('LandingPage — Make.com Orbital & OAuth 1-Click Redesign', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({
      runtimeMode: 'sandbox',
      gmailEnabled: false,
      mysheetsEnabled: false,
      mycalendarEnabled: false,
      schedulesEnabled: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('Item #1: renders Planora Hero Rotator with trust pills, 14 paper edge layers, and no dangling dot', () => {
    const navigate = vi.fn();
    const { container } = render(
      <LandingPage navigate={navigate} authConfig={{ signupEnabled: true, googleEnabled: true }} />,
    );

    const heroSection = container.querySelector('[data-od-id="hero-section"]') as HTMLElement;
    expect(heroSection).not.toBeNull();
    expect(within(heroSection).getByTestId('landing-hero-trust-pills')).toHaveTextContent(
      /Kết nối OAuth 1-Click.*Khóa phạm vi an toàn.*Duyệt trước khi ghi/,
    );
    expect(heroSection.textContent).not.toContain('Tài khoản mới cần quản trị viên duyệt. ·');

    const rotator = heroSection.querySelector('.planora-hero-rotator') as HTMLElement;
    expect(rotator).toBeInTheDocument();
    expect(rotator.querySelectorAll('.hero-edge-layer')).toHaveLength(14);
    expect(heroSection.querySelector('.hero-front')).toBeInTheDocument();
    expect(heroSection.querySelector('.hero-back')).toBeInTheDocument();
  });

  it('Item #2: renders Planora 3-step workflow illustration (VÍ DỤ: MỘT YÊU CẦU, BA BƯỚC) replacing Make orbital canvas', () => {
    const navigate = vi.fn();
    const { container } = render(
      <LandingPage navigate={navigate} authConfig={{ signupEnabled: true, googleEnabled: true }} />,
    );

    const workflowSection = container.querySelector('#how') as HTMLElement;
    expect(workflowSection).not.toBeNull();
    expect(workflowSection).toHaveTextContent(/VÍ DỤ: MỘT YÊU CẦU, BA BƯỚC/i);
    expect(workflowSection).toHaveTextContent(/GitHub/i);
    expect(workflowSection).toHaveTextContent(/Trello/i);
    expect(workflowSection).toHaveTextContent(/Slack/i);

    const stepCards = workflowSection.querySelectorAll('.workflow-step-card');
    expect(stepCards).toHaveLength(3);
  });

  it('Item #3 & #4: renders Auto-Digest Morning Schedule section and 3-Layer Safety Architecture proof while preserving WCAG principles copy', () => {
    const navigate = vi.fn();
    const { container } = render(
      <LandingPage navigate={navigate} authConfig={{ signupEnabled: true, googleEnabled: true }} />,
    );

    const digestSection = screen.getByTestId('landing-schedule-digest-section');
    expect(digestSection).toHaveTextContent(/Chờ duyệt từng lượt/i);
    expect(digestSection).toHaveTextContent(/Tự gửi bản tin Auto-Digest mỗi sáng/i);
    expect(digestSection).toHaveTextContent(/Lịch họp nhóm · Bảng Sprint Q4 → Kênh #bao-cao-sang/i);
    expect(within(digestSection).getByTestId('workflow-flow-canvas')).toHaveAttribute(
      'data-flow-mode',
      'schedule',
    );
    expect(within(digestSection).getByTestId('landing-try-digest-btn')).toBeInTheDocument();

    const principlesSection = container.querySelector('[data-od-id="principles-section"]') as HTMLElement;
    expect(principlesSection).toHaveTextContent('Bạn luôn là người quyết định');
    expect(principlesSection).toHaveTextContent(
      'Sản phẩm được thiết kế với sự cẩn trọng tối đa để bạn hoàn toàn an tâm khi giao việc.',
    );
    expect(principlesSection).toHaveTextContent('Không ghi gì khi chưa được duyệt');

    const scopeProof = within(principlesSection).getByTestId('landing-scope-lock-proof');
    expect(scopeProof).toHaveTextContent(/Lớp 1: Khóa phạm vi tài nguyên/i);
    expect(scopeProof).toHaveTextContent(/Lớp 2: Xem trước nguyên văn & lưới dữ liệu/i);
    expect(scopeProof).toHaveTextContent(/Lớp 3: Biên nhận đối chiếu & Khôi phục an toàn/i);
  });

  it('Item #5 & #6: renders OAuth & Visual Scope Picker badges on all integration cards and replaces orphaned Hộp thư đến on Step 2', () => {
    const navigate = vi.fn();
    const { container } = render(
      <LandingPage navigate={navigate} authConfig={{ signupEnabled: true, googleEnabled: true }} />,
    );

    const integrationsSection = container.querySelector('[data-od-id="integrations-section"]') as HTMLElement;
    const badges = within(integrationsSection).getAllByTestId('integration-oauth-badge');
    expect(badges.length).toBeGreaterThanOrEqual(8);

    const step2 = container.querySelector('[data-od-id="step-2"]') as HTMLElement;
    expect(step2.textContent).not.toContain('Hộp thư đến');
    expect(within(step2).getByTestId('onboarding-step2-oauth-badge')).toHaveTextContent(
      /Kết nối OAuth 1-Click.*Chọn bảng & kênh trực tiếp từ danh sách/i,
    );
  });

  it('Item #7: clicking Dùng thử kịch bản này saves ati_prefill_prompt to sessionStorage, opens #auth-modal, and pre-fills Cockpit composer on mount', () => {
    const navigate = vi.fn();
    render(<LandingPage navigate={navigate} authConfig={{ signupEnabled: true, googleEnabled: true }} />);

    fireEvent.click(screen.getByTestId('landing-try-playbook-btn'));

    const savedPrompt = sessionStorage.getItem('ati_prefill_prompt');
    expect(savedPrompt).toBeTruthy();
    expect(savedPrompt!.length).toBeGreaterThan(20);
    expect(navigate).toHaveBeenCalledWith('/signup');
    expect(document.getElementById('auth-modal')).not.toBeNull();

    cleanup();

    useChatStore.setState({
      conversationId: null,
      messages: [],
      activePlan: null,
      activeClarification: null,
      isPlanning: false,
    } as any);

    render(
      <Cockpit
        services={[{ id: 'trello', name: 'Trello', connected: true, configured: true, tools: [] }]}
        servicesLoading={false}
        servicesError={null}
        onSendMessage={vi.fn()}
        onNewConversation={vi.fn()}
        onSelectConversation={vi.fn()}
        onSettings={vi.fn()}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
        recovery={null}
      />,
    );

    const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
    expect(promptInput).not.toBeNull();
    expect(promptInput.value).toBe(savedPrompt);
    expect(sessionStorage.getItem('ati_prefill_prompt')).toBeNull();
  });
});
