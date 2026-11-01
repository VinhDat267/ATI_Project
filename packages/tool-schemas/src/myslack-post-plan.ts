import type {PlanStep} from './types.js';
import {validateSlackBinding,sameSlackBinding} from './myslack-context.js';
import {validateSlackPolicyReference} from './myslack-policy.js';
import {strictSlackObject} from './myslack-plan-bindings.js';
/** Separate opt-in contract: the existing read binding validator never accepts writes. */
export function validateSlackPostPlan(value:unknown,owner:string){
 const p=strictSlackObject(value,['kind','thinking','summary','steps','warnings','connections']);
 if(p.kind!=='plan'||!Array.isArray(p.steps)||p.steps.length!==1)throw new Error('SLACK_POST_PLAN_INVALID');
 const step=strictSlackObject(p.steps[0],['id','tool','description','args','dependsOn']);
 const params=strictSlackObject(step.args,['channel','text']);
 if(step.tool!=='myslack.chat_postMessage'||typeof step.id!=='string'||!step.id||step.id.length>128||!Array.isArray(step.dependsOn)||step.dependsOn.length||
  typeof params.channel!=='string'||!/^[CG][A-Za-z0-9_-]{1,63}$/.test(params.channel)||typeof params.text!=='string'||!params.text.trim()||params.text.length>4000)throw new Error('SLACK_POST_PLAN_INVALID');
 const connections=strictSlackObject(p.connections,['myslack']),m=strictSlackObject(connections.myslack,['bindings','steps']);
 if(!m.bindings||!m.steps||Array.isArray(m.bindings)||Array.isArray(m.steps)||Object.keys(m.bindings).length!==1||Object.keys(m.steps).length!==1)throw new Error('SLACK_POST_PLAN_INVALID');
 const record=strictSlackObject(m.steps[step.id],['connectionId','tool','dependencies','policyReference']);
 const raw=strictSlackObject(m.bindings[record.connectionId],['atiUserId','connectionId','workspaceId','slackUserId','identityVersion']),binding=validateSlackBinding(raw);
 strictSlackObject(record.policyReference,['binding','purpose','requestedRetentionDays','providerProfileId','configFingerprint','policyVersion','consentRevision','providerRevision']);
 strictSlackObject(record.policyReference.binding,['atiUserId','connectionId','workspaceId','slackUserId','identityVersion']);
 const policyReference=validateSlackPolicyReference(record.policyReference);
 if(binding.atiUserId!==owner||binding.connectionId!==record.connectionId||record.tool!==step.tool||!Array.isArray(record.dependencies)||record.dependencies.length||
  !sameSlackBinding(binding,policyReference.binding)||policyReference.purpose!=='planning'||policyReference.requestedRetentionDays!==0)throw new Error('SLACK_POST_PLAN_INVALID');
 return {step:step as unknown as PlanStep,binding,policyReference,params:{channel:params.channel as string,text:params.text as string}};
}
