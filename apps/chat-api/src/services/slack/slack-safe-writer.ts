import type pg from 'pg';
import type {SlackTokenManager} from './token-manager.js';
import {SlackWriteOutboxRepo,normalizeSlackWrite,slackWriteDenied,slackWriteUnknown,type SlackWriteInput} from '../../db/repositories/slack-write-outbox-repo.js';
interface Options {pool:pg.Pool;apiBaseUrl:string;tokens:Pick<SlackTokenManager,'getAccessToken'>;authorize:(input:SlackWriteInput,client?:pg.PoolClient)=>Promise<void>;timeoutMs?:number;fetchFn?:typeof fetch}
const TS=/^[0-9]{1,10}\.[0-9]{6}$/;
/** Internal only until 03C2 supplies reviewed plan/source/policy callbacks. No automatic write retry. */
export class SlackSafeWriter {
 private repo:SlackWriteOutboxRepo;private endpoint:string;private timeout:number;
 constructor(private options:Options){
  this.repo=new SlackWriteOutboxRepo(options.pool);this.timeout=options.timeoutMs??8000;
  try{const u=new URL(options.apiBaseUrl);if(u.href!=='https://slack.com/api'&&!(u.protocol==='http:'&&['127.0.0.1','[::1]'].includes(u.hostname)&&!u.username&&!u.password&&!u.search&&!u.hash&&['/','/api'].includes(u.pathname)))throw new Error();this.endpoint=u.href.replace(/\/$/,'');
   if(!Number.isSafeInteger(this.timeout)||this.timeout<1||this.timeout>10000)throw new Error();
  }catch{throw slackWriteDenied();}
 }
 private async call(method:string,params:Record<string,unknown>,token:string,signal?:AbortSignal):Promise<any>{
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(this.timeout)]):AbortSignal.timeout(this.timeout);
  combined.throwIfAborted();
  const response=await (this.options.fetchFn??fetch)(this.endpoint+'/'+method,{method:'POST',redirect:'error',signal:combined,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(params)});
  const reader=response.body?.getReader();if(!reader)throw new Error();const chunks:Uint8Array[]=[];let bytes=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>262144)throw new Error();chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  combined.throwIfAborted();const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!response.ok||data?.ok!==true)throw new Error();return data;
 }
 private result(row:any,ts=row.provider_ts){return {operationId:row.operation_id,status:'confirmed' as const,channel:row.channel_id,ts};}
 private async ready(c:pg.PoolClient,i:SlackWriteInput,readOnly=false){
  try{await this.repo.transaction(c,async()=>{await this.options.authorize(i,c);await this.repo.authority(c,i,readOnly);i.signal?.throwIfAborted();});}
  catch{throw slackWriteDenied();}
 }
 private async access(i:SlackWriteInput){try{return await this.options.tokens.getAccessToken(i.binding.atiUserId,i.binding.connectionId,i.binding.identityVersion);}catch{throw slackWriteDenied();}}
 private async membership(c:pg.PoolClient,i:SlackWriteInput,token:string,readOnly=false){
  try{await this.ready(c,i,readOnly);const data=await this.call('conversations.info',{channel:i.params.channel},token,i.signal);
   if(data.channel?.id!==i.params.channel||data.channel.is_member!==true||data.channel.is_archived===true)throw new Error();await this.ready(c,i,readOnly);
  }catch{throw slackWriteDenied();}
 }
 async execute(value:SlackWriteInput){
  let dispatched=false;
  try{return await this.executeGuarded(value,()=>{dispatched=true;});}catch(e){if(dispatched||(e as any)?.category==='UNKNOWN')throw slackWriteUnknown();throw slackWriteDenied();}
 }
 private async executeGuarded(value:SlackWriteInput,onDispatch:()=>void){
  const i=normalizeSlackWrite(structuredClone({...value,signal:undefined}));i.signal=value.signal;
  // Validate approval before token acquisition (which may itself exchange a rotating token).
  await this.repo.withOwner(i,c=>this.ready(c,i));
  const token=await this.access(i);
  return this.repo.withOwner(i,async c=>{
   await this.ready(c,i);let row=await this.repo.lookup(c,i);
   if(row&&row.status!=='prepared'){onDispatch();if(row.status==='confirmed')return this.result(row);throw slackWriteUnknown();}
   await this.membership(c,i,token);
   row=await this.repo.transaction(c,async()=>{await this.options.authorize(i,c);await this.repo.authority(c,i);return this.repo.prepare(c,i);});
   row=await this.repo.transaction(c,async()=>{await this.options.authorize(i,c);await this.repo.authority(c,i);i.signal?.throwIfAborted();const attempt=await this.repo.dispatch(c,row);
    // Mark before COMMIT: a lost COMMIT acknowledgement is also ambiguous.
    onDispatch();return attempt;});
   try{
    const data=await this.call('chat.postMessage',{...i.params,client_msg_id:row.client_msg_id,parse:'none',link_names:false,unfurl_links:false,unfurl_media:false},token,i.signal);
    if(data.channel!==i.params.channel||typeof data.ts!=='string'||!TS.test(data.ts)||data.message?.user!==i.binding.slackUserId||
       (data.message?.client_msg_id!==undefined&&data.message.client_msg_id!==row.client_msg_id))throw new Error();
    await this.repo.receipt(c,row,data.ts);row.provider_ts=data.ts;
    return await this.readback(c,i,row,token);
   }catch{await this.repo.unknown(c,row).catch(()=>{});throw slackWriteUnknown();}
  });
 }
 private async readback(c:pg.PoolClient,i:SlackWriteInput,row:any,token:string){
  await this.membership(c,i,token,true);let cursor:string|undefined;const seen=new Set<string>(),matches:any[]=[];
  for(let page=0;page<5;page++){
   await this.ready(c,i,true);
   const data=await this.call('conversations.history',{channel:i.params.channel,limit:100,...(cursor?{cursor}:{})},token,i.signal);
   await this.ready(c,i,true);
   if(!Array.isArray(data.messages)||data.messages.length>100||typeof data.has_more!=='boolean')throw new Error();
   // Validate every entry, including nonmatching ones. A partial/malformed page
   // cannot serve as successful evidence merely because one match looks valid.
   const id=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(v);
   for(const m of data.messages)if(!m||typeof m!=='object'||Array.isArray(m)||typeof m.ts!=='string'||!TS.test(m.ts)||typeof m.text!=='string'||
     (m.type!==undefined&&m.type!=='message')||(!id(m.user)&&!id(m.bot_id))||(m.user!==undefined&&!id(m.user))||
     (m.client_msg_id!==undefined&&(typeof m.client_msg_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.client_msg_id))))throw new Error();
   for(const m of data.messages){if(m.user===i.binding.slackUserId&&m.text===i.params.text&&
      (row.provider_ts?m.ts===row.provider_ts:m.client_msg_id===row.client_msg_id))matches.push(m);}
   const next=data.response_metadata?.next_cursor??'';if(typeof next!=='string'||next.length>2048||seen.has(next))throw new Error();
   if(!next){if(data.has_more)throw new Error();break;}if(!data.has_more||page===4)throw new Error();seen.add(next);cursor=next;
  }
  if(matches.length!==1)throw new Error();await this.ready(c,i,true);i.signal?.throwIfAborted();await this.repo.confirm(c,row,matches[0].ts);return this.result(row,matches[0].ts);
 }
 async reconcile(value:SlackWriteInput){
  let dispatched=false;
  try{return await this.reconcileGuarded(value,()=>{dispatched=true;});}catch(e){if(dispatched||(e as any)?.category==='UNKNOWN')throw slackWriteUnknown();throw slackWriteDenied();}
 }
 private async reconcileGuarded(value:SlackWriteInput,onDispatch:()=>void){
  const i=normalizeSlackWrite(structuredClone({...value,signal:undefined}));i.signal=value.signal;
  await this.repo.withOwner(i,c=>this.ready(c,i,true));const token=await this.access(i);
  return this.repo.withOwner(i,async c=>{await this.ready(c,i,true);const row=await this.repo.lookup(c,i);if(!row||row.status==='prepared')throw slackWriteDenied();onDispatch();if(row.status==='confirmed')return this.result(row);
   try{return await this.readback(c,i,row,token);}catch{await this.repo.unknown(c,row).catch(()=>{});throw slackWriteUnknown();}
  });
 }
}
