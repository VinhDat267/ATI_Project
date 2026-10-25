/** @vitest-environment jsdom */
import { afterEach, expect, it } from 'vitest';
import { describeRecurrence, formatRunTime, runLabel } from '../src/services/schedule-text';
import { selectMoment } from '../src/services/cockpit-moment';
import { handleSSEEvent, resetSSEState } from '../src/hooks/use-sse';
import { useChatStore } from '../src/store/chat-store';

afterEach(() => { useChatStore.getState().reset(); resetSSEState(); });
it.each([
  [{ type: 'daily', time: '08:00' }, 'Hằng ngày, 08:00, giờ Việt Nam'],
  [{ type: 'once', date: '2026-10-31', time: '09:00' }, 'Một lần, thứ Bảy 31/10/2026, 09:00, giờ Việt Nam'],
  [{ type: 'weekly', days: [1, 3], time: '08:30' }, 'Thứ Hai, thứ Tư, 08:30, giờ Việt Nam'],
  [{ type: 'weekly', days: [1, 2, 3, 4, 5], time: '08:30' }, 'Thứ Hai đến thứ Sáu, 08:30, giờ Việt Nam'],
  [{ type: 'weekly', days: [1, 2, 3, 4, 5, 6, 7], time: '08:30' }, 'Mọi ngày trong tuần, 08:30, giờ Việt Nam'],
  [{ type: 'weekly', days: [6, 7], time: '08:30' }, 'Thứ Bảy, Chủ nhật, 08:30, giờ Việt Nam'],
] as const)('describes recurrence %j', (value, text) => expect(describeRecurrence(value as any)).toBe(text));
it('formats a UTC time in Vietnam, including crossing midnight', () => {
  expect(formatRunTime('2026-10-26T01:30:00Z')).toBe('08:30 thứ Hai 26/10');
  expect(formatRunTime('2026-10-25T18:30:00Z')).toBe('01:30 thứ Hai 26/10');
});
it('describes missed and approved runs', () => {
  expect(runLabel({ state: 'missed', missedCount: 3 } as any)).toBe('Đã lỡ 3 lượt');
  expect(runLabel({ state: 'approved', planStatus: 'partial' } as any)).toBe('Xong một phần');
});
it.each(['schedule_proposal', 'schedule_state'])('selects %s and lets a newer plan take over', type => {
  const state = useChatStore.getState(); state.addMessage({ id: 's', role: 'assistant', content: '', metadata: { type } });
  expect(selectMoment(useChatStore.getState(), null)).toBe('schedule');
  state.addMessage({ id: 'p', role: 'assistant', content: '', metadata: { type: 'plan' } }); state.setPlanStatus('preview');
  expect(selectMoment(useChatStore.getState(), null)).toBe(4);
});
it('settles a proposal, keeps metadata, deduplicates replay and ignores another conversation', () => {
  const state = useChatStore.getState(); state.setConversationId('c'); state.beginPlanning('c', 'r');
  const metadata = { type: 'schedule_proposal', proposal: { action: 'create', name: 'Lịch họp' } };
  const data = JSON.stringify({ conversationId: 'c', messageId: 'm', metadata, replyToMessageId: 'u', requestId: 'r' });
  handleSSEEvent('schedule_proposal', data, '1', 'c');
  expect(useChatStore.getState().isPlanning).toBe(false);
  expect(useChatStore.getState().messages[0]).toMatchObject({ id: 'm', metadata: { ...metadata, replyToMessageId: 'u' } });
  handleSSEEvent('schedule_proposal', data, '2', 'c');
  handleSSEEvent('schedule_updated', JSON.stringify({ conversationId: 'other', messageId: 'z', type: 'schedule_state', schedule: {} }), '3', 'other');
  expect(useChatStore.getState().messages).toHaveLength(1);
});
it('normalizes the flattened schedule_updated payload', () => {
  useChatStore.getState().setConversationId('c');
  handleSSEEvent('schedule_updated', JSON.stringify({ conversationId: 'c', messageId: 'm', type: 'schedule_state', schedule: { name: 'Lịch mới' } }), '1', 'c');
  expect(useChatStore.getState().messages[0]).toMatchObject({ id: 'm', metadata: { type: 'schedule_state', schedule: { name: 'Lịch mới' } } });
});
it('does not let a replayed proposal replace a newer plan', () => {
  useChatStore.getState().setConversationId('c');
  const payload = JSON.stringify({ messageId: 'm', metadata: { type: 'schedule_proposal', proposal: { action: 'create' } } });
  handleSSEEvent('schedule_proposal', payload, '1', 'c');
  handleSSEEvent('plan_preview', JSON.stringify({ planId: 'p', plan: { summary: 'Mới', steps: [] } }), '2', 'c');
  handleSSEEvent('schedule_proposal', payload, '3', 'c');
  expect(selectMoment(useChatStore.getState(), null)).toBe(4);
  expect(useChatStore.getState().activePlan?.id).toBe('p');
});
it('does not settle a newer request when a proposal without requestId is replayed', () => {
  const state = useChatStore.getState(); state.setConversationId('c');
  const payload = JSON.stringify({ messageId: 'old', metadata: { type: 'schedule_proposal', proposal: { action: 'create' } } });
  handleSSEEvent('schedule_proposal', payload, '1', 'c');
  state.beginPlanning('c', 'new-request'); state.addMessage({ id: 'new-user', role: 'user', content: 'Đổi giờ mới' });
  handleSSEEvent('schedule_proposal', payload, '2', 'c');
  expect(useChatStore.getState().isPlanning).toBe(true);
});
