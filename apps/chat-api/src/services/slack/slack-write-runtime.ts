import type pg from 'pg';
import {canonicalSlackJson,type SlackExecutionSnapshot} from '@wap/executor';
import {validateSlackPostPlan,validateSlackSourceReplyPlan,validateSlackPolicyReference,validateSlackBinding,sameSlackBinding,slackPolicyRefToEpoch,type PlanStep,type PlanResponse} from '@wap/tool-schemas';
import type {SlackConnectionRepo} from '../../db/repositories/slack-connection-repo.js';
import type {PlanRepo} from '../../db/repositories/plan-repo.js';
import {SlackDerivedLineageRepo} from '../../db/repositories/slack-derived-lineage-repo.js';
import type {SlackPolicyService} from './policy-service.js';
import type {SlackTokenManager} from './token-manager.js';
import {SlackSafeWriter} from './slack-safe-writer.js';
import {SlackInvalidationService,acquireSlackInvalidationLocks,slackInvalidationLockKeys} from './slack-invalidation-service.js';
import {planOriginAllowed} from './slack-plan-origin.js';
import {guardPlanInTransaction} from './slack-plan-lineage.js';
import {isBoundSlackWritePlan,isBoundSlackSourceReplyPlan} from './slack-write-plan.js';
import {resolveCertifiedSourceReplyParams,slackWriteDenied,type SlackWriteInput} from '../../db/repositories/slack-write-outbox-repo.js';
interface Options {pool:pg.Pool;connections:SlackConnectionRepo;policy:SlackPolicyService;invalidation:SlackInvalidationService;plans:PlanRepo;tokens:SlackTokenManager;appId:string;apiBaseUrl:string;timeoutMs?:number}
const body=(s:SlackExecutionSnapshot)=>({kind:'plan',thinking:'',summary:'',warnings:[],steps:s.steps,connections:{myslack:s.bindings}});
export class SlackWriteRuntime {
 private writer:SlackSafeWriter;private lineage:SlackDerivedLineageRepo;
 constructor(private o:Options){
  this.lineage=new SlackDerivedLineageRepo(o.pool,o.policy);
  this.writer=new SlackSafeWriter({pool:o.pool,apiBaseUrl:o.apiBaseUrl,tokens:o.tokens,timeoutMs:o.timeoutMs,authorize:(i,c)=>this.authorize(i,c!)});
 }
 private async authorize(i:SlackWriteInput,c:pg.PoolClient){
  i.signal?.throwIfAborted();const row=(await c.query('SELECT * FROM plans WHERE id=$1',[i.planId])).rows[0];
  if(!row||row.plan_hash!==i.planHash)throw slackWriteDenied();
  const isManual=isBoundSlackWritePlan(row.plan_json,i.binding.atiUserId);
  const isSourceReply=!isManual&&isBoundSlackSourceReplyPlan(row.plan_json,i.binding.atiUserId);
  if(!isManual&&!isSourceReply)throw slackWriteDenied();
  const validated=isManual
   ?validateSlackPostPlan(row.plan_json,i.binding.atiUserId)
   :await resolveCertifiedSourceReplyParams(c,i.planId,row.plan_json,i.binding.atiUserId);
  const {binding,policyReference:ref}=validated;
  const expectedParams=isManual?(validated as ReturnType<typeof validateSlackPostPlan>).params:(validated as Awaited<ReturnType<typeof resolveCertifiedSourceReplyParams>>).resolvedParams;
  if(!sameSlackBinding(binding,i.binding)||canonicalSlackJson(expectedParams)!==canonicalSlackJson(i.params))throw slackWriteDenied();
  if(!isManual){
   const checked=await guardPlanInTransaction(c,this.lineage,i.planId,'planning');
   if(!checked.source||!checked.allowed||!checked.segments.some(s=>sameSlackBinding(s.sourceRef.binding,binding)))throw slackWriteDenied();
  }
  const keys=[...slackInvalidationLockKeys({barrierType:'binding',binding,reason:'manual_post'}),
   ...slackInvalidationLockKeys({barrierType:'epoch',epoch:slackPolicyRefToEpoch(ref),reason:'manual_post'}),
   ...slackInvalidationLockKeys({barrierType:'channel',binding,channelId:expectedParams.channel,reason:'manual_post'}),
   ...slackInvalidationLockKeys({barrierType:'resource',workspaceId:binding.workspaceId,resourceType:'conversation',resourceId:expectedParams.channel,reason:'manual_post'})];
  await acquireSlackInvalidationLocks(c,keys);
  await c.query('SELECT id FROM users WHERE id=$1 FOR SHARE',[binding.atiUserId]);
  const connection=(await c.query('SELECT * FROM slack_connections WHERE id=$1 FOR SHARE',[binding.connectionId])).rows[0];
  if(!this.scopes(connection,expectedParams.channel))throw slackWriteDenied();
  await c.query('SELECT id FROM slack_trusted_providers WHERE id=$1 FOR SHARE',[ref.providerProfileId]);
  await c.query('SELECT workspace_id FROM slack_processing_consents WHERE workspace_id=$1 AND provider_id=$2 FOR SHARE',[binding.workspaceId,ref.providerProfileId]);
  if(isManual){
   if(!await planOriginAllowed(c,'plans',row,binding.atiUserId))throw slackWriteDenied();
  }
  await this.policy(binding,ref,c);
  if((await this.o.invalidation.checkBarriers({binding,workspaceId:binding.workspaceId,channelId:expectedParams.channel,resourceType:'conversation',resourceId:expectedParams.channel,epoch:slackPolicyRefToEpoch(ref)},c)).blocked)throw slackWriteDenied();
  i.signal?.throwIfAborted();
 }
 private async policy(binding:any,ref:any,c?:pg.PoolClient){
  for(const purpose of ['planning','manual_lookup'] as const){
   const expected=validateSlackPolicyReference({...ref,purpose,requestedRetentionDays:purpose==='manual_lookup'?0:ref.requestedRetentionDays});
   if(!(await this.o.policy.resolveSlackModelPolicy({binding,purpose,requestedRetentionDays:expected.requestedRetentionDays,expectedPolicyReference:expected},c)).allowed)throw slackWriteDenied();
  }
 }
 private scopes(row:any,channel:string){const family=channel.startsWith('G')?'groups':channel.startsWith('D')?'im':'channels';return row?.app_id===this.o.appId&&row.scopes.includes('chat:write')&&row.scopes.includes(family+':read')&&row.scopes.includes(family+':history');}
 async propose(input:{userId:string;connectionId:string;channel:string;request:string}){
  const row=await this.o.connections.withOwner(input.userId,c=>this.o.connections.get(c,input.userId,input.connectionId));
  if(!row||row.status!=='active'||!this.scopes(row,input.channel))throw slackWriteDenied();
  const binding=validateSlackBinding({atiUserId:input.userId,connectionId:row.id,workspaceId:row.workspace_id,slackUserId:row.actor_id,identityVersion:row.identity_version});
  const d=await this.o.policy.resolveSlackModelPolicy({binding,purpose:'planning',requestedRetentionDays:0});if(!d.allowed)throw slackWriteDenied();const ref=validateSlackPolicyReference(d.policyReference);await this.policy(binding,ref);
  const response:PlanResponse={kind:'plan',thinking:'Yêu cầu gửi nội dung bạn nhập.',summary:'Gửi tin nhắn Slack sau khi duyệt',warnings:['Chỉ gửi sau khi bạn duyệt. Nếu chưa rõ kết quả, hãy đối soát trước khi tạo lần gửi khác.'],steps:[{id:'post',tool:'myslack.chat_postMessage',description:'Gửi tin nhắn bằng tài khoản Slack của bạn',args:{channel:input.channel,text:input.request},dependsOn:[]}],connections:{myslack:{bindings:{[row.id]:binding},steps:{post:{connectionId:row.id,tool:'myslack.chat_postMessage',dependencies:[],policyReference:ref}}}}};
  validateSlackPostPlan(response,input.userId);return {response,labels:{[row.id]:row.workspace_name+' · '+row.workspace_id+' · '+row.actor_id}};
 }
 async assertApproval(s:SlackExecutionSnapshot,signal?:AbortSignal){
  const planBody=body(s);
  const isManual=isBoundSlackWritePlan(planBody,s.userId);
  const validated=isManual?validateSlackPostPlan(planBody,s.userId):validateSlackSourceReplyPlan(planBody,s.userId);
  const {binding,policyReference:ref,params}=validated;signal?.throwIfAborted();
  const row=await this.o.connections.withOwner(s.userId,c=>this.o.connections.get(c,s.userId,binding.connectionId));
  if(!row||row.status!=='active'||!this.scopes(row,params.channel)||!sameSlackBinding(binding,{atiUserId:row.user_id,connectionId:row.id,workspaceId:row.workspace_id,slackUserId:row.actor_id,identityVersion:row.identity_version}))throw slackWriteDenied();
  await this.policy(binding,ref);if((await this.o.invalidation.checkBarriers({binding,epoch:slackPolicyRefToEpoch(ref),channelId:params.channel})).blocked)throw slackWriteDenied();signal?.throwIfAborted();
 }
 private async input(s:SlackExecutionSnapshot,stepId:string,signal?:AbortSignal):Promise<SlackWriteInput>{
  const planBody=body(s);
  if(isBoundSlackWritePlan(planBody,s.userId)){
   const {binding,step,params}=validateSlackPostPlan(planBody,s.userId);if(step.id!==stepId)throw slackWriteDenied();
   const row=await this.o.connections.withOwner(s.userId,c=>this.o.connections.get(c,s.userId,binding.connectionId));if(!row)throw slackWriteDenied();
   return {planId:s.planId,planHash:s.planHash,stepId,appId:this.o.appId,binding,params,signal};
  }
  const c=await this.o.pool.connect();
  let certified:Awaited<ReturnType<typeof resolveCertifiedSourceReplyParams>>;
  try{certified=await resolveCertifiedSourceReplyParams(c,s.planId,planBody,s.userId);}finally{c.release();}
  if(certified.step.id!==stepId)throw slackWriteDenied();
  const row=await this.o.connections.withOwner(s.userId,cl=>this.o.connections.get(cl,s.userId,certified.binding.connectionId));if(!row)throw slackWriteDenied();
  return {planId:s.planId,planHash:s.planHash,stepId,appId:this.o.appId,binding:certified.binding,params:certified.resolvedParams,signal};
 }
 async execute(s:SlackExecutionSnapshot,step:PlanStep,signal?:AbortSignal){
  const planBody=body(s);
  if(isBoundSlackWritePlan(planBody,s.userId)&&canonicalSlackJson(s.steps[0])!==canonicalSlackJson(step))throw slackWriteDenied();
  const resolvedInput=await this.input(s,step.id,signal);
  if(canonicalSlackJson(step.args)!==canonicalSlackJson(resolvedInput.params))throw slackWriteDenied();
  return this.writer.execute(resolvedInput);
 }
 async reconcile(s:SlackExecutionSnapshot,stepId:string,signal?:AbortSignal){return this.writer.reconcile(await this.input(s,stepId,signal));}
 async assertCompletion(s:SlackExecutionSnapshot,stepId:string,c:pg.PoolClient){
  const planBody=body(s);
  if(isBoundSlackWritePlan(planBody,s.userId)){
   const {binding,step,params}=validateSlackPostPlan(planBody,s.userId);if(step.id!==stepId)throw slackWriteDenied();
   await this.authorize({planId:s.planId,planHash:s.planHash,stepId,appId:this.o.appId,binding,params},c);
   return;
  }
  const certified=await resolveCertifiedSourceReplyParams(c,s.planId,planBody,s.userId);
  if(certified.step.id!==stepId)throw slackWriteDenied();
  await this.authorize({planId:s.planId,planHash:s.planHash,stepId,appId:this.o.appId,binding:certified.binding,params:certified.resolvedParams},c);
 }
}
