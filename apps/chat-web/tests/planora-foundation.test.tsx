// @vitest-environment jsdom
import './setup';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PlanoraMark, Brand, ServiceLogo } from '../src/planora/components/Brand';

afterEach(() => {
  cleanup();
});
import { Button } from '../src/planora/components/Button';
import { Field } from '../src/planora/components/Field';
import { StatusBadge } from '../src/planora/components/StatusBadge';
import { PlanoraShowcase } from '../src/planora/samples/PlanoraShowcase';
import { LandingSample } from '../src/planora/samples/LandingSample';
import { ChatPlanSample } from '../src/planora/samples/ChatPlanSample';
import { SettingsScopeSample } from '../src/planora/samples/SettingsScopeSample';
import { HistoryScheduleSample } from '../src/planora/samples/HistoryScheduleSample';

// ============================================================================
// 1. WCAG AA Contrast Verification (Mathematical Verification on tokens.css)
// ============================================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tokensCssPath = path.resolve(__dirname, '../src/planora/styles/tokens.css');
const tokensCss = readFileSync(tokensCssPath, 'utf8');

function parsePlanoraTokens(css: string) {
  const extract = (selector: string) => {
    const idx = css.indexOf(selector);
    if (idx === -1) return {} as Record<string, string>;
    const block = css.slice(idx).split('}')[0];
    return Object.fromEntries(
      [...block.matchAll(/--(planora-[a-z0-9-]+):\s*(#[0-9A-Fa-f]{3,8})\s*;/g)].map(m => [m[1], m[2]])
    );
  };
  return {
    light: extract(':root {'),
    dark: extract('html.dark,'),
  };
}

const { light: lightTokens, dark: darkTokens } = parsePlanoraTokens(tokensCss);

describe('Planora Tokens & Accessibility Contrast', () => {
  function luminance(hex: string): number {
    const rgb = hex
      .replace('#', '')
      .match(/.{2}/g)!
      .map(x => parseInt(x, 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }

  function contrastRatio(hex1: string, hex2: string): number {
    const l1 = luminance(hex1);
    const l2 = luminance(hex2);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  it('meets WCAG AA (>= 4.5:1) for all Light mode color pairs parsed from tokens.css', () => {
    // Light mode tokens extracted directly from tokens.css
    const canvas = lightTokens['planora-canvas'];
    const paper = lightTokens['planora-paper'];
    const sidebar = lightTokens['planora-sidebar'];
    const text = lightTokens['planora-text'];
    const muted = lightTokens['planora-muted'];
    const primary = lightTokens['planora-primary'];
    const onPrimary = lightTokens['planora-on-primary'];
    const placeholder = lightTokens['planora-placeholder'];

    // Status tokens
    const pendingText = lightTokens['planora-pending-text'];
    const pendingBg = lightTokens['planora-pending-bg'];
    const errorText = lightTokens['planora-error-text'];
    const errorBg = lightTokens['planora-error-bg'];
    const unknownText = lightTokens['planora-unknown-text'];
    const unknownBg = lightTokens['planora-unknown-bg'];

    // Verify all required tokens exist in tokens.css
    expect(canvas).toBeDefined();
    expect(paper).toBeDefined();
    expect(sidebar).toBeDefined();
    expect(text).toBeDefined();
    expect(muted).toBeDefined();
    expect(primary).toBeDefined();
    expect(onPrimary).toBeDefined();
    expect(placeholder).toBeDefined();
    expect(pendingText).toBeDefined();
    expect(pendingBg).toBeDefined();
    expect(errorText).toBeDefined();
    expect(errorBg).toBeDefined();
    expect(unknownText).toBeDefined();
    expect(unknownBg).toBeDefined();

    expect(contrastRatio(text, canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(text, paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(text, sidebar)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(muted, paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(primary, paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(onPrimary, primary)).toBeGreaterThanOrEqual(4.5);

    // Placeholder tokens (WCAG AA requirement >= 4.5:1)
    expect(contrastRatio(placeholder, paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(placeholder, canvas)).toBeGreaterThanOrEqual(4.5);

    expect(contrastRatio(pendingText, pendingBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(errorText, errorBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(unknownText, unknownBg)).toBeGreaterThanOrEqual(4.5);
  });

  it('meets WCAG AA (>= 4.5:1) for all Dark mode color pairs parsed from tokens.css', () => {
    // Dark mode tokens extracted directly from tokens.css
    const canvas = darkTokens['planora-canvas'];
    const paper = darkTokens['planora-paper'];
    const sidebar = darkTokens['planora-sidebar'];
    const text = darkTokens['planora-text'];
    const muted = darkTokens['planora-muted'];
    const primary = darkTokens['planora-primary'];
    const onPrimary = darkTokens['planora-on-primary'];
    const placeholder = darkTokens['planora-placeholder'];

    // Status tokens
    const pendingText = darkTokens['planora-pending-text'];
    const pendingBg = darkTokens['planora-pending-bg'];
    const errorText = darkTokens['planora-error-text'];
    const errorBg = darkTokens['planora-error-bg'];
    const unknownText = darkTokens['planora-unknown-text'];
    const unknownBg = darkTokens['planora-unknown-bg'];
    const successText = darkTokens['planora-success-text'];
    const successBg = darkTokens['planora-success-bg'];

    // Verify all required tokens exist in tokens.css
    expect(canvas).toBeDefined();
    expect(paper).toBeDefined();
    expect(sidebar).toBeDefined();
    expect(text).toBeDefined();
    expect(muted).toBeDefined();
    expect(primary).toBeDefined();
    expect(onPrimary).toBeDefined();
    expect(placeholder).toBeDefined();
    expect(pendingText).toBeDefined();
    expect(pendingBg).toBeDefined();
    expect(errorText).toBeDefined();
    expect(errorBg).toBeDefined();
    expect(unknownText).toBeDefined();
    expect(unknownBg).toBeDefined();
    expect(successText).toBeDefined();
    expect(successBg).toBeDefined();

    expect(contrastRatio(text, canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(text, paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(text, sidebar)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(muted, paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(primary, paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(onPrimary, primary)).toBeGreaterThanOrEqual(4.5);

    // Placeholder tokens (WCAG AA requirement >= 4.5:1)
    expect(contrastRatio(placeholder, paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(placeholder, canvas)).toBeGreaterThanOrEqual(4.5);

    expect(contrastRatio(pendingText, pendingBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(errorText, errorBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(unknownText, unknownBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(successText, successBg)).toBeGreaterThanOrEqual(4.5);
  });
});

// ============================================================================
// 2. Component Unit Tests
// ============================================================================
describe('Planora Foundation Components', () => {
  describe('Brand Component', () => {
    it('renders PlanoraMark standalone SVG', () => {
      const { container } = render(<PlanoraMark size={40} className="custom-mark" />);
      const svg = container.querySelector('svg.custom-mark');
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveAttribute('width', '40');
    });

    it('renders Planora monogram mark and wordmark', () => {
      render(<Brand />);
      expect(screen.getByText('planora')).toBeInTheDocument();
      expect(screen.getByText('Workflow workspace')).toBeInTheDocument();
    });

    it('renders as button when onClick is provided', () => {
      const handleClick = vi.fn();
      render(<Brand onClick={handleClick} label="Trang chủ Planora" />);
      const btn = screen.getByRole('button', { name: 'Trang chủ Planora' });
      expect(btn).toBeInTheDocument();
      fireEvent.click(btn);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('renders as anchor when href is provided', () => {
      render(<Brand href="/overview" label="Liên kết giới thiệu" />);
      const link = screen.getByRole('link', { name: 'Liên kết giới thiệu' });
      expect(link).toHaveAttribute('href', '/overview');
    });

    it('ServiceLogo renders image for recognized services and fallback letter for unknown', () => {
      const { container } = render(
        <div>
          <ServiceLogo name="GitHub" alt="GitHub Mark" />
          <ServiceLogo name="Trello" />
          <ServiceLogo name="CustomServiceX" alt="Custom service" />
        </div>
      );

      const githubImg = screen.getByAltText('GitHub Mark');
      expect(githubImg).toHaveAttribute('src', '/logos/github.svg');

      const trelloImg = container.querySelector('img[src="/logos/trello.svg"]');
      expect(trelloImg).toBeInTheDocument();

      const fallback = screen.getByLabelText('Custom service');
      expect(fallback).toHaveTextContent('C');
    });
  });

  describe('Button Component', () => {
    it('renders native button attributes and variant classes', () => {
      const handleClick = vi.fn();
      render(
        <Button variant="primary" size="lg" onClick={handleClick} type="submit">
          Thực thi
        </Button>
      );

      const btn = screen.getByRole('button', { name: 'Thực thi' });
      expect(btn).toHaveAttribute('type', 'submit');
      expect(btn).toHaveClass('planora-btn-primary');
      expect(btn).toHaveClass('planora-btn-lg');

      fireEvent.click(btn);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('disables interactions and has correct accessibility when disabled', () => {
      const handleClick = vi.fn();
      render(
        <Button variant="danger" disabled onClick={handleClick}>
          Xóa kế hoạch
        </Button>
      );

      const btn = screen.getByRole('button', { name: 'Xóa kế hoạch' });
      expect(btn).toBeDisabled();
      fireEvent.click(btn);
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('renders icons on left or right', () => {
      render(
        <Button icon={<span data-testid="test-icon">★</span>} iconPosition="left">
          Yêu thích
        </Button>
      );

      expect(screen.getByTestId('test-icon')).toBeInTheDocument();
    });
  });

  describe('Field Component', () => {
    it('renders single-line input with accessible label and helper text', () => {
      render(
        <Field
          label="Tên kho lưu trữ"
          helper="Ví dụ: owner/repo"
          placeholder="Nhập tên kho"
          required
        />
      );

      const input = screen.getByLabelText(/Tên kho lưu trữ/);
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute('required');
      expect(screen.getByText('Ví dụ: owner/repo')).toBeInTheDocument();
    });

    it('renders multiline textarea with error alert linked via aria-describedby', () => {
      render(
        <Field
          multiline
          label="Mô tả công việc"
          error="Mô tả không được để trống"
          rows={3}
        />
      );

      const textarea = screen.getByLabelText('Mô tả công việc');
      expect(textarea.tagName.toLowerCase()).toBe('textarea');
      expect(textarea).toHaveAttribute('aria-invalid', 'true');

      const errorAlert = screen.getByRole('alert');
      expect(errorAlert).toHaveTextContent('Mô tả không được để trống');
      expect(textarea).toHaveAttribute('aria-describedby', errorAlert.id);
    });

    it('composes external aria-describedby with error without dangling helper ID', () => {
      render(
        <Field
          id="custom-field"
          label="Tên nhánh"
          helper="Gợi ý: feature/abc"
          error="Tên nhánh không hợp lệ"
          aria-describedby="external-audit-note"
        />
      );

      const input = screen.getByLabelText(/Tên nhánh/);
      expect(screen.queryByText('Gợi ý: feature/abc')).not.toBeInTheDocument();
      const errorAlert = screen.getByRole('alert');
      expect(errorAlert.id).toBe('custom-field-error');
      expect(input).toHaveAttribute('aria-describedby', 'custom-field-error external-audit-note');
      expect(document.getElementById('custom-field-helper')).toBeNull();
    });
  });

  describe('StatusBadge Component', () => {
    it('renders all four semantic status types with correct role and label', () => {
      const { rerender } = render(<StatusBadge status="success" />);
      expect(screen.getByRole('status')).toHaveTextContent('Hoàn tất');
      expect(screen.getByRole('status')).toHaveClass('planora-badge-success');

      rerender(<StatusBadge status="pending" label="Chờ duyệt kế hoạch" />);
      expect(screen.getByRole('status')).toHaveTextContent('Chờ duyệt kế hoạch');
      expect(screen.getByRole('status')).toHaveClass('planora-badge-pending');

      rerender(<StatusBadge status="error" label="Thất bại tạm thời" />);
      expect(screen.getByRole('status')).toHaveTextContent('Thất bại tạm thời');
      expect(screen.getByRole('status')).toHaveClass('planora-badge-error');

      rerender(<StatusBadge status="unknown" />);
      expect(screen.getByRole('status')).toHaveTextContent('Chưa rõ');
      expect(screen.getByRole('status')).toHaveClass('planora-badge-unknown');
    });
  });
});

// ============================================================================
// 3. Four Reference Samples Unit Tests
// ============================================================================
describe('Planora Reference Samples (PL-01)', () => {
  it('renders LandingSample with demo notice and 8 integrated services', () => {
    render(<LandingSample />);
    expect(screen.getByText(/Mẫu giao diện Giới thiệu/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Từ ý tưởng đến kế hoạch và hành động/ })).toBeInTheDocument();
    expect(screen.getByText('Google Calendar')).toBeInTheDocument();
    expect(screen.getByText('Google Sheets')).toBeInTheDocument();
  });

  it('renders ChatPlanSample with sidebar, mobile toggle, plan card and composer', () => {
    const { container } = render(<ChatPlanSample />);
    expect(screen.getByText(/Mẫu giao diện Hội thoại làm trung tâm/)).toBeInTheDocument();
    expect(screen.getByText(/Kế hoạch thực thi 2 bước/)).toBeInTheDocument();
    expect(screen.getByText(/github\.list_issues/)).toBeInTheDocument();
    expect(screen.getByText(/trello\.update_card/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Phê duyệt và Thực thi' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Nhập yêu cầu tiếp theo/)).toBeInTheDocument();

    // Mobile nav toggle exists and toggles sidebar class
    const mobileToggle = screen.getByRole('button', { name: 'Chuyển đổi điều hướng không gian làm việc' });
    expect(mobileToggle).toBeInTheDocument();
    expect(mobileToggle).toHaveAttribute('aria-expanded', 'false');

    const sidebar = container.querySelector('.planora-chat-sidebar');
    expect(sidebar).not.toHaveClass('planora-sidebar-open');

    fireEvent.click(mobileToggle);
    expect(mobileToggle).toHaveAttribute('aria-expanded', 'true');
    expect(sidebar).toHaveClass('planora-sidebar-open');
  });

  it('renders SettingsScopeSample with PR #260 GitHub OAuth repo filter and destinations', () => {
    render(<SettingsScopeSample />);
    expect(screen.getByText(/Cài đặt kết nối & Phạm vi tài nguyên/)).toBeInTheDocument();
    expect(screen.getByText('GitHub (OAuth cá nhân)')).toBeInTheDocument();
    expect(screen.getByText(/5 \/ 10/)).toBeInTheDocument();
    expect(screen.getByText('VinhDat267/ATI_Project')).toBeInTheDocument();
    expect(screen.getByText(/Đích gửi GitHub Digest tự động/)).toBeInTheDocument();
  });

  it('renders HistoryScheduleSample with scrollable audit log table', () => {
    const { container } = render(<HistoryScheduleSample />);
    expect(screen.getByRole('heading', { level: 1, name: /Nhật ký hoạt động & Lịch chạy tự động/ })).toBeInTheDocument();
    expect(screen.getByText('GitHub Digest buổi sáng')).toBeInTheDocument();
    expect(screen.getByText('needs_attention')).toBeInTheDocument();
    expect(screen.getByText(/Đã giữ marker chống gửi trùng/)).toBeInTheDocument();

    // Verifies F2 scroll container accessibility
    const scrollRegion = screen.getByRole('region', { name: 'Bảng nhật ký thực thi gần đây' });
    expect(scrollRegion).toBeInTheDocument();
    expect(scrollRegion).toHaveClass('planora-table-scroll');
    const table = container.querySelector('table');
    expect(table).toBeInTheDocument();
    expect(table?.style.minWidth).toBe('540px');
  });

  it('PlanoraShowcase renders tabs and synchronizes theme via useTheme standard contract', () => {
    localStorage.clear();
    render(<PlanoraShowcase initialView="landing" />);
    expect(screen.getByText(/PLANORA PL-01/)).toBeInTheDocument();

    // Toggle to Chat
    fireEvent.click(screen.getByRole('button', { name: '2. Chat có plan' }));
    expect(screen.getByText(/Mẫu giao diện Hội thoại làm trung tâm/)).toBeInTheDocument();

    // Toggle to Settings
    fireEvent.click(screen.getByRole('button', { name: '3. Settings (OAuth & Scope)' }));
    expect(screen.getByText(/Cài đặt kết nối & Phạm vi tài nguyên/)).toBeInTheDocument();

    // Toggle theme to dark
    const themeBtn = screen.getByRole('button', { name: /Chuyển sang giao diện/ });
    fireEvent.click(themeBtn);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('ati-theme')).toBe('dark');

    // Toggle theme back to light
    fireEvent.click(themeBtn);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('ati-theme')).toBe('light');
  });
});
