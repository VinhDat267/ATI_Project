import {createServer,type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {AuthGate} from '../src/components/AuthGate';
import {GmailCallbackView} from '../src/views/GmailCallbackView';
import {JiraCallbackView} from '../src/views/JiraCallbackView';
import {useRoute} from '../src/hooks/use-route';
import {authStorage} from '../src/services/auth-storage';

const originalFetch=globalThis.fetch;
let server:Server;
let originalLocation:Location;
let replace:ReturnType<typeof vi.fn>;
let hold=false;
let release:()=>void;
let requests:string[];

beforeEach(async()=>{
 requests=[];hold=false;sessionStorage.clear();
 authStorage.setStoredTokens({accessToken:'stale-access',refreshToken:'stale-refresh',user:{id:'test-owner',email:'owner@example.test',name:'Owner'}});
 const gate=new Promise<void>(done=>{release=done;});
 server=createServer(async(req,res)=>{
  requests.push(req.url!);
  if(hold)await gate;
  res.setHeader('Content-Type','application/json');
  if(req.url==='/api/auth/config'){res.end(JSON.stringify({signupEnabled:false,googleEnabled:false}));return;}
  res.statusCode=401;res.end(JSON.stringify({error:'Expired session',code:'INVALID_SESSION'}));
 });
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 vi.stubGlobal('fetch',(url:string,init?:RequestInit)=>originalFetch(new URL(url,origin),init));
 originalLocation=window.location;replace=vi.fn();
});
afterEach(async()=>{
 release();cleanup();Object.defineProperty(window,'location',{configurable:true,value:originalLocation});
 authStorage.clearStoredTokens();vi.unstubAllGlobals();vi.restoreAllMocks();server.closeAllConnections();
 await new Promise<void>(done=>server.close(()=>done()));
});
function land(path:string,hostname='localhost',search='?code=TEST_CALLBACK_CODE&state=TEST_CALLBACK_STATE'){
 Object.defineProperty(window,'location',{configurable:true,value:{...originalLocation,protocol:'http:',hostname,port:'5174',host:hostname+':5174',origin:'http://'+hostname+':5174',pathname:path,search,hash:'',href:'http://'+hostname+':5174'+path+search,replace}});
 const changeLocation=(_state:unknown,_title:string,url?:string|URL|null)=>{
  const next=new URL(String(url??window.location.href),window.location.href);
  Object.assign(window.location,{href:next.href,origin:next.origin,pathname:next.pathname,search:next.search,hash:next.hash});
 };
 vi.spyOn(window.history,'replaceState').mockImplementation(changeLocation);
 vi.spyOn(window.history,'pushState').mockImplementation(changeLocation);
}
function Probe(){
 const {route,navigate}=useRoute();
 return <AuthGate route={route} navigate={navigate}>{()=>route.kind==='gmail-callback'?<GmailCallbackView input={route.googleCallback} navigate={navigate}/>:route.kind==='jira-callback'?<JiraCallbackView input={route.jiraCallback} navigate={navigate}/>:<p>Other page</p>}</AuthGate>;
}
it.each(['/connections/gmail/callback','/connections/myjira/callback','/connections/jira/callback','/connections/trello/callback','/connections/notion/callback'])('preserves %s callback for the alternate loopback host when stale hydration invalidates this host session',async path=>{
 land(path);render(<Probe/>);
 await waitFor(()=>expect(replace).toHaveBeenCalledTimes(1));
 const target=new URL(replace.mock.calls[0]![0]);
 expect(target.origin).toBe('http://127.0.0.1:5174');
 const expectedPaths=path==='/connections/gmail/callback'?['/connections/gmail/callback']:path==='/connections/trello/callback'?['/connections/trello/callback']:path==='/connections/notion/callback'?['/connections/notion/callback']:['/connections/jira/callback','/connections/myjira/callback'];
 expect(expectedPaths).toContain(target.pathname);
 expect(target.searchParams.get('code')).toBe('TEST_CALLBACK_CODE');
 expect(target.searchParams.get('state')).toBe('TEST_CALLBACK_STATE');
 expect(target.href).not.toContain('stale-access');expect(target.href).not.toContain('stale-refresh');
});
it('shows login without forwarding OAuth input to a different non-loopback host',async()=>{
 land('/connections/gmail/callback','ati.example');render(<Probe/>);
 await screen.findByRole('button',{name:'Đăng nhập'});
 expect(replace).not.toHaveBeenCalled();
});
it('does not recover a cancelled OAuth grant after session expiry',async()=>{
 land('/connections/gmail/callback','localhost','?error=access_denied&state=TEST_STATE');render(<Probe/>);
 await screen.findByRole('button',{name:'Đăng nhập'});expect(replace).not.toHaveBeenCalled();
});
it('does not recover an OAuth callback after a deliberate logout in another tab',async()=>{
 hold=true;land('/connections/gmail/callback');render(<Probe/>);
 await waitFor(()=>expect(requests).toContain('/api/auth/me'));
 act(()=>{localStorage.clear();window.dispatchEvent(new StorageEvent('storage',{key:null,storageArea:localStorage}));release();});
 await screen.findByRole('button',{name:'Đăng nhập'});expect(replace).not.toHaveBeenCalled();
});
