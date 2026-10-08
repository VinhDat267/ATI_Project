/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { Cockpit } from '../src/components/Cockpit';
import { useExecutionRecovery } from '../src/hooks/use-execution-recovery';
import { useChatStore } from '../src/store/chat-store';
import { apiClient } from '../src/services/api-client';
import { handleSSEEvent } from '../src/hooks/use-sse';
import type { ExecutionSnapshot } from '../src/types';
afterEach(()=>{cleanup();vi.restoreAllMocks();useChatStore.getState().reset();});
const saved:ExecutionSnapshot={plan:{id:'p1',convId:'c1',status:'partial',summary:'Failed',steps:[{id:'s1',tool:'trello.create_card',description:'Create',args:{listId:'list',title:'Original'}}]},execution:{status:'partial',pausedStepId:'s1'},steps:[{stepId:'s1',tool:'trello.create_card',status:'failed',error:'Denied'}],recoveryActions:['retry','skip','stop']};
function stage(){useChatStore.getState().setConversationId('c1');useChatStore.getState().setExecutionSnapshot(saved);const controls={busy:false,error:null,onRetry:vi.fn(),onSkip:vi.fn(),onStop:vi.fn(),onContinue:vi.fn(),onEdit:vi.fn()};render(<Cockpit services={[]} servicesLoading={false} servicesError={null} onSendMessage={vi.fn()} onNewConversation={vi.fn()} onSelectConversation={vi.fn()} onSettings={vi.fn()} onApprove={vi.fn()} onCancel={vi.fn()} recovery={controls}/>);return controls;}
it('known failure retry and skip target the persisted paused step',()=>{const controls=stage();fireEvent.click(screen.getByRole('button',{name:'Thử lại việc 1'}));fireEvent.click(screen.getByRole('button',{name:'Bỏ qua việc này'}));expect(controls.onRetry).toHaveBeenCalledWith('s1');expect(controls.onSkip).toHaveBeenCalledWith('s1');});
it('stop requires confirmation and Escape never stops the plan',()=>{const controls=stage();fireEvent.click(screen.getByRole('button',{name:'Dừng kế hoạch'}));expect(controls.onStop).not.toHaveBeenCalled();fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();expect(controls.onStop).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Dừng kế hoạch'}));fireEvent.click(screen.getByRole('button',{name:'Dừng hẳn quy trình'}));expect(controls.onStop).toHaveBeenCalledTimes(1);});
it('edit shows labelled schema fields and submits edited arguments only after confirmation',()=>{const controls=stage();fireEvent.click(screen.getByRole('button',{name:'Sửa rồi thử lại'}));expect(screen.queryByRole('textbox',{name:'Tham số thực thi'})).toBeNull();const title=screen.getByDisplayValue('Original');fireEvent.change(title,{target:{value:'Corrected'}});fireEvent.click(screen.getByRole('button',{name:'Xem lại nội dung sửa'}));expect(controls.onEdit).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Dừng và gửi yêu cầu sửa'}));expect(controls.onEdit).toHaveBeenCalledWith('s1',expect.objectContaining({title:'Corrected'}),'Create');});
it('late recovery error after leaving and returning to the same conversation cannot surface in the new owner',async()=>{
  useChatStore.getState().setConversationId('c1');useChatStore.getState().setExecutionSnapshot(saved);
  let reject!:(error:Error)=>void;vi.spyOn(apiClient,'retryStep').mockImplementation(()=>new Promise((_resolve,fail)=>{reject=fail;}));
  const hook=renderHook(()=>useExecutionRecovery());let task!:Promise<unknown>;act(()=>{task=hook.result.current.recover('retry','s1');});
  act(()=>{useChatStore.getState().setConversationId('c2');});act(()=>{useChatStore.getState().setConversationId('c1');});
  await act(async()=>{reject(new Error('STALE OWNER ERROR'));await task;});expect(hook.result.current.recoveryError).toBeNull();
});
it('snapshot unknown blocks retry and continue even when live store and server actions disagree',async()=>{
  useChatStore.getState().setConversationId('c1');useChatStore.getState().setExecutionSnapshot({...saved,steps:[{...saved.steps[0],status:'unknown'}],recoveryActions:['retry','continue','stop']});useChatStore.setState({stepStatuses:{s1:'failed'}});
  const retry=vi.spyOn(apiClient,'retryStep');const resume=vi.spyOn(apiClient,'continueExecution');const hook=renderHook(()=>useExecutionRecovery());await act(async()=>{await hook.result.current.recover('retry','s1');await hook.result.current.recover('continue');});expect(retry).not.toHaveBeenCalled();expect(resume).not.toHaveBeenCalled();
});
it('editor uses saved successful reference values rather than a reference to the stopped plan',()=>{
  stage();act(()=>useChatStore.getState().setExecutionSnapshot({...saved,plan:{...saved.plan,steps:[{id:'s0',tool:'trello.create_card',description:'Saved',args:{}},{id:'s1',tool:'trello.add_member',description:'Assign',args:{cardId:{$ref:'s0.output.id'},memberId:'member'}}]},steps:[{stepId:'s0',tool:'trello.create_card',status:'succeeded',output:{id:'saved-card-id'}},{stepId:'s1',tool:'trello.add_member',status:'failed'}]}));
  fireEvent.click(screen.getByRole('button',{name:'Sửa rồi thử lại'}));expect(screen.getByDisplayValue('saved-card-id')).toBeInTheDocument();
});
it('a delayed recovery success for A does not fetch or overwrite B, or a newer plan in A',async()=>{
  useChatStore.getState().setConversationId('c1');useChatStore.getState().setExecutionSnapshot(saved);
  let release!:()=>void;vi.spyOn(apiClient,'skipStep').mockImplementation(()=>new Promise(resolve=>{release=()=>resolve({status:'completed'});}));const latest=vi.spyOn(apiClient,'getLatestExecutionSnapshot');const hook=renderHook(()=>useExecutionRecovery());
  let task!:Promise<unknown>;act(()=>{task=hook.result.current.recover('skip','s1');});act(()=>{useChatStore.getState().reset();useChatStore.getState().setConversationId('c2');useChatStore.getState().setActivePlan({id:'p2',summary:'B',steps:[]});useChatStore.getState().setPlanStatus('preview');});await act(async()=>{release();await task;});expect(latest).not.toHaveBeenCalled();expect(useChatStore.getState().activePlan?.id).toBe('p2');expect(useChatStore.getState().planStatus).toBe('preview');
});
it('an authoritative own stopped SSE arriving before HTTP still permits the edited replacement request',async()=>{
  useChatStore.getState().setConversationId('c1');useChatStore.getState().setExecutionSnapshot(saved);
  let release!:()=>void;vi.spyOn(apiClient,'stopExecution').mockImplementation(()=>new Promise(resolve=>{release=()=>resolve({status:'stopped'});}));
  vi.spyOn(apiClient,'getLatestExecutionSnapshot').mockResolvedValue({...saved,plan:{...saved.plan,status:'stopped'},execution:{status:'stopped'},recoveryActions:[]});
  const hook=renderHook(()=>useExecutionRecovery());let task!:Promise<boolean>;act(()=>{task=hook.result.current.recover('stop');});
  act(()=>handleSSEEvent('exec_done',JSON.stringify({planId:'p1',status:'stopped'}),undefined,'c1'));
  let accepted=false;await act(async()=>{release();accepted=await task;});expect(accepted).toBe(true);expect(useChatStore.getState().executionSnapshot?.execution.status).toBe('stopped');
});
