const RETURN_TARGET_KEY = 'wap_auth_return_target';
const ACCOUNT_PATHS = new Set([
  '/login', '/signup', '/verify-email', '/resend-verification',
  '/forgot-password', '/reset-password', '/auth/google/callback',
]);

interface StoredReturnTarget {
  path: string;
  userId?: string;
}

function safeInternalPath(value: string): string | null {
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin || ACCOUNT_PATHS.has(parsed.pathname.replace(/\/$/, '') || '/')) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function currentAuthReturnTarget(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function saveAuthReturnTarget(path: string, userId?: string): void {
  const safePath = safeInternalPath(path);
  if (!safePath) {
    sessionStorage.removeItem(RETURN_TARGET_KEY);
    return;
  }
  sessionStorage.setItem(RETURN_TARGET_KEY, JSON.stringify({ path: safePath, ...(userId ? { userId } : {}) }));
}

export function clearAuthReturnTarget(): void {
  sessionStorage.removeItem(RETURN_TARGET_KEY);
}

export function consumeAuthReturnTarget(userId: string): string | null {
  const raw = sessionStorage.getItem(RETURN_TARGET_KEY);
  sessionStorage.removeItem(RETURN_TARGET_KEY);
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as StoredReturnTarget;
    if (stored.userId && stored.userId !== userId) return null;
    return typeof stored.path === 'string' ? safeInternalPath(stored.path) : null;
  } catch {
    return null;
  }
}
