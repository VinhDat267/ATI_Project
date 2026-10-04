import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingsModal } from '../../src/components/SettingsModal';
import type { ServiceInfo } from '../../src/types';

const nativeFetch = globalThis.fetch;
const submittedSecret = 'synthetic submitted\nsecret';
const unsavedSecret = 'synthetic unsaved\nsecret';
let server: Server;
let releaseSave: () => void;
let credentialType: 'password' | 'multiline';
let status: number;
let serviceReads: number;
let requests: Array<{ credentials: Record<string, string>; allowedScope: string[] }>;

beforeEach(async () => {
  localStorage.clear();
  credentialType = 'multiline';
  status = 200;
  serviceReads = 0;
  requests = [];
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url === '/api/services') {
      serviceReads++;
      const service: ServiceInfo = {
        id: 'demo', name: 'Demo', configured: true, connected: false,
        tools: [], allowedScope: ['S1'], scopeKey: 'spaces', scopeLabel: 'Demo Space',
        credentialFields: [
          { key: 'secret', label: 'Secret', type: credentialType },
          { key: 'token', label: 'Token', type: 'password' },
        ],
      };
      res.end(JSON.stringify({ services: [service] }));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/services/demo/credentials') {
      let body = '';
      for await (const chunk of req) body += chunk;
      requests.push(JSON.parse(body));
      await saveGate;
      res.statusCode = status;
      res.end(JSON.stringify(status === 200
        ? { success: true, message: 'Saved via HTTP' }
        : { error: 'Rejected via HTTP' }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) =>
    nativeFetch(typeof input === 'string' && input.startsWith('/') ? `${origin}${input}` : input, init));
});

afterEach(async () => {
  releaseSave();
  cleanup();
  vi.unstubAllGlobals();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const submit = async (secret = submittedSecret) => {
  render(<SettingsModal isOpen onClose={() => {}} />);
  fireEvent.change(await screen.findByLabelText('Secret'), { target: { value: secret } });
  fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'synthetic submitted token' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
  await waitFor(() => expect(requests).toHaveLength(1));
};

it.each([
  { type: 'multiline' as const, submitted: submittedSecret, draft: unsavedSecret },
  { type: 'password' as const, submitted: 'synthetic submitted secret', draft: 'synthetic unsaved secret' },
])(
  'preserves a newer $type draft on late save success and clears only unchanged credentials', async ({ type, submitted, draft }) => {
    credentialType = type;
    await submit(submitted);
    fireEvent.change(screen.getByLabelText('Secret'), { target: { value: draft } });
    fireEvent.change(screen.getByPlaceholderText('Thêm Demo Space...'), { target: { value: 'S2 draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
    releaseSave();
    expect(await screen.findByText('Saved via HTTP')).toBeInTheDocument();
    expect(requests).toEqual([{
      credentials: { secret: submitted, token: 'synthetic submitted token' }, allowedScope: ['S1'],
    }]);
    expect(serviceReads).toBe(2);
    expect(screen.getByLabelText('Secret')).toHaveValue(draft);
    expect(screen.getByLabelText('Token')).toHaveValue('');
    expect(screen.getByText('S2 draft')).toBeInTheDocument();
  },
);

it('clears credentials that still match the successful submission', async () => {
  await submit();
  releaseSave();
  expect(await screen.findByText('Saved via HTTP')).toBeInTheDocument();
  expect(screen.getByLabelText('Secret')).toHaveValue('');
  expect(screen.getByLabelText('Token')).toHaveValue('');
});

it('retains all input after a rejected save, including edits made while pending', async () => {
  status = 400;
  await submit();
  fireEvent.change(screen.getByLabelText('Secret'), { target: { value: unsavedSecret } });
  releaseSave();
  expect(await screen.findByText(/Rejected via HTTP/)).toBeInTheDocument();
  expect(screen.getByLabelText('Secret')).toHaveValue(unsavedSecret);
  expect(screen.getByLabelText('Token')).toHaveValue('synthetic submitted token');
});
