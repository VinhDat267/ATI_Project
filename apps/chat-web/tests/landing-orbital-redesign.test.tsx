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

  it('Item #1: renders Hero Orbital Flow Showcase with trust pills, 3 interactive playbook tabs, Router node, and no dangling dot', () => {
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

    const preview = within(heroSection).getByTestId('landing-hero-orbital-preview');
    expect(preview).toBeInTheDocument();

    const tab0 = within(preview).getByTestId('landing-playbook-tab-0');
    const tab1 = within(preview).getByTestId('landing-playbook-tab-1');
    const tab2 = within(preview).getByTestId('landing-playbook-tab-2');
    expect(tab0).toHaveTextContent(/Đồng bộ lỗi liên công cụ/i);
    expect(tab1).toHaveTextContent(/Báo cáo lịch họp & Auto-Digest mỗi sáng/i);
    expect(tab2).toHaveTextContent(/Điều phối công việc & lịch biểu/i);

    const canvas = within(preview).getByTestId('workflow-flow-canvas');
    expect(canvas).toHaveAttribute('data-flow-mode', 'preview');
    expect(within(canvas).getByTestId('workflow-router-node')).toHaveAttribute('data-router-node', 'true');
    expect(within(preview).getByText(/Dữ liệu từ Việc 1 → Việc 2/i)).toBeInTheDocument();

    fireEvent.click(tab1);
    expect(preview).toHaveTextContent(/Google Calendar/i);
    expect(preview).toHaveTextContent(/Telegram/i);

    fireEvent.click(tab2);
    expect(preview).toHaveTextContent(/Trello/i);
    expect(preview).toHaveTextContent(/Google Calendar/i);
  });

  it('Item #2: synchronizes the 5 interactive storytelling moments with Cockpit (Orbital Canvas, Horizontal Sheets Grid, Schedule CTA, and 5 fallback children)', () => {
    const navigate = vi.fn();
    const { container } = render(
      <LandingPage navigate={navigate} authConfig={{ signupEnabled: true, googleEnabled: true }} />,
    );

    const panel1 = container.querySelector('#stage-panel-1') as HTMLElement;
    expect(panel1).toHaveTextContent('Trello');
    expect(panel1).toHaveTextContent('Slack');
    expect(panel1).toHaveTextContent('GitHub');
    expect(panel1).toHaveTextContent('Google Sheets');
    expect(panel1).toHaveTextContent('Google Calendar');
    expect(panel1).toHaveTextContent('Telegram');

    const stage3Canvas = screen.getByTestId('landing-stage3-orbital-canvas');
    expect(within(stage3Canvas).getByTestId('workflow-flow-canvas')).toHaveAttribute('data-flow-mode', 'preview');

    const sheetsGrid = screen.getByTestId('landing-stage3-sheets-grid');
    expect(sheetsGrid).toHaveTextContent('Cột A');
    expect(sheetsGrid).toHaveTextContent('Cột B');
    expect(sheetsGrid).toHaveTextContent('Cột C');
    expect(sheetsGrid).toHaveTextContent('Cột D');
    expect(sheetsGrid).toHaveTextContent('29/09/2026');
    expect(sheetsGrid).toHaveTextContent('Lỗi thanh toán #42');
    expect(sheetsGrid).toHaveTextContent('Cao');
    expect(sheetsGrid).toHaveTextContent('Đã mở Issue #42');

    const stage4Canvas = screen.getByTestId('landing-stage4-orbital-canvas');
    expect(within(stage4Canvas).getByTestId('workflow-flow-canvas')).toHaveAttribute('data-flow-mode', 'executing');

    const stage5Canvas = screen.getByTestId('landing-stage5-orbital-canvas');
    expect(within(stage5Canvas).getByTestId('workflow-flow-canvas')).toHaveAttribute('data-flow-mode', 'receipt');
    expect(screen.getByTestId('landing-stage5-schedule-cta')).toHaveTextContent(
      /Đặt lịch chạy định kỳ quy trình này/i,
    );

    const fallbackList = container.querySelector('.stage-fallback-list') as HTMLElement;
    expect(fallbackList).not.toBeNull();
    expect(fallbackList.querySelectorAll(':scope > div')).toHaveLength(5);
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
