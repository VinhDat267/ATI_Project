import {createServer,type Server} from 'node:http';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup,act} from '@testing-library/react';
import {defaultSlackAssistantConfig} from '@wap/tool-schemas';
import {SlackAutomationSettings} from '../src/components/slack/SlackAutomationSettings';
import {authStorage} from '../src/services/auth-storage';
let server:Server,requests:any[],version:string,available:boolean,conflict:boolean,delay:number;
const nativeFetch=fetch;
beforeEach(async()=>{
 requests=[];version='9007199254740993';available=true;conflict=false;delay=0;
 authStorage.setStoredTokens({accessToken:'token-one',refreshToken:'refresh-one',user:{id:'owner-one',email:'one@example.test',name:'One'}});
 server=createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;const body=raw?JSON.parse(raw):undefined;requests.push({method:req.method,url:req.url,body});if(delay)await new Promise(r=>setTimeout(r,delay));res.setHeader('content-type','application/json');
  if(req.method==='PUT'&&conflict){res.statusCode=409;res.end(JSON.stringify({code:'SLACK_ASSISTANT_VERSION_CONFLICT',error:'Cấu hình đã thay đổi.'}));return;}
  if(req.url?.endsWith('/followed-threads')){res.end(JSON.stringify({success:true}));return;}
  res.end(JSON.stringify({config:body?.config??defaultSlackAssistantConfig(),configVersion:version,available,pausedReason:null,queue:{pending:2,running:0,held:0,needsAttention:1}}));
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+(server.address() as any).port;vi.stubGlobal('fetch',(path:string,init?:RequestInit)=>nativeFetch(new URL(path,url),init));
});
afterEach(async()=>{cleanup();authStorage.clearStoredTokens();vi.unstubAllGlobals();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
async function opened(){render(<SlackAutomationSettings connectionId="conn-one" workspaceName="Workspace Một" active/>);fireEvent.click(screen.getByRole('button',{name:'Tự động hóa Workspace Một'}));return screen.findByLabelText('Chế độ');}
it('loads disabled hybrid, explains the three modes and shows pending work',async()=>{
 expect(await opened()).toHaveValue('hybrid');expect(screen.getByLabelText('Tự động tạo đề xuất')).not.toBeChecked();expect(screen.getByText(/2 việc đang chờ/)).toBeInTheDocument();expect(screen.getByRole('option',{name:'Rules — dùng luật'})).toBeInTheDocument();expect(screen.getByRole('option',{name:'AI — phân loại mọi sự kiện hợp lệ'})).toBeInTheDocument();
});
it('saves bounded settings with exact bigint CAS revision and no actor/token fields',async()=>{
 await opened();fireEvent.change(screen.getByLabelText('Chế độ'),{target:{value:'rules'}});fireEvent.click(screen.getByLabelText('Tự động tạo đề xuất'));fireEvent.change(screen.getByLabelText('Số lượt AI mỗi ngày'),{target:{value:'12'}});fireEvent.click(screen.getByRole('button',{name:'Lưu tự động hóa'}));
 await waitFor(()=>expect(requests.some(r=>r.method==='PUT')).toBe(true));const put=requests.find(r=>r.method==='PUT');expect(put.body.expectedVersion).toBe('9007199254740993');expect(put.body.config).toMatchObject({mode:'rules',enabled:true,budget:{dailyCalls:12}});expect(JSON.stringify(put.body)).not.toMatch(/atiUserId|slackUserId|accessToken/);
});
it('keeps edits visible and asks to reload when another tab wins config CAS',async()=>{
 await opened();conflict=true;fireEvent.change(screen.getByLabelText('Chế độ'),{target:{value:'ai'}});fireEvent.click(screen.getByRole('button',{name:'Lưu tự động hóa'}));await screen.findByRole('alert');expect(screen.getByLabelText('Chế độ')).toHaveValue('ai');expect(screen.getByRole('button',{name:'Tải lại cấu hình'})).toBeInTheDocument();
});
it('shows unavailable background while keeping preferences visible',async()=>{
 available=false;await opened();expect(screen.getByText(/Tự động hóa chưa khả dụng/)).toBeInTheDocument();expect(screen.getByLabelText('Tự động tạo đề xuất')).toBeDisabled();expect(screen.getByLabelText('Chế độ')).toBeEnabled();expect(screen.getByText(/UTC/)).toBeInTheDocument();
});
it('follows only the explicitly entered thread metadata',async()=>{
 await opened();fireEvent.change(screen.getByLabelText('ID kênh'),{target:{value:'C_ONE'}});fireEvent.change(screen.getByLabelText('Timestamp gốc của thread'),{target:{value:'1793549000.000001'}});fireEvent.click(screen.getByRole('button',{name:'Theo dõi thread'}));
 await waitFor(()=>expect(requests.some(r=>r.url.endsWith('/followed-threads'))).toBe(true));expect(requests.find(r=>r.url.endsWith('/followed-threads')).body).toEqual({channelId:'C_ONE',threadTs:'1793549000.000001',follow:true});
});
it('clears the previous account and rejects a delayed settings response after account switch',async()=>{
 delay=80;render(<SlackAutomationSettings connectionId="conn-one" workspaceName="Workspace Một" active/>);fireEvent.click(screen.getByRole('button',{name:'Tự động hóa Workspace Một'}));await waitFor(()=>expect(requests).toHaveLength(1));
 act(()=>authStorage.setStoredTokens({accessToken:'token-two',refreshToken:'refresh-two',user:{id:'owner-two',email:'two@example.test',name:'Two'}}));await new Promise(r=>setTimeout(r,120));expect(screen.queryByLabelText('Chế độ')).not.toBeInTheDocument();expect(screen.queryByText(/2 việc đang chờ/)).not.toBeInTheDocument();
});
it('configures daily digest toggle and local time and links to the proposal inbox',async()=>{
 await opened();
 expect(screen.getByRole('link',{name:'Mở hộp thư đề xuất'})).toHaveAttribute('href','/inbox');
 fireEvent.click(screen.getByLabelText('Bật bản tóm tắt hàng ngày'));
 fireEvent.change(screen.getByLabelText('Giờ gửi bản tóm tắt (HH:MM)'),{target:{value:'08:30'}});
 fireEvent.click(screen.getByRole('button',{name:'Lưu tự động hóa'}));
 await waitFor(()=>expect(requests.some(r=>r.method==='PUT')).toBe(true));
 const put=requests.find(r=>r.method==='PUT');
 expect(put.body.config.digest).toEqual({enabled:true,time:'08:30'});
});
