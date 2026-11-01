import {readFileSync} from 'node:fs';
import {validateSlackBinding,validateSlackTriageDecision,type SlackBinding,type SlackTriageDecision} from '@wap/tool-schemas';
import type {LLMProvider} from './types.js';
export interface SlackTriageMessage {text:string;user?:string;ts:string;channelId:string;threadTs?:string;conversationType:'public'|'private'|'im'|'mpim';isTrigger?:boolean;followedThread?:boolean}
export interface SlackTriageInput {binding:SlackBinding;context:SlackTriageMessage[];truncated:boolean;signal?:AbortSignal;maxOutputTokens:number;beforeModelAttempt:(signal:AbortSignal,reservedTokens:number)=>Promise<void>}
const gateCodes=['SLACK_BUDGET_HELD','SLACK_ASSISTANT_CONFIG_CHANGED','SLACK_POLICY_DENIED','SLACK_TRIAGE_LEASE_LOST','SLACK_MODEL_ABORTED'] as const;
export class SlackModelGateError extends Error {
 readonly code:typeof gateCodes[number];
 constructor(code:typeof gateCodes[number]){super(gateCodes.includes(code)?code:'SLACK_POLICY_DENIED');this.name='SlackModelGateError';this.code=gateCodes.includes(code)?code:'SLACK_POLICY_DENIED';}
}
const prompt=readFileSync(new URL('../../../prompts/slack-triage.prompt.txt',import.meta.url),'utf8');
/** The classifier has no tools or write authority. Transport retries share a mandatory private gate. */
export class SlackTriagePlanner {
 constructor(private readonly provider:LLMProvider){}
 reportedTokens():number|null{
  const u=this.provider.lastCallMetrics?.usage;let total=u?.totalTokens;
  if(total==null&&this.provider.name==='openai-compatible'&&u?.promptTokens!=null&&u.completionTokens!=null)total=u.promptTokens+u.completionTokens;
  return typeof total==='number'&&Number.isSafeInteger(total)&&total>=0&&total<=1000000000?total:null;
 }
 async classify(input:SlackTriageInput):Promise<SlackTriageDecision>{
  if(!this.provider.supportsModelBudget)throw new Error('SLACK_MODEL_BUDGET_UNSUPPORTED');
  let binding:SlackBinding;try{binding=validateSlackBinding(input.binding);}catch{throw new Error('SLACK_MODEL_INPUT_INVALID');}
  if(!Array.isArray(input.context)||input.context.length<1||input.context.length>20||input.context.some(m=>typeof m.text!=='string'||m.text.includes('\u0000')||!/^\d{1,10}(?:\.\d{1,6})?$/.test(m.ts)||!/^[A-Za-z0-9_-]{1,64}$/.test(m.channelId)||!['public','private','im','mpim'].includes(m.conversationType))||input.context.reduce((n,m)=>n+m.text.length,0)>20000||!Number.isSafeInteger(input.maxOutputTokens)||input.maxOutputTokens<256||input.maxOutputTokens>4096||typeof input.beforeModelAttempt!=='function'||typeof input.truncated!=='boolean')throw new Error('SLACK_MODEL_INPUT_INVALID');
  input.signal?.throwIfAborted();
  const content=JSON.stringify({ownerSlackUserId:binding.slackUserId,truncated:input.truncated,messages:input.context.map((m,index)=>({index,text:m.text,user:m.user,ts:m.ts,channelId:m.channelId,threadTs:m.threadTs,conversationType:m.conversationType,isTrigger:m.isTrigger===true,followedThread:m.followedThread===true}))});
  const reservedTokens=Buffer.byteLength(prompt+content,'utf8')+input.maxOutputTokens+8192;
  let raw:string;
  try{raw=await this.provider.generatePlan({systemPrompt:prompt,conversationHistory:[{role:'user',content}],toolCatalog:[],workingMemory:{},signal:input.signal,maxOutputTokens:input.maxOutputTokens,beforeModelAttempt:signal=>input.beforeModelAttempt(signal,reservedTokens)});}
  catch(e){if(e instanceof SlackModelGateError)throw e;if(input.signal?.aborted)throw new SlackModelGateError('SLACK_MODEL_ABORTED');throw new Error('SLACK_MODEL_FAILED');}
  input.signal?.throwIfAborted();
  try{return validateSlackTriageDecision(JSON.parse(raw),input.context.length);}catch{throw new Error('SLACK_MODEL_INVALID');}
 }
}
