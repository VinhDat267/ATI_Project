import {canonicalSlackJson} from '@wap/executor';
import {SlackModelGateError,type SlackTriagePlanner,type SlackTriageMessage} from '@wap/planner';
import {sameSlackPolicyEpoch,slackPolicyRefToEpoch,validateSlackPolicyReference,type SlackTriageDecision} from '@wap/tool-schemas';
import type {SlackAssistantRepo,SlackTriageLease} from '../../db/repositories/slack-assistant-repo.js';
import type {DerivedSegmentInput} from '../../db/repositories/slack-derived-lineage-repo.js';
import type {SlackPrivateReadWrapper} from './slack-private-read-wrapper.js';
import type {SlackPolicyService} from './policy-service.js';
import {compareSlackRevisions} from './slack-invalidation-service.js';
import {slackPersonalRelevance,evaluateSlackRules} from './slack-rules-engine.js';
interface Options {repo:SlackAssistantRepo;wrapper:SlackPrivateReadWrapper;policy:SlackPolicyService;planner:SlackTriagePlanner;workerId:string;deadlineMs?:number}
/** Fetches private content afresh; signed ingress never supplies a body to rules or the model. */
export class SlackTriageWorker {
 constructor(private readonly options:Options){}
 async runOnce(limit=5,signal?:AbortSignal):Promise<{claimed:number;applied:number;retried:number}>{
  const stats={claimed:0,applied:0,retried:0};if(signal?.aborted)return stats;
  const leases=await this.options.repo.claim(limit,this.options.workerId,signal);stats.claimed=leases.length;
  for(const lease of leases){
   if(signal?.aborted)break;
   const combined=AbortSignal.any([AbortSignal.timeout(this.options.deadlineMs??30000),...(signal?[signal]:[])]);
   try{
    const {context,segments,truncated}=await this.readContext(lease,combined);
    let decision:SlackTriageDecision={kind:'no_action'};
    const rules=context.map((m,index)=>({index,result:evaluateSlackRules(lease.config.rules,{slackUserId:lease.binding.slackUserId,conversationType:m.conversationType,followedThread:m.followedThread===true,message:{text:m.text,user:m.user,ts:m.ts,threadTs:m.threadTs}})})).filter(({index,result})=>context[index]!.isTrigger&&result.kind==='proposal');
    if(lease.config.mode==='rules'){
     const first=rules[0];if(first&&first.result.kind==='proposal'){const m=context[first.index]!,result=first.result;
      decision={kind:'proposal',title:(result.intent.summary||m.text).slice(0,160),rationale:'Khớp luật cá nhân đã bật.',sourceIndices:[first.index],relevance:{...result.relevance,sourceIndex:first.index},intents:[{...result.intent,summary:(result.intent.summary||m.text).slice(0,2000)}]};
     }
    }else if(lease.config.mode==='ai'||rules.length){
     try{decision=await this.options.planner.classify({binding:lease.binding,context,truncated,signal:combined,maxOutputTokens:lease.config.budget.maxOutputTokens,
      beforeModelAttempt:async(attemptSignal,reserved)=>{try{await this.options.repo.reserveAttempt(lease,reserved,attemptSignal,segments);}catch(e){const code=e instanceof Error?e.message:'';throw new SlackModelGateError(code==='SLACK_BUDGET_HELD'||code==='SLACK_ASSISTANT_CONFIG_CHANGED'||code==='SLACK_TRIAGE_LEASE_LOST'?code:'SLACK_POLICY_DENIED');}}});}finally{await this.options.repo.recordReportedUsage(lease,this.options.planner.reportedTokens());}
     if(decision.kind!=='no_action'){
      const candidate=decision;
      const proofs=candidate.sourceIndices.filter(index=>context[index]?.isTrigger).map(index=>({index,proof:slackPersonalRelevance({slackUserId:lease.binding.slackUserId,conversationType:context[index]!.conversationType,followedThread:context[index]!.followedThread===true,message:context[index]!})})).filter(p=>p.proof);
      const found=proofs.find(p=>p.index===candidate.relevance.sourceIndex)??proofs[0];
      decision=found?{...candidate,relevance:{...found.proof!,sourceIndex:found.index}}:{kind:'no_action'};
     }
    }
    combined.throwIfAborted();const result=await this.options.repo.publish(lease,decision,segments,combined,context,truncated);if(result.status==='published')stats.applied++;else stats.retried++;
   }catch(e){
    const code=e instanceof SlackModelGateError?e.code:e instanceof Error?e.message:'';
    if(code!=='SLACK_BUDGET_HELD')try{await this.options.repo.hold(lease,code.startsWith('SLACK_MODEL')?'model_failed':code==='SLACK_CONTEXT_LIMIT'?'context_limit':'source_unavailable');}catch{/* A revoked/expired lease cannot mutate current work. */}
    stats.retried++;
   }
  }return stats;
 }
 private async readContext(lease:SlackTriageLease,signal:AbortSignal):Promise<{context:SlackTriageMessage[];segments:DerivedSegmentInput[];truncated:boolean}>{
  const repo=this.options.repo,b=lease.binding,triggers=lease.triggers,first=triggers[0];if(!first||triggers.length>20)throw new Error('SLACK_SOURCE_UNAVAILABLE');
  await repo.assertCurrent(lease,signal);
  const observations:any[]=[];
  const read=async(tool:string,params:Record<string,unknown>)=>{
   await repo.assertCurrent(lease,signal);
   const result=await this.options.wrapper.executeRead({callerAtiUserId:b.atiUserId,binding:b,tool,params,purpose:'triage',signal});
   const ref=validateSlackPolicyReference(result.policyReference);
   if(!sameSlackPolicyEpoch(slackPolicyRefToEpoch(ref),slackPolicyRefToEpoch(lease.policyReference)))throw new Error('SLACK_POLICY_DENIED');
   await repo.assertCurrent(lease,signal);return result.data as any;
  };
  const info=await read('myslack.conversations_info',{channel:first.channelId});observations.push(info.channel);
  const kind=info.channel.is_im?'im':info.channel.is_mpim?'mpim':info.channel.is_private?'private':'public';
  const ordered=[...triggers].sort((a,z)=>compareSlackRevisions(a.messageTs,z.messageTs)),oldest=ordered[0]!.messageTs,latest=ordered.at(-1)!.messageTs;
  const threaded=triggers.some(t=>t.threadTs!==t.messageTs);
  const data=await read(threaded?'myslack.conversations_replies':'myslack.conversations_history',threaded?{channel:first.channelId,ts:first.threadTs,oldest,latest,inclusive:true,limit:20}:{channel:first.channelId,latest,inclusive:true,limit:20});
  let values:any[]=Array.isArray(data.messages)?data.messages:[];
  values=values.filter(m=>compareSlackRevisions(m.ts,latest)<=0);
  for(const trigger of triggers)if(!values.some(m=>m.ts===trigger.messageTs))throw new Error('SLACK_SOURCE_UNAVAILABLE');
  let truncated=!!data.has_more||!!data.response_metadata?.next_cursor;
  if(threaded&&values.length<20&&!values.some(m=>m.ts===first.threadTs)){
   const root=await read('myslack.conversations_replies',{channel:first.channelId,ts:first.threadTs,oldest:first.threadTs,latest:first.threadTs,inclusive:true,limit:1});
   const message=(root.messages??[]).find((m:any)=>m.ts===first.threadTs);if(message)values=[message,...values];else truncated=true;
  }
  if(threaded&&!values.some(m=>m.ts===first.threadTs))truncated=true;
  values=[...new Map(values.map(m=>[m.ts,m])).values()].sort((a,z)=>compareSlackRevisions(a.ts,z.ts));
  const required=values.filter(m=>triggers.some(t=>t.messageTs===m.ts));
  const extra=values.filter(m=>!triggers.some(t=>t.messageTs===m.ts));
  const selected=[...required,...extra.slice(-(20-required.length))].slice(0,20).sort((a,z)=>compareSlackRevisions(a.ts,z.ts));
  if(selected.length<values.length)truncated=true;
  if(selected.some(m=>typeof m.text!=='string')||selected.reduce((n,m)=>n+m.text.length,0)>20000)throw new Error('SLACK_CONTEXT_LIMIT');
  observations.push(...selected);
  const storageRef={...lease.policyReference,purpose:'storage' as const,requestedRetentionDays:lease.config.retentionDays};
  const storage=await this.options.policy.resolveSlackModelPolicy({binding:b,purpose:'storage',requestedRetentionDays:lease.config.retentionDays,expectedPolicyReference:storageRef});if(!storage.allowed)throw new Error('SLACK_POLICY_DENIED');
  const segments:DerivedSegmentInput[]=observations.map(value=>{
   const p=value?.provenance,id=p?.resourceIdentity,ref=validateSlackPolicyReference(p?.acquisitionPolicyReference);
   if(canonicalSlackJson(ref)!==canonicalSlackJson(lease.policyReference)||!id||!/^[a-f0-9]{64}$/.test(p.observationalDigest))throw new Error('SLACK_SOURCE_UNAVAILABLE');
   const message=id.type==='message';if(!message&&id.type!=='conversation')throw new Error('SLACK_SOURCE_UNAVAILABLE');
   return {sourceRef:{binding:b,resourceType:message?'message':'conversation',resourceId:message?JSON.stringify([id.channelId,id.messageTs]):id.channelId,revision:p.nativeRevision??p.observationalDigest},acquisitionPolicyRef:ref,storagePolicyRef:validateSlackPolicyReference(storage.policyReference),captureHash:p.observationalDigest,capturedAt:p.observedAt,channelId:first.channelId};
  });
  const context:SlackTriageMessage[]=await Promise.all(selected.map(async m=>{
   const trigger=triggers.find(t=>t.messageTs===m.ts);return {text:m.text,user:m.user,ts:m.ts,channelId:first.channelId,...(m.thread_ts?{threadTs:m.thread_ts}:{}),conversationType:kind,isTrigger:!!trigger,followedThread:trigger?await repo.isFollowed(lease,trigger):false};
  }));
  await repo.assertCurrent(lease,signal,segments);return {context,segments,truncated};
 }
}
