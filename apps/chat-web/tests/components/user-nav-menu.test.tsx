/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { UserNavMenu } from '../../src/components/layout/UserNavMenu';

afterEach(() => {
  cleanup();
});

describe('UserNavMenu Component', () => {
  it('renders user details and triggers onOpenSettings and onLogout', () => {
    const onOpenSettings = vi.fn();
    const onLogout = vi.fn();
    const user = {
      id: 'u1',
      name: 'Nguyen Van A',
      email: 'a@example.com',
    };

    render(
      <UserNavMenu
        user={user}
        onOpenSettings={onOpenSettings}
        onLogout={onLogout}
      />
    );

    expect(screen.getByText('Nguyen Van A')).toBeInTheDocument();
    expect(screen.getByText('a@example.com')).toBeInTheDocument();
    expect(screen.getByText('NG')).toBeInTheDocument();

    const settingsBtn = screen.getByRole('button', { name: /cài đặt/i });
    fireEvent.click(settingsBtn);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    const logoutBtn = screen.getByRole('button', { name: /đăng xuất/i });
    fireEvent.click(logoutBtn);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('renders fallback for guest/unnamed user', () => {
    render(
      <UserNavMenu
        user={null}
        onOpenSettings={vi.fn()}
        onLogout={vi.fn()}
      />
    );

    expect(screen.getByText('Người dùng')).toBeInTheDocument();
    expect(screen.getByText('AO')).toBeInTheDocument();
  });
});
