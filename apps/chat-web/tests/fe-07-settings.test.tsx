import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SettingsPage } from '../src/pages/Settings/SettingsPage';
import type { ServiceInfo, User } from '../src/types';
import { readFileSync } from 'node:fs';

const admin: User = { id: 'admin', name: 'Test Admin', email: 'admin@localhost.test', role: 'admin' };
const nativeFetch = globalThis.fetch;
let server: Server;
let services: ServiceInfo[];
let calls: { url: string; method: string; body: any }[];
let releaseSave: () => void;
let holdSave: boolean;
let saveStatus: number;
let testStatus: 'healthy' | 'unhealthy';
let testMessage: string;
let holdTest: boolean;
let flushTestHeaders: boolean;
let requestSignal: AbortSignal | undefined;
let holdCatalogue: boolean;
let catalogueStatus: number;
let releaseCatalogue: () => void;
const service = (id: string, configured = false): ServiceInfo => ({
  id, name: id === 'github' ? 'GitHub' : id === 'notion' ? 'Notion' : id,
  connected: false, configured, connectionStatus: configured ? 'unchecked' : 'unconfigured', lastCheckedAt: null,
  tools: [`${id}.create_item`], allowedScope: configured ? ['owner/repo'] : [],
  credentialFields: [{ key: 'token', label: 'Token', type: 'password' }], scopeLabel: 'Repository', scopeKey: 'repos',
});
beforeEach(async () => {
  window.history.replaceState({}, '', '/settings'); localStorage.clear();
  services = [service('github'), service('notion', true)]; calls = [];
  holdSave = false; holdTest = false; flushTestHeaders = false; requestSignal = undefined; saveStatus = 200; testStatus = 'healthy'; testMessage = 'Sandbox verified';
  holdCatalogue = false; catalogueStatus = 200;
  const gate = new Promise<void>(resolve => { releaseSave = resolve; });
  const catalogueGate = new Promise<void>(resolve => { releaseCatalogue = resolve; });
  server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    calls.push({ url: req.url!, method: req.method!, body: body ? JSON.parse(body) : null });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/services') {
      if (holdCatalogue) await catalogueGate;
      res.statusCode = catalogueStatus;
      res.end(JSON.stringify(catalogueStatus === 200 ? { services } : { error: 'offline' })); return;
    }
    const found = services.find(s => req.url?.startsWith(`/api/services/${s.id}/`));
    if (!found) { res.statusCode = 404; res.end('{}'); return; }
    if (req.url?.endsWith('/test')) {
      if (holdTest) { if (flushTestHeaders) res.flushHeaders(); return; }
      found.connectionStatus = testStatus; found.lastCheckedAt = '2026-10-08T07:05:00Z';
      res.statusCode = testStatus === 'healthy' ? 200 : 503;
      res.end(JSON.stringify({ status: testStatus, latencyMs: 12, message: testMessage })); return;
    }
    if (holdSave) await gate;
    res.statusCode = saveStatus;
    if (saveStatus === 200) {
      found.configured = true; found.connectionStatus = 'unchecked'; found.lastCheckedAt = null;
      found.allowedScope = JSON.parse(body).allowedScope;
      res.end(JSON.stringify({ success: true, message: 'Saved via HTTP' }));
    } else res.end(JSON.stringify({ error: 'Rejected via HTTP' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (typeof input === 'string' && input.endsWith('/test')) requestSignal = init?.signal ?? undefined;
    return nativeFetch(typeof input === 'string' && input.startsWith('/') ? `${origin}${input}` : input, init);
  });
});
afterEach(async () => { releaseSave(); releaseCatalogue(); cleanup(); vi.unstubAllGlobals(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
const mount = (user = admin) => render(<SettingsPage user={user} navigate={() => {}} onLogout={() => {}} />);
const open = async (name = 'GitHub') => { fireEvent.click(await screen.findByRole('button', { name: new RegExp(`${name} —`) })); return screen.findByRole('dialog', { name }); };
const addScope = (value = 'owner/repo') => { fireEvent.change(screen.getByLabelText('Thêm Repository'), { target: { value } }); fireEvent.click(screen.getByRole('button', { name: /Thêm/ })); };

it('does not claim catalogue counts or empty groups while the first catalogue request is loading', async () => {
  holdCatalogue = true; mount();
  expect(await screen.findByRole('status')).toHaveTextContent('Đang tải dịch vụ...');
  await waitFor(() => expect(calls.some(call => call.url === '/api/services')).toBe(true));
  expect(screen.queryByText('Tất cả 8 dịch vụ đều đã được thiết lập.')).not.toBeInTheDocument();
  expect(screen.queryByText('Chưa có dịch vụ nào được thiết lập.')).not.toBeInTheDocument();
  expect(screen.queryByText(/\d+ \/ 8 dịch vụ đã thiết lập/)).not.toBeInTheDocument();
  releaseCatalogue();
  expect(await screen.findByText('1 / 8 dịch vụ đã thiết lập · 0 kết nối tốt')).toBeInTheDocument();
});
it('does not claim catalogue counts or empty groups after the first catalogue request fails, and recovers on retry', async () => {
  catalogueStatus = 503; mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Không thể kết nối máy chủ. Hãy kiểm tra mạng và thử lại.');
  expect(screen.queryByText('Tất cả 8 dịch vụ đều đã được thiết lập.')).not.toBeInTheDocument();
  expect(screen.queryByText('Chưa có dịch vụ nào được thiết lập.')).not.toBeInTheDocument();
  expect(screen.queryByText(/\d+ \/ 8 dịch vụ đã thiết lập/)).not.toBeInTheDocument();
  catalogueStatus = 200; fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByText('1 / 8 dịch vụ đã thiết lập · 0 kết nối tốt')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('groups by configured, summarizes eight services and presents four textual states and checked time', async () => {
  services = [service('github', true), service('notion', true), service('slack', true), service('trello')];
  services[0].connectionStatus = 'healthy'; services[0].lastCheckedAt = '2026-10-08T07:05:00Z'; services[1].connectionStatus = 'unhealthy';
  mount(); expect(await screen.findByText('3 / 8 dịch vụ đã thiết lập · 1 kết nối tốt')).toBeInTheDocument();
  expect(screen.getByText(/Kết nối tốt · kiểm tra lúc/)).toBeInTheDocument();
  expect(screen.getByText('Không kết nối được')).toBeInTheDocument(); expect(screen.getByText('Chưa kiểm tra')).toBeInTheDocument(); expect(screen.getByText('Chưa kết nối')).toBeInTheDocument();
  expect(within(document.getElementById('list-connected-services')!).getAllByRole('button')).toHaveLength(3);
  expect(document.body.textContent).not.toMatch(/Allowed Scope|Write Safety|Least Privilege|AES|Kịch bản demo|320 ms/);
});
it.each(['admin', 'member'] as const)('blocks checks for unconfigured services for %s', async role => {
  mount({ ...admin, role }); const dialog = await open();
  expect(within(dialog).getByRole('button', { name: 'Kiểm tra kết nối' })).toBeDisabled();
  expect(within(dialog).getByText(/Lưu khoá và ít nhất một nơi được dùng trước, rồi mới kiểm tra được/)).toBeVisible();
  expect(calls.filter(c => c.url.endsWith('/test'))).toHaveLength(0);
});
it('posts all credentials, moves the saved row and resets verification without exposing saved keys', async () => {
  mount(); await open(); fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'synthetic' } }); addScope();
  fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' })); expect(await screen.findByText(/Saved via HTTP/)).toBeInTheDocument();
  expect(calls.find(c => c.url.endsWith('/credentials'))?.body).toEqual({ credentials: { token: 'synthetic' }, allowedScope: ['owner/repo'] });
  expect(screen.getByLabelText('Token')).toHaveValue(''); expect(screen.getByLabelText('Token')).toHaveAttribute('placeholder', 'Đã lưu · nhập lại nếu muốn thay');
  expect(within(screen.getByRole('dialog')).getByText('Chưa kiểm tra')).toBeInTheDocument();
  expect(document.getElementById('list-connected-services')).toContainElement(document.getElementById('service-row-github'));
});
it('saves scope alone with PUT, preserving blank stored credentials', async () => {
  services[0] = service('github', true); mount(); await open(); addScope('owner/second'); fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
  expect(await screen.findByText(/Saved via HTTP/)).toBeInTheDocument();
  expect(calls.find(c => c.url.endsWith('/scope'))).toEqual({ url: '/api/services/github/scope', method: 'PUT', body: { allowedScope: ['owner/repo', 'owner/second'] } });
  expect(calls.some(c => c.url.endsWith('/credentials'))).toBe(false);
});
it('requires every credential when changing keys and at least one scope', async () => {
  services[0].credentialFields!.push({ key: 'apiKey', label: 'API key', type: 'text' });
  mount(); await open(); fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'synthetic' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' })); expect(await screen.findByRole('alert')).toHaveTextContent('ít nhất một');
  addScope(); fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' })); expect(await screen.findByRole('alert')).toHaveTextContent('nhập lại đủ');
  expect(calls.filter(c => c.method !== 'GET')).toHaveLength(0);
});
it('rejects malformed GitHub scope before adding or saving', async () => {
  mount(); await open(); addScope('invalid/repo/path'); expect(document.getElementById('new-scope-format-hint')).toBeVisible();
  expect(document.getElementById('scope-chips-container')).not.toHaveTextContent('invalid/repo/path');
});
it('rejects a Jira site outside https atlassian.net', async () => {
  services = [{ ...service('jira'), name: 'Jira', credentialFields: [{ key: 'siteUrl', label: 'Site URL', type: 'text' }, { key: 'email', label: 'Email' }, { key: 'apiToken', label: 'API token' }], scopeLabel: 'Project key' }];
  mount(); await open('Jira'); fireEvent.change(screen.getByLabelText('Site URL'), { target: { value: 'http://evil.test' } });
  fireEvent.change(screen.getByLabelText('Thêm Project key'), { target: { value: 'ATIT' } }); fireEvent.click(screen.getByRole('button', { name: 'Thêm' })); fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
  expect(document.getElementById('jira-siteUrl-format-hint')).toBeVisible(); expect(calls.filter(c => c.method !== 'GET')).toHaveLength(0);
});
it('locks member credentials and scopes but allows configured checks with live results', async () => {
  mount({ ...admin, role: 'member' }); const dialog = await open('Notion');
  expect(within(dialog).getByLabelText('Token')).toBeDisabled(); expect(within(dialog).getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled();
  expect(within(dialog).queryByRole('button', { name: /^Xoá mục/ })).not.toBeInTheDocument();
  expect(within(dialog).getByText(/Chỉ quản trị viên thay đổi được khoá dùng chung của nhóm/)).toBeVisible();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Kiểm tra kết nối' }));
  expect(await screen.findByText(/Sandbox verified.*12 ms/)).toBeInTheDocument(); expect(document.getElementById('test-result-box')).toHaveAttribute('aria-live', 'polite');
});
it.each(['Token rejected', 'Không nhận được phản hồi sau 10 giây'])('announces real provider failure: %s', async message => {
  testStatus = 'unhealthy'; testMessage = message; mount(); const dialog = await open('Notion'); fireEvent.click(within(dialog).getByRole('button', { name: 'Kiểm tra kết nối' }));
  expect(await screen.findByText(message)).toBeInTheDocument(); await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Không kết nối được')); expect(screen.queryByText(/320 ms/)).not.toBeInTheDocument();
});
it('deep links, traps both Tab directions, blocks outside focus, and restores the replaced row on Escape', async () => {
  window.history.replaceState({}, '', '/settings#notion'); mount(); const dialog = await screen.findByRole('dialog', { name: 'Notion' });
  const first = within(dialog).getByRole('button', { name: 'Đóng ngăn chi tiết' }); const last = within(dialog).getByRole('button', { name: 'Kiểm tra kết nối' });
  expect(first).toHaveFocus(); fireEvent.keyDown(first, { key: 'Tab', shiftKey: true }); expect(last).toHaveFocus(); fireEvent.keyDown(last, { key: 'Tab' }); expect(first).toHaveFocus();
  document.getElementById('service-row-github')!.focus(); expect(first).toHaveFocus();
  // Saving re-groups the row, replacing its DOM node. Restoration uses its stable id.
  fireEvent.click(last); await screen.findByText(/Sandbox verified/);
  fireEvent.keyDown(window, { key: 'Escape' }); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(document.getElementById('service-row-notion')).toHaveFocus();
});
it('ignores unknown hashes and keeps page focus and Escape alone without a drawer', async () => {
  window.history.replaceState({}, '', '/settings#missing'); mount(); await screen.findByRole('button', { name: /Notion —/ });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); const row = screen.getByRole('button', { name: /GitHub —/ }); row.focus(); fireEvent.keyDown(window, { key: 'Escape' }); expect(row).toHaveFocus();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
});
it('supports in-page hash changes and backdrop close without closing on content clicks', async () => {
  mount(); await screen.findByRole('button', { name: /Notion —/ });
  await act(async () => { window.history.replaceState({}, '', '/settings#notion'); window.dispatchEvent(new HashChangeEvent('hashchange')); });
  const dialog = await screen.findByRole('dialog', { name: 'Notion' }); fireEvent.click(within(dialog).getByRole('heading', { name: 'Notion' })); expect(dialog).toBeVisible();
  fireEvent.click(document.getElementById('drawer-backdrop')!); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('a late save of A cannot clear B or newer edits of A after navigating drawers', async () => {
  holdSave = true; mount(); await open(); fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'submitted A' } }); addScope(); fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
  await waitFor(() => expect(calls.some(c => c.url.endsWith('/credentials'))).toBe(true)); fireEvent.keyDown(window, { key: 'Escape' });
  await open('Notion'); fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'draft B' } }); releaseSave();
  await waitFor(() => expect(calls.filter(c => c.url === '/api/services')).toHaveLength(2)); expect(screen.getByLabelText('Token')).toHaveValue('draft B');
  fireEvent.keyDown(window, { key: 'Escape' }); await open(); expect(screen.getByLabelText('Token')).toHaveValue('');
});
it('aborts the actual HTTP test request at ten seconds and announces timeout', async () => {
  holdTest = true; mount(); await open('Notion'); fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }));
  await waitFor(() => expect(calls.some(c => c.url.endsWith('/test'))).toBe(true));
  expect(requestSignal).toBeDefined(); expect(requestSignal!.aborted).toBe(false);
  expect(await screen.findByText(/Không nhận được phản hồi sau 10 giây/, {}, { timeout: 12_000 })).toBeInTheDocument();
  expect(requestSignal!.aborted).toBe(true);
}, 15_000);
it('preserves in-progress credentials when the same user receives a refreshed access token', async () => {
  const view = render(<SettingsPage user={admin} authToken="initial-access" navigate={() => {}} onLogout={() => {}} />);
  await open(); fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'unsaved' } });
  view.rerender(<SettingsPage user={admin} authToken="refreshed-access" navigate={() => {}} onLogout={() => {}} />);
  expect(await screen.findByLabelText('Token')).toHaveValue('unsaved');
});
it('uses the prototype metadata, raw page CSS, layout and brand parts without demo controls', async () => {
  const source = readFileSync('../../docs/design/prototypes/react/src/pages/Settings/page.css', 'utf8');
  const port = readFileSync('src/pages/Settings/page.css', 'utf8');
  expect(port).toBe(source); mount(); await screen.findByRole('button', { name: /GitHub —/ });
  expect(document.documentElement).toHaveAttribute('data-proto-page', 'settings'); expect(document.title).toBe('Kết nối dịch vụ — ATI');
  expect(screen.getByRole('main')).toHaveClass('flex-1', 'max-w-5xl', 'px-4', 'sm:px-6', 'py-8', 'sm:py-10');
  expect(screen.getByRole('banner')).toHaveClass('sticky', 'top-0', 'z-30', 'bg-[#F8F8F6]/90', 'backdrop-blur-md');
  expect(screen.getByRole('button', { name: /Menu người dùng/ })).toHaveTextContent('TA');
  expect(screen.queryByText(/Xem như|Kết quả kiểm tra tiếp theo|Kịch bản demo/)).not.toBeInTheDocument();
});
it('late results from a previous user cannot replace the current user catalogue or drafts', async () => {
  holdSave = true; const view = mount(); await open(); fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'submitted' } }); addScope(); fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
  await waitFor(() => expect(calls.some(c => c.url.endsWith('/credentials'))).toBe(true));
  view.rerender(<SettingsPage user={{ ...admin, id: 'new-user' }} navigate={() => {}} onLogout={() => {}} />);
  fireEvent.change(await screen.findByLabelText('Token'), { target: { value: 'new user draft' } });
  await act(async () => { releaseSave(); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(screen.getByLabelText('Token')).toHaveValue('new user draft'); expect(screen.queryByText(/Saved via HTTP/)).not.toBeInTheDocument();
});
it('renders provider verification and scope-save messages in Vietnamese without legacy technical labels', async () => {
  testStatus = 'unhealthy'; testMessage = 'Provider rejected notion credentials'; mount(); await open('Notion'); fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }));
  expect(await screen.findByText(/Khoá truy cập bị từ chối/)).toBeInTheDocument(); expect(screen.queryByText('Provider rejected notion credentials')).not.toBeInTheDocument();
});
it('shows the source empty-scope guidance before saving an unconfigured service', async () => {
  mount(); await open(); expect(document.getElementById('scope-empty-error')).toBeVisible(); expect(document.getElementById('scope-empty-error')).toHaveTextContent('Cần ít nhất một Repository.');
});
it('announces timeout when HTTP headers arrive but the response body hangs', async () => {
  holdTest = true; flushTestHeaders = true; mount(); await open('Notion'); fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }));
  expect(await screen.findByText(/Không nhận được phản hồi sau 10 giây/, {}, { timeout: 12_000 })).toBeInTheDocument(); expect(requestSignal!.aborted).toBe(true);
}, 15_000);
