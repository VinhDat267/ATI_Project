import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useChatStore } from '../src/store/chat-store';
import { handleSSEEvent, resetSSEState } from '../src/hooks/use-sse';
import { RecoveryMoment } from '../src/pages/Cockpit/RecoveryMoment';
import { PlanMoment } from '../src/pages/Cockpit/PlanMoment';
import type { ExecutionSnapshot } from '../src/types';
const connections = { gmail: { credentialId: 'personal-id', email: 'own+other@gmail.test' } };
const plan = { id: 'plan', convId: 'conv', summary: 'Thư', status: 'pending' as const, connections, steps: [{ id: 'g', tool: 'gmail.reply', description: 'Trả lời', args: { to: ['a@example.test'], body: 'Cảm ơn' } }] };
afterEach(() => { cleanup(); useChatStore.getState().reset(); resetSSEState(); });
it('retains the approved Gmail sender through SSE and execution reload', () => {
  handleSSEEvent('plan', JSON.stringify({ planId: 'plan', plan }));
  expect(useChatStore.getState().activePlan?.connections).toEqual(connections);
  useChatStore.getState().setExecutionSnapshot({ plan, execution: { status: 'preview' }, steps: [], recoveryActions: [] });
  expect(useChatStore.getState().activePlan?.connections).toEqual(connections);
});
it('shows the Gmail connection email rather than the ATI login email before approval', () => {
  render(<PlanMoment runtimeMode="sandbox" plan={plan} services={[]} destination={() => ''} onPreview={() => {}} onApprove={() => {}} onCancel={() => {}} onEdit={() => {}} inlineComposer={null} />);
  expect(screen.getByText('Gửi từ: own+other@gmail.test')).toBeTruthy();
});
it.each(['gmail.send_message', 'gmail.reply', 'gmail.forward', 'gmail.create_draft', 'slack.send_message'])('offers a correctly encoded sent folder only for unknown send operations: %s', tool => {
  const snapshot: ExecutionSnapshot = { plan: { ...plan, steps: [{ ...plan.steps[0], tool }] }, execution: { status: 'reconciliation_required', pausedStepId: 'g' }, steps: [{ stepId: 'g', tool, status: 'unknown' }], recoveryActions: ['skip', 'stop'] };
  render(<RecoveryMoment moment={8} snapshot={snapshot} steps={[{ id: 'g', tool, description: 'Thư', status: 'unknown' }]} services={[]} controls={null} />);
  const link = screen.queryByRole('link', { name: 'Mở thư mục Đã gửi' });
  if (['gmail.send_message', 'gmail.reply', 'gmail.forward'].includes(tool)) expect(link?.getAttribute('href')).toBe('https://mail.google.com/mail/?authuser=own%2Bother%40gmail.test#sent');
  else expect(link).toBeNull();
  expect(screen.queryByRole('button', { name: /Thử lại/ })).toBeNull();
});
