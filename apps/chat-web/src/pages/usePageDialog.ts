import { useLayoutEffect, useRef } from 'react';

// Adds keyboard/focus behavior to the prototype modal without changing its markup.
export function usePageDialog(id: string | null, close: () => void, busy = false) {
  const closeRef = useRef(close), busyRef = useRef(busy);
  closeRef.current = close; busyRef.current = busy;
  useLayoutEffect(() => {
    if (!id) return;
    const dialog = document.getElementById(id);
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const background = Array.from(document.querySelectorAll<HTMLElement>('header,main,footer'));
    for (const element of background) element.setAttribute('inert', '');
    const scroll = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const elements = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]'));
    const focusFirst = () => (dialog.querySelector<HTMLElement>('input') ?? elements()[0] ?? dialog).focus();
    focusFirst();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const all = elements(), first = all[0], last = all.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const focus = (event: FocusEvent) => { if (!dialog.contains(event.target as Node)) focusFirst(); };
    document.addEventListener('keydown', key); document.addEventListener('focusin', focus);
    return () => {
      document.removeEventListener('keydown', key); document.removeEventListener('focusin', focus);
      document.body.style.overflow = scroll;
      for (const element of background) element.removeAttribute('inert');
      if (previous?.isConnected) previous.focus();
    };
  }, [id]);
}
