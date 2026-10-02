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
    expect(screen.getByText(/Cách làm truyền thống: thao tác qua nhiều ứng dụng/i)).toBeDefined();
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
    expect(screen.getByText(/Hiểu mệnh lệnh tự nhiên/i)).toBeDefined();
    expect(screen.getByText(/Tự động liên kết công việc theo chuỗi/i)).toBeDefined();
    expect(screen.getByText(/Tự phục hồi gián đoạn thông minh/i)).toBeDefined();
  });

  it('toggles mobile menu with hamburger button and closes when a link is clicked', () => {
    render(<LandingPageView onGoToLogin={vi.fn()} />);

    // Initially mobile nav is not rendered
    expect(screen.queryByLabelText('Menu di động')).toBeNull();

    // Click hamburger button to open
    const hamburger = screen.getByRole('button', { name: /Mở menu điều hướng/i });
    expect(hamburger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(hamburger);
    expect(hamburger.getAttribute('aria-expanded')).toBe('true');

    const mobileNav = screen.getByLabelText('Menu di động');
    expect(mobileNav).toBeDefined();

    // Mobile nav contains comparison, features, ecosystem, security links
    expect(mobileNav.querySelector('a[href="#comparison"]')).not.toBeNull();
    expect(mobileNav.querySelector('a[href="#features"]')).not.toBeNull();
    expect(mobileNav.querySelector('a[href="#ecosystem"]')).not.toBeNull();
    expect(mobileNav.querySelector('a[href="#security"]')).not.toBeNull();

    // Clicking a link closes the mobile menu
    const featureLink = mobileNav.querySelector('a[href="#features"]')!;
    fireEvent.click(featureLink);
    expect(screen.queryByLabelText('Menu di động')).toBeNull();
  });

  it('closes mobile menu on Escape key press and triggers onGoToLogin from mobile menu', () => {
    const onLogin = vi.fn();
    render(<LandingPageView onGoToLogin={onLogin} />);

    const hamburger = screen.getByRole('button', { name: /Mở menu điều hướng/i });
    fireEvent.click(hamburger);
    expect(screen.getByLabelText('Menu di động')).toBeDefined();

    // Press Escape to close
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByLabelText('Menu di động')).toBeNull();

    // Re-open and click login button in mobile menu
    fireEvent.click(screen.getByRole('button', { name: /Mở menu điều hướng/i }));
    const mobileNav = screen.getByLabelText('Menu di động');
    const mobileLoginBtn = mobileNav.querySelector('button')!;
    fireEvent.click(mobileLoginBtn);
    expect(onLogin).toHaveBeenCalled();
    expect(screen.queryByLabelText('Menu di động')).toBeNull();
  });
});

it('separates supported services from development and makes no unmeasured claims',()=>{
  const {container}=render(<LandingPageView onGoToLogin={vi.fn()} />);
  expect(container.textContent).not.toMatch(/80%|95%|100%|<\s*10s|10 giây|15[–-]20|2[–-]3 giờ|Gmail|mã hóa đa lớp|triệt để/);
  expect(screen.getByRole('heading',{name:'Đã hỗ trợ'})).toBeInTheDocument();
  expect(screen.getByRole('heading',{name:'Đang phát triển'})).toBeInTheDocument();
  expect(screen.getAllByText(/AES-256-GCM/).length).toBeGreaterThan(0);
});
