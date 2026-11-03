/** @vitest-environment jsdom */
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { refreshSlackConversation } from '../src/services/slack-read-refresh';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';
import { useChatStore } from '../src/store/chat-store';
import { loadConversationHistory } from '../src/hooks/use-conversation-history';
import { refreshExecutionSnapshot } from '../src/services/execution-snapshot';

beforeEach(() => {
  authStorage.setStoredTokens({ accessToken: 'owner-a', refreshToken: 'refresh-a', user: { id: 'owner-a' } as any });
  useChatStore.getState().reset();
  useChatStore.getState().setConversationId('c1');
  useChatStore.setState({ messages: [{ id: 'sensitive', role: 'assistant', content: 'OLD_SLACK_SOURCE' }], conversations: [{id:'c1',title:'OLD_SOURCE_TITLE'}] });
  vi.spyOn(apiClient, 'getActivePlan').mockResolvedValue(null);
  vi.spyOn(apiClient, 'getLatestExecutionSnapshot').mockResolvedValue(null);
});
afterEach(() => { vi.restoreAllMocks(); authStorage.clearStoredTokens(); });
it('clears cached source data synchronously before a guarded reload, even if the read fails', async () => {
  vi.spyOn(apiClient, 'getConversation').mockRejectedValue(new Error('offline'));
  const pending = refreshSlackConversation('c1', true);
  expect(useChatStore.getState().messages).toEqual([]);
  expect(useChatStore.getState().conversations[0].title).not.toContain('OLD_SOURCE_TITLE');
  await pending;
  expect(useChatStore.getState().executionSnapshot).toBeNull();
  expect(useChatStore.getState().messages).toEqual([]);
});
it('does not restore a response after logout or a different owner takes over', async () => {
  let finish!: (value: any) => void;
  vi.spyOn(apiClient, 'getConversation').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = refreshSlackConversation('c1', true);
  authStorage.setStoredTokens({ accessToken: 'owner-b', user: { id: 'owner-b' } as any });
  finish({ conversation: { id: 'c1' }, messages: [{ id: 'late', role: 'assistant', content: 'LATE_SLACK_SOURCE' }] });
  await pending;
  expect(useChatStore.getState().messages).toEqual([]);
});
it('does not overwrite a newer response or selection', async () => {
  let finish!: (value: any) => void;
  vi.spyOn(apiClient, 'getConversation').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = refreshSlackConversation('c1');
  useChatStore.getState().setConversationId('c2');
  finish({ conversation: { id: 'c1' }, messages: [{ id: 'late', role: 'assistant', content: 'LATE_SLACK_SOURCE' }] });
  await pending;
  expect(useChatStore.getState().messages.some(row => row.id === 'late')).toBe(false);
});
it('invalidates a delayed route history response before it can merge old source messages back', async () => {
  let finish!: (value:any)=>void;
  vi.spyOn(apiClient,'getConversation').mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue({conversation:{id:'c1'},messages:[]});
  const history=loadConversationHistory('c1',()=>useChatStore.getState().conversationId==='c1');
  await refreshSlackConversation('c1',true);
  finish({conversation:{id:'c1'},messages:[{id:'stale',role:'assistant',content:'RESTORED_PRIVATE_SOURCE'}]});await history;
  expect(useChatStore.getState().messages).toEqual([]);
});
it('does not restore an old route read after the owner changes while the route stays the same', async () => {
  let finish!: (value:any)=>void;
  vi.spyOn(apiClient,'getConversation').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const history=loadConversationHistory('c1',()=>true);
  authStorage.setStoredTokens({accessToken:'other',user:{id:'other'} as any});
  finish({conversation:{id:'c1'},messages:[{id:'stale',role:'assistant',content:'OTHER_OWNER_SOURCE'}]});await history;
  expect(useChatStore.getState().messages.some(row=>row.id==='stale')).toBe(false);
});
it('does not restore an old execution snapshot after the owner changes', async () => {
  let finish!: (value:any)=>void;
  vi.mocked(apiClient.getLatestExecutionSnapshot).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const reading=refreshExecutionSnapshot('c1');
  authStorage.setStoredTokens({accessToken:'other',user:{id:'other'} as any});
  finish({plan:{id:'old',convId:'c1',status:'completed'},execution:{status:'completed'},steps:[],recoveryActions:[]});await reading;
  expect(useChatStore.getState().executionSnapshot).toBeNull();
});
it('coalesces interval refreshes so a slower guarded response is still applied', async () => {
  let finish!: (value:any)=>void;
  const get=vi.spyOn(apiClient,'getConversation').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const first=refreshSlackConversation('c1');const next=refreshSlackConversation('c1');const third=refreshSlackConversation('c1');
  expect(get).toHaveBeenCalledTimes(1);
  finish({conversation:{id:'c1'},messages:[{id:'safe',role:'user',content:'GUARDED_CURRENT_RESPONSE'}]});await Promise.all([first,next,third]);
  expect(useChatStore.getState().messages[0]?.content).toBe('GUARDED_CURRENT_RESPONSE');
});
it('expires a hanging refresh, aborts actual transport signals and clears old cached payloads', async () => {
  let signal:AbortSignal|undefined;
  vi.spyOn(apiClient,'getConversation').mockImplementation((_id,s)=>{signal=s;return new Promise(()=>{});});
  await refreshSlackConversation('c1',false,20);
  expect(signal?.aborted).toBe(true);
  expect(useChatStore.getState().messages).toEqual([]);
},1000);
it('invalidates route reads that started during a poll which later expired', async () => {
  let finish!:(value:any)=>void;
  vi.spyOn(apiClient,'getConversation').mockImplementationOnce(()=>new Promise(()=>{})).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const polling=refreshSlackConversation('c1',false,20);
  const history=loadConversationHistory('c1',()=>true);
  await polling;
  finish({conversation:{id:'c1'},messages:[{id:'late-timeout',role:'assistant',content:'OLD_SOURCE_AFTER_TIMEOUT'}]});await history;
  expect(useChatStore.getState().messages).toEqual([]);
},1000);
