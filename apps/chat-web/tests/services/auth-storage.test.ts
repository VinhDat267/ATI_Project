import { describe, it, expect, beforeEach } from 'vitest';
import {
  authStorage,
  getStoredTokens,
  setStoredTokens,
  clearStoredTokens,
  subscribeAuthTokens,
} from '../../src/services/auth-storage';

describe('authStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns nulls when localStorage is empty', () => {
    const tokens = getStoredTokens();
    expect(tokens).toEqual({
      accessToken: null,
      refreshToken: null,
      user: null,
    });
  });

  it('stores and retrieves access token, refresh token, and user', () => {
    const user = { id: 'u1', email: 'test@example.com', name: 'Tester' };
    setStoredTokens({
      accessToken: 'access_123',
      refreshToken: 'refresh_456',
      user,
    });

    const tokens = getStoredTokens();
    expect(tokens.accessToken).toBe('access_123');
    expect(tokens.refreshToken).toBe('refresh_456');
    expect(tokens.user).toEqual(user);
  });

  it('supports partial updates without overwriting untouched fields', () => {
    setStoredTokens({
      accessToken: 'access_1',
      refreshToken: 'refresh_1',
      user: { id: 'u1', email: 'a@b.c', name: 'A' },
    });

    setStoredTokens({
      accessToken: 'access_2',
    });

    const tokens = getStoredTokens();
    expect(tokens.accessToken).toBe('access_2');
    expect(tokens.refreshToken).toBe('refresh_1');
    expect(tokens.user?.email).toBe('a@b.c');
  });

  it('removes specific fields when explicitly set to null', () => {
    setStoredTokens({
      accessToken: 'access_1',
      refreshToken: 'refresh_1',
    });

    setStoredTokens({
      refreshToken: null,
    });

    const tokens = getStoredTokens();
    expect(tokens.accessToken).toBe('access_1');
    expect(tokens.refreshToken).toBeNull();
  });

  it('clears all stored tokens and user', () => {
    setStoredTokens({
      accessToken: 'access_1',
      refreshToken: 'refresh_1',
      user: { id: 'u1', email: 'a@b.c', name: 'A' },
    });

    clearStoredTokens();
    const tokens = getStoredTokens();
    expect(tokens).toEqual({
      accessToken: null,
      refreshToken: null,
      user: null,
    });
  });

  it('gracefully handles corrupted JSON in user storage', () => {
    localStorage.setItem('wap_user', 'invalid-json{{{');
    const tokens = authStorage.getStoredTokens();
    expect(tokens.user).toBeNull();
  });

  it('notifies subscribers whenever tokens are updated or cleared', () => {
    const notifications: any[] = [];
    const unsubscribe = subscribeAuthTokens((tokens) => {
      notifications.push(tokens);
    });

    setStoredTokens({ accessToken: 't1', user: { id: 'u1', email: 'u1@test.com', name: 'User 1' } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].accessToken).toBe('t1');
    expect(notifications[0].user?.name).toBe('User 1');

    clearStoredTokens();
    expect(notifications).toHaveLength(2);
    expect(notifications[1].accessToken).toBeNull();
    expect(notifications[1].user).toBeNull();

    unsubscribe();
    setStoredTokens({ accessToken: 't2' });
    expect(notifications).toHaveLength(2);
  });
});
