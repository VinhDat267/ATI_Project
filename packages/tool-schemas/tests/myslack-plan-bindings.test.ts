import { describe,it,expect } from 'vitest';
import * as schema from '../src/index.js';
const binding={atiUserId:'owner',connectionId:'connection',workspaceId:'T_ONE',slackUserId:'U_ONE',identityVersion:1};
const policy={binding,purpose:'planning',requestedRetentionDays:0,providerProfileId:'provider',configFingerprint:'a'.repeat(64),policyVersion:'v1',consentRevision:'9007199254740993',providerRevision:'1'};
const steps=[{id:'first',tool:'myslack.users_list',description:'List users',args:{limit:10},dependsOn:[]},{id:'second',tool:'myslack.users_info',description:'Read user',args:{user:{$ref:'first.output.members.0.id'}},dependsOn:['first']}];
const derive=(...args:any[])=>(schema as any).deriveSlackDependencySelectors(...args);
const validate=(...args:any[])=>(schema as any).validateSlackPlanBindings(...args);
const snapshot=()=>({bindings:{connection:binding},steps:Object.fromEntries(steps.map(s=>[s.id,{connectionId:'connection',tool:s.tool,dependencies:derive(s.args,steps),policyReference:policy}]))});
describe('server-owned Slack approval binding',()=>{
 it('derives complete selectors including templates and preserves revision precision',()=>{
  expect(derive({a:{$ref:'first.output.members.0.id'},b:{$template:'User ${first.output.members.0.id}'}},steps)).toEqual([{refStepId:'first',path:'output.members.0.id',service:'myslack',kind:'slack'}]);
  expect(validate(snapshot(),steps).steps.first.policyReference.consentRevision).toBe('9007199254740993');
 });
 it('rejects unknown keys, forged dependencies and changed policy identity',()=>{
  const unknown=snapshot();(unknown.steps.first as any).extra=true;expect(()=>validate(unknown,steps)).toThrow();
  const forged=snapshot();forged.steps.second.dependencies=[];expect(()=>validate(forged,steps)).toThrow();
  const extraPolicy=structuredClone(snapshot());(extraPolicy.steps.first.policyReference as any).trusted=true;expect(()=>validate(extraPolicy,steps)).toThrow();
  const swapped=structuredClone(snapshot());swapped.steps.first.policyReference={...swapped.steps.first.policyReference,binding:{...binding,workspaceId:'T_OTHER'}};expect(()=>validate(swapped,steps)).toThrow();
 });
 it.each([{$ref:'first.output.id',extra:true},{$ref:'first.output.__proto__'},{$ref:'missing.output.id'},{$template:'bad ${first[0]}'},{$ref:'first.output..id'}])('rejects ambiguous or unsafe selectors %j',(args)=>{
  expect(()=>derive(args,steps)).toThrow();
 });
 it('requires exact step and connection sets and positive safe identity generation',()=>{
  const v=snapshot();delete v.steps.second;expect(()=>validate(v,steps)).toThrow();
  const extra=snapshot();(extra.bindings as any).unused=binding;expect(()=>validate(extra,steps)).toThrow();
  const bad=structuredClone(snapshot());bad.bindings.connection.identityVersion=Number.MAX_SAFE_INTEGER+1;expect(()=>validate(bad,steps)).toThrow();
 });
 it('accepts PostgreSQL jsonb key ordering without weakening exact dependency fields',()=>{
  const v=snapshot(),d=v.steps.second.dependencies[0]!;
  v.steps.second.dependencies=[{kind:d.kind,service:d.service,path:d.path,refStepId:d.refStepId}];
  expect(validate(v,steps).steps.second.dependencies).toEqual(derive(steps[1]!.args,steps));
  (v.steps.second.dependencies[0] as any).extra='forged';expect(()=>validate(v,steps)).toThrow();
 });
});
