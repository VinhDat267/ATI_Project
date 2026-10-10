/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { apiClient } from '../src/services/api-client';
import { userErrorMessage } from '../src/services/user-error';
import { NotFoundView } from '../src/views/NotFoundView';
import { PlanningErrorMoment } from '../src/pages/Errors/PlanningErrors';
import { conversationStreamPath } from '../src/hooks/use-sse';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('distinguishes a server 500 from network and gateway availability failures', () => {
  expect(userErrorMessage(Object.assign(new Error('Internal'), { status: 500 }))).toBe('Máy chủ gặp lỗi. Hãy thử lại.');
  for (const failure of [new TypeError('Failed to fetch'), Object.assign(new Error('Bad gateway'), { status: 502 }), Object.assign(new Error('Unavailable'), { status: 503 }), Object.assign(new Error('Timeout'), { status: 504 })]) {
    expect(userErrorMessage(failure)).toBe('Không thể kết nối máy chủ. Hãy kiểm tra mạng và thử lại.');
  }
});

it('renders exactly one h1 for a missing conversation while preserving the alert', () => {
  const { container } = render(<NotFoundView message="Không tìm thấy hội thoại." onGoHome={() => {}} />);
  expect(container.querySelectorAll('h1')).toHaveLength(1);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Không mở được hội thoại');
  expect(screen.getByRole('alert')).toHaveTextContent('Không tìm thấy hội thoại.');
});

it.each([
  [false, 'Sự cố máy chủ', 'Sự cố máy chủ'],
  [true, 'Mất kết nối', 'Mất kết nối máy chủ'],
] as const)('uses truthful planning error copy when networkError=%s', (networkError, label, title) => {
  render(<PlanningErrorMoment request="Yêu cầu" networkError={networkError} onRetry={() => {}} onEdit={() => {}} />);
  expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
});

it('encodes conversation ids as one path segment for REST and SSE requests', async () => {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    if (url.endsWith('/plans/active') || url.endsWith('/executions/latest')) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify({ conversation: {}, messages: [] }), { status: 200 });
  }));
  await apiClient.getConversation('a/b?x=1');
  await apiClient.sendMessage('a/b?x=1', 'hello', 'temp');
  await apiClient.getActivePlan('a/b?x=1');
  await apiClient.getLatestExecutionSnapshot('a/b?x=1');
  expect(urls).toEqual([
    '/api/conversations/a%2Fb%3Fx%3D1',
    '/api/conversations/a%2Fb%3Fx%3D1/messages',
    '/api/conversations/a%2Fb%3Fx%3D1/plans/active',
    '/api/conversations/a%2Fb%3Fx%3D1/executions/latest',
  ]);
  expect(conversationStreamPath('a/b?x=1')).toBe('/api/conversations/a%2Fb%3Fx%3D1/stream');
});
