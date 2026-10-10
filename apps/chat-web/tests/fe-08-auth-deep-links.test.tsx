import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { authStorage } from '../src/services/auth-storage';

afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); authStorage.clearStoredTokens();
  window.history.replaceState({}, '', '/');
});

const failures = [
  { status: 429, code: 'LOGIN_LOCKED', mode: 'blocked-attempts' },
  { status: 403, code: 'ACCOUNT_PENDING', mode: 'blocked-pending' },
  { status: 403, code: 'ACCOUNT_DISABLED', mode: 'blocked-locked' },
];
const cases = ['/c/private-conversation', '/account', '/admin/users', '/settings', '/history']
  .flatMap(path => failures.map(failure => ({ path, ...failure })));

it.each(cases)('shows $code after login at the protected deep link $path', async ({ path, status, code, mode }) => {
  authStorage.clearStoredTokens();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/auth/config') return new Response(JSON.stringify({ signupEnabled: true, googleEnabled: false }), { headers: { 'Content-Type': 'application/json' } });
    if (url === '/api/auth/login') return new Response(JSON.stringify({ code, error: 'Private admin@example.test' }), {
      status, headers: { 'Content-Type': 'application/json', 'Retry-After': '73' },
    });
    throw new Error(`Unexpected request: ${url}`);
  }));
  window.history.replaceState({}, '', path);
  const { container } = render(<App />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'member@example.test' } });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'Current!password' } });
  fireEvent.submit(container.querySelector('form')!);
  await waitFor(() => expect(container.querySelector(`#view-${mode}`)).toBeInTheDocument());
  expect(window.location.pathname).toBe(path);
  expect(document.body).not.toHaveTextContent('admin@example.test');
  expect(authStorage.getStoredTokens().accessToken).toBeNull();
  if (status === 429) expect(container.querySelector('#blocked-timer-display')).toHaveTextContent('01:13');
});
