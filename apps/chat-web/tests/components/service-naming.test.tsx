/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SettingsPage } from '../../src/pages/Settings/SettingsPage';
const settingsProps = { user: { id: 'admin', email: 'admin@localhost.test', name: 'Test Admin', role: 'admin' as const }, navigate: () => {}, onLogout: () => {} };

import { RecoveryMoment } from '../../src/pages/Cockpit/RecoveryMoment';
import { MissionControlLaunchpad } from '../../src/components/MissionControlLaunchpad';
import { apiClient } from '../../src/services/api-client';
import type { ExecutionSnapshot, ServiceInfo } from '../../src/types';

// W3-00b: a registered service the frontend has never heard of must still be named
// and configured entirely from GET /api/services.
const demo: ServiceInfo = { id: 'demo', name: 'Demo Hub', connected: true, configured: true, tools: ['demo.create_thing'],
  allowedScope: [], scopeKey: 'spaces', scopeLabel: 'không gian Demo', credentialFields: [{ key: 'privateKey', label: 'Khóa riêng (PEM)', type: 'multiline' }] };
const unlabelled: ServiceInfo = { id: 'boardlike', name: 'Boardlike', connected: false, configured: false, allowedScope: [], scopeKey: 'boards', credentialFields: [] };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('labels the allowlist from the API scopeLabel, with a neutral fallback instead of a per-service table', async () => {
  vi.spyOn(apiClient, 'getServices').mockResolvedValue({ services: [demo, unlabelled], canConfigure: true });
  render(<SettingsPage {...settingsProps} />);
  fireEvent.click(await screen.findByRole('button', { name: /Demo Hub —/ }));
  expect(screen.getByText('ATI chỉ đọc và ghi ở những không gian Demo trong danh sách này.')).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: /Boardlike —/ }));
  expect(screen.getByText('ATI chỉ đọc và ghi ở những tài nguyên trong danh sách này.')).toBeInTheDocument();
});

it('names the service to check by its API display name', () => {
  const snapshot = { execution: { status: 'reconciliation_required', pausedStepId: 's1' }, recoveryActions: ['skip', 'stop'],
    plan: { steps: [{ id: 's1', tool: 'demo.create_thing', description: 'Tạo thứ', args: {} }] },
    steps: [{ stepId: 's1', tool: 'demo.create_thing', status: 'unknown' }] } as unknown as ExecutionSnapshot;
  render(<RecoveryMoment moment={9} snapshot={snapshot} services={[demo]} steps={[{id:"s1",tool:"demo.create_thing",description:"Tạo thứ",status:"unknown"}]} controls={null} />);
  expect(screen.getByText(/Tôi không chắc lệnh đã tới Demo Hub/)).toBeInTheDocument();
});

it('builds the command placeholder from the configured services', () => {
  render(<MissionControlLaunchpad onSendMessage={() => {}} services={[demo, unlabelled]} runtimeMode="live" />);
  const input = screen.getByRole('textbox', { name: 'Khung lệnh điều phối quy trình' });
  expect(input).toHaveAttribute('placeholder', 'Gõ lệnh điều phối (@Demo Hub) hoặc chọn quy trình mẫu bên dưới...');
  cleanup();
  render(<MissionControlLaunchpad onSendMessage={() => {}} services={[unlabelled]} runtimeMode="live" />);
  expect(within(document.body).getByRole('textbox', { name: 'Khung lệnh điều phối quy trình' }))
    .toHaveAttribute('placeholder', 'Gõ lệnh điều phối hoặc chọn quy trình mẫu bên dưới...');
});
