/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { Cockpit } from '../src/components/Cockpit';
import { useChatStore } from '../src/store/chat-store';
import type { ActivePlan, ExecutionSnapshot, PlanStatus } from '../src/types';
import assets from '../src/assets/cockpit-services.json';

vi.mock('../src/services/api-client', () => ({ apiClient: { getRuntime: async () => ({runtimeMode:'sandbox'}), getConversations: async () => ({conversations:[]}) } }));
afterEach(() => { cleanup(); useChatStore.getState().reset(); vi.restoreAllMocks(); });
const plan: ActivePlan = {id:'p1',summary:'Tạo issue rồi báo nhóm',resourceLabels:{'ati/test':'ati/test','#ati-test':'#ati-test'},steps:[
  {id:'step_1',tool:'github.create_issue',description:'Tạo issue',args:{repo:'ati/test',title:'Sửa đăng nhập',body:'Mô tả'}},
  {id:'step_2',tool:'slack.send_message',description:'Báo nhóm',args:{channel:'#ati-test',text:{$template:'Issue: ${step_1.output.html_url}'}}},
]};
const snapshot = (statuses: ExecutionSnapshot['steps'][number]['status'][]): ExecutionSnapshot => ({plan:{...plan,id:'p1',convId:'c1',status:'approved'},execution:{status:'executing'},recoveryActions:[],steps:statuses.map((status,i)=>({stepId:`step_${i+1}`,tool:plan.steps[i].tool,status,durationMs:i ? 7 : 1200,startedAt:'2026-10-07T00:00:00.000Z',completedAt:'2026-10-07T00:00:01.200Z',output:i ? {messageId:'m1',url:'https://slack.com/app_redirect?channel=ati-test'} : {number:42,title:'Sửa đăng nhập',html_url:'https://github.com/ati/test/issues/42'}}))});
function view() { const onSendMessage=vi.fn(); render(<Cockpit services={[{id:'github',name:'GitHub',configured:true,connected:false,connectionStatus:'unchecked'},{id:'slack',name:'Slack',configured:true,connected:false,connectionStatus:'unchecked'}]} servicesLoading={false} servicesError={null} onSendMessage={onSendMessage} onNewConversation={vi.fn()} onSelectConversation={vi.fn()} onSettings={vi.fn()} onApprove={vi.fn()} onCancel={vi.fn()} recovery={null}/>); return onSendMessage; }
it('moment 4 copies plan cards and sticky actions, with no bottom composer', async()=>{
  useChatStore.setState({activePlan:plan,planStatus:'preview'}); view();
  expect(await screen.findByRole('heading',{level:1,name:'Tôi sẽ làm 2 việc, theo thứ tự'})).toHaveClass('font-display','text-4xl','sm:text-5xl');
  expect(document.querySelectorAll('#plan-cards-container article')).toHaveLength(2);
  expect(document.getElementById('moment-4-sticky-bar')).toHaveClass('sticky','bottom-0');
  expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  expect(screen.getByText(/ghi thật vào công cụ/)).toBeInTheDocument();
});
it('inline edit and chat drawer share one draft, Shift+Enter and Enter keep their behavior',async()=>{
  useChatStore.setState({activePlan:plan,planStatus:'preview'}); const send=view();
  fireEvent.click(await screen.findByRole('button',{name:'Sửa qua Chat'}));
  let input=screen.getByRole('textbox'); expect(input).toHaveFocus();
  fireEvent.change(input,{target:{value:'Sửa\nchi tiết'}}); fireEvent.keyDown(input,{key:'Enter',shiftKey:true}); expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Xem hội thoại'}));
  expect(screen.getAllByRole('textbox')).toHaveLength(1); input=screen.getByPlaceholderText('Nhắn tiếp trong phiên này…'); expect(input).toHaveValue('Sửa\nchi tiết');
  fireEvent.keyDown(document,{key:'Escape'}); expect(screen.getAllByRole('textbox')).toHaveLength(1); input=screen.getByRole('textbox');
  fireEvent.keyDown(input,{key:'Enter'}); expect(send).toHaveBeenCalledWith('Sửa\nchi tiết');
  fireEvent.click(screen.getByRole('button',{name:'Đóng ô sửa'})); expect(screen.queryAllByRole('textbox')).toHaveLength(0);
});
it.each(['approving','executing','completed'] as PlanStatus[])('moment %s has exactly one fixed auto-growing bottom textarea',async status=>{
  useChatStore.setState({activePlan:plan,planStatus:status}); view(); await screen.findByRole('textbox');
  expect(document.getElementById('global-bottom-bar')).toHaveClass('fixed','bottom-0');
  expect(screen.getAllByRole('textbox')).toHaveLength(1); expect(screen.getByRole('textbox')).toHaveAttribute('rows','1');
  fireEvent.click(screen.getByRole('button',{name:'Xem hội thoại'})); expect(screen.getAllByRole('textbox')).toHaveLength(1);
  fireEvent.keyDown(document,{key:'Escape'}); expect(screen.getAllByRole('textbox')).toHaveLength(1);
});
it.each([['succeeded','running',50],['succeeded','skipped',100],['pending','pending',0]] as const)('progress uses actual terminal steps: %s / %s',async (first,second,percent)=>{
  useChatStore.setState({activePlan:plan,planStatus:'executing',executionSnapshot:snapshot([first,second])}); view();
  const bar=await screen.findByRole('progressbar'); expect(bar).toHaveAttribute('aria-valuenow',String(percent===100?2:percent===50?1:0)); expect(bar).toHaveAttribute('aria-valuemax','2');
  expect(document.getElementById('exec-progress-bar')).toHaveStyle({width:`${percent}%`});
});
it('running/pending steps never expose persisted output or success chips',async()=>{
  useChatStore.setState({activePlan:plan,planStatus:'executing',executionSnapshot:snapshot(['running','pending'])}); view();
  await screen.findByRole('heading',{name:'Đang thực hiện công việc'});
  expect(screen.queryByText(/Issue #42/)).toBeNull(); expect(screen.queryAllByRole('link',{name:/Mở|Xem tin/})).toHaveLength(0);
  expect(screen.queryByText(/✓ Đã/)).toBeNull(); expect(screen.queryByText(/1,2 giây/)).toBeNull();
});
it('execution links keep each service palette instead of sharing the first card color',async()=>{
  useChatStore.setState({activePlan:plan,planStatus:'executing',executionSnapshot:snapshot(['succeeded','succeeded'])});view();
  expect(await screen.findByRole('link',{name:'Mở issue'})).toHaveClass(assets.services.github.suggestion.name);
  expect(screen.getByRole('link',{name:'Xem tin'})).toHaveClass(assets.services.slack.suggestion.name);
});
it('opening an empty plan edit keeps the correction prefix and places the caret after it',async()=>{
  useChatStore.setState({activePlan:plan,planStatus:'preview'});view();
  fireEvent.click(await screen.findByRole('button',{name:'Sửa qua Chat'}));
  const input=screen.getByRole('textbox') as HTMLTextAreaElement;
  expect(input).toHaveValue('Điều chỉnh kế hoạch: ');expect(input.selectionStart).toBe(input.value.length);expect(input.selectionEnd).toBe(input.value.length);
});
it('preview keeps the source title weight and the service-specific tag colors',async()=>{
  useChatStore.setState({activePlan:plan,planStatus:'preview'});view();
  fireEvent.click((await screen.findAllByRole('button',{name:'Xem trước'}))[0]);
  const dialog=screen.getByRole('dialog',{name:'Xem trước nội dung'});
  expect(within(dialog).getByText('Sửa đăng nhập')).toHaveClass('text-sm','font-bold','text-neutral-900','mt-0.5');
  expect(document.getElementById('preview-service-tag')).toHaveClass('bg-neutral-900','text-white');
});
it('Sheets preview copies the source value table with only the requested cells',async()=>{
  useChatStore.setState({activePlan:{...plan,steps:[{id:'sheet',tool:'sheets.append_rows',description:'Ghi bảng tính',args:{spreadsheetId:'sheet-id',range:'Tasks!A:D',values:[['Tiêu đề',{$ref:'step_1.output.url'}]]}}]},planStatus:'preview'});view();
  fireEvent.click(await screen.findByRole('button',{name:'Xem trước'}));
  const table=await screen.findByRole('table');expect(table).toHaveClass('w-full','text-left','text-xs');
  expect(within(table).getByText('Tiêu đề')).toBeInTheDocument();expect(within(table).getByText(/kết quả step_1: url/)).toBeInTheDocument();expect(within(table).queryByText(/104/)).toBeNull();
});
it('Slack preview copies the source message frame without inventing sender identity',async()=>{
  useChatStore.setState({activePlan:{...plan,steps:[{...plan.steps[1],args:{channel:'#ati-test',text:'Nội dung\nnguyên văn'}}]},planStatus:'preview'});view();
  fireEvent.click(await screen.findByRole('button',{name:'Xem trước'}));
  const dialog=screen.getByRole('dialog',{name:'Xem trước nội dung'});
  expect(within(dialog).getByText(/Nội dung\s+nguyên văn/)).toHaveClass('bg-white','p-3','text-neutral-900','font-sans');expect(within(dialog).queryByText('ATI Assistant (Bot)')).toBeNull();
});
it.each([{$ref:'step_1.output.number'},{$template:'Issue ${step_1.output.number}'}])('receipt connects only actual output field references: %j',async reference=>{
  const saved=snapshot(['succeeded','succeeded']); saved.plan.steps=plan.steps.map((s,i)=>i?{...s,args:{...s.args,text:reference}}:s); saved.execution.status='completed';
  useChatStore.setState({planStatus:'completed',executionSnapshot:saved}); view();
  await screen.findByRole('heading',{name:'Đã xong 2 việc trên 2 công cụ'});
  const connector=document.querySelector('[data-receipt-connector]'); expect(connector).toHaveTextContent('number'); expect(connector).toHaveAttribute('data-from','step_1'); expect(connector).toHaveAttribute('data-to','step_2');
});
it('dependsOn alone and plain strings never imply a data arrow',async()=>{
  const saved=snapshot(['succeeded','succeeded']); saved.execution.status='completed'; saved.plan.steps=plan.steps.map((s,i)=>i?{...s,dependsOn:['step_1'],args:{channel:'#ati-test',text:'step_1.output.number'}}:s);
  useChatStore.setState({planStatus:'completed',executionSnapshot:saved}); view(); await screen.findByRole('heading',{name:'Đã xong 2 việc trên 2 công cụ'});
  expect(document.querySelector('[data-receipt-connector]')).toBeNull();
});
it('receipt hides raw fields in technical details and restricts outcome links to https',async()=>{
  const saved=snapshot(['succeeded','succeeded']); saved.execution.status='completed'; saved.steps[0].output={number:42,url:'http://github.com/ati/test/issues/42',html_url:'javascript:alert(1)'};
  useChatStore.setState({planStatus:'completed',executionSnapshot:saved}); view(); await screen.findByRole('heading',{name:'Đã xong 2 việc trên 2 công cụ'});
  expect(screen.queryByRole('link',{name:/Mở issue/})).toBeNull(); const link=screen.getByRole('link',{name:'Xem tin'}); expect(link).toHaveAttribute('target','_blank'); expect(link).toHaveAttribute('rel','noopener noreferrer');
  expect(screen.getByText('github.create_issue').closest('details')).toHaveTextContent('Chi tiết kỹ thuật');
  expect(screen.getByText('Trong 1,2 giây')).toBeInTheDocument(); expect(screen.getByText('< 0,1 giây')).toBeInTheDocument();
});
it('the receipt live announcement does not offset the first source header in its spacing group',async()=>{
  const saved=snapshot(['succeeded','succeeded']);saved.execution.status='completed';
  useChatStore.setState({planStatus:'completed',executionSnapshot:saved});view();
  const heading=await screen.findByRole('heading',{level:1});
  expect(document.getElementById('moment-6')!.firstElementChild).toContainElement(heading);
  expect(await screen.findByText('Quy trình đã hoàn thành.')).toHaveAttribute('role','status');
});
it('drawer uses source aside/backdrop and summarizes plans without JSON',async()=>{
  useChatStore.setState({activePlan:plan,planStatus:'preview',messages:[{id:'u',role:'user',content:'Nhờ sửa',timestamp:'2026-10-07T00:00:00.000Z'},{id:'p',role:'assistant',content:JSON.stringify(plan),metadata:{type:'plan',plan}}]}); view();
  fireEvent.click(await screen.findByRole('button',{name:'Xem hội thoại'})); const dialog=screen.getByRole('dialog',{name:'Nhật ký hội thoại'});
  expect(dialog.tagName).toBe('ASIDE'); expect(dialog).toHaveClass('sm:w-[420px]'); expect(document.getElementById('drawer-backdrop')).toHaveClass('bg-black/25','backdrop-blur-sm');
  const log=within(dialog).getByRole('log'); expect(log).toHaveTextContent('Kế hoạch 2 việc'); expect(log.textContent).not.toContain('"args"'); expect(log).toHaveTextContent('Bạn ·');
});
it('moment changes keep scroll/focus and the previous snapshot cannot draw new plan arrows',async()=>{
  useChatStore.setState({activePlan:plan,planStatus:'preview'}); view(); await screen.findByRole('button',{name:'Duyệt kế hoạch'});
  document.documentElement.scrollTop=93; act(()=>useChatStore.setState({planStatus:'executing'})); expect(document.documentElement.scrollTop).toBe(0); expect(screen.getByRole('heading',{level:1})).toHaveFocus();
  const saved=snapshot(['succeeded','succeeded']); saved.execution.status='completed';
  act(()=>useChatStore.setState({planStatus:'completed',executionSnapshot:saved})); expect(screen.getByRole('heading',{level:1})).toHaveFocus();
  act(()=>useChatStore.setState({activePlan:{...plan,id:'p2'},planStatus:'preview'})); expect(document.querySelector('[data-receipt-connector]')).toBeNull();
});
it('a request input removed by moment 4 gives focus to the new heading',async()=>{
  view();const input=await screen.findByRole('textbox');input.focus();
  fireEvent.change(input,{target:{value:'Tạo issue'}});document.documentElement.scrollTop=70;
  act(()=>useChatStore.setState({activePlan:plan,planStatus:'preview'}));
  expect(await screen.findByRole('heading',{level:1,name:/Tôi sẽ làm/})).toHaveFocus();
  expect(document.documentElement.scrollTop).toBe(0);expect(screen.queryAllByRole('textbox')).toHaveLength(0);
});
it('template references trim expressions and find fields in nested arrays without implying forward dependencies',async()=>{
  const saved=snapshot(['succeeded','succeeded']);saved.execution.status='completed';
  saved.plan.steps=plan.steps.map((step,index)=>index?{...step,args:{rows:[['Field',{$template:'${ step_1.output.number }'}],{$ref:'step_2.output.url'},{$ref:'future.output.url'}]}}:step);
  useChatStore.setState({planStatus:'completed',executionSnapshot:saved});view();await screen.findByRole('heading',{level:1});
  expect(document.querySelectorAll('[data-receipt-connector]')).toHaveLength(1);expect(document.querySelector('[data-receipt-connector]')).toHaveTextContent('number');
});
it('read receipt collections also reject insecure output links',async()=>{
  const saved=snapshot(['succeeded']);saved.execution.status='completed';saved.plan.steps=[{...plan.steps[0],tool:'github.search_issues'}];saved.steps[0].tool='github.search_issues';saved.steps[0].output=[{number:42,title:'Read result',url:'http://github.com/ati/test/issues/42'}];
  useChatStore.setState({planStatus:'completed',executionSnapshot:saved});view();await screen.findByRole('heading',{level:1});
  expect(document.querySelector('#receipt-chain a[href^="http:"]')).toBeNull();expect(screen.getByText('Read result')).toBeInTheDocument();
});
it('history drawer preserves search and rename while using the source card hierarchy',async()=>{
  const {apiClient}=await import('../src/services/api-client');
  vi.spyOn(apiClient,'getConversations').mockResolvedValueOnce({conversations:[{id:'c1',title:'Công việc hôm nay',updatedAt:'2026-10-07T00:00:00.000Z'}]});
  useChatStore.setState({activePlan:plan,planStatus:'preview'});view();fireEvent.click(await screen.findByRole('button',{name:'Mở danh sách hội thoại'}));
  const row=await screen.findByRole('button',{name:/^Công việc hôm nay/});expect(row.querySelector('.font-medium')).not.toBeNull();
  expect(screen.getByRole('searchbox',{name:'Tìm hội thoại theo tiêu đề'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Đổi tên Công việc hôm nay'})).toBeInTheDocument();
  fireEvent.click(document.getElementById('drawer-backdrop')!);await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
