/**
 * Local Playbook Storage Service (FLOW-02, F2 Isolation)
 * Stores Playbooks in browser localStorage scoped by userId and workspaceKey.
 */

export const PLAYBOOK_STORAGE_PREFIX = 'planora_playbooks_v2';
export const LEGACY_STORAGE_KEY = 'ati_custom_playbooks_v1';
export const QUARANTINE_STORAGE_KEY = 'planora_playbooks_quarantine_v1';
export const MAX_PLAYBOOKS_PER_NAMESPACE = 12;

export interface CustomPlaybook {
  id: string;
  title: string;
  prompt: string;
  services: string[];
  isCustom?: boolean;
}

function isValidUserId(userId?: string | null): userId is string {
  const trimmed = userId?.trim();
  return Boolean(trimmed && trimmed !== 'anonymous');
}

export function buildStorageKey(userId?: string | null, workspaceKey?: string | null): string {
  const u = userId?.trim() || 'anonymous';
  const w = workspaceKey?.trim() || 'personal';
  return `${PLAYBOOK_STORAGE_PREFIX}:${u}:${w}`;
}

export function quarantineLegacyV1(): void {
  try {
    if (typeof window === 'undefined') return;
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return;
    // Backup to quarantine key
    window.localStorage.setItem(QUARANTINE_STORAGE_KEY, legacy);
    // Remove legacy only if setItem succeeded
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // If storage is full or disabled, preserve legacy key
  }
}

export function loadPlaybooks(
  userId?: string | null,
  workspaceKey?: string | null
): CustomPlaybook[] {
  try {
    if (typeof window === 'undefined') return [];
    quarantineLegacyV1();
    if (!isValidUserId(userId)) return [];
    const key = buildStorageKey(userId, workspaceKey);
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is CustomPlaybook =>
        Boolean(
          item &&
            typeof item.id === 'string' &&
            typeof item.title === 'string' &&
            typeof item.prompt === 'string' &&
            Array.isArray(item.services)
        )
    );
  } catch {
    return [];
  }
}

export function savePlaybook(
  userId: string | null | undefined,
  workspaceKey: string | null | undefined,
  playbook: CustomPlaybook
): { success: boolean; error?: string } {
  try {
    if (typeof window === 'undefined') {
      return { success: false, error: 'Storage unavailable in server environment' };
    }
    quarantineLegacyV1();
    if (!isValidUserId(userId)) {
      return {
        success: false,
        error: 'PLAYBOOK_AUTH_REQUIRED: Vui lòng đăng nhập tài khoản xác thực để lưu Playbook.',
      };
    }
    const existing = loadPlaybooks(userId, workspaceKey);
    const index = existing.findIndex((p) => p.id === playbook.id);

    let nextList: CustomPlaybook[];
    if (index >= 0) {
      nextList = [...existing];
      nextList[index] = playbook;
    } else {
      if (existing.length >= MAX_PLAYBOOKS_PER_NAMESPACE) {
        return {
          success: false,
          error: `PLAYBOOK_QUOTA_EXCEEDED: Đã đạt giới hạn tối đa ${MAX_PLAYBOOKS_PER_NAMESPACE} mẫu. Vui lòng xoá bớt mẫu cũ trước khi lưu thêm.`,
        };
      }
      nextList = [playbook, ...existing];
    }

    const key = buildStorageKey(userId, workspaceKey);
    window.localStorage.setItem(key, JSON.stringify(nextList));
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Không thể lưu mẫu vào bộ nhớ trình duyệt' };
  }
}

export function deletePlaybook(
  userId: string | null | undefined,
  workspaceKey: string | null | undefined,
  playbookId: string
): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if (!isValidUserId(userId)) return false;
    const existing = loadPlaybooks(userId, workspaceKey);
    const filtered = existing.filter((p) => p.id !== playbookId);
    if (filtered.length === existing.length) return false;
    const key = buildStorageKey(userId, workspaceKey);
    window.localStorage.setItem(key, JSON.stringify(filtered));
    return true;
  } catch {
    return false;
  }
}
