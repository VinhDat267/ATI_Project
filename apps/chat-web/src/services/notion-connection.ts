import { authStorage } from './auth-storage';

const NOTION_NOTICE_KEY = 'wap_notion_notice';

export function notionSessionOwner() {
  return authStorage.getStoredTokens()?.user?.id ?? null;
}

export function redirectToNotion(url: string) {
  window.location.assign(url);
}

export const notionConnectionNotice = {
  set(workspaceName: string) {
    try {
      const userId = notionSessionOwner();
      sessionStorage.setItem(NOTION_NOTICE_KEY, JSON.stringify({ userId, workspaceName }));
    } catch {
      /* ignore storage errors */
    }
  },
  take(userId?: string): string | null {
    try {
      const raw = sessionStorage.getItem(NOTION_NOTICE_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(NOTION_NOTICE_KEY);
      const parsed = JSON.parse(raw) as { userId?: string; workspaceName?: string };
      if (!parsed.workspaceName || (parsed.userId && parsed.userId !== userId)) return null;
      return parsed.workspaceName;
    } catch {
      sessionStorage.removeItem(NOTION_NOTICE_KEY);
      return null;
    }
  },
};

export function notionCallbackError(code?: string): string {
  if (code === 'NOTION_STATE_INVALID') {
    return 'Phiên kết nối Notion đã hết hạn hoặc không hợp lệ. Vui lòng thử lại.';
  }
  if (code === 'NOTION_CONNECT_FAILED') {
    return 'Không thể xác thực tài khoản Notion. Vui lòng thử lại.';
  }
  if (code === 'INVALID_SESSION') {
    return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  }
  return 'Kết nối Notion không thành công. Vui lòng thử lại.';
}

export function conversationReturnPath(returnTo?: string | null): string | null {
  return returnTo && /^\/c\/[0-9a-f-]{36}$/i.test(returnTo) ? returnTo : null;
}

export function extractNotionDatabaseIdClient(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const dashedMatch = trimmed.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (dashedMatch) {
    return dashedMatch[1].toLowerCase();
  }
  const rawMatch = trimmed.match(/([0-9a-f]{32})/i);
  if (rawMatch) {
    const h = rawMatch[1].toLowerCase();
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  }
  return null;
}
