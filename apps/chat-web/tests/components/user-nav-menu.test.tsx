/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { UserNavMenu } from '../../src/components/layout/UserNavMenu';

afterEach(() => {
  cleanup();
});

describe.each([undefined, 'prototype'] as const)('UserNavMenu Component %s', variant => {
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
        variant={variant}
        user={user}
        onOpenSettings={onOpenSettings}
        onLogout={onLogout}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Menu người dùng/ }));
    expect(screen.getByText('Nguyen Van A')).toBeInTheDocument();
    expect(screen.getByText('a@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Menu người dùng/ })).toHaveTextContent('NA');

    const settingsBtn = screen.getByRole('menuitem', { name: 'Kết nối dịch vụ' });
    fireEvent.click(settingsBtn);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

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
        onOpenSettings={vi.fn()}
        onLogout={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Menu người dùng/ }));
    expect(screen.getByText('Người dùng')).toBeInTheDocument();
    expect(screen.getByText('AO')).toBeInTheDocument();
  });
});
