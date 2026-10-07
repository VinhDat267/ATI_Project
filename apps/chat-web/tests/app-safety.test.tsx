import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { transcriptText } from './cockpit-test-helpers';
import { App } from '../src/App';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';
import { useChatStore } from '../src/store/chat-store';
vi.mock('../src/hooks/use-sse', () => ({ useSSE: vi.fn(() => ({ disconnected: false })) }));
const user = {id:'u1', name:'Tester', email:'test@example.test'};
beforeEach(() => {
  useChatStore.getState().reset();
  authStorage.setStoredTokens({accessToken:'access', refreshToken:'refresh', user});
  vi.spyOn(apiClient, 'request').mockImplementation(async url => {
    if (url === '/api/auth/me') return {user};
    if (url === '/api/health') return {runtimeMode:'sandbox'};
    if (url === '/api/services') return {services:[]};
    return {conversations:[]};
  });
});
afterEach(() => {cleanup(); vi.restoreAllMocks(); authStorage.clearStoredTokens();});
async function openApp() { render(<App />); await screen.findByRole('heading',{level:1}); }
it('preserves the current conversation and messages when creating a conversation fails', async () => {
  useChatStore.setState({conversationId:'valid-c1',messages:[{id:'m1',role:'user',content:'Keep this conversation'}]});
  vi.spyOn(apiClient,'createConversation').mockRejectedValue(new TypeError('Failed to fetch'));
  await openApp();
  fireEvent.click(screen.getByRole('button',{name:'Mở danh sách hội thoại'}));
  fireEvent.click(screen.getByRole('button',{name:/Cuộc hội thoại mới/}));
  await screen.findByText(/Không thể kết nối máy chủ/);
  expect(useChatStore.getState().conversationId).toBe('valid-c1');
  expect(await transcriptText('Keep this conversation')).toBeInTheDocument();
});
it('disables approval without a real plan id', async () => {
  useChatStore.setState({conversationId:'c1',activePlan:{summary:'Invalid plan',steps:[]} as any,planStatus:'preview'});
  const approve=vi.spyOn(apiClient,'approvePlan');
  await openApp();
  expect(screen.getByRole('button',{name:/Duyệt kế hoạch/})).toBeDisabled();
  expect(approve).not.toHaveBeenCalled();
});
it('keeps the preview when reject fails', async () => {
  const plan={id:'p1',summary:'Keep preview',steps:[]};
  useChatStore.setState({conversationId:'c1',activePlan:plan as any,planStatus:'preview'});
  vi.spyOn(apiClient,'rejectPlan').mockRejectedValue(new TypeError('Failed to fetch'));
  await openApp(); fireEvent.click(screen.getByRole('button',{name:/Hủy/}));
  await screen.findByText(/Không thể kết nối máy chủ/);
  expect(useChatStore.getState().activePlan).toEqual(plan);
  expect(useChatStore.getState().planStatus).toBe('preview');
});
it.each([503, undefined])('keeps tokens when session restoration fails with %s', async status => {
  vi.spyOn(apiClient,'getMe').mockRejectedValue(Object.assign(new TypeError('Failed to fetch'),{status}));
  await openApp(); await screen.findByText(/Không thể kết nối máy chủ/);
  expect(authStorage.getStoredTokens().accessToken).toBe('access');
});
it('shows sandbox mode from the backend and hides it in live mode', async () => {
  await openApp(); expect(await screen.findByText('Chế độ thử nghiệm: kế hoạch mẫu, không gọi dịch vụ thật')).toBeInTheDocument();
  cleanup(); vi.spyOn(apiClient,'request').mockImplementation(async url => url==='/api/health'?{runtimeMode:'live'}:url==='/api/auth/me'?{user}:{services:[],conversations:[]});
  await openApp(); await waitFor(()=>expect(apiClient.request).toHaveBeenCalledWith('/api/health'));
  expect(screen.queryByText('Chế độ thử nghiệm: kế hoạch mẫu, không gọi dịch vụ thật')).toBeNull();
});
it.each(['Escape','backdrop','close'])('dismisses a paused failure with %s and allows reopening without a Stop request',async mode=>{
  useChatStore.setState({conversationId:'c1',activePlan:{id:'p1',summary:'Paused',steps:[{id:'s1',tool:'slack.send_message',args:{},description:'Notify'}]} as any,planStatus:'partial',stepStatuses:{s1:'failed'},stepErrors:{s1:'Fixture failure'}});
  const stop=vi.spyOn(apiClient,'stopExecution');
  await openApp(); const dialog=await screen.findByRole('alertdialog');
  if(mode==='Escape') fireEvent.keyDown(window,{key:'Escape'});
  else fireEvent.click(mode==='backdrop'?dialog:screen.getByRole('button',{name:'Đóng hộp thoại'}));
  await waitFor(()=>expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(useChatStore.getState().planStatus).toBe('partial'); expect(stop).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Mở lại xử lý lỗi'}));
  expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
});
