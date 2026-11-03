interface Options {appToken:string;apiBaseUrl:string;timeoutMs?:number;fetchFn?:typeof fetch}
const safeId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(value);
const record=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function endpoint(value:string):string {
 try {
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash)throw new Error();
  if(url.href==='https://slack.com/api')return url.href;
  if(url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname)&&['','/','/api'].includes(url.pathname))return url.href.replace(/\/$/,'');
 } catch { /* URL exceptions can retain credentials in .input; never propagate them. */ }
 throw new Error('SLACK_AUTHORIZATIONS_CONFIG_INVALID');
}
/** Private routing metadata only. A partial authorization list never becomes a usable result. */
export class SlackAuthorizationsResolver {
 private readonly base:string;
 private readonly timeout:number;
 private readonly fetchFn:typeof fetch;
 constructor(private readonly options:Options) {
  this.base=endpoint(options.apiBaseUrl);this.timeout=options.timeoutMs??8000;this.fetchFn=options.fetchFn??fetch;
  if(typeof options.appToken!=='string'||!options.appToken.trim()||options.appToken.length>4096||/[\r\n]/.test(options.appToken)||
     !Number.isSafeInteger(this.timeout)||this.timeout<1||this.timeout>10000)throw new Error('SLACK_AUTHORIZATIONS_CONFIG_INVALID');
 }
 async resolve(eventContext:string,workspaceId:string,signal?:AbortSignal):Promise<string[]> {
  try {
   if(typeof eventContext!=='string'||!eventContext.trim()||eventContext.length>1024||!safeId(workspaceId))throw new Error();
   const timeout=AbortSignal.timeout(this.timeout),combined=signal?AbortSignal.any([signal,timeout]):timeout;
   combined.throwIfAborted();
   const users=new Set<string>(),cursors=new Set<string>();let cursor='';let count=0;
   for(let page=0;page<50;page++) {
    combined.throwIfAborted();
    const body=new URLSearchParams({event_context:eventContext,limit:'200'});if(cursor)body.set('cursor',cursor);
    const response=await this.fetchFn(this.base+'/apps.event.authorizations.list',{method:'POST',redirect:'error',signal:combined,
     headers:{Authorization:'Bearer '+this.options.appToken,'Content-Type':'application/x-www-form-urlencoded'},body});
    if(!response.ok||!response.body)throw new Error();
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    try {for(;;){const {done,value}=await reader.read();combined.throwIfAborted();if(done)break;size+=value.length;if(size>131072)throw new Error();chunks.push(value);}}
    finally {await reader.cancel().catch(()=>{});}
    const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!record(data)||data.ok!==true||!Array.isArray(data.authorizations)||data.authorizations.length>1000)throw new Error();
    count+=data.authorizations.length;if(count>10000)throw new Error();
    for(const authorization of data.authorizations) {
     if(!record(authorization)||!safeId(authorization.user_id)||typeof authorization.is_bot!=='boolean'||
        (authorization.is_enterprise_install!==undefined&&typeof authorization.is_enterprise_install!=='boolean'))throw new Error();
     if(authorization.is_enterprise_install===true)continue;
     if(!safeId(authorization.team_id))throw new Error();
     if(!authorization.is_bot&&authorization.team_id===workspaceId)users.add(authorization.user_id);
    }
    if(data.response_metadata!==undefined&&!record(data.response_metadata))throw new Error();
    const next=data.response_metadata?.next_cursor??'';
    if(typeof next!=='string'||next.length>4096||(data.has_more!==undefined&&typeof data.has_more!=='boolean')||(!next&&data.has_more===true))throw new Error();
    combined.throwIfAborted();
    if(!next)return [...users].sort();
    if(cursors.has(next))throw new Error();cursors.add(next);cursor=next;
   }
   throw new Error();
  } catch {throw new Error('SLACK_AUTHORIZATIONS_FAILED');}
 }
}
