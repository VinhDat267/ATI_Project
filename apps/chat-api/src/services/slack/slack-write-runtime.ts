import type pg from 'pg';
import {canonicalSlackJson,type SlackExecutionSnapshot} from '@wap/executor';
import {validateSlackPostPlan,validateSlackPolicyReference,validateSlackBinding,sameSlackBinding,slackPolicyRefToEpoch,type PlanStep,type PlanResponse} from '@wap/tool-schemas';
import type {SlackConnectionRepo} from '../../db/repositories/slack-connection-repo.js';
import type {PlanRepo} from '../../db/repositories/plan-repo.js';
import type {SlackPolicyService} from './policy-service.js';
import type {SlackTokenManager} from './token-manager.js';
import {SlackSafeWriter} from './slack-safe-writer.js';
import {SlackInvalidationService,acquireSlackInvalidationLocks,slackInvalidationLockKeys} from './slack-invalidation-service.js';
import {planOriginAllowed} from './slack-plan-origin.js';
import {isBoundSlackWritePlan} from './slack-write-plan.js';
import {slackWriteDenied,type SlackWriteInput} from '../../db/repositories/slack-write-outbox-repo.js';
interface Options {pool:pg.Pool;connections:SlackConnectionRepo;policy:SlackPolicyService;invalidation:SlackInvalidationService;plans:PlanRepo;tokens:SlackTokenManager;appId:string;apiBaseUrl:string;timeoutMs?:number}
const body=(s:SlackExecutionSnapshot)=>({kind:'plan',thinking:'',summary:'',warnings:[],steps:s.steps,connections:{myslack:s.bindings}});
export class SlackWriteRuntime {
 private writer:SlackSafeWriter;
 constructor(private o:Options){this.writer=new SlackSafeWriter({pool:o.pool,apiBaseUrl:o.apiBaseUrl,tokens:o.tokens,timeoutMs:o.timeoutMs,authorize:(i,c)=>this.authorize(i,c!)});}
 private async authorize(i:SlackWriteInput,c:pg.PoolClient){
  i.signal?.throwIfAborted();const row=(await c.query('SELECT * FROM plans WHERE id=$1',[i.planId])).rows[0];
  if(!row||row.plan_hash!==i.planHash||!isBoundSlackWritePlan(row.plan_json,i.binding.atiUserId))throw slackWriteDenied();
  const {binding,policyReference:ref,params}=validateSlackPostPlan(row.plan_json,i.binding.atiUserId);
  if(!sameSlackBinding(binding,i.binding)||canonicalSlackJson(params)!==canonicalSlackJson(i.params))throw slackWriteDenied();
  const keys=[...slackInvalidationLockKeys({barrierType:'binding',binding,reason:'manual_post'}),
   ...slackInvalidationLockKeys({barrierType:'epoch',epoch:slackPolicyRefToEpoch(ref),reason:'manual_post'}),
   ...slackInvalidationLockKeys({barrierType:'channel',binding,channelId:params.channel,reason:'manual_post'}),
   ...slackInvalidationLockKeys({barrierType:'resource',workspaceId:binding.workspaceId,resourceType:'conversation',resourceId:params.channel,reason:'manual_post'})];
  await acquireSlackInvalidationLocks(c,keys);
  await c.query('SELECT id FROM users WHERE id=$1 FOR SHARE',[binding.atiUserId]);
  const connection=(await c.query('SELECT * FROM slack_connections WHERE id=$1 FOR SHARE',[binding.connectionId])).rows[0];
  if(!this.scopes(connection,params.channel))throw slackWriteDenied();
  await c.query('SELECT id FROM slack_trusted_providers WHERE id=$1 FOR SHARE',[ref.providerProfileId]);
  await c.query('SELECT workspace_id FROM slack_processing_consents WHERE workspace_id=$1 AND provider_id=$2 FOR SHARE',[binding.workspaceId,ref.providerProfileId]);
  if(!await planOriginAllowed(c,'plans',row,binding.atiUserId))throw slackWriteDenied();
  await this.policy(binding,ref,c);
  if((await this.o.invalidation.checkBarriers({binding,workspaceId:binding.workspaceId,channelId:params.channel,resourceType:'conversation',resourceId:params.channel,epoch:slackPolicyRefToEpoch(ref)},c)).blocked)throw slackWriteDenied();
  i.signal?.throwIfAborted();
 }
 private async policy(binding:any,ref:any,c?:pg.PoolClient){
  for(const purpose of ['planning','manual_lookup'] as const){const expected=validateSlackPolicyReference({...ref,purpose});if(!(await this.o.policy.resolveSlackModelPolicy({binding,purpose,requestedRetentionDays:0,expectedPolicyReference:expected},c)).allowed)throw slackWriteDenied();}
 }
 private scopes(row:any,channel:string){const family=channel.startsWith('G')?'groups':'channels';return row?.app_id===this.o.appId&&row.scopes.includes('chat:write')&&row.scopes.includes(family+':read')&&row.scopes.includes(family+':history');}
 async propose(input:{userId:string;connectionId:string;channel:string;request:string}){
  const row=await this.o.connections.withOwner(input.userId,c=>this.o.connections.get(c,input.userId,input.connectionId));
  if(!row||row.status!=='active'||!this.scopes(row,input.channel))throw slackWriteDenied();
  const binding=validateSlackBinding({atiUserId:input.userId,connectionId:row.id,workspaceId:row.workspace_id,slackUserId:row.actor_id,identityVersion:row.identity_version});
  const d=await this.o.policy.resolveSlackModelPolicy({binding,purpose:'planning',requestedRetentionDays:0});if(!d.allowed)throw slackWriteDenied();const ref=validateSlackPolicyReference(d.policyReference);await this.policy(binding,ref);
  const response:PlanResponse={kind:'plan',thinking:'Yêu cầu gửi nội dung bạn nhập.',summary:'Gửi tin nhắn Slack sau khi duyệt',warnings:['Chỉ gửi sau khi bạn duyệt. Nếu chưa rõ kết quả, hãy đối soát trước khi tạo lần gửi khác.'],steps:[{id:'post',tool:'myslack.chat_postMessage',description:'Gửi tin nhắn bằng tài khoản Slack của bạn',args:{channel:input.channel,text:input.request},dependsOn:[]}],connections:{myslack:{bindings:{[row.id]:binding},steps:{post:{connectionId:row.id,tool:'myslack.chat_postMessage',dependencies:[],policyReference:ref}}}}};
  validateSlackPostPlan(response,input.userId);return {response,labels:{[row.id]:row.workspace_name+' · '+row.workspace_id+' · '+row.actor_id}};
 }
 async assertApproval(s:SlackExecutionSnapshot,signal?:AbortSignal){
  const {binding,policyReference:ref,params}=validateSlackPostPlan(body(s),s.userId);signal?.throwIfAborted();
  const row=await this.o.connections.withOwner(s.userId,c=>this.o.connections.get(c,s.userId,binding.connectionId));
  if(!row||row.status!=='active'||!this.scopes(row,params.channel)||!sameSlackBinding(binding,{atiUserId:row.user_id,connectionId:row.id,workspaceId:row.workspace_id,slackUserId:row.actor_id,identityVersion:row.identity_version}))throw slackWriteDenied();
  await this.policy(binding,ref);if((await this.o.invalidation.checkBarriers({binding,epoch:slackPolicyRefToEpoch(ref),channelId:params.channel})).blocked)throw slackWriteDenied();signal?.throwIfAborted();
 }
 private async input(s:SlackExecutionSnapshot,stepId:string,signal?:AbortSignal):Promise<SlackWriteInput>{
  const {binding,step,params}=validateSlackPostPlan(body(s),s.userId);if(step.id!==stepId)throw slackWriteDenied();
  const row=await this.o.connections.withOwner(s.userId,c=>this.o.connections.get(c,s.userId,binding.connectionId));if(!row)throw slackWriteDenied();
  return {planId:s.planId,planHash:s.planHash,stepId,appId:this.o.appId,binding,params,signal};
 }
 async execute(s:SlackExecutionSnapshot,step:PlanStep,signal?:AbortSignal){if(canonicalSlackJson(s.steps[0])!==canonicalSlackJson(step))throw slackWriteDenied();return this.writer.execute(await this.input(s,step.id,signal));}
 async reconcile(s:SlackExecutionSnapshot,stepId:string,signal?:AbortSignal){return this.writer.reconcile(await this.input(s,stepId,signal));}
}
