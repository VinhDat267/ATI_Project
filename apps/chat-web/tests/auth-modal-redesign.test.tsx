/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App';
import { authStorage } from '../src/services/auth-storage';

let googleEnabled = false;
let signupEnabled = true;

function mockConfigFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.endsWith('/config')
        ? { signupEnabled, googleEnabled }
        : { message: 'ok' };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

beforeEach(() => {
  localStorage.removeItem('ati-theme');
  authStorage.clearStoredTokens();
  googleEnabled = false;
  signupEnabled = true;
  mockConfigFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
  authStorage.clearStoredTokens();
});

function open(path: string) {
  window.history.replaceState({}, '', path);
  return render(<App />);
}

describe('Auth modal redesign', () => {
  it('switches the editorial showcase panel across login, signup, and forgot-password while preserving a single h1', async () => {
    const { container } = open('/login');
    await waitFor(() => expect(container.querySelector('#auth-showcase-panel')).not.toBeNull());

    const getShowcase = () => container.querySelector<HTMLElement>('#auth-showcase-panel')!;
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(within(getShowcase()).getByRole('heading', { level: 2 })).toBeInTheDocument();
    expect(within(getShowcase()).getByText('Khóa phạm vi tài nguyên')).toBeInTheDocument();
    expect(within(getShowcase()).getByText('Xem trước nguyên văn kế hoạch')).toBeInTheDocument();
    expect(within(getShowcase()).getByText('Biên nhận đối chiếu tức thì')).toBeInTheDocument();
    expect(within(getShowcase()).getByText('Trello')).toBeInTheDocument();
    expect(within(getShowcase()).getByText('GitHub')).toBeInTheDocument();
    expect(within(getShowcase()).getByText('Slack')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Đăng ký' }));
    await waitFor(() => expect(window.location.pathname).toBe('/signup'));
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(within(getShowcase()).getByText('Xác minh email')).toBeInTheDocument();
    expect(within(getShowcase()).getByText('Quản trị viên duyệt')).toBeInTheDocument();
    expect(within(getShowcase()).getByText('Kết nối công cụ')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Đăng nhập' }));
    await waitFor(() => expect(window.location.pathname).toBe('/login'));
    fireEvent.click(screen.getByRole('button', { name: 'Quên mật khẩu?' }));
    await waitFor(() => expect(window.location.pathname).toBe('/forgot-password'));
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(within(getShowcase()).getByRole('heading', { level: 2 })).toBeInTheDocument();
    expect(within(getShowcase()).getByText(/30 phút/)).toBeInTheDocument();
  });

  it('shows password guidance without claiming strength and announces length errors on blur', async () => {
    const { container } = open('/signup');
    const meter = await waitFor(() => {
      const el = container.querySelector('#signup-password-strength');
      expect(el).not.toBeNull();
      return el!;
    });

    // Initial mount: neutral guidance, 0 filled bars, no premature red danger styling
    expect(meter).toHaveTextContent('Tối thiểu 12 ký tự');
    expect(meter.querySelectorAll('[data-strength-bar="empty"]')).toHaveLength(4);
    expect(meter.querySelector('.auth-strength-danger')).toBeNull();
    expect(meter.querySelector('.auth-tone-danger')).toBeNull();

    const pwdInput = screen.getByLabelText('Mật khẩu', { exact: true }) as HTMLInputElement;
    const announcement = screen.getByRole('status');
    expect(announcement).toBeEmptyDOMElement();
    expect(pwdInput).toHaveAccessibleDescription(expect.stringContaining('Tối thiểu 12 ký tự'));

    // Typing < 12 characters before blur: shows remaining char count without premature red danger styling
    fireEvent.change(pwdInput, { target: { value: 'abc' } });
    expect(meter).toHaveTextContent('Còn thiếu 9 ký tự nữa');
    expect(meter.querySelector('.auth-strength-danger')).toBeNull();
    expect(meter.querySelector('.auth-tone-danger')).toBeNull();
    expect(announcement).toBeEmptyDOMElement();

    fireEvent.blur(pwdInput);
    expect(meter).toHaveTextContent('Mật khẩu cần ít nhất 12 ký tự');
    expect(meter.querySelectorAll('[data-strength-bar="danger"]')).toHaveLength(1);
    expect(meter.querySelector('.auth-tone-danger')).not.toBeNull();
    expect(announcement).toHaveTextContent('Mật khẩu cần ít nhất 12 ký tự');

    fireEvent.focus(pwdInput);
    expect(announcement).toBeEmptyDOMElement();
    fireEvent.change(pwdInput, { target: { value: 'Password123!' } });
    expect(meter).toHaveTextContent('Đạt 4/4 gợi ý về ký tự');
    expect(meter).toHaveTextContent('Ưu tiên mật khẩu dài, riêng cho Planora.');
    expect(meter).not.toHaveTextContent(/độ mạnh|an toàn|tuyệt vời/i);
    expect(meter.querySelectorAll('[data-strength-bar="filled"]')).toHaveLength(4);
    fireEvent.blur(pwdInput);
    expect(announcement).toBeEmptyDOMElement();

    // Switching back to login and returning to signup resets transient signup password state
    fireEvent.click(screen.getByRole('tab', { name: 'Đăng nhập' }));
    await waitFor(() => expect(window.location.pathname).toBe('/login'));
    fireEvent.click(screen.getByRole('tab', { name: 'Đăng ký' }));
    await waitFor(() => expect(window.location.pathname).toBe('/signup'));

    const freshInput = screen.getByLabelText('Mật khẩu', { exact: true }) as HTMLInputElement;
    const freshMeter = container.querySelector('#signup-password-strength')!;
    expect(freshInput.value).toBe('');
    expect(freshMeter).toHaveTextContent('Tối thiểu 12 ký tự');
    expect(freshMeter.querySelectorAll('[data-strength-bar="empty"]')).toHaveLength(4);
    expect(freshMeter.querySelector('.auth-tone-danger')).toBeNull();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('omits Google divider when Google OAuth is disabled and shows it when enabled, preserving secondary actions', async () => {
    googleEnabled = false;
    open('/login');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Quên mật khẩu?' })).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: 'Tiếp tục với Google' })).toBeNull();
    expect(screen.queryByText(/hoặc tiếp tục bằng email/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Gửi lại email xác minh' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đăng ký' })).toBeInTheDocument();

    cleanup();
    googleEnabled = true;
    mockConfigFetch();
    open('/login');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tiếp tục với Google' })).toBeInTheDocument());
    expect(screen.getByText(/hoặc tiếp tục bằng email/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Đăng ký' }));
    await waitFor(() => expect(window.location.pathname).toBe('/signup'));
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeInTheDocument();
  });

  it('keeps the privacy link available before continuing with Google when email signup is closed', async () => {
    signupEnabled = false;
    googleEnabled = true;
    open('/signup');
    const modal = within(screen.getByRole('dialog'));
    await modal.findByRole('button', { name: 'Tiếp tục với Google' });

    const policy = modal.getByRole('link', { name: 'Chính sách an toàn & Dữ liệu' });
    expect(policy).toHaveAttribute('href', '/privacy');
    expect(modal.queryByText(/hoặc tiếp tục bằng email/i)).toBeNull();
    fireEvent.click(policy);
    await waitFor(() => expect(window.location.pathname).toBe('/privacy'));
  });
});
