/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { LandingPageView } from '../../src/components/LandingPageView';

afterEach(() => {
  cleanup();
});

describe('LandingPageView Component', () => {
  it('renders brand hero, headline, and primary call-to-actions', () => {
    const onGoToLogin = vi.fn();
    render(<LandingPageView onGoToLogin={onGoToLogin} />);

    expect(screen.getAllByText(/AI Workflow Automation Platform/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Biến một câu lệnh thành quy trình/i)).toBeDefined();

    // CTA buttons exist
    const heroCta = screen.getByRole('button', { name: /Bắt đầu trải nghiệm ngay/i });
    expect(heroCta).toBeDefined();

    fireEvent.click(heroCta);
    expect(onGoToLogin).toHaveBeenCalledTimes(1);
  });

  it('renders the Before vs After comparison section', () => {
    render(<LandingPageView onGoToLogin={vi.fn()} />);

    // Before column
    expect(screen.getByText(/Cách làm truyền thống: 8 bước rườm rà qua 4 ứng dụng/i)).toBeDefined();
    expect(screen.getByText(/Lục tìm board & list, tạo card thủ công/i)).toBeDefined();

    // After column
    expect(screen.getByText(/Với AI Workflow: 1 câu lệnh tự nhiên duy nhất/i)).toBeDefined();
    expect(screen.getByText(/AI tự động phân giải đối tượng và lập kế hoạch/i)).toBeDefined();
  });

  it('renders the multi-service ecosystem integrations', () => {
    render(<LandingPageView onGoToLogin={vi.fn()} />);

    expect(screen.getAllByText(/GitHub/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Trello/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Slack/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Google Sheets/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Jira/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Notion/i).length).toBeGreaterThan(0);
  });

  it('triggers onGoToLogin when clicking the navbar login button', () => {
    const onGoToLogin = vi.fn();
    render(<LandingPageView onGoToLogin={onGoToLogin} />);

    const navLoginBtn = screen.getByRole('button', { name: /Đăng nhập vào hệ thống/i });
    expect(navLoginBtn).toBeDefined();

    fireEvent.click(navLoginBtn);
    expect(onGoToLogin).toHaveBeenCalledTimes(1);
  });

  it('renders all nav anchor links pointing to valid section IDs including features', () => {
    const { container } = render(<LandingPageView onGoToLogin={vi.fn()} />);

    const comparisonLink = container.querySelector('a[href="#comparison"]');
    const featuresLink = container.querySelector('a[href="#features"]');
    const ecosystemLink = container.querySelector('a[href="#ecosystem"]');
    const securityLink = container.querySelector('a[href="#security"]');

    expect(comparisonLink).not.toBeNull();
    expect(featuresLink).not.toBeNull();
    expect(ecosystemLink).not.toBeNull();
    expect(securityLink).not.toBeNull();

    // Verify sections with corresponding IDs exist
    expect(container.querySelector('#comparison')).not.toBeNull();
    expect(container.querySelector('#features')).not.toBeNull();
    expect(container.querySelector('#ecosystem')).not.toBeNull();
    expect(container.querySelector('#security')).not.toBeNull();

    // Verify key features text is displayed
    expect(screen.getByText(/Phân tích ý định tự nhiên/i)).toBeDefined();
    expect(screen.getByText(/Điều phối DAG phụ thuộc/i)).toBeDefined();
    expect(screen.getByText(/Tự phục hồi lỗi từng phần/i)).toBeDefined();
  });
});
