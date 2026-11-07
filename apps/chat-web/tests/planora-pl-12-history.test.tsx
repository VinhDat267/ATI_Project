/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { HistoryPage } from '../src/pages/History/HistoryPage';
import { SidebarHistory } from '../src/components/layout/SidebarHistory';
import { useChatStore } from '../src/store/chat-store';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';
import {
  resetWorkspaceStorage,
  setActiveWorkspaceId,
  setCachedOrganizations,
} from '../src/services/workspace-storage';

const mockUser = {
  id: 'u-1',
  name: 'Đoàn Mai',
  email: 'mai@example.test',
  role: 'member' as const,
};

const sampleConversations = [
  {
    id: 'conv-101',
    title: 'Đồng bộ lịch tuần sang Slack',
    status: 'completed',
    updated_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  },
  {
    id: 'conv-102',
    title: 'Bản tin GitHub PR cần xử lý',
    status: 'partial',
    updated_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
  },
  {
    id: 'conv-103',
    title: 'Hỏi đáp dữ liệu bảng tính Google Sheets',
    status: 'chatting',
    updated_at: new Date(Date.now() - 1000 * 60 * 60 * 25).toISOString(),
  },
];

describe('PL-12: Planora History & Archives UI (GATE-03 & Business-First UX v2.0)', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    resetWorkspaceStorage();
    useChatStore.getState().reset();
    authStorage.setStoredTokens({ accessToken: 'test-token', user: mockUser });
    vi.spyOn(apiClient, 'getMe').mockResolvedValue({ user: mockUser });
    vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({ schedules: [] });
    vi.spyOn(apiClient, 'getConversations').mockResolvedValue({
      conversations: sampleConversations,
      nextCursor: 'cursor-page-2',
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    resetWorkspaceStorage();
    authStorage.clearStoredTokens();
    window.history.replaceState({}, '', '/');
  });

  describe('1. Visual Tokens & Editorial Planora Standards', () => {
    it('uses Planora tokens and serif typography for headings on HistoryPage', async () => {
      const navigate = vi.fn();
      render(<HistoryPage user={mockUser} navigate={navigate} onLogout={vi.fn()} />);

      const heading = await screen.findByRole('heading', { level: 1, name: /Nhật ký điều phối/i });
      expect(heading).toBeInTheDocument();
      expect(heading.className).toContain('font-serif');
      expect(heading.className).toContain('text-[var(--planora-text)]');

      // Await conversations list mount
      await screen.findByRole('heading', { name: 'Đồng bộ lịch tuần sang Slack' });

      const main = document.querySelector('main')!;
      const footer = document.querySelector('footer')!;
      expect(main).toBeInTheDocument();
      expect(footer).toBeInTheDocument();

      // 0% old prototype orange #FF5701 in HistoryPage main and footer
      const historyHtml = main.innerHTML + footer.innerHTML;
      expect(historyHtml).not.toContain('#FF5701');
      expect(historyHtml).not.toContain('#E04D00');
      expect(historyHtml).not.toContain('#E04C00');
      expect(historyHtml).not.toContain('#FFF6EE');

      // 0% ATI references in user-facing text
      expect(main.textContent).not.toContain('ATI');
      expect(footer.textContent).not.toContain('ATI');
      expect(footer.textContent).toContain('Planora');
    });

    it('ensures 100% of SVG vector icons on HistoryPage main and footer have aria-hidden="true"', async () => {
      render(<HistoryPage user={mockUser} navigate={vi.fn()} onLogout={vi.fn()} />);
      await screen.findByRole('heading', { level: 1 });
      await screen.findByRole('heading', { name: 'Đồng bộ lịch tuần sang Slack' });

      const main = document.querySelector('main')!;
      const footer = document.querySelector('footer')!;
      const svgs = [...main.querySelectorAll('svg'), ...footer.querySelectorAll('svg')];
      expect(svgs.length).toBeGreaterThan(0);
      svgs.forEach((svg) => {
        expect(svg.getAttribute('aria-hidden')).toBe('true');
      });
    });

    it('ensures 0% raw emojis and 100% SVG aria-hidden="true" in SidebarHistory', async () => {
      const { container } = render(
        <SidebarHistory planora currentConversationId={null} />
      );
      await screen.findByText(/Đồng bộ lịch tuần sang Slack/);

      // Zero raw emojis
      expect(container.textContent).not.toContain('💬');
      expect(container.textContent).not.toContain('✎');
      expect(container.textContent).not.toContain('👤');

      // 100% SVGs have aria-hidden="true"
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThan(0);
      svgs.forEach((svg) => {
        expect(svg.getAttribute('aria-hidden')).toBe('true');
      });

      // Zero old orange
      expect(container.innerHTML).not.toContain('#FF5701');
      expect(container.innerHTML).not.toContain('brand-primary');
    });
  });

  describe('2. Business-First UX: Navigation, Actions & Synchronization', () => {
    it('displays conversational summary and opens the exact conversation /c/:id', async () => {
      const navigate = vi.fn();
      render(<HistoryPage user={mockUser} navigate={navigate} onLogout={vi.fn()} />);

      const rowTitle = await screen.findByRole('heading', { name: 'Đồng bộ lịch tuần sang Slack' });
      expect(rowTitle).toBeInTheDocument();

      const openLink = screen.getAllByRole('link', { name: /Mở hội thoại/i })[0];
      expect(openLink).toHaveAttribute('href', '/c/conv-101');
      fireEvent.click(openLink);
      expect(navigate).toHaveBeenCalledWith('/c/conv-101');
    });

    it('supports status filtering (all, completed, needs_action, chatting)', async () => {
      render(<HistoryPage user={mockUser} navigate={vi.fn()} onLogout={vi.fn()} />);
      await screen.findByText('Đồng bộ lịch tuần sang Slack');

      // Filter: Hoàn thành
      const completedPill = screen.getByRole('button', { name: 'Hoàn thành' });
      fireEvent.click(completedPill);
      expect(screen.getByText('Đồng bộ lịch tuần sang Slack')).toBeInTheDocument();
      expect(screen.queryByText('Bản tin GitHub PR cần xử lý')).toBeNull();
      expect(screen.queryByText('Hỏi đáp dữ liệu bảng tính Google Sheets')).toBeNull();

      // Filter: Cần xử lý
      const needsActionPill = screen.getByRole('button', { name: 'Cần xử lý' });
      fireEvent.click(needsActionPill);
      expect(screen.queryByText('Đồng bộ lịch tuần sang Slack')).toBeNull();
      expect(screen.getByText('Bản tin GitHub PR cần xử lý')).toBeInTheDocument();

      // Filter: Tất cả
      const allPill = screen.getByRole('button', { name: 'Tất cả' });
      fireEvent.click(allPill);
      expect(screen.getByText('Đồng bộ lịch tuần sang Slack')).toBeInTheDocument();
      expect(screen.getByText('Bản tin GitHub PR cần xử lý')).toBeInTheDocument();
      expect(screen.getByText('Hỏi đáp dữ liệu bảng tính Google Sheets')).toBeInTheDocument();
    });

    it('synchronizes rename between HistoryPage and SidebarHistory immediately', async () => {
      const renameSpy = vi.spyOn(apiClient, 'renameConversation').mockResolvedValue({
        conversation: {
          id: 'conv-101',
          title: 'Tiêu đề đã được cập nhật mới',
          status: 'completed',
          updated_at: new Date().toISOString(),
        },
      });

      render(
        <div>
          <SidebarHistory planora currentConversationId="conv-101" />
          <HistoryPage user={mockUser} navigate={vi.fn()} onLogout={vi.fn()} />
        </div>
      );

      await screen.findAllByText(/Đồng bộ lịch tuần sang Slack/);

      // Rename from HistoryPage
      const renameBtn = screen.getByRole('button', { name: 'Đổi tên Đồng bộ lịch tuần sang Slack' });
      fireEvent.click(renameBtn);

      const input = screen.getByRole('textbox', { name: 'Tiêu đề hội thoại' });
      fireEvent.change(input, { target: { value: 'Tiêu đề đã được cập nhật mới' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      await waitFor(() => {
        expect(renameSpy).toHaveBeenCalledWith('conv-101', 'Tiêu đề đã được cập nhật mới');
      });

      // Verify that SidebarHistory displays updated title
      await waitFor(() => {
        expect(screen.getAllByText(/Tiêu đề đã được cập nhật mới/).length).toBeGreaterThanOrEqual(1);
      });
    });

    it('loads more items using cursor pagination without resetting state', async () => {
      const listSpy = vi.spyOn(apiClient, 'getConversations')
        .mockResolvedValueOnce({
          conversations: [sampleConversations[0]],
          nextCursor: 'cursor-next-99',
        })
        .mockResolvedValueOnce({
          conversations: [sampleConversations[1]],
          nextCursor: null,
        });

      render(<HistoryPage user={mockUser} navigate={vi.fn()} onLogout={vi.fn()} />);
      await screen.findByText('Đồng bộ lịch tuần sang Slack');

      const loadMoreBtn = screen.getByRole('button', { name: 'Tải thêm' });
      fireEvent.click(loadMoreBtn);

      await waitFor(() => {
        expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'cursor-next-99' }));
      });
      expect(await screen.findByText('Bản tin GitHub PR cần xử lý')).toBeInTheDocument();
    });

    it('displays friendly empty state and reset button when statusFilter yields 0 results', async () => {
      vi.spyOn(apiClient, 'getConversations').mockResolvedValueOnce({
        conversations: [sampleConversations[0]], // only 'completed' status
        nextCursor: null,
      });

      render(<HistoryPage user={mockUser} navigate={vi.fn()} onLogout={vi.fn()} />);
      await screen.findByText('Đồng bộ lịch tuần sang Slack');

      // Click 'Cần xử lý' filter -> 0 items match
      const needsActionPill = screen.getByRole('button', { name: 'Cần xử lý' });
      fireEvent.click(needsActionPill);

      expect(screen.getByText('Không có hội thoại nào phù hợp bộ lọc')).toBeInTheDocument();
      expect(screen.queryByText('Đồng bộ lịch tuần sang Slack')).toBeNull();

      // Click 'Đặt lại bộ lọc' button
      const resetBtn = screen.getByRole('button', { name: 'Đặt lại bộ lọc' });
      fireEvent.click(resetBtn);

      // Now filter is reset to 'all' and conversations reappear
      expect(screen.getByText('Đồng bộ lịch tuần sang Slack')).toBeInTheDocument();
      expect(screen.queryByText('Không có hội thoại nào phù hợp bộ lọc')).toBeNull();
    });

    it('clears stale notice when switching workspace in HistoryPage', async () => {
      setActiveWorkspaceId('org-1');
      render(<HistoryPage user={mockUser} navigate={vi.fn()} onLogout={vi.fn()} />);
      await screen.findByText('Đồng bộ lịch tuần sang Slack');

      // Rename to produce a notice
      vi.spyOn(apiClient, 'renameConversation').mockResolvedValueOnce({
        conversation: { id: 'conv-101', title: 'Tên đã cập nhật' },
      });
      const renameBtn = screen.getByRole('button', { name: 'Đổi tên Đồng bộ lịch tuần sang Slack' });
      fireEvent.click(renameBtn);
      const input = screen.getByRole('textbox', { name: 'Tiêu đề hội thoại' });
      fireEvent.change(input, { target: { value: 'Tên đã cập nhật' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      await screen.findByText('Đã đổi tên hội thoại.');

      // Switch workspace
      await act(async () => {
        setActiveWorkspaceId('org-2');
      });

      // Notice must be cleared
      expect(screen.queryByText('Đã đổi tên hội thoại.')).toBeNull();
    });
  });

  describe('3. Workspace Data Isolation & Stale Response Guard', () => {
    it('discards late responses when switching workspace during in-flight fetch in HistoryPage', async () => {
      let callCount = 0;
      let resolveFirst!: (data: any) => void;
      let resolveSecond!: (data: any) => void;
      vi.spyOn(apiClient, 'getConversations').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        return new Promise((resolve) => {
          resolveSecond = resolve;
        });
      });

      setCachedOrganizations([
        { id: 'org-1', name: 'Công ty Alpha', role: 'member', status: 'active' },
        { id: 'org-2', name: 'Công ty Beta', role: 'member', status: 'active' },
      ] as any);

      setActiveWorkspaceId('org-1');
      render(<HistoryPage user={mockUser} navigate={vi.fn()} onLogout={vi.fn()} />);

      // Workspace 1 request is in-flight
      expect(screen.getByText('Đang tải hội thoại...')).toBeInTheDocument();

      // User switches to Workspace 2
      act(() => {
        setActiveWorkspaceId('org-2');
      });

      // Late response from Workspace 1 arrives
      await act(async () => {
        resolveFirst({
          conversations: [
            { id: 'leaked-conv', title: 'Dữ liệu rò rỉ từ Workspace 1' },
          ],
          nextCursor: null,
        });
      });

      // Leaked item must NEVER appear
      expect(screen.queryByText('Dữ liệu rò rỉ từ Workspace 1')).toBeNull();

      // Second response arrives for Workspace 2
      await act(async () => {
        resolveSecond({
          conversations: [
            { id: 'fresh-conv-2', title: 'Hội thoại hợp lệ của Workspace 2' },
          ],
          nextCursor: null,
        });
      });

      expect(screen.getByText('Hội thoại hợp lệ của Workspace 2')).toBeInTheDocument();
    });

    it('clears and isolates conversations in SidebarHistory when workspace changes', async () => {
      let callCount = 0;
      let resolveFirst!: (data: any) => void;
      let resolveSecond!: (data: any) => void;

      vi.spyOn(apiClient, 'getConversations').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return new Promise((r) => {
            resolveFirst = r;
          });
        }
        return new Promise((r) => {
          resolveSecond = r;
        });
      });

      setActiveWorkspaceId('org-alpha');
      render(<SidebarHistory planora currentConversationId={null} />);

      // Switch to org-beta
      act(() => {
        setActiveWorkspaceId('org-beta');
      });

      // Late response from org-alpha resolves
      await act(async () => {
        resolveFirst({
          conversations: [{ id: 'stale-alpha', title: 'Alpha Stale Conv' }],
          nextCursor: null,
        });
      });

      expect(screen.queryByText('Alpha Stale Conv')).toBeNull();

      // Second response resolves
      await act(async () => {
        resolveSecond({
          conversations: [{ id: 'beta-conv', title: 'Beta Fresh Conv' }],
          nextCursor: null,
        });
      });

      expect(screen.getByText(/Beta Fresh Conv/)).toBeInTheDocument();
    });

    it('clears editing, saving, and error states when switching workspace during rename in SidebarHistory', async () => {
      let rejectRename!: (err: any) => void;
      vi.spyOn(apiClient, 'renameConversation').mockImplementation(
        () => new Promise((_, reject) => {
          rejectRename = reject;
        })
      );

      setActiveWorkspaceId('org-alpha');
      render(<SidebarHistory planora currentConversationId="conv-101" />);

      // Wait for conversation item to appear
      await screen.findByText(/Đồng bộ lịch tuần sang Slack/);

      // Click rename button
      const renameBtn = screen.getByRole('button', { name: 'Đổi tên hội thoại Đồng bộ lịch tuần sang Slack' });
      fireEvent.click(renameBtn);

      // Verify input is open
      const input = screen.getByRole('textbox', { name: 'Tiêu đề hội thoại' });
      expect(input).toBeInTheDocument();
      fireEvent.change(input, { target: { value: 'Tên mới' } });

      // Submit rename -> triggers saving
      const form = input.closest('form')!;
      fireEvent.submit(form);

      // Switch workspace while rename request is in flight
      await act(async () => {
        setActiveWorkspaceId('org-beta');
      });

      // Form is unmounted / cleared
      expect(screen.queryByRole('textbox', { name: 'Tiêu đề hội thoại' })).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();

      // The slow network request fails
      await act(async () => {
        rejectRename(new Error('Mạng bị gián đoạn'));
      });

      // Error must NOT leak into the new workspace and no form remains open
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByRole('textbox', { name: 'Tiêu đề hội thoại' })).toBeNull();
    });
  });

  describe('4. Mutation Testing Verification (M1 - M3)', () => {
    it('M1: fails if primary buttons or links revert to prototype orange #FF5701', async () => {
      render(<HistoryPage user={mockUser} navigate={vi.fn()} onLogout={vi.fn()} />);
      await screen.findByRole('heading', { name: 'Đồng bộ lịch tuần sang Slack' });

      const main = document.querySelector('main')!;
      const footer = document.querySelector('footer')!;
      const html = main.innerHTML + footer.innerHTML;
      expect(html).not.toMatch(/#[Ff][Ff]5701/);
      expect(html).not.toMatch(/#[Ee]04[CcDd]00/);
    });

    it('M2: fails if any SVG icon in HistoryPage main, footer, or SidebarHistory lacks aria-hidden="true"', async () => {
      const { container: pageContainer } = render(
        <HistoryPage user={mockUser} navigate={vi.fn()} onLogout={vi.fn()} />
      );
      const { container: sidebarContainer } = render(
        <SidebarHistory planora currentConversationId={null} />
      );

      await screen.findByRole('heading', { name: 'Đồng bộ lịch tuần sang Slack' });
      await screen.findAllByText(/Đồng bộ lịch tuần sang Slack/);

      const main = pageContainer.querySelector('main')!;
      const footer = pageContainer.querySelector('footer')!;
      const allSvgs = [
        ...main.querySelectorAll('svg'),
        ...footer.querySelectorAll('svg'),
        ...sidebarContainer.querySelectorAll('svg'),
      ];

      expect(allSvgs.length).toBeGreaterThan(0);
      for (const svg of allSvgs) {
        expect(svg.getAttribute('aria-hidden')).toBe('true');
      }
    });

    it('M3: fails if workspace switch leaks old conversations into the new workspace', async () => {
      useChatStore.getState().setConversations([
        { id: 'c-old', title: 'Hội thoại cũ từ Không gian trước' },
      ]);

      render(<SidebarHistory planora currentConversationId={null} />);
      expect(screen.getByText(/Hội thoại cũ từ Không gian trước/)).toBeInTheDocument();

      await act(async () => {
        setActiveWorkspaceId('different-workspace');
      });

      expect(screen.queryByText(/Hội thoại cũ từ Không gian trước/)).toBeNull();
    });
  });
});
