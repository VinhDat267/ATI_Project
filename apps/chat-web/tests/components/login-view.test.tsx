/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { LoginView } from '../../src/components/LoginView';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('LoginView Component', () => {
  it('renders split-screen branding and essential form elements', () => {
    const setEmail = vi.fn();
    const setPassword = vi.fn();
    const onLogin = vi.fn();

    render(
      <LoginView
        email=""
        setEmail={setEmail}
        password=""
        setPassword={setPassword}
        isLoggingIn={false}
        authError={null}
        onLogin={onLogin}
      />
    );

    // Brand and platform title
    expect(screen.getByText(/AI Workflow Automation Platform/i)).toBeDefined();
    expect(screen.getAllByText(/GitHub/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Trello/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Slack/i).length).toBeGreaterThan(0);

    // Form inputs accessible by label
    expect(screen.getByLabelText('Email')).toBeDefined();
    expect(screen.getByLabelText('Mật khẩu')).toBeDefined();

    // Submit button
    const submitBtn = screen.getByRole('button', { name: 'Đăng nhập' });
    expect(submitBtn).toBeDefined();
    expect(submitBtn.hasAttribute('disabled')).toBe(false);
  });

  it('handles input changes and form submission', () => {
    const setEmail = vi.fn();
    const setPassword = vi.fn();
    const onLogin = vi.fn((e) => e.preventDefault());

    render(
      <LoginView
        email="test@example.com"
        setEmail={setEmail}
        password="secret"
        setPassword={setPassword}
        isLoggingIn={false}
        authError={null}
        onLogin={onLogin}
      />
    );

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } });
    expect(setEmail).toHaveBeenCalledWith('user@example.com');

    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'mypassword' } });
    expect(setPassword).toHaveBeenCalledWith('mypassword');

    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(onLogin).toHaveBeenCalled();
  });

  it('omits quick fill even when a callback was provided', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_SHOW_DEMO_LOGIN', 'true');
    vi.stubEnv('VITE_DEMO_EMAIL', 'demo@localhost.test');
    vi.stubEnv('VITE_DEMO_PASSWORD', 'demo-test-only');
    const onQuickFillDemo = vi.fn();

    render(
      <LoginView
        email=""
        setEmail={vi.fn()}
        password=""
        setPassword={vi.fn()}
        isLoggingIn={false}
        authError={null}
        onLogin={vi.fn()}
        onQuickFillDemo={onQuickFillDemo}
      />
    );

    const quickFillBtn = screen.queryByRole('button', { name: /Điền nhanh tài khoản demo/i });
    expect(quickFillBtn).toBeNull();

    expect(quickFillBtn).toBeNull();
    expect(onQuickFillDemo).not.toHaveBeenCalled();
  });

  it('displays auth error alert when authError is present', () => {
    render(
      <LoginView
        email="admin@test.com"
        setEmail={vi.fn()}
        password="wrong"
        setPassword={vi.fn()}
        isLoggingIn={false}
        authError="Email hoặc mật khẩu không chính xác"
        onLogin={vi.fn()}
      />
    );

    const alert = screen.getByRole('alert');
    expect(alert).toBeDefined();
    expect(alert.textContent).toContain('Email hoặc mật khẩu không chính xác');
  });

  it('disables submit button and shows loading state when isLoggingIn is true', () => {
    render(
      <LoginView
        email="admin@test.com"
        setEmail={vi.fn()}
        password="secret"
        setPassword={vi.fn()}
        isLoggingIn={true}
        authError={null}
        onLogin={vi.fn()}
      />
    );

    const submitBtn = screen.getByRole('button', { name: /Đang đăng nhập/i });
    expect(submitBtn.hasAttribute('disabled')).toBe(true);
  });

  it('triggers onBackToLanding when the back button is clicked', () => {
    const onBackToLanding = vi.fn();
    render(
      <LoginView
        email=""
        setEmail={vi.fn()}
        password=""
        setPassword={vi.fn()}
        isLoggingIn={false}
        authError={null}
        onLogin={vi.fn()}
        onBackToLanding={onBackToLanding}
      />
    );

    const backBtn = screen.getByRole('button', { name: /Đóng cửa sổ/i });
    expect(backBtn).toBeDefined();

    fireEvent.click(backBtn);
    expect(onBackToLanding).toHaveBeenCalledTimes(1);
  });

  it('does not expose opted-in sandbox credentials in the public modal', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_SHOW_DEMO_LOGIN', 'true');
    vi.stubEnv('VITE_DEMO_EMAIL', 'demo@localhost.test');
    vi.stubEnv('VITE_DEMO_PASSWORD', 'demo-test-only');
    const setEmail = vi.fn();
    const setPassword = vi.fn();

    render(
      <LoginView
        email=""
        setEmail={setEmail}
        password=""
        setPassword={setPassword}
        isLoggingIn={false}
        authError={null}
        onLogin={vi.fn()}
      />
    );

    const quickFillBtn = screen.queryByRole('button', { name: /Điền nhanh tài khoản demo/i });
    expect(quickFillBtn).toBeNull();

    expect(setEmail).not.toHaveBeenCalled();
    expect(setPassword).not.toHaveBeenCalled();
  });

  it('translates generic Invalid email or password error into helpful Vietnamese guidance', () => {
    render(
      <LoginView
        email="admin@test.com"
        setEmail={vi.fn()}
        password="wrong"
        setPassword={vi.fn()}
        isLoggingIn={false}
        authError="Invalid email or password"
        onLogin={vi.fn()}
      />
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Email hoặc mật khẩu không chính xác');
    expect(alert.textContent).not.toContain('Điền nhanh');
  });
});

for (const dev of [true, false]) {
  it(`hides demo credentials unless development explicitly opts in (DEV=${dev})`, () => {
    vi.stubEnv('DEV', dev);
    vi.stubEnv('VITE_SHOW_DEMO_LOGIN', dev ? 'false' : 'true');
    vi.stubEnv('VITE_DEMO_PASSWORD', 'must-not-appear');
    render(<LoginView email="" password="" setEmail={vi.fn()} setPassword={vi.fn()} isLoggingIn={false} authError={null} onLogin={vi.fn()} />);
    expect(screen.queryByRole('button', {name: /Điền nhanh/})).toBeNull();
    expect(screen.queryByText('must-not-appear')).toBeNull();
  });
}
