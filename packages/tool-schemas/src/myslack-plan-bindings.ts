import type { PlanStep } from './types.js';
import {validateSlackBinding,sameSlackBinding,type SlackBinding} from './myslack-context.js';
import {validateSlackPolicyReference,type SlackPolicyReference} from './myslack-policy.js';
import {MYSLACK_CORE_READ_TOOLS} from './myslack-tools.js';

export interface SlackDependencySelector {refStepId:string;path:string;service:string;kind:'slack'|'other'}
export interface SlackStepBinding {connectionId:string;tool:string;dependencies:SlackDependencySelector[];policyReference:SlackPolicyReference}
export interface SlackPlanBindings {bindings:Record<string,SlackBinding>;steps:Record<string,SlackStepBinding>}
export function isSlackReadTool(tool:string):boolean {return MYSLACK_CORE_READ_TOOLS.some(t=>t.name===tool);}
export function strictSlackObject(value:unknown,keys:readonly string[]):Record<string,any>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||
    Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(value,k)))throw new TypeError('SLACK_BINDING_INVALID');
 return value as Record<string,any>;
}
export function deriveSlackDependencySelectors(rawArgs:unknown,steps:readonly PlanStep[]):SlackDependencySelector[]{
 const found=new Map<string,SlackDependencySelector>();let nodes=0;
 const reference=(ref:unknown)=>{
  if(typeof ref!=='string'||!/^([A-Za-z0-9_-]+)(\.[A-Za-z0-9_-]+)*$/.test(ref)||
    ref.split('.').some(p=>['__proto__','constructor','prototype'].includes(p)))throw new TypeError('SLACK_DEPENDENCY_INVALID');
  const [refStepId,...parts]=ref.split('.'),step=steps.find(s=>s.id===refStepId);
  if(!step)throw new TypeError('SLACK_DEPENDENCY_INVALID');
  const service=step.tool.split('.')[0]!,entry:SlackDependencySelector={refStepId:refStepId!,path:parts.join('.'),service,kind:service==='myslack'?'slack':'other'};
  found.set(JSON.stringify(entry),entry);
 };
 const walk=(value:unknown,depth:number)=>{
  if(++nodes>4096||depth>32)throw new TypeError('SLACK_DEPENDENCY_INVALID');
  if(value===null||['string','boolean','number'].includes(typeof value))return;
  if(Array.isArray(value)){value.forEach(v=>walk(v,depth+1));return;}
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new TypeError('SLACK_DEPENDENCY_INVALID');
  const obj=value as Record<string,unknown>;
  if(Object.keys(obj).some(k=>['__proto__','constructor','prototype'].includes(k)))throw new TypeError('SLACK_DEPENDENCY_INVALID');
  if(Object.hasOwn(obj,'$ref')){strictSlackObject(obj,['$ref']);reference(obj.$ref);return;}
  if(Object.hasOwn(obj,'$template')){
   strictSlackObject(obj,['$template']);if(typeof obj.$template!=='string')throw new TypeError('SLACK_DEPENDENCY_INVALID');
   for(const m of obj.$template.matchAll(/\$\{([^}]*)\}/g))reference(m[1]);
   if(obj.$template.replace(/\$\{[^}]*\}/g,'').includes('${'))throw new TypeError('SLACK_DEPENDENCY_INVALID');
   return;
  }
  Object.values(obj).forEach(v=>walk(v,depth+1));
 };walk(rawArgs,0);return [...found.values()].sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);
}
export function validateSlackPlanBindings(value:unknown,planSteps:readonly PlanStep[]):SlackPlanBindings{
 const obj=strictSlackObject(value,['bindings','steps']);
 if(!obj.bindings||!obj.steps||Array.isArray(obj.bindings)||Array.isArray(obj.steps))throw new TypeError('SLACK_BINDING_INVALID');
 const steps=planSteps.filter(s=>s.tool.startsWith('myslack.'));
 if(new Set(planSteps.map(s=>s.id)).size!==planSteps.length||Object.keys(obj.steps).length!==steps.length||!steps.length)throw new TypeError('SLACK_BINDING_INVALID');
 const bindings:Record<string,SlackBinding>={},records:Record<string,SlackStepBinding>={},used=new Set<string>();
 for(const [key,raw] of Object.entries(obj.bindings)){
  if(['__proto__','constructor','prototype'].includes(key))throw new TypeError('SLACK_BINDING_INVALID');
  strictSlackObject(raw,['atiUserId','connectionId','workspaceId','slackUserId','identityVersion']);
  const b=validateSlackBinding(raw);if(b.connectionId!==key)throw new TypeError('SLACK_BINDING_INVALID');bindings[key]=b;
 }
 for(const step of steps){
  if(!isSlackReadTool(step.tool)||!Object.hasOwn(obj.steps,step.id))throw new TypeError('SLACK_WRITE_DISABLED');
  const raw=strictSlackObject(obj.steps[step.id],['connectionId','tool','dependencies','policyReference']),b=bindings[raw.connectionId];
  strictSlackObject(raw.policyReference,['binding','purpose','requestedRetentionDays','providerProfileId','configFingerprint','policyVersion','consentRevision','providerRevision']);
  strictSlackObject(raw.policyReference.binding,['atiUserId','connectionId','workspaceId','slackUserId','identityVersion']);
  const p=validateSlackPolicyReference(raw.policyReference),dependencies=deriveSlackDependencySelectors(step.args,planSteps);
  if(!Array.isArray(raw.dependencies))throw new TypeError('SLACK_BINDING_INVALID');
  const normalized=raw.dependencies.map((d:unknown)=>{const entry=strictSlackObject(d,['refStepId','path','service','kind']);return {refStepId:entry.refStepId,path:entry.path,service:entry.service,kind:entry.kind};});
  if(!b||raw.tool!==step.tool||!sameSlackBinding(b,p.binding)||p.purpose!=='planning'||p.requestedRetentionDays!==0||
     JSON.stringify(normalized)!==JSON.stringify(dependencies)||dependencies.some(d=>planSteps.findIndex(s=>s.id===d.refStepId)>=planSteps.indexOf(step)))throw new TypeError('SLACK_BINDING_INVALID');
  records[step.id]={connectionId:raw.connectionId,tool:step.tool,dependencies,policyReference:p};used.add(raw.connectionId);
 }
 if(Object.keys(bindings).length!==used.size)throw new TypeError('SLACK_BINDING_INVALID');
 return {bindings,steps:records};
}
