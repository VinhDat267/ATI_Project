// @vitest-environment jsdom
import './setup';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlanoraMark, Brand, ServiceLogo } from '../src/planora/components/Brand';
import { Button } from '../src/planora/components/Button';
import { Field } from '../src/planora/components/Field';
import { StatusBadge } from '../src/planora/components/StatusBadge';
import { PlanoraShowcase } from '../src/planora/samples/PlanoraShowcase';
import { LandingSample } from '../src/planora/samples/LandingSample';
import { ChatPlanSample } from '../src/planora/samples/ChatPlanSample';
import { SettingsScopeSample } from '../src/planora/samples/SettingsScopeSample';
import { HistoryScheduleSample } from '../src/planora/samples/HistoryScheduleSample';

// ============================================================================
// 1. WCAG AA Contrast Verification (Mathematical Verification)
// ============================================================================
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

  it('meets WCAG AA (>= 4.5:1) for all Light mode color pairs', () => {
    // Light mode tokens
    const canvas = '#f8f4eb';
    const paper = '#fffdf7';
    const sidebar = '#eee9dd';
    const text = '#2e382d';
    const muted = '#656b5b';
    const primary = '#3c5741';

    // Status tokens
    const pendingText = '#85532b';
    const pendingBg = '#f6e6cf';
    const errorText = '#9a3f32';
    const errorBg = '#f8e6df';
    const unknownText = '#654576';
    const unknownBg = '#eee6f2';

    expect(contrastRatio(text, canvas)).toBeGreaterThanOrEqual(4.5); // ~11.12:1
    expect(contrastRatio(text, paper)).toBeGreaterThanOrEqual(4.5); // ~12.00:1
    expect(contrastRatio(text, sidebar)).toBeGreaterThanOrEqual(4.5); // ~10.08:1
    expect(contrastRatio(muted, paper)).toBeGreaterThanOrEqual(4.5); // ~5.42:1
    expect(contrastRatio(primary, paper)).toBeGreaterThanOrEqual(4.5); // ~7.84:1
    expect(contrastRatio(paper, primary)).toBeGreaterThanOrEqual(4.5); // Button text on primary

    expect(contrastRatio(pendingText, pendingBg)).toBeGreaterThanOrEqual(4.5); // ~5.24:1
    expect(contrastRatio(errorText, errorBg)).toBeGreaterThanOrEqual(4.5); // ~5.55:1
    expect(contrastRatio(unknownText, unknownBg)).toBeGreaterThanOrEqual(4.5); // ~6.46:1
  });

  it('meets WCAG AA (>= 4.5:1) for all Dark mode color pairs', () => {
    // Dark mode tokens
    const canvas = '#171c18';
    const paper = '#202820';
    const sidebar = '#151b16';
    const text = '#f5f1e7';
    const muted = '#b5bcae';
    const primary = '#8fb68e';
    const onPrimary = '#132014';

    // Status tokens
    const pendingText = '#f5c07a';
    const pendingBg = '#332314';
    const errorText = '#fca5a5';
    const errorBg = '#351a1a';
    const unknownText = '#d8b4fe';
    const unknownBg = '#281a33';
    const successText = '#a7f3d0';
    const successBg = '#1a2e1d';

    expect(contrastRatio(text, canvas)).toBeGreaterThanOrEqual(4.5); // ~15.31:1
    expect(contrastRatio(text, paper)).toBeGreaterThanOrEqual(4.5); // ~13.44:1
    expect(contrastRatio(text, sidebar)).toBeGreaterThanOrEqual(4.5); // ~15.51:1
    expect(contrastRatio(muted, paper)).toBeGreaterThanOrEqual(4.5); // ~7.77:1
    expect(contrastRatio(primary, paper)).toBeGreaterThanOrEqual(4.5); // ~6.67:1
    expect(contrastRatio(onPrimary, primary)).toBeGreaterThanOrEqual(4.5); // ~7.43:1

    expect(contrastRatio(pendingText, pendingBg)).toBeGreaterThanOrEqual(4.5); // ~9.13:1
    expect(contrastRatio(errorText, errorBg)).toBeGreaterThanOrEqual(4.5); // ~8.42:1
    expect(contrastRatio(unknownText, unknownBg)).toBeGreaterThanOrEqual(4.5); // ~9.24:1
    expect(contrastRatio(successText, successBg)).toBeGreaterThanOrEqual(4.5); // ~11.27:1
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

  it('renders ChatPlanSample with sidebar, plan card and composer', () => {
    render(<ChatPlanSample />);
    expect(screen.getByText(/Mẫu giao diện Hội thoại làm trung tâm/)).toBeInTheDocument();
    expect(screen.getByText(/Kế hoạch thực thi 2 bước/)).toBeInTheDocument();
    expect(screen.getByText(/github\.list_issues/)).toBeInTheDocument();
    expect(screen.getByText(/trello\.update_card/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Phê duyệt và Thực thi' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Nhập yêu cầu tiếp theo/)).toBeInTheDocument();
  });

  it('renders SettingsScopeSample with PR #260 GitHub OAuth repo filter and destinations', () => {
    render(<SettingsScopeSample />);
    expect(screen.getByText(/Cài đặt kết nối & Phạm vi tài nguyên/)).toBeInTheDocument();
    expect(screen.getByText('GitHub (OAuth cá nhân)')).toBeInTheDocument();
    expect(screen.getByText(/5 \/ 10/)).toBeInTheDocument();
    expect(screen.getByText('VinhDat267/ATI_Project')).toBeInTheDocument();
    expect(screen.getByText(/Đích gửi GitHub Digest tự động/)).toBeInTheDocument();
  });

  it('renders HistoryScheduleSample with schedules, needs_attention and audit log', () => {
    render(<HistoryScheduleSample />);
    expect(screen.getByRole('heading', { level: 1, name: /Nhật ký hoạt động & Lịch chạy tự động/ })).toBeInTheDocument();
    expect(screen.getByText('GitHub Digest buổi sáng')).toBeInTheDocument();
    expect(screen.getByText('needs_attention')).toBeInTheDocument();
    expect(screen.getByText(/Đã giữ marker chống gửi trùng/)).toBeInTheDocument();
  });

  it('PlanoraShowcase renders tabs and toggles between samples and theme', () => {
    render(<PlanoraShowcase initialView="landing" />);
    expect(screen.getByText(/PLANORA PL-01/)).toBeInTheDocument();

    // Toggle to Chat
    fireEvent.click(screen.getByRole('button', { name: '2. Chat có plan' }));
    expect(screen.getByText(/Mẫu giao diện Hội thoại làm trung tâm/)).toBeInTheDocument();

    // Toggle to Settings
    fireEvent.click(screen.getByRole('button', { name: '3. Settings (OAuth & Scope)' }));
    expect(screen.getByText(/Cài đặt kết nối & Phạm vi tài nguyên/)).toBeInTheDocument();

    // Toggle theme
    const themeBtn = screen.getByRole('button', { name: /Chuyển sang giao diện/ });
    fireEvent.click(themeBtn);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
