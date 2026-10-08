/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Workspace } from '../src/components/Workspace';
import { useChatStore } from '../src/store/chat-store';
import { Cockpit } from '../src/components/Cockpit';
import { resourceDestination } from '../src/components/Cockpit';
import { CockpitDialog } from '../src/components/CockpitDialog';
import { apiClient } from '../src/services/api-client';
import type { ChatStoreState } from '../src/store/chat-store';
vi.mock('../src/hooks/use-sse', async importOriginal => ({ ...await importOriginal<typeof import('../src/hooks/use-sse')>(), useSSE: () => ({ disconnected: false }) }));
vi.mock('../src/hooks/use-conversation-history', () => ({ useConversationHistory: () => ({ loading: false, error: null }) }));
vi.mock('../src/services/api-client', () => ({ apiClient: { getRuntime: async () => ({ runtimeMode: 'sandbox' }), getServices: async () => ({ services: [], canConfigure: false }), getConversations: async () => ({ conversations: [] }), rejectPlan:vi.fn(), approvePlan:vi.fn() } }));
afterEach(() => { cleanup(); useChatStore.getState().reset(); });
it('FE-05 exposes exactly one chat composer on the empty cockpit', () => {
  useChatStore.getState().reset();
  render(<Workspace authToken="test" user={null} authError={null} onClearAuthError={() => {}} onLogout={() => {}} route={{kind:'home'}} navigate={() => {}} />);
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
  expect(screen.getByRole('heading', { name: 'Hôm nay bạn muốn nhờ việc gì?' })).toBeInTheDocument();
});
const plan = { id:'p1',summary:'Tạo issue và gửi báo cáo',resourceLabels:{ repo:'ati-test' },steps:[{id:'s1',tool:'github.create_issue',description:'Tạo issue trong kho ati-test',args:{repo:'repo',title:'Kiểm tra cockpit',body:'Nội dung cần ghi'}}] };
function renderCockpit() { return render(<Cockpit services={[{id:'github',name:'GitHub',configured:true,connected:false,connectionStatus:'unchecked'},{id:'slack',name:'Slack',configured:false,connected:false,connectionStatus:'unconfigured'}]} servicesLoading={false} servicesError={null} onSendMessage={vi.fn()} onNewConversation={vi.fn()} onSelectConversation={vi.fn()} onSettings={vi.fn()} onApprove={vi.fn()} onCancel={vi.fn()} recovery={null} />); }
it.each(['idle','preview','approving','executing','completed','stopped','rejected','failed'] as const)('one draft survives conversation drawer at %s', status => {
  useChatStore.setState({activePlan:plan,planStatus:status}); renderCockpit();
  if(status==='preview') fireEvent.click(screen.getByRole('button',{name:'Sửa qua Chat'}));
  fireEvent.change(screen.getByRole('textbox'), {target:{value:'Draft stays'}});
  const opener=screen.getByRole('button',{name:'Xem hội thoại'}); opener.focus(); fireEvent.click(opener);
  const dialog=screen.getByRole('dialog',{name:'Nhật ký hội thoại'});
  expect(screen.getAllByRole('textbox')).toHaveLength(1); expect(within(dialog).getByRole('textbox')).toHaveValue('Draft stays');
  fireEvent.keyDown(document,{key:'Escape'});
  expect(screen.getAllByRole('textbox')).toHaveLength(1); expect(screen.getByRole('textbox')).toHaveValue('Draft stays'); expect(opener).toHaveFocus();
});
it.each([
  ['planning',{isPlanning:true}],
  ['clarification',{activeClarification:{question:'Chọn nơi ghi',options:['A']}}],
  ['known failure',{planStatus:'partial',stepStatuses:{s1:'failed'}}],
  ['unknown',{planStatus:'executing',stepStatuses:{s1:'unknown'}}],
  ['restart',{planStatus:'reconciliation_required'}],
  ['refusal',{messages:[{id:'r',role:'assistant',content:'Từ chối yêu cầu: Chưa kết nối',metadata:{type:'refusal'}}]}],
] as const)('one composer through drawer transitions at %s',(_name,patch)=>{
  useChatStore.setState(patch as Partial<ChatStoreState>); renderCockpit();
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'Xem hội thoại'}));
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
  fireEvent.keyDown(document,{key:'Escape'}); expect(screen.getAllByRole('textbox')).toHaveLength(1);
});
it('configured suggestions prefill the single textarea; unconfigured services have no suggestion', () => {
  renderCockpit(); fireEvent.click(screen.getByRole('button',{name:'Tạo issue mới trên GitHub'}));
  expect(screen.getByRole('textbox')).toHaveValue('Tạo issue mới trên GitHub');
  expect(screen.queryByRole('button',{name:'Gửi thông báo tiến độ qua Slack'})).toBeNull();
  expect(screen.getByText('Chưa kiểm tra')).toBeInTheDocument(); expect(screen.getByText('Chưa kết nối:')).toBeInTheDocument();
  expect(screen.getByRole('link',{name:'Kết nối thêm'})).toHaveAttribute('href','/settings');
});
it('future services use the API name, generic SVG and a configured suggestion without adding core branches',()=>{
  render(<Cockpit services={[{id:'future-tool',name:'Công cụ nhóm',configured:true,connected:false,connectionStatus:'unchecked'}]} servicesLoading={false} servicesError={null} onSendMessage={vi.fn()} onNewConversation={vi.fn()} onSelectConversation={vi.fn()} onSettings={vi.fn()} onApprove={vi.fn()} onCancel={vi.fn()} recovery={null} />);
  expect(within(screen.getByLabelText('Dịch vụ đã thiết lập')).getByText('Công cụ nhóm')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Mô tả công việc với Công cụ nhóm'}));
  expect(screen.getByRole('textbox')).toHaveValue('Mô tả công việc với Công cụ nhóm');
});
it('uses generic resource types and prior step number when the server has no grounded names',()=>{
  expect(resourceDestination({id:'s',tool:'trello.create_card',description:'Create',args:{listId:'opaque-list-id'}})).toBe('Danh sách · chưa có tên trong dữ liệu');
  expect(resourceDestination({id:'s2',tool:'trello.add_member',description:'Assign',args:{cardId:{$ref:'step_1.output.id'},memberId:'opaque-member-id'}})).toBe('Kết quả của bước 1 · Thành viên · chưa có tên trong dữ liệu');
});
it('preview contains actual intended text and grounded destination without invented issue number', () => {
  useChatStore.setState({activePlan:plan,planStatus:'preview'}); renderCockpit();
  expect(screen.queryByText(/#42/)).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Xem trước'}));
  const dialog=screen.getByRole('dialog',{name:'Xem trước nội dung'});
  expect(within(dialog).getByText('Kiểm tra cockpit')).toBeInTheDocument(); expect(within(dialog).getByText('Nội dung cần ghi')).toBeInTheDocument();
  expect(within(dialog).getByText(/Đích:/).parentElement).toHaveTextContent('ati-test');
  expect(within(dialog).queryByText('repo',{exact:true})).toBeNull();
  const close=within(dialog).getByRole('button',{name:'Đóng Xem trước nội dung'}); close.focus(); fireEvent.keyDown(document,{key:'Tab',shiftKey:true}); expect(within(dialog).getByRole('button',{name:'Đóng xem trước'})).toHaveFocus();
  fireEvent.keyDown(document,{key:'Tab'}); expect(close).toHaveFocus();
  fireEvent.keyDown(document,{key:'Escape'}); expect(screen.getByRole('button',{name:'Xem trước'})).toHaveFocus();
});
it('clarification uses its single main textarea with no second free-text form', () => {
  useChatStore.setState({activeClarification:{question:'Chọn kho nào?',options:['Kho A','Kho B']}}); renderCockpit();
  expect(screen.getAllByRole('textbox')).toHaveLength(1); expect(screen.getByRole('textbox',{name:'Nhập câu trả lời làm rõ yêu cầu'})).toBeInTheDocument();
  expect(screen.getByRole('radio',{name:'Kho A'})).toBeInTheDocument();
});
it('receipt uses actual elapsed timestamps and only http(s) outcome links', () => {
  useChatStore.setState({planStatus:'completed',executionSnapshot:{plan:{...plan,convId:'c1',status:'completed'},execution:{status:'completed'},recoveryActions:[],steps:[{stepId:'s1',tool:'github.create_issue',status:'succeeded',startedAt:'2026-10-05T10:00:00.000Z',completedAt:'2026-10-05T10:00:02.500Z',durationMs:2500,output:{url:'https://github.com/ati/test/issues/42',html_url:'javascript:alert(1)',number:42}}]}}); renderCockpit();
  const link=screen.getByRole('link',{name:'Mở issue'}); expect(link).toHaveAttribute('rel','noopener noreferrer'); expect(link).toHaveAttribute('target','_blank');
  expect(screen.queryByRole('link',{name:'javascript:alert(1)'})).toBeNull(); expect(screen.getByText('Trong 2,5 giây')).toBeInTheDocument(); expect(screen.queryByText(/đã xác nhận/i)).toBeNull();
});
it('offers a settings link and a new request when no service is configured',()=>{
  useChatStore.setState({planStatus:'completed'});
  render(<Cockpit services={[]} servicesLoading={false} servicesError={null} onSendMessage={vi.fn()} onNewConversation={vi.fn()} onSelectConversation={vi.fn()} onSettings={vi.fn()} onApprove={vi.fn()} onCancel={vi.fn()} recovery={null} />);
  expect(within(screen.getByRole('group',{name:'Gợi ý tiếp theo'})).getByRole('link',{name:'Kết nối thêm'})).toHaveAttribute('href','/settings');
  expect(screen.getByRole('button',{name:'Nhờ việc khác'})).toBeInTheDocument();
});
it('returns focus to a rerendered opener using its stable identity', () => {
  const view=render(<><button key="a" id="stable-opener">Open</button></>); screen.getByRole('button',{name:'Open'}).focus();
  view.rerender(<><button key="a" id="stable-opener">Open</button><CockpitDialog title="Example" returnFocusId="stable-opener" onClose={()=>{}}><button>Action</button></CockpitDialog></>);
  view.rerender(<><button key="b" id="stable-opener">Open</button><CockpitDialog title="Example" returnFocusId="stable-opener" onClose={()=>{}}><button>Action</button></CockpitDialog></>);
  view.rerender(<><button key="b" id="stable-opener">Open</button></>); expect(screen.getByRole('button',{name:'Open'})).toHaveFocus();
});
it('late plan for A cannot change B cockpit moment', async () => {
  useChatStore.setState({conversationId:'B'}); renderCockpit();
  const {handleSSEEvent}=await import('../src/hooks/use-sse');
  act(()=>handleSSEEvent('plan_preview',JSON.stringify({planId:'plan-A',summary:'Late A',steps:plan.steps}),undefined,'A'));
  expect(screen.getByRole('region',{name:/Cockpit|Tôi sẽ làm|Đang thực hiện công việc|Đã xong|Chưa rõ kết quả|chưa hoàn thành việc này|Hệ thống vừa khởi động lại/})).toHaveAttribute('data-moment','1'); expect(screen.queryByText('Late A')).toBeNull();
});
it('late cancellation for A cannot clear the selected B plan', async () => {
  let finish!:()=>void; vi.mocked(apiClient.rejectPlan).mockImplementation(()=>new Promise(resolve=>{finish=()=>resolve(undefined); }));
  useChatStore.setState({conversationId:'A',activePlan:plan,planStatus:'preview'});
  render(<Workspace authToken="test" user={null} authError={null} onClearAuthError={() => {}} onLogout={() => {}} route={{kind:'conversation',conversationId:'A'}} navigate={() => {}} />);
  fireEvent.click(screen.getByRole('button',{name:'Hủy'}));
  act(()=>useChatStore.setState({conversationId:'B',activePlan:{...plan,id:'plan-B'},planStatus:'preview'}));
  await act(async()=>finish()); expect(useChatStore.getState().activePlan?.id).toBe('plan-B'); expect(useChatStore.getState().planStatus).toBe('preview');
});
it.each(['executing','completed'] as const)('a late approval error cannot restore preview after authoritative SSE %s',async phase=>{
  let fail!:(error:Error)=>void; vi.mocked(apiClient.approvePlan).mockImplementation(()=>new Promise((_resolve,reject)=>{fail=reject;}));
  useChatStore.setState({conversationId:'A',activePlan:plan,planStatus:'preview'});
  render(<Workspace authToken="test" user={null} authError={null} onClearAuthError={() => {}} onLogout={() => {}} route={{kind:'conversation',conversationId:'A'}} navigate={() => {}} />);
  fireEvent.click(screen.getByRole('button',{name:'Duyệt kế hoạch'}));
  act(()=>useChatStore.getState().setPlanStatus(phase));
  await act(async()=>fail(new Error('Late transport error')));
  expect(useChatStore.getState().planStatus).toBe(phase); expect(screen.queryByRole('button',{name:'Duyệt kế hoạch'})).toBeNull();
});
it.each(['executing','completed'] as const)('late approval success preserves authoritative SSE %s',async phase=>{
  let finish!:()=>void; vi.mocked(apiClient.approvePlan).mockImplementation(()=>new Promise(resolve=>{finish=()=>resolve(undefined);}));
  useChatStore.setState({conversationId:'A',activePlan:plan,planStatus:'preview'});
  render(<Workspace authToken="test" user={null} authError={null} onClearAuthError={() => {}} onLogout={() => {}} route={{kind:'conversation',conversationId:'A'}} navigate={() => {}} />);
  fireEvent.click(screen.getByRole('button',{name:'Duyệt kế hoạch'})); act(()=>useChatStore.getState().setPlanStatus(phase));
  await act(async()=>finish()); expect(useChatStore.getState().planStatus).toBe(phase); expect(screen.queryByRole('button',{name:'Duyệt kế hoạch'})).toBeNull();
});

it.each(['preview','completed'] as const)('beginPlanning retires the previous %s owner but retains completed history', status => {
  useChatStore.setState({conversationId:'A',activePlan:plan,planStatus:status});
  expect(useChatStore.getState().beginPlanning('A','new-request')).toBe(true);
  renderCockpit();
  expect(screen.getByRole('region',{name:/Cockpit|Tôi sẽ làm|Đang thực hiện công việc|Đã xong|Chưa rõ kết quả|chưa hoàn thành việc này|Hệ thống vừa khởi động lại/})).toHaveAttribute('data-moment','2');
  expect(useChatStore.getState().activePlan).toBeNull();
});
it('a read-only old completed snapshot cannot reacquire the stage while a new request is planning',()=>{
  const store=useChatStore.getState(); store.setConversationId('A');
  store.beginPlanning('A','new-request');
  store.setExecutionSnapshot({plan:{...plan,convId:'A',status:'completed'},execution:{status:'completed'},recoveryActions:[],steps:[{stepId:'s1',tool:'github.create_issue',status:'succeeded'}]});
  renderCockpit(); expect(screen.getByRole('region',{name:/Cockpit|Tôi sẽ làm|Đang thực hiện công việc|Đã xong|Chưa rõ kết quả|chưa hoàn thành việc này|Hệ thống vừa khởi động lại/})).toHaveAttribute('data-moment','2');
  expect(useChatStore.getState().executionSnapshot?.plan.id).toBe('p1');
});
it.each(['unknown','failed'] as const)('a new planning request preserves unsafe %s evidence',status=>{
  useChatStore.setState({conversationId:'A',activePlan:plan,planStatus:'partial',stepStatuses:{s1:status}});
  useChatStore.getState().beginPlanning('A','new-request'); renderCockpit();
  expect(screen.getByRole('region',{name:/Cockpit|Tôi sẽ làm|Đang thực hiện công việc|Đã xong|Chưa rõ kết quả|chưa hoàn thành việc này|Hệ thống vừa khởi động lại/})).toHaveAttribute('data-moment',status==='unknown'?'8':'7');
  expect(useChatStore.getState().activePlan?.id).toBe('p1');
});
it('current progress rejects old snapshot output even when the plans reuse a step ID, then follows actual SSE',async()=>{
  const store=useChatStore.getState(); store.setConversationId('A');
  store.setExecutionSnapshot({plan:{...plan,convId:'A',status:'completed'},execution:{status:'completed'},recoveryActions:[],steps:[{stepId:'s1',tool:'github.create_issue',status:'succeeded',durationMs:3000,output:{url:'https://github.com/ati/test/issues/42',number:42}}]});
  store.setActivePlan({...plan,id:'new-plan',summary:'New plan',steps:[{id:'s1',tool:'slack.send_message',description:'NEW operation',args:{channel:'#general',text:'New content'}}]});
  store.setPlanStatus('approving'); renderCockpit();
  expect(screen.getByText('NEW operation',{exact:true})).toBeInTheDocument();
  expect(screen.queryByRole('link',{name:'Mở issue'})).toBeNull();
  expect(screen.queryByText('Đã hoàn thành 1/1 bước.',{exact:true})).toBeNull();
  const {handleSSEEvent}=await import('../src/hooks/use-sse');
  act(()=>handleSSEEvent('exec_start',JSON.stringify({planId:'new-plan'}),undefined,'A'));
  act(()=>handleSSEEvent('exec_step',JSON.stringify({planId:'new-plan',stepId:'s1',status:'running'}),undefined,'A'));
  expect(useChatStore.getState().planStatus).toBe('executing');
  expect(screen.getByText('NEW operation',{exact:true})).toBeInTheDocument();
  act(()=>handleSSEEvent('exec_step',JSON.stringify({planId:'new-plan',stepId:'s1',status:'succeeded'}),undefined,'A'));
  act(()=>handleSSEEvent('exec_done',JSON.stringify({planId:'new-plan',status:'completed'}),undefined,'A'));
  expect(screen.getByRole('region',{name:/Cockpit|Tôi sẽ làm|Đang thực hiện công việc|Đã xong|Chưa rõ kết quả|chưa hoàn thành việc này|Hệ thống vừa khởi động lại/})).toHaveAttribute('data-moment','6');
  expect(screen.queryByRole('link',{name:'Mở issue'})).toBeNull();
});
it.each([
  {content:'Stored planning failure',metadata:{type:'planning_error'}},
  {content:'Lỗi: Legacy planning failure'},
  {content:'[Lỗi gửi tin nhắn]: Transport failure'},
])('terminal error feedback remains visible outside the conversation drawer: $content',message=>{
  useChatStore.setState({messages:[{id:'error',role:'system',...message}]}); renderCockpit();
  expect(screen.getByRole('alert')).toHaveTextContent(message.metadata?.type === 'planning_error' ? 'Không thể lập kế hoạch lúc này. Hãy thử lại.' : message.content);
});
