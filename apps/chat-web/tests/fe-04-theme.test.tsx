import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

let dark = false;
const media = new EventTarget() as EventTarget & { matches: boolean };
Object.defineProperty(media, 'matches', { get: () => dark });
beforeEach(() => {
  dark = false; localStorage.clear(); document.documentElement.classList.remove('dark');
  vi.stubGlobal('matchMedia', () => media);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// A missing/incorrect bootstrap would paint light before React can apply a saved dark preference.
it.each(['saved', 'system', 'blocked'])('applies dark in the executable pre-React bootstrap (%s)', mode => {
  if (mode === 'saved') localStorage.setItem('ati-theme', 'dark');
  else dark = true;
  if (mode === 'blocked') vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Denied'); });
  const html = readFileSync('index.html', 'utf8');
  const script = html.match(/<script id="theme-bootstrap">([\s\S]*?)<\/script>/)?.[1] ?? '';
  window.eval(script);
  expect(document.documentElement).toHaveClass('dark');
});

async function themeHook(): Promise<typeof import('../src/hooks/use-theme').useTheme> {
  const path = '../src/hooks/use-theme';
  const module = await import(/* @vite-ignore */ path).catch(() => null);
  expect(module, 'theme hook must expose real preference behavior').not.toBeNull();
  return module!.useTheme;
}
it('reads saved choice, writes a toggle, and ignores later OS changes', async () => {
  localStorage.setItem('ati-theme', 'dark');
  const { result } = renderHook(await themeHook());
  expect(result.current.theme).toBe('dark');
  act(() => result.current.toggleTheme());
  expect(localStorage.getItem('ati-theme')).toBe('light');
  act(() => { dark = true; media.dispatchEvent(new Event('change')); });
  expect(result.current.theme).toBe('light');
  expect(document.documentElement).not.toHaveClass('dark');
});
it('follows OS changes until a cross-tab preference arrives, then follows clearing it', async () => {
  const { result } = renderHook(await themeHook());
  act(() => { dark = true; media.dispatchEvent(new Event('change')); });
  expect(result.current.theme).toBe('dark');
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'ati-theme', newValue: 'light', storageArea: localStorage })));
  expect(result.current.theme).toBe('light');
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'ati-theme', newValue: null, storageArea: localStorage })));
  expect(result.current.theme).toBe('dark');
});
it('can toggle when localStorage reading and writing are blocked', async () => {
  dark = true;
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Denied'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Denied'); });
  const { result } = renderHook(await themeHook());
  expect(result.current.theme).toBe('dark');
  act(() => result.current.toggleTheme());
  expect(result.current.theme).toBe('light');
});
