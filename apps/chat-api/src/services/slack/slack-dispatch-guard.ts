import {canonicalSlackJson,computeSlackExecutionDigest,slackDigestInput,deriveSlackDispatchSources,resolveArgs,type SlackDispatchGuard,type SlackExecutionSnapshot} from '@wap/executor';
import {MYSLACK_CORE_READ_TOOLS,validateSlackToolExecutionArgs,slackPolicyRefToEpoch} from '@wap/tool-schemas';
import type {PlanRepo} from '../../db/repositories/plan-repo.js';
import type {SlackReadPlanBindings} from './slack-plan-bindings.js';
import type {SlackPolicyService} from './policy-service.js';
import type {SlackInvalidationService,CheckBarriersQuery} from './slack-invalidation-service.js';
export function createSlackDispatchGuard(options:{snapshot:SlackExecutionSnapshot;binder:SlackReadPlanBindings;plans:PlanRepo;policy:SlackPolicyService;invalidation:SlackInvalidationService}):SlackDispatchGuard{
 const snapshot=structuredClone(options.snapshot);
 return {authorize:async({envelope,signal})=>{
  signal.throwIfAborted();
  if(computeSlackExecutionDigest(slackDigestInput(envelope))!==envelope.digest||envelope.planId!==snapshot.planId||envelope.planHash!==snapshot.planHash)throw new Error('SLACK_ENVELOPE_MISMATCH');
  await options.plans.assertSourceDispatchAllowed(snapshot.planId,snapshot.userId,snapshot.planHash,envelope.stepId,envelope.tool,signal);
  const saved=await options.plans.getSourceExecutionSnapshot(snapshot.planId),step=snapshot.steps.find(s=>s.id===envelope.stepId),record=snapshot.bindings.steps[envelope.stepId];
  if(!step||step.tool!==envelope.tool||!record||canonicalSlackJson(saved.plan.plan_json.connections?.myslack)!==canonicalSlackJson(snapshot.bindings)||
     canonicalSlackJson(envelope.binding)!==canonicalSlackJson(snapshot.bindings.bindings[record.connectionId])||canonicalSlackJson(envelope.policyReference)!==canonicalSlackJson(record.policyReference))throw new Error('SLACK_ENVELOPE_MISMATCH');
  const outputs=new Map(saved.steps.filter(s=>s.status==='succeeded').map(s=>[s.step_id,s.output_json]));
  const expected=validateSlackToolExecutionArgs(MYSLACK_CORE_READ_TOOLS.find(t=>t.name===step.tool)!,{binding:envelope.binding,params:resolveArgs(step.args,outputs)}).params;
  if(canonicalSlackJson(expected)!==canonicalSlackJson(envelope.params)||canonicalSlackJson(deriveSlackDispatchSources(record.dependencies,outputs,snapshot))!==canonicalSlackJson(envelope.sources))throw new Error('SLACK_SOURCE_UNVERIFIED');
  await options.binder.assert(snapshot.userId,snapshot.steps,snapshot.bindings,signal);
  const checks:CheckBarriersQuery[]=[{binding:envelope.binding,workspaceId:envelope.binding.workspaceId,epoch:slackPolicyRefToEpoch(envelope.policyReference)}];
  const params=envelope.params;
  if(typeof params.channel==='string')checks.push({...checks[0],channelId:params.channel,resourceType:'conversation',resourceId:params.channel});
  if(typeof params.user==='string')checks.push({...checks[0],resourceType:'user',resourceId:params.user});
  const ts=params.ts??params.thread_ts??params.message_ts;
  if(typeof params.channel==='string'&&typeof ts==='string')checks.push({...checks[0],channelId:params.channel,resourceType:'message',resourceId:JSON.stringify([params.channel,ts])});
  for(const source of envelope.sources){
   const ref=source.policyReference,decision=await options.policy.resolveSlackModelPolicy({binding:source.sourceRef.binding,purpose:ref.purpose,requestedRetentionDays:ref.requestedRetentionDays,expectedPolicyReference:ref});
   if(!decision.allowed)throw new Error('SLACK_READ_POLICY_DENIED');
   checks.push({binding:source.sourceRef.binding,workspaceId:source.sourceRef.binding.workspaceId,epoch:slackPolicyRefToEpoch(ref),resourceType:source.sourceRef.resourceType,resourceId:source.sourceRef.resourceId,revision:source.sourceRef.revision,...(source.provenance.resourceIdentity.channelId?{channelId:source.provenance.resourceIdentity.channelId}:{})});
  }
  for(const query of checks){signal.throwIfAborted();if((await options.invalidation.checkBarriers(query)).blocked)throw new Error('SLACK_READ_BARRIERED');}
  signal.throwIfAborted();
 }};
}
