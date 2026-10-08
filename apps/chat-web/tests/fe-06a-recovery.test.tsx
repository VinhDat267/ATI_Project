/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Cockpit } from '../src/components/Cockpit';
import { useChatStore } from '../src/store/chat-store';
import { handleSSEEvent, resetSSEState } from '../src/hooks/use-sse';
import type { ExecutionSnapshot } from '../src/types';

vi.mock('../src/services/api-client', () => ({ apiClient: { getRuntime: async () => ({runtimeMode:'sandbox'}), getConversations:async()=>({conversations:[]}) } }));
afterEach(() => { cleanup(); useChatStore.getState().reset(); resetSSEState(); });
const plan = { id:'p1', convId:'c1', status:'partial' as const, summary:'Tạo thẻ và báo nhóm', steps:[
  {id:'s1',tool:'trello.create_card',description:'Tạo thẻ',args:{listId:'list',name:'Thẻ test'}},
  {id:'s2',tool:'slack.send_message',description:'Báo nhóm',args:{channel:'#ati-test',text:'Nội dung'}},
] };
function snapshot(status:ExecutionSnapshot['execution']['status'], stepStatus:ExecutionSnapshot['steps'][number]['status'], actions:ExecutionSnapshot['recoveryActions']):ExecutionSnapshot {
  return {plan:{...plan,status},execution:{status,pausedStepId:'s2'},steps:[
    {stepId:'s1',tool:'trello.create_card',status:'succeeded',output:{name:'Thẻ đã tạo',url:'https://trello.com/c/saved'}},
    {stepId:'s2',tool:'slack.send_message',status:stepStatus,error:{message:'Không có quyền ghi'}},
  ],recoveryActions:actions};
}
function stage(saved:ExecutionSnapshot|null, recovery?:any) {
  useChatStore.getState().setConversationId('c1');
  if(saved) useChatStore.getState().setExecutionSnapshot(saved);
  return render(<Cockpit services={[{id:'slack',name:'Slack',configured:true,connected:false,connectionStatus:'unchecked'}]} servicesLoading={false} servicesError={null} onSendMessage={vi.fn()} onNewConversation={vi.fn()} onSelectConversation={vi.fn()} onSettings={vi.fn()} onApprove={vi.fn()} onCancel={vi.fn()} recovery={recovery ?? null}/>);
}
it('known failure renders the prototype incident/impact sections and only snapshot actions',()=>{
  stage(snapshot('partial','failed',['skip','stop']));
  const incident=screen.getByRole('region');
  expect(incident).toHaveAttribute('id','moment-7');
  expect(within(incident).getByText('Chuyện gì đã xảy ra')).toBeInTheDocument();
  expect(within(incident).getByText('Ảnh hưởng hiện tại')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/Thử lại|Sửa rồi/})).toBeNull();
});
it('unknown has no retry/edit/continue even with inconsistent server actions and has a safe service destination',()=>{
  stage(snapshot('partial','unknown',['retry','skip','stop','continue']));
  expect(screen.getByRole('region')).toHaveAttribute('id','moment-8');
  expect(screen.getByText(/Nếu chưa có/)).toBeInTheDocument();
  expect(screen.getByRole('link',{name:'Kiểm tra trên Slack'})).toHaveAttribute('href','https://slack.com/app_redirect?channel=%23ati-test');
  expect(screen.queryByRole('button',{name:/Thử lại|Sửa rồi|Làm tiếp/})).toBeNull();
});
it('restart lists saved success links and pending work and gates Continue from snapshot',()=>{
  stage(snapshot('reconciliation_required','pending',['stop']));
  expect(screen.getByRole('heading',{level:1})).toHaveTextContent('Hệ thống vừa khởi động lại');
  expect(screen.getByText('Chưa làm')).toBeInTheDocument();
  expect(screen.getByRole('link',{name:/Mở card/})).toHaveAttribute('href','https://trello.com/c/saved');
  expect(screen.queryByRole('button',{name:'Làm tiếp các việc còn lại'})).toBeNull();
});
it.each(['stopped','failed','rejected'] as const)('terminal %s with old unknown/failed evidence renders terminal receipt without recovery',status=>{
  stage(snapshot(status,status==='failed'?'failed':'unknown',[]));
  expect(screen.getByRole('region')).toHaveAttribute('data-moment','unsuccessful');
  expect(screen.getByRole('button',{name:'Nhờ việc khác'})).toBeInTheDocument();
  expect(screen.getByRole('link',{name:'Mở card'})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/Thử lại|Bỏ qua|Dừng kế hoạch/})).toBeNull();
});
it('receipt counts only tools with succeeded steps and never uses skipped output as a result',()=>{
  const saved=snapshot('completed','skipped',[]); saved.steps[1].output={url:'https://slack.com/fake',text:'FAKE OUTPUT'};
  stage(saved);
  expect(screen.getByRole('heading',{level:1})).toHaveTextContent('Đã xong 1 việc trên 1 công cụ');
  expect(screen.queryByRole('link',{name:'Mở tin nhắn'})).toBeNull();
  expect(screen.queryByText('FAKE OUTPUT')).toBeNull();
});
it('sandbox plan warning agrees with sandbox runtime',async()=>{
  useChatStore.setState({activePlan:plan,planStatus:'preview'}); stage(null);
  expect(await screen.findByText(/Các thao tác này chỉ chạy trong chế độ thử nghiệm/)).toBeInTheDocument();
  expect(screen.queryByText(/Các thao tác này ghi thật/)).toBeNull();
});
it.each(['plan','plan_preview'])('SSE %s adds one display summary without replay duplicates',event=>{
  stage(null); act(()=>handleSSEEvent(event,JSON.stringify({planId:'p1',summary:plan.summary,steps:plan.steps}),undefined,'c1'));
  act(()=>handleSSEEvent(event,JSON.stringify({planId:'p1',summary:plan.summary,steps:plan.steps}),undefined,'c1'));
  fireEvent.click(screen.getByRole('button',{name:'Xem hội thoại'}));
  expect(within(screen.getByRole('log')).getByText('Kế hoạch 2 việc đã sẵn sàng: Tạo thẻ và báo nhóm')).toBeInTheDocument();
  expect(useChatStore.getState().messages.filter(m=>m.metadata?.planId==='p1')).toHaveLength(1);
});
it.each(['plan','conversation'])('closes the inline edit composer when %s changes',owner=>{
  useChatStore.setState({activePlan:plan,planStatus:'preview'}); stage(null);
  fireEvent.click(screen.getByRole('button',{name:'Sửa qua Chat'}));
  expect(screen.getByRole('textbox')).toBeInTheDocument();
  act(()=>useChatStore.setState(owner==='plan'?{activePlan:{...plan,id:'p2'}}:{conversationId:'c2'}));
  expect(screen.queryByRole('textbox')).toBeNull();
});
it.each(['stopped','failed','rejected'] as const)('a new request after terminal %s owns planning and clarification while preserving evidence',status=>{
  const saved=snapshot(status,status==='failed'?'failed':'unknown',[]);stage(saved);
  act(()=>{useChatStore.getState().beginPlanning('c1','new-request');});
  expect(document.getElementById('moment-2')).toBeInTheDocument();
  expect(useChatStore.getState().executionSnapshot?.steps[1].status).toBe(status==='failed'?'failed':'unknown');
  act(()=>{useChatStore.getState().setExecutionSnapshot(saved);});
  expect(document.getElementById('moment-2')).toBeInTheDocument();
  act(()=>{useChatStore.getState().setIsPlanning(false,'c1','new-request');useChatStore.getState().setClarification({question:'Chọn nơi mới',options:['A']});});
  expect(document.getElementById('moment-3')).toBeInTheDocument();
});
it('planner refusal remains the existing refusal screen, separate from a rejected execution',()=>{
  stage(null);act(()=>handleSSEEvent('refusal',JSON.stringify({reason:'Unsupported'}),undefined,'c1'));
  expect(document.getElementById('moment-refusal')).toBeInTheDocument();
});
it('durable partial UNKNOWN uses the uncertainty screen without claiming a server restart',()=>{
  const saved=snapshot('reconciliation_required','unknown',['skip','stop']);saved.plan.status='partial';stage(saved);
  expect(document.getElementById('moment-8')).toBeInTheDocument();expect(screen.queryByRole('heading',{name:'Hệ thống vừa khởi động lại'})).toBeNull();
});

it('an unrelated planner refusal cannot hide the saved unsafe execution',()=>{stage(snapshot('partial','unknown',['skip','stop']));act(()=>handleSSEEvent('refusal',JSON.stringify({reason:'Unsupported'}),undefined,'c1'));expect(document.getElementById('moment-8')).toBeInTheDocument();});
