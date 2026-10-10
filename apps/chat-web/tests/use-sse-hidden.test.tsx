/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

const calls: Array<{ url: string; options: any }> = [];
vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: vi.fn((url: string, options: any) => {
    calls.push({ url, options });
    return new Promise<void>(() => {});
  }),
}));

import { useSSE } from '../src/hooks/use-sse';

function Client() { useSSE('conversation/with slash', 'token'); return null; }

afterEach(() => { cleanup(); calls.length = 0; });

it('keeps one SSE connection open when the document becomes hidden', () => {
  render(<Client />);
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe('/api/conversations/conversation%2Fwith%20slash/stream');
  expect(calls[0].options.openWhenHidden).toBe(true);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(calls).toHaveLength(1);
  expect(calls[0].options.signal.aborted).toBe(false);
});
