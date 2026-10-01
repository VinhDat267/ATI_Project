import type { User } from '../types';

export interface StoredTokens {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
}

export interface SetTokensInput {
  accessToken?: string | null;
  refreshToken?: string | null;
  user?: User | null;
}

const ACCESS_TOKEN_KEY = 'wap_access_token';
const REFRESH_TOKEN_KEY = 'wap_refresh_token';
const USER_KEY = 'wap_user';

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export function getStoredTokens(): StoredTokens {
  const storage = getStorage();
  if (!storage) {
    return { accessToken: null, refreshToken: null, user: null };
  }
  const accessToken = storage.getItem(ACCESS_TOKEN_KEY);
  const refreshToken = storage.getItem(REFRESH_TOKEN_KEY);
  const rawUser = storage.getItem(USER_KEY);
  let user: User | null = null;
  if (rawUser) {
    try {
      user = JSON.parse(rawUser);
    } catch {
      user = null;
    }
  }
  return { accessToken, refreshToken, user };
}

export type AuthChangeListener = (tokens: StoredTokens) => void;
const listeners = new Set<AuthChangeListener>();

export function subscribeAuthTokens(listener: AuthChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners(): void {
  const current = getStoredTokens();
  listeners.forEach((fn) => {
    try {
      fn(current);
    } catch (err) {
      console.error('Error in auth token listener:', err);
    }
  });
}

export function setStoredTokens(tokens: SetTokensInput): void {
  const storage = getStorage();
  if (!storage) return;

  if (tokens.accessToken !== undefined) {
    if (tokens.accessToken === null) {
      storage.removeItem(ACCESS_TOKEN_KEY);
    } else {
      storage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    }
  }

  if (tokens.refreshToken !== undefined) {
    if (tokens.refreshToken === null) {
      storage.removeItem(REFRESH_TOKEN_KEY);
    } else {
      storage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    }
  }

  if (tokens.user !== undefined) {
    if (tokens.user === null) {
      storage.removeItem(USER_KEY);
    } else {
      storage.setItem(USER_KEY, JSON.stringify(tokens.user));
    }
  }

  notifyListeners();
}

export function clearStoredTokens(): void {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(ACCESS_TOKEN_KEY);
  storage.removeItem(REFRESH_TOKEN_KEY);
  storage.removeItem(USER_KEY);

  notifyListeners();
}

export const authStorage = {
  getStoredTokens,
  setStoredTokens,
  clearStoredTokens,
  subscribeAuthTokens,
};
