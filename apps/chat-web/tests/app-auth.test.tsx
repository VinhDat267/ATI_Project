/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App authentication', () => {
  it('requires submitted credentials instead of logging in as the demo admin automatically', async () => {
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      json: async () => ({ accessToken: 'jwt', user: { id: 'user-1', email: 'operator@example.com', name: 'Operator' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    // The public health request must not log in before credential submission.
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/login')).toBe(false);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'operator@example.com' } });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'entered-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'operator@example.com', password: 'entered-secret' }),
    })));
  });
});
