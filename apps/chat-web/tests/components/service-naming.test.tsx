/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SettingsModal } from '../../src/components/SettingsModal';
import { ServiceCard } from '../../src/components/ServiceCard';
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
  vi.spyOn(apiClient, 'getServices').mockResolvedValue({ services: [demo, unlabelled] });
  render(<SettingsModal isOpen onClose={() => {}} />);
  expect(await screen.findByText('Giới hạn không gian Demo mà AI được phép đọc và ghi.')).toBeInTheDocument();
  expect(screen.getByText('Giới hạn tài nguyên mà AI được phép đọc và ghi.')).toBeInTheDocument();
});

it('uses a textarea for a multiline credential and clears the typed secret once saved', async () => {
  const onSave = vi.fn().mockResolvedValue({ success: true, message: 'Đã lưu' });
  render(<ServiceCard service="demo" title="Demo Hub" credentialFields={demo.credentialFields} onSave={onSave} />);
  const field = screen.getByLabelText('Khóa riêng (PEM)');
  expect(field.tagName).toBe('TEXTAREA');
  const pem = '-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----';
  fireEvent.change(field, { target: { value: pem } });
  fireEvent.click(screen.getByRole('button', { name: /Lưu/ }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ credentials: { privateKey: pem }, allowedScope: [] }));
  await waitFor(() => expect(screen.getByLabelText('Khóa riêng (PEM)')).toHaveValue(''));
  expect(document.body.textContent).not.toContain('BEGIN PRIVATE KEY');
});

it('keeps a typed secret when saving fails so it can be corrected', async () => {
  const onSave = vi.fn().mockResolvedValue({ success: false, message: 'Sai định dạng' });
  render(<ServiceCard service="demo" title="Demo Hub" credentialFields={demo.credentialFields} onSave={onSave} />);
  fireEvent.change(screen.getByLabelText('Khóa riêng (PEM)'), { target: { value: 'not a key' } });
  fireEvent.click(screen.getByRole('button', { name: /Lưu/ }));
  expect(await screen.findByText('Sai định dạng')).toBeInTheDocument();
  expect(screen.getByLabelText('Khóa riêng (PEM)')).toHaveValue('not a key');
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
