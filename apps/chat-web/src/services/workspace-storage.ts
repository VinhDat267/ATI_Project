import type { WorkspaceSummary } from '../types';

const STORAGE_KEY = 'wap_active_workspace_id';
const PENDING_INVITE_KEY = 'wap_pending_invite_code';

let cachedOrganizations: WorkspaceSummary[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch {
      // ignore listener error
    }
  }
}

export function getActiveWorkspaceId(): string {
  try {
    const val = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY)?.trim() : null;
    return val || 'personal';
  } catch {
    return 'personal';
  }
}

export function setActiveWorkspaceId(id: string): void {
  const next = id?.trim() || 'personal';
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  } catch {
    // ignore storage errors
  }
  notify();
}

export function getCachedOrganizations(): WorkspaceSummary[] {
  return cachedOrganizations;
}

export function setCachedOrganizations(orgs: WorkspaceSummary[]): void {
  cachedOrganizations = Array.isArray(orgs) ? orgs : [];
  notify();
}

export function getActiveWorkspaceSummary(): WorkspaceSummary {
  const id = getActiveWorkspaceId();
  if (id !== 'personal') {
    const found = cachedOrganizations.find(o => o.id === id);
    if (found) return found;
  }
  return {
    id: 'personal',
    name: 'Không gian Cá nhân',
    role: 'admin',
    status: 'active',
  };
}

export function subscribeWorkspace(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function savePendingInviteCode(code: string): void {
  try {
    const trimmed = code.trim().toUpperCase();
    if (trimmed && typeof window !== 'undefined') {
      window.localStorage.setItem(PENDING_INVITE_KEY, trimmed);
    }
  } catch {}
}

export function consumePendingInviteCode(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const val = window.localStorage.getItem(PENDING_INVITE_KEY)?.trim() || null;
    if (val) window.localStorage.removeItem(PENDING_INVITE_KEY);
    return val;
  } catch {
    return null;
  }
}

export function resetWorkspaceStorage(): void {
  cachedOrganizations = [];
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(PENDING_INVITE_KEY);
    }
  } catch {}
  notify();
}
