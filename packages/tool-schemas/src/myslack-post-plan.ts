import type {PlanStep} from './types.js';
import {validateSlackBinding,sameSlackBinding} from './myslack-context.js';
import {validateSlackPolicyReference} from './myslack-policy.js';
import {strictSlackObject,deriveSlackDependencySelectors,type SlackDependencySelector} from './myslack-plan-bindings.js';
const CERTIFIED_REPLY_OUTPUT_PATH=/^(?:output\.)?(?:url|id|key|title|name|updatedRange)$/;
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
/** Validated source-bound referenced thread reply family for approved proposal workflows. */
export function validateSlackSourceReplyPlan(value:unknown,owner:string){
 const p=strictSlackObject(value,['kind','thinking','summary','steps','warnings','connections']);
 if(p.kind!=='plan'||!Array.isArray(p.steps)||p.steps.length<1||p.steps.length>8)throw new Error('SLACK_SOURCE_REPLY_PLAN_INVALID');
 const steps=p.steps.map(s=>strictSlackObject(s,['id','tool','description','args','dependsOn']) as unknown as PlanStep);
 if(new Set(steps.map(s=>s.id)).size!==steps.length||steps.some(s=>typeof s.id!=='string'||!s.id||s.id.length>128||typeof s.tool!=='string'||s.tool.startsWith('slack.')||!Array.isArray(s.dependsOn)))throw new Error('SLACK_SOURCE_REPLY_PLAN_INVALID');
 const slackSteps=steps.filter(s=>s.tool.startsWith('myslack.'));
 const step=steps.at(-1);
 if(slackSteps.length!==1||!step||step!==slackSteps[0]||step.tool!=='myslack.chat_postMessage')throw new Error('SLACK_SOURCE_REPLY_PLAN_INVALID');
 const params=strictSlackObject(step.args,['channel','thread_ts','text']);
 if(typeof params.channel!=='string'||!/^[CGD][A-Za-z0-9_-]{1,63}$/.test(params.channel)||
  typeof params.thread_ts!=='string'||!/^[0-9]{1,10}\.[0-9]{6}$/.test(params.thread_ts))throw new Error('SLACK_SOURCE_REPLY_PLAN_INVALID');
 if(typeof params.text==='string'){if(!params.text.trim()||params.text.length>4000)throw new Error('SLACK_SOURCE_REPLY_PLAN_INVALID');}
 else{const tpl=strictSlackObject(params.text,['$template']);if(typeof tpl.$template!=='string'||!tpl.$template.trim()||tpl.$template.length>4000)throw new Error('SLACK_SOURCE_REPLY_PLAN_INVALID');}
 const dependencies=deriveSlackDependencySelectors(step.args,steps);
 if(dependencies.some(d=>d.kind!=='other'||!step.dependsOn?.includes(d.refStepId)||steps.findIndex(s=>s.id===d.refStepId)>=steps.length-1||!CERTIFIED_REPLY_OUTPUT_PATH.test(d.path)))throw new Error('SLACK_SOURCE_REPLY_PLAN_INVALID');
 const connections=strictSlackObject(p.connections,['myslack']),m=strictSlackObject(connections.myslack,['bindings','steps']);
 if(!m.bindings||!m.steps||Array.isArray(m.bindings)||Array.isArray(m.steps)||Object.keys(m.bindings).length!==1||Object.keys(m.steps).length!==1)throw new Error('SLACK_SOURCE_REPLY_PLAN_INVALID');
 const record=strictSlackObject(m.steps[step.id],['connectionId','tool','dependencies','policyReference']);
 const raw=strictSlackObject(m.bindings[record.connectionId],['atiUserId','connectionId','workspaceId','slackUserId','identityVersion']),binding=validateSlackBinding(raw);
 strictSlackObject(record.policyReference,['binding','purpose','requestedRetentionDays','providerProfileId','configFingerprint','policyVersion','consentRevision','providerRevision']);
 strictSlackObject(record.policyReference.binding,['atiUserId','connectionId','workspaceId','slackUserId','identityVersion']);
 const policyReference=validateSlackPolicyReference(record.policyReference);
 if(!Array.isArray(record.dependencies))throw new Error('SLACK_SOURCE_REPLY_PLAN_INVALID');
 const normalized:SlackDependencySelector[]=record.dependencies.map((d:unknown)=>{const entry=strictSlackObject(d,['refStepId','path','service','kind']);return {refStepId:entry.refStepId,path:entry.path,service:entry.service,kind:entry.kind};});
 if(binding.atiUserId!==owner||binding.connectionId!==record.connectionId||record.tool!==step.tool||
  JSON.stringify(normalized)!==JSON.stringify(dependencies)||!sameSlackBinding(binding,policyReference.binding)||
  policyReference.purpose!=='planning'||policyReference.requestedRetentionDays<0||policyReference.requestedRetentionDays>7)throw new Error('SLACK_SOURCE_REPLY_PLAN_INVALID');
 return {step,allSteps:steps,binding,policyReference,dependencies,params:{channel:params.channel as string,thread_ts:params.thread_ts as string,text:params.text as string|{$template:string}}};
}
