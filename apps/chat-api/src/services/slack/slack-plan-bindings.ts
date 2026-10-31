import {deriveSlackDependencySelectors,validateSlackPlanBindings,validateSlackPolicyReference,MYSLACK_CORE_READ_TOOLS,sameSlackBinding,slackPolicyRefToEpoch,type PlanStep,type SlackPlanBindings,type SlackBinding} from '@wap/tool-schemas';
import type {SlackConnectionRepo} from '../../db/repositories/slack-connection-repo.js';
import type {SlackPolicyService} from './policy-service.js';
import type {SlackInvalidationService} from './slack-invalidation-service.js';
export interface SlackReadAssignment {stepId:string;connectionId:string}
export class SlackReadPlanBindings{
 constructor(private connections:SlackConnectionRepo,private policy:SlackPolicyService,private invalidation:SlackInvalidationService){}
 async resolve(userId:string,steps:PlanStep[],assignments:SlackReadAssignment[],signal?:AbortSignal):Promise<SlackPlanBindings>{
  if(!steps.length||assignments.length!==steps.length||new Set(assignments.map(a=>a.stepId)).size!==steps.length||
    assignments.some(a=>!steps.some(s=>s.id===a.stepId)||Object.keys(a).some(k=>!['stepId','connectionId'].includes(k))))throw new Error('SLACK_SELECTION_REQUIRED');
  const result:SlackPlanBindings={bindings:{},steps:{}};
  for(const step of steps){
   signal?.throwIfAborted();const assignment=assignments.find(a=>a.stepId===step.id)!;
   const row=await this.connections.withOwner(userId,c=>this.connections.get(c,userId,assignment.connectionId));
   const tool=MYSLACK_CORE_READ_TOOLS.find(t=>t.name===step.tool);
   if(!row||row.status!=='active'||!tool||!(tool.userScopes??[]).some(s=>row.scopes.includes(s)))throw new Error('SLACK_READ_UNAVAILABLE');
   const binding:SlackBinding={atiUserId:userId,connectionId:row.id,workspaceId:row.workspace_id,slackUserId:row.actor_id,identityVersion:row.identity_version};
   const decision=await this.policy.resolveSlackModelPolicy({binding,purpose:'planning',requestedRetentionDays:0});
   if(!decision.allowed)throw new Error('SLACK_READ_POLICY_DENIED');
   result.bindings[row.id]=binding;result.steps[step.id]={connectionId:row.id,tool:step.tool,dependencies:deriveSlackDependencySelectors(step.args,steps),policyReference:validateSlackPolicyReference(decision.policyReference)};
  }
  await this.assert(userId,steps,result,signal);return validateSlackPlanBindings(result,steps);
 }
 async assert(userId:string,steps:PlanStep[],value:unknown,signal?:AbortSignal):Promise<void>{
  const current=validateSlackPlanBindings(value,steps);
  for(const step of steps){
   signal?.throwIfAborted();const record=current.steps[step.id]!,binding=current.bindings[record.connectionId]!,tool=MYSLACK_CORE_READ_TOOLS.find(t=>t.name===step.tool)!;
   if(binding.atiUserId!==userId)throw new Error('SLACK_READ_IDENTITY_MISMATCH');
   const row=await this.connections.withOwner(userId,c=>this.connections.get(c,userId,binding.connectionId));
   if(!row||row.status!=='active'||!sameSlackBinding(binding,{atiUserId:row.user_id,connectionId:row.id,workspaceId:row.workspace_id,slackUserId:row.actor_id,identityVersion:row.identity_version})||
      !(tool.userScopes??[]).some(s=>row.scopes.includes(s)))throw new Error('SLACK_READ_UNAVAILABLE');
   const d=await this.policy.resolveSlackModelPolicy({binding,purpose:'planning',requestedRetentionDays:0,expectedPolicyReference:record.policyReference});
   if(!d.allowed)throw new Error('SLACK_READ_POLICY_DENIED');
   if((await this.invalidation.checkBarriers({binding,workspaceId:binding.workspaceId,epoch:slackPolicyRefToEpoch(record.policyReference)})).blocked)throw new Error('SLACK_READ_BARRIERED');
  }
  signal?.throwIfAborted();
 }
}
