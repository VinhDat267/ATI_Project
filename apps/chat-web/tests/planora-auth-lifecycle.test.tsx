/** @vitest-environment jsdom */
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthActionPage, type AuthActionMode } from '../src/pages/AuthAction/AuthActionPage';
import { VerifyEmailView } from '../src/views/VerifyEmailView';
import { ResetPasswordView } from '../src/views/ResetPasswordView';
import { GoogleCallbackView } from '../src/views/GoogleCallbackView';
import { authStorage } from '../src/services/auth-storage';
import { apiClient } from '../src/services/api-client';

describe('PL-04 Planora AuthAction & Account Lifecycle', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    authStorage.clearStoredTokens();
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('AuthActionPage all 13 modes render with PlanoraAuthFrame', () => {
    const modes: Array<{
      mode: AuthActionMode;
      expectedHeading: string;
      expectedBadge: string;
      expectedId: string;
    }> = [
      {
        mode: 'loading',
        expectedHeading: 'Đang xác minh tài khoản…',
        expectedBadge: 'XÁC MINH EMAIL',
        expectedId: 'view-loading',
      },
      {
        mode: 'verify-success',
        expectedHeading: 'Email của bạn đã được xác minh',
        expectedBadge: 'Bước 1 / 3 hoàn tất',
        expectedId: 'view-verify-success',
      },
      {
        mode: 'verify-expired',
        expectedHeading: 'Link xác minh không còn hiệu lực',
        expectedBadge: 'Xác minh email',
        expectedId: 'view-verify-expired',
      },
      {
        mode: 'verify-used',
        expectedHeading: 'Link này đã được sử dụng',
        expectedBadge: 'Đã xác thực trước đó',
        expectedId: 'view-verify-used',
      },
      {
        mode: 'reset-password',
        expectedHeading: 'Tạo mật khẩu mới',
        expectedBadge: 'Bảo mật tài khoản',
        expectedId: 'view-reset-password',
      },
      {
        mode: 'reset-success',
        expectedHeading: 'Mật khẩu đã được thay đổi',
        expectedBadge: 'Cập nhật thành công',
        expectedId: 'view-reset-success',
      },
      {
        mode: 'google-pending',
        expectedHeading: 'Đang chờ quản trị viên duyệt',
        expectedBadge: 'Đăng ký với Google · Chờ phê duyệt',
        expectedId: 'view-google-pending',
      },
      {
        mode: 'google-ready',
        expectedHeading: 'Đang vào không gian làm việc…',
        expectedBadge: 'Đăng nhập thành công',
        expectedId: 'view-google-ready',
      },
      {
        mode: 'google-error',
        expectedHeading: 'Đăng nhập Google chưa hoàn tất',
        expectedBadge: 'Chưa hoàn tất',
        expectedId: 'view-google-error',
      },
      {
        mode: 'blocked-pending',
        expectedHeading: 'Tài khoản đang chờ duyệt',
        expectedBadge: 'Đăng nhập tạm thời bị chặn · Đang chờ duyệt',
        expectedId: 'view-blocked-pending',
      },
      {
        mode: 'blocked-locked',
        expectedHeading: 'Tài khoản đã bị tạm khóa',
        expectedBadge: 'Đăng nhập bị từ chối · Tài khoản bị khóa',
        expectedId: 'view-blocked-locked',
      },
      {
        mode: 'blocked-attempts',
        expectedHeading: 'Sai mật khẩu quá nhiều lần',
        expectedBadge: 'Bảo vệ tài khoản · Tạm khóa 15 phút',
        expectedId: 'view-blocked-attempts',
      },
      {
        mode: 'email-not-verified',
        expectedHeading: 'Tài khoản đang chờ duyệt',
        expectedBadge: 'Cần xác minh email',
        expectedId: 'view-email-not-verified',
      },
    ];

    it.each(modes)(
      'renders mode $mode with single primary heading "$expectedHeading" and section #$expectedId',
      ({ mode, expectedHeading, expectedBadge, expectedId }) => {
        const navigate = vi.fn();
        const { container } = render(
          <AuthActionPage
            mode={mode}
            email="user@planora.test"
            name="Test User"
            navigate={navigate}
          />
        );

        // Single primary heading h1
        const headings = screen.getAllByRole('heading', { level: 1 });
        expect(headings).toHaveLength(1);
        expect(headings[0]).toHaveTextContent(expectedHeading);

        // Kicker badge
        const badges = screen.getAllByText(expectedBadge);
        expect(badges.length).toBeGreaterThanOrEqual(1);

        // Mode container section with expected ID
        expect(container.querySelector(`#${expectedId}`)).toBeInTheDocument();

        // Card ID
        expect(container.querySelector('#action-card')).toBeInTheDocument();
      }
    );
  });

  describe('Password Strength meter and Confirmation in reset-password mode', () => {
    it('updates strength meter bars and text based on password complexity', () => {
      const navigate = vi.fn();
      render(
        <AuthActionPage
          mode="reset-password"
          email="user@planora.test"
          navigate={navigate}
        />
      );

      const newPassInput = screen.getByLabelText('Mật khẩu mới');
      const strengthText = screen.getByText('Tối thiểu 12 ký tự');
      expect(strengthText).toBeInTheDocument();

      // < 12 characters -> red
      fireEvent.input(newPassInput, { target: { value: 'short' } });
      expect(screen.getByText('Mật khẩu cần ít nhất 12 ký tự')).toBeInTheDocument();

      // >= 12 characters but low diversity -> score 1
      fireEvent.input(newPassInput, { target: { value: 'alllowercasepassword' } });
      expect(screen.getByText('Độ mạnh: Khá (đạt 12 ký tự)')).toBeInTheDocument();

      // >= 12 chars + upper + lower + numbers + symbols -> excellent
      fireEvent.input(newPassInput, { target: { value: 'Planora2026!VeryStrong' } });
      expect(screen.getByText('Độ mạnh: Tuyệt vời')).toBeInTheDocument();
    });

    it('validates password match confirmation and toggles visibility', () => {
      const navigate = vi.fn();
      render(
        <AuthActionPage
          mode="reset-password"
          email="user@planora.test"
          navigate={navigate}
        />
      );

      const newPass = screen.getByLabelText('Mật khẩu mới');
      const confirmPass = screen.getByLabelText('Nhập lại mật khẩu');

      fireEvent.input(newPass, { target: { value: 'ValidPassword123!' } });
      fireEvent.input(confirmPass, { target: { value: 'DifferentPassword456!' } });
      expect(screen.getByText('Mật khẩu xác nhận chưa trùng khớp')).toBeInTheDocument();

      fireEvent.input(confirmPass, { target: { value: 'ValidPassword123!' } });
      expect(screen.getByText('✓ Mật khẩu khớp nhau')).toBeInTheDocument();

      // Visibility toggles
      const eyeBtns = screen.getAllByRole('button', { name: /Ẩn hiện mật khẩu/ });
      expect(eyeBtns).toHaveLength(2);
      expect(newPass).toHaveAttribute('type', 'password');
      fireEvent.click(eyeBtns[0]);
      expect(newPass).toHaveAttribute('type', 'text');
    });
  });

  describe('Countdown Timer in blocked-attempts mode', () => {
    it('computes remaining seconds from deadline and updates display without prototype placeholder', async () => {
      vi.useFakeTimers();
      const now = 1000000;
      vi.setSystemTime(now);

      const deadline = now + 73 * 1000; // 73 seconds = 01:13
      const navigate = vi.fn();
      const { container } = render(
        <AuthActionPage
          mode="blocked-attempts"
          email="user@planora.test"
          deadline={deadline}
          navigate={navigate}
        />
      );

      const display = container.querySelector('#blocked-timer-display');
      expect(display).toHaveTextContent('01:13');

      // Fast forward 13 seconds -> 01:00
      act(() => {
        vi.advanceTimersByTime(13000);
      });
      expect(display).toHaveTextContent('01:00');

      // Fast forward to zero -> 00:00 with timer-done
      act(() => {
        vi.advanceTimersByTime(60000);
      });
      expect(display).toHaveTextContent('00:00');
      expect(display).toHaveClass('timer-done');
    });
  });

  describe('VerifyEmailView integration', () => {
    it('calls verifyEmail on token mount, stores tokens and navigates home on success', async () => {
      const navigate = vi.fn();
      vi.spyOn(apiClient, 'verifyEmail').mockResolvedValue({
        message: 'Xác minh thành công',
        accessToken: 'access-123',
        refreshToken: 'refresh-123',
        user: { id: 'u1', email: 'verified@example.com', name: 'Verified' },
      });

      render(<VerifyEmailView navigate={navigate} token="valid-verify-token" />);

      await waitFor(() => {
        expect(apiClient.verifyEmail).toHaveBeenCalledWith('valid-verify-token');
        expect(navigate).toHaveBeenCalledWith('/', true);
      });
      expect(authStorage.getStoredTokens().accessToken).toBe('access-123');
    });

    it('renders verify-expired mode with error when verifyEmail fails', async () => {
      const navigate = vi.fn();
      vi.spyOn(apiClient, 'verifyEmail').mockRejectedValue(
        new Error('Token đã hết hạn')
      );

      render(<VerifyEmailView navigate={navigate} token="expired-verify-token" />);

      expect(await screen.findByRole('alert')).toHaveTextContent('Token đã hết hạn');
      expect(screen.getByText('Link xác minh không còn hiệu lực')).toBeInTheDocument();
    });
  });

  describe('ResetPasswordView integration', () => {
    it('validates password length before submission and updates to reset-success', async () => {
      const navigate = vi.fn();
      vi.spyOn(apiClient, 'resetPassword').mockResolvedValue({
        message: 'Đặt lại mật khẩu thành công',
      });

      render(<ResetPasswordView navigate={navigate} token="valid-reset-token" />);

      // Password too short (< 12)
      fireEvent.change(screen.getByLabelText('Mật khẩu mới'), { target: { value: 'short' } });
      fireEvent.change(screen.getByLabelText('Nhập lại mật khẩu'), { target: { value: 'short' } });
      fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Mật khẩu phải có từ 12 đến 128 ký tự.');
      expect(apiClient.resetPassword).not.toHaveBeenCalled();

      // Valid password
      fireEvent.change(screen.getByLabelText('Mật khẩu mới'), { target: { value: 'ValidPassword123!' } });
      fireEvent.change(screen.getByLabelText('Nhập lại mật khẩu'), { target: { value: 'ValidPassword123!' } });
      fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }));

      await waitFor(() => {
        expect(apiClient.resetPassword).toHaveBeenCalledWith('valid-reset-token', 'ValidPassword123!');
      });
      expect(await screen.findByText('Mật khẩu đã được thay đổi')).toBeInTheDocument();
    });
  });

  describe('GoogleCallbackView single invocation and StrictMode', () => {
    it('triggers completeGoogleAuth exactly once even under React StrictMode', async () => {
      const navigate = vi.fn();
      vi.spyOn(apiClient, 'completeGoogleAuth').mockResolvedValue({
        accessToken: 'google-access',
        refreshToken: 'google-refresh',
        user: { id: 'g1', email: 'google@test.com', name: 'Google User' },
      });

      render(
        <StrictMode>
          <GoogleCallbackView
            navigate={navigate}
            googleCallback={{ code: 'test-code', state: 'test-state' }}
          />
        </StrictMode>
      );

      await waitFor(() => {
        expect(apiClient.completeGoogleAuth).toHaveBeenCalledTimes(1);
        expect(apiClient.completeGoogleAuth).toHaveBeenCalledWith('test-code', 'test-state');
      });
    });
  });

  describe('F1 & F2 regression: Long email containment & Footer tap targets', () => {
    const longEmail = 'a'.repeat(64) + '@' + 'b'.repeat(63) + '.example.test'; // 141 characters

    it('renders 141-character valid long email with break-all in blocked-locked mode', () => {
      render(
        <AuthActionPage
          mode="blocked-locked"
          email={longEmail}
          navigate={vi.fn()}
        />
      );

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Tài khoản đã bị tạm khóa');
      const emailEl = document.querySelector('.user-email-placeholder');
      expect(emailEl).toBeInTheDocument();
      expect(emailEl).toHaveTextContent(longEmail);
      expect(emailEl?.className).toContain('user-email-placeholder');
      expect(emailEl?.className).toContain('break-all');
    });

    it('renders 141-character email with break-all in blocked-pending, blocked-attempts and email-not-verified', () => {
      const testModes: AuthActionMode[] = ['blocked-pending', 'blocked-attempts', 'email-not-verified', 'verify-success'];
      for (const m of testModes) {
        cleanup();
        render(
          <AuthActionPage
            mode={m}
            email={longEmail}
            navigate={vi.fn()}
          />
        );
        const emailEl = document.querySelector('.user-email-placeholder');
        expect(emailEl).toBeInTheDocument();
        expect(emailEl).toHaveTextContent(longEmail);
        expect(emailEl?.className).toContain('break-all');
      }
    });

    it('renders footer links with planora-auth-footer-link class and valid targets', () => {
      render(
        <AuthActionPage
          mode="blocked-locked"
          email={longEmail}
          navigate={vi.fn()}
        />
      );

      const footer = document.querySelector('.planora-auth-footer');
      expect(footer).toBeInTheDocument();

      const homeLink = screen.getByRole('link', { name: 'Trang chủ' });
      expect(homeLink).toHaveAttribute('href', '/');
      expect(homeLink.className).toContain('planora-auth-footer-link');

      const privacyLink = screen.getByRole('link', { name: 'Chính sách an toàn & Dữ liệu' });
      expect(privacyLink).toHaveAttribute('href', '/privacy');
      expect(privacyLink.className).toContain('planora-auth-footer-link');
    });
  });
});
