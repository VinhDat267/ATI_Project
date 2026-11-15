/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('Item #1: renders Hero Orbital Flow Showcase with accurate trust pills, 3 interactive playbook tabs, Router node, $ref data flow edges, and no dangling dot', () => {
    const navigate = vi.fn();
    const { container } = render(
      <LandingPage navigate={navigate} authConfig={{ signupEnabled: true, googleEnabled: true }} />,
    );

    const heroSection = container.querySelector('[data-od-id="hero-section"]') as HTMLElement;
    expect(heroSection).not.toBeNull();
    expect(within(heroSection).getByTestId('landing-hero-trust-pills')).toHaveTextContent(
      /Khóa phạm vi từng bảng & kênh.*Xem trước nguyên văn trước khi ghi.*Biên nhận kèm liên kết gốc/,
    );
    expect(heroSection.textContent).not.toContain('Tài khoản mới cần quản trị viên duyệt. ·');

    const preview = within(heroSection).getByTestId('landing-hero-orbital-preview');
    expect(preview).toBeInTheDocument();

    const stage = preview.querySelector('.pl-workbench-stage') as HTMLElement;
    expect(stage).not.toBeNull();
    expect(within(stage).queryByText(/Bấm trực tiếp vào từng công cụ/i)).toBeNull();
    const chrome = preview.querySelector('.pl-workbench-chrome') as HTMLElement;
    expect(chrome).not.toBeNull();
    expect(within(chrome).getByText(/Bấm vào công cụ để xem bước/i)).toBeInTheDocument();

    const tab0 = within(preview).getByTestId('landing-playbook-tab-0');
    const tab1 = within(preview).getByTestId('landing-playbook-tab-1');
    const tab2 = within(preview).getByTestId('landing-playbook-tab-2');
    expect(tab0).toHaveTextContent(/Đồng bộ sự cố khách hàng/i);
    expect(tab1).toHaveTextContent(/Chốt lịch nghiệm thu & giao việc/i);
    expect(tab2).toHaveTextContent(/Đọc doanh thu & mở phiếu đối soát/i);

    const canvas = within(preview).getByTestId('workflow-flow-canvas');
    expect(canvas).toHaveAttribute('data-flow-mode', 'preview');
    expect(within(canvas).getByTestId('workflow-router-node')).toHaveAttribute('data-router-node', 'true');
    expect(within(preview).getAllByTestId('workflow-data-flow-pill').length).toBeGreaterThanOrEqual(1);

    fireEvent.click(tab1);
    expect(preview).toHaveTextContent(/Google Calendar/i);
    expect(preview).toHaveTextContent(/Notion/i);

    fireEvent.click(tab2);
    expect(preview).toHaveTextContent(/Google Sheets/i);
    expect(preview).toHaveTextContent(/Jira/i);
    expect(preview).toHaveTextContent(/Telegram/i);

    // Click tab0 again, click a workflow node, and assert non-stretching floating overlay opens instead of inline drawer
    fireEvent.click(tab0);
    fireEvent.click(within(preview).getByTestId('workflow-node-github'));
    const overlay = within(preview).getByTestId('workbench-node-overlay');
    expect(overlay).toHaveTextContent(/GitHub/i);
    expect(within(preview).queryByTestId('workflow-node-inspector')).toBeNull();
  });

  it('Item #2: synchronizes the 5 interactive storytelling moments with unified Lỗi thanh toán QR đơn #408 story, Orbital Canvas, Sheets Grid, Schedule CTA, and 5 fallback children', () => {
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
    expect(sheetsGrid).toHaveTextContent('15/11/2026');
    expect(sheetsGrid).toHaveTextContent('Lỗi thanh toán QR đơn #408');
    expect(sheetsGrid).toHaveTextContent('Cao');
    expect(sheetsGrid).toHaveTextContent('Link issue từ Bước 2');

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
    expect(fallbackList).toHaveTextContent('Lỗi thanh toán QR đơn #408');
  });

  it('Item #3 & #4: renders two-mode Scheduled Automation (manual approval vs single-source auto-digest) and 3-Layer Safety Architecture proof while preserving WCAG principles copy', () => {
    const navigate = vi.fn();
    const { container } = render(
      <LandingPage navigate={navigate} authConfig={{ signupEnabled: true, googleEnabled: true }} />,
    );

    const digestSection = screen.getByTestId('landing-schedule-digest-section');
    expect(digestSection).toHaveTextContent(/Chờ duyệt từng lượt/i);
    expect(digestSection).toHaveTextContent(/Tự gửi bản tin tổng hợp mỗi sáng/i);
    expect(digestSection).toHaveTextContent(/Lịch Sản phẩm.*Slack #bao-cao-sang/i);
    expect(within(digestSection).getByTestId('workflow-flow-canvas')).toHaveAttribute(
      'data-flow-mode',
      'schedule',
    );
    expect(within(digestSection).getByTestId('landing-try-digest-btn')).toBeInTheDocument();

    fireEvent.click(within(digestSection).getByTestId('landing-digest-tab-1'));
    expect(digestSection).toHaveTextContent(/Bảng Kế hoạch Quý 4/i);
    expect(digestSection).toHaveTextContent(/Telegram Ban điều hành/i);

    fireEvent.click(within(digestSection).getByTestId('landing-digest-tab-2'));
    expect(digestSection).toHaveTextContent(/acme\/web-store/i);
    expect(digestSection).toHaveTextContent(/Slack #ky-thuat/i);

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

  it('Item #5 & #6: renders OAuth & Visual Scope Picker badges without purple/violet tints and separates Admin approval (Step 2) from Scope Lock (Step 3)', () => {
    const navigate = vi.fn();
    const { container } = render(
      <LandingPage navigate={navigate} authConfig={{ signupEnabled: true, googleEnabled: true }} />,
    );

    const integrationsSection = container.querySelector('[data-od-id="integrations-section"]') as HTMLElement;
    const badges = within(integrationsSection).getAllByTestId('integration-oauth-badge');
    expect(badges).toHaveLength(8);
    expect(new Set(badges.map((b) => b.textContent?.trim()))).toHaveProperty('size', 8);
    expect(integrationsSection.innerHTML).not.toMatch(/purple-|violet-|#4A154B/i);

    const step2 = container.querySelector('[data-od-id="step-2"]') as HTMLElement;
    expect(step2.textContent).not.toContain('Hộp thư đến');
    expect(within(step2).getByTestId('onboarding-step2-approval-badge')).toHaveTextContent(
      /Kiểm soát thành viên bởi quản trị viên nhóm/i,
    );

    const step3 = container.querySelector('[data-od-id="step-3"]') as HTMLElement;
    expect(within(step3).getByTestId('onboarding-step3-scope-badge')).toHaveTextContent(
      /Kết nối một chạm.*Chọn bảng & kênh trực tiếp từ danh sách/i,
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

  it('Item #8: renders #product-film chromeless without native controls bar, unmuted at 35% volume, auto-looping in view, with accessible surface toggle and NotAllowedError fallback', async () => {
    vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({
      runtimeMode: 'sandbox',
      gmailEnabled: true,
      mysheetsEnabled: false,
      mycalendarEnabled: false,
      schedulesEnabled: true,
    });

    const observers = new Map<Element, IntersectionObserverCallback>();
    const OriginalIntersectionObserver = window.IntersectionObserver;
    class MockIntersectionObserver {
      private cb: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb;
      }
      observe(target: Element) {
        observers.set(target, this.cb);
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});

    try {
      const navigate = vi.fn();
      const { container } = render(
        <LandingPage navigate={navigate} authConfig={{ signupEnabled: true, googleEnabled: true }} />,
      );

      // Giữ duy nhất 1 thẻ <h1> trên toàn trang landing
      expect(container.querySelectorAll('h1')).toHaveLength(1);

      const filmSection = screen.getByTestId('product-film-section');
      expect(filmSection).toHaveAttribute('id', 'product-film');
      expect(filmSection.textContent).not.toMatch(/human in the loop|auto digest|oauth 1-click/i);

      const filmShell = within(filmSection).getByTestId('landing-film-shell');
      expect(filmShell.nextElementSibling).toBeNull();

      expect(within(filmSection).queryByTestId('film-chapter-0')).toBeNull();
      expect(within(filmSection).queryByTestId('film-play-toggle')).toBeNull();
      expect(within(filmSection).queryByTestId('film-mute-toggle')).toBeNull();
      expect(within(filmSection).queryByTestId('film-replay-btn')).toBeNull();

      const video = within(filmShell).getByTestId('landing-product-video') as HTMLVideoElement;
      expect(video).toHaveAttribute('poster', '/videos/planora-workflow-poster.png');
      expect(video).not.toHaveAttribute('controls');
      expect(video.controls).toBe(false);
      expect(video.muted).toBe(false);
      expect(video.defaultMuted).toBe(false);
      expect(video.volume).toBeCloseTo(0.35, 5);
      expect(video.loop).toBe(true);
      expect(video.playsInline).toBe(true);

      const surface = within(filmShell).getByTestId('landing-film-surface');
      expect(surface.tagName).toBe('BUTTON');
      await waitFor(() => {
        expect(surface).toHaveAttribute('aria-label', expect.stringContaining('Gmail, Slack và Trello'));
      });
      expect(surface).toHaveAttribute('aria-pressed', 'false');

      // Entering viewport auto-plays unmuted at 35% volume
      const filmObserver = observers.get(filmSection);
      expect(filmObserver).toBeDefined();
      filmObserver!(
        [{ isIntersecting: true, target: filmSection } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      expect(playSpy).toHaveBeenCalledTimes(1);
      expect(video.muted).toBe(false);
      expect(video.volume).toBeCloseTo(0.35, 5);

      // Simulate active playback and pause via surface click
      Object.defineProperty(video, 'paused', { value: false, configurable: true });
      fireEvent.play(video);
      expect(surface).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(surface);
      expect(pauseSpy).toHaveBeenCalledTimes(1);
      Object.defineProperty(video, 'paused', { value: true, configurable: true });
      fireEvent.pause(video);
      expect(surface).toHaveAttribute('aria-pressed', 'false');

      // Subsequent in-view callback respects manual pause until user clicks surface again
      filmObserver!(
        [{ isIntersecting: true, target: filmSection } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      expect(playSpy).toHaveBeenCalledTimes(1);

      // Clicking surface while paused resumes unmuted at 35% volume
      fireEvent.click(surface);
      expect(playSpy).toHaveBeenCalledTimes(2);
      expect(video.muted).toBe(false);
      expect(video.volume).toBeCloseTo(0.35, 5);

      // Leaving viewport while playing pauses playback
      Object.defineProperty(video, 'paused', { value: false, configurable: true });
      filmObserver!(
        [{ isIntersecting: false, target: filmSection } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      expect(pauseSpy).toHaveBeenCalledTimes(2);

      const sources = [...video.querySelectorAll('source')].map((s) => ({
        src: s.getAttribute('src'),
        type: s.getAttribute('type'),
      }));
      expect(sources).toEqual([
        { src: '/videos/planora-workflow.webm', type: 'video/webm' },
        { src: '/videos/planora-workflow.mp4', type: 'video/mp4' },
      ]);

      // NotAllowedError autoplay fallback: falls back to muted play(), then unmutes to 0.35 on user pointerdown
      cleanup();
      observers.clear();
      playSpy.mockReset();
      pauseSpy.mockReset();
      playSpy
        .mockRejectedValueOnce(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }))
        .mockResolvedValue(undefined);

      render(<LandingPage navigate={navigate} authConfig={{ signupEnabled: true, googleEnabled: true }} />);
      const fallbackSection = screen.getByTestId('product-film-section');
      const fallbackVideo = within(fallbackSection).getByTestId('landing-product-video') as HTMLVideoElement;
      const fallbackObserver = observers.get(fallbackSection);
      expect(fallbackObserver).toBeDefined();

      fallbackObserver!(
        [{ isIntersecting: true, target: fallbackSection } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      await Promise.resolve();
      await Promise.resolve();

      expect(playSpy).toHaveBeenCalledTimes(2);
      expect(fallbackVideo.muted).toBe(true);

      fireEvent.pointerDown(window);
      expect(fallbackVideo.muted).toBe(false);
      expect(fallbackVideo.volume).toBeCloseTo(0.35, 5);
    } finally {
      vi.stubGlobal('IntersectionObserver', OriginalIntersectionObserver);
    }
  });

  it('Item #9: renders architectural PLANORA closing wordmark, TasteSkill nav/hero/footer CTA hooks, interactive mobile menu drawer, zero banned jargon or violet tints, and zero Gmail text when disabled', async () => {
    const navigate = vi.fn();
    const { container } = render(
      <LandingPage navigate={navigate} authConfig={{ signupEnabled: true, googleEnabled: true }} />,
    );

    const header = container.querySelector('[data-od-id="nav-header"]') as HTMLElement;
    expect(header).not.toBeNull();
    expect(container.querySelector('[data-od-id="btn-header-login"]')).not.toBeNull();
    expect(container.querySelector('[data-od-id="btn-header-signup"]')).not.toBeNull();
    expect(container.querySelector('[data-od-id="btn-hero-signup"]')).not.toBeNull();
    expect(container.querySelector('[data-od-id="btn-hero-google"]')).not.toBeNull();
    expect(container.querySelector('[data-od-id="btn-footer-cta-signup"]')).not.toBeNull();
    expect(container.querySelector('[data-od-id="btn-footer-cta-google"]')).not.toBeNull();

    const footer = container.querySelector('[data-od-id="footer"]') as HTMLElement;
    expect(footer).not.toBeNull();
    expect(within(footer).getByText('PLANORA')).toBeInTheDocument();

    const menuBtn = screen.getByTestId('landing-mobile-menu-btn');
    expect(menuBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('landing-mobile-drawer')).toBeNull();

    fireEvent.click(menuBtn);
    expect(menuBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('landing-mobile-drawer')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('landing-mobile-drawer')).toBeNull();

    const bodyText = document.body.textContent ?? '';
    expect(bodyText).not.toMatch(
      /human in the loop|human-in-the-loop|auto digest|auto-digest|oauth 1-click|1-click oauth|webhook|cronjob|idempotency|payload|\bDAG\b/i,
    );
    expect(bodyText).not.toMatch(/Gmail/i);
    expect(container.innerHTML).not.toMatch(/purple-|violet-|#4A154B/i);
  });
});
