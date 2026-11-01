import {planSlackRead,type LLMProvider} from '@wap/planner';
import {validateSlackBinding,validateSlackPolicyReference,sameSlackBinding,sameSlackPolicyEpoch,slackPolicyRefToEpoch,type PlannerResponse} from '@wap/tool-schemas';
import type {SlackConnectionRepo} from '../../db/repositories/slack-connection-repo.js';
import type {SlackPolicyService} from './policy-service.js';
import type {SlackReadPlanBindings} from './slack-plan-bindings.js';
interface Options{connections:SlackConnectionRepo;policy:SlackPolicyService;binder:SlackReadPlanBindings;provider:LLMProvider}
export class SlackReadProposalService{
 constructor(private options:Options){}
 async propose(input:{userId:string;connectionId:string;request:string;signal?:AbortSignal}):Promise<{response:PlannerResponse;labels:Record<string,string>}>{
  const deny=(reason:string)=>({response:{kind:'refusal' as const,reason,suggestion:'Kiểm tra workspace và quyền kết nối trong Kết nối dịch vụ, rồi gửi lại yêu cầu.'},labels:{}});
  input.signal?.throwIfAborted();
  const row=await this.options.connections.withOwner(input.userId,c=>this.options.connections.get(c,input.userId,input.connectionId));
  if(!row||row.status!=='active')return deny('Workspace Slack này chưa sẵn sàng hoặc cần kết nối lại.');
  const binding=validateSlackBinding({atiUserId:input.userId,connectionId:row.id,workspaceId:row.workspace_id,slackUserId:row.actor_id,identityVersion:row.identity_version});
  const planning=await this.options.policy.resolveSlackModelPolicy({binding,purpose:'planning',requestedRetentionDays:0});
  if(!planning.allowed)return deny('Workspace chưa cho phép ATI lập yêu cầu đọc Slack.');
  for(const purpose of ['manual_lookup','storage'] as const){
   const ready=await this.options.policy.resolveSlackModelPolicy({binding,purpose,requestedRetentionDays:purpose==='storage'?1:0});
   if(!ready.allowed)return deny('Tra cứu có lịch sử cần workspace cho phép đọc và lưu kết quả tối đa 1 ngày.');
  }
  const response=await planSlackRead(this.options.provider,{request:input.request,slackUserId:binding.slackUserId,signal:input.signal});
  if(response.kind!=='plan')return {response,labels:{}};
  const bindings=await this.options.binder.resolve(input.userId,response.steps,response.steps.map(step=>({stepId:step.id,connectionId:row.id})),input.signal);
  const initial=slackPolicyRefToEpoch(validateSlackPolicyReference(planning.policyReference));
  if(Object.values(bindings.bindings).some(current=>!sameSlackBinding(current,binding))||Object.values(bindings.steps).some(step=>!sameSlackPolicyEpoch(initial,slackPolicyRefToEpoch(step.policyReference))))return deny('Kết nối hoặc quyền Slack đã thay đổi. Hãy lập lại yêu cầu.');
  return {response:{...response,connections:{myslack:bindings}},labels:{[row.id]:row.workspace_name+' · '+row.workspace_id+' · '+row.actor_id}};
 }
}
