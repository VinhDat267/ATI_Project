/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { UserNavMenu } from '../../src/components/layout/UserNavMenu';

afterEach(() => {
  cleanup();
});

describe.each([undefined, 'prototype'] as const)('UserNavMenu Component %s', variant => {
  it('renders user details and only exposes account, privacy, and logout actions', () => {
    const onOpenAccount = vi.fn();
    const navigate = vi.fn();
    const onLogout = vi.fn();
    const user = {
      id: 'u1',
      name: 'Nguyen Van A',
      email: 'a@example.com',
      role: 'admin' as const,
    };

    render(
      <UserNavMenu
        variant={variant}
        user={user}
        navigate={navigate}
        onOpenAccount={onOpenAccount}
        onLogout={onLogout}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Menu người dùng/ }));
    expect(screen.getByText('Nguyen Van A')).toBeInTheDocument();
    expect(screen.getByText('a@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Menu người dùng/ })).toHaveTextContent('NA');
    // Sidebar destinations must not be duplicated in the avatar popover.
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      'Tài khoản',
      'Chính sách an toàn',
      'Đăng xuất',
    ]);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Tài khoản' }));
    expect(onOpenAccount).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Menu người dùng/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Chính sách an toàn' }));
    expect(navigate).toHaveBeenCalledWith('/privacy');

    fireEvent.click(screen.getByRole('button', { name: /Menu người dùng/ }));
    const logoutBtn = screen.getByRole('menuitem', { name: /đăng xuất/i });
    fireEvent.click(logoutBtn);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('renders fallback for guest/unnamed user', () => {
    render(
      <UserNavMenu
        variant={variant}
        user={null}
        onLogout={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Menu người dùng/ }));
    expect(screen.getByText('Người dùng')).toBeInTheDocument();
    expect(screen.getByText('AO')).toBeInTheDocument();
  });
});
