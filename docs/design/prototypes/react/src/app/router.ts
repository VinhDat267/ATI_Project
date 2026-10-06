import { useSyncExternalStore } from 'react';

// Điều hướng bằng History API, không thư viện router (giống routes.ts của apps/chat-web).
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

export function navigate(to: string, replace = false) {
  const url = new URL(to, window.location.href);
  if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
  notify();
  requestAnimationFrame(() => {
    const target = url.hash ? document.getElementById(decodeURIComponent(url.hash.slice(1))) : null;
    if (target) target.scrollIntoView(); else window.scrollTo(0, 0);
  });
}

export function useLocation() {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => window.location.pathname + window.location.search,
  );
}

window.addEventListener('popstate', notify);
// Link nội bộ (href bắt đầu bằng "/") đi qua router thay vì tải lại trang; link "#..." trong trang để trình duyệt xử lý.
document.addEventListener('click', event => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = (event.target as Element | null)?.closest?.('a[href]');
  const href = anchor?.getAttribute('href');
  if (!anchor || !href?.startsWith('/') || anchor.getAttribute('target') || anchor.hasAttribute('download')) return;
  event.preventDefault();
  navigate(href);
});
