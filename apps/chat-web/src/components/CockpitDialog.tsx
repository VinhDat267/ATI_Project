import { useLayoutEffect, useRef, type ReactNode } from 'react';
const focusable = 'button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),summary,[tabindex="0"]';
export function CockpitDialog({ title, onClose, returnFocusId, side, children }: { title: string; onClose: () => void; returnFocusId: string; side?: 'left' | 'right'; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.querySelector<HTMLElement>(focusable)?.focus();
    const background = [...document.querySelectorAll<HTMLElement>('[data-cockpit-background]')];
    background.forEach(element => { element.inert = true; });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key === 'Tab') {
        const items = [...dialog.querySelectorAll<HTMLElement>(focusable)].filter(item => !item.hidden && !item.closest('[hidden]'));
        const first = items[0], last = items.at(-1);
        if (!first) { event.preventDefault(); dialog.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    const focusin = (event: FocusEvent) => { if (!dialog.contains(event.target as Node)) dialog.querySelector<HTMLElement>(focusable)?.focus(); };
    document.addEventListener('keydown', keydown); document.addEventListener('focusin', focusin);
    return () => {
      background.forEach(element => { element.inert = false; });
      document.removeEventListener('keydown', keydown); document.removeEventListener('focusin', focusin);
      (document.getElementById(returnFocusId) ?? (opener?.isConnected ? opener : null))?.focus();
    };
  }, [returnFocusId]);
  return <div className="fixed inset-0 z-50 flex bg-black/40" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={`bg-surface text-text border border-border flex flex-col min-w-0 w-full ${side ? `max-w-md h-full ${side === 'right' ? 'ml-auto' : ''}` : 'max-w-2xl max-h-[85dvh] m-auto rounded-2xl'} shadow-xl`}>
      <div className="flex items-center justify-between gap-3 border-b border-border p-4"><h2 className="font-semibold">{title}</h2><button type="button" aria-label={`Đóng ${title}`} className="h-10 w-10 shrink-0" onClick={onClose}>✕</button></div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  </div>;
}
