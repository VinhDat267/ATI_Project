import {it,expect} from 'vitest';
import {validateSlackPostPlan,validateSlackSourceReplyPlan} from '../src/myslack-post-plan.js';
import {validateSlackPlanBindings} from '../src/myslack-plan-bindings.js';
const binding={atiUserId:'owner',connectionId:'connection',workspaceId:'T_ONE',slackUserId:'U_ONE',identityVersion:1};
const policy={binding,purpose:'planning',requestedRetentionDays:0,providerProfileId:'provider',configFingerprint:'a'.repeat(64),policyVersion:'v1',consentRevision:'1',providerRevision:'1'};
const plan=()=>({kind:'plan',thinking:'',summary:'Post',warnings:[],steps:[{id:'post',tool:'myslack.chat_postMessage',description:'Post',args:{channel:'C_ONE',text:'Exact user text'},dependsOn:[]}],connections:{myslack:{bindings:{connection:binding},steps:{post:{connectionId:'connection',tool:'myslack.chat_postMessage',dependencies:[],policyReference:policy}}}}});
it('accepts only the explicit source-free single-post shape; the existing read validator still refuses it',()=>{const p=plan();expect(validateSlackPostPlan(p,'owner').binding).toEqual(binding);expect(()=>validateSlackPlanBindings(p.connections.myslack,p.steps)).toThrow('SLACK_WRITE_DISABLED');});
it.each(['owner','policy','dependency','dm','extra','mixed'])('denies forged %s write plans',kind=>{const p:any=plan();if(kind==='owner')p.connections.myslack.bindings.connection.atiUserId='another';if(kind==='policy')p.connections.myslack.steps.post.policyReference={...policy,binding:{...binding,workspaceId:'T_OTHER'}};if(kind==='dependency')p.steps[0].args.text={$ref:'read.output.text'};if(kind==='dm')p.steps[0].args.channel='D_OTHER';if(kind==='extra')p.connections.myslack.steps.post.trusted=true;if(kind==='mixed')p.steps.push({...p.steps[0],id:'second'});expect(()=>validateSlackPostPlan(p,'owner')).toThrow();});
const sourceBinding={atiUserId:'owner',connectionId:'connection',workspaceId:'T_ONE',slackUserId:'U_ONE',identityVersion:1};
const sourcePolicy={binding:sourceBinding,purpose:'planning',requestedRetentionDays:1,providerProfileId:'provider',configFingerprint:'a'.repeat(64),policyVersion:'v1',consentRevision:'1',providerRevision:'1'};
const sourceReplyPlan=()=>structuredClone({kind:'plan',thinking:'Tạo thẻ và trả lời thread',summary:'Tạo thẻ Trello và báo lại trong thread Slack',warnings:[],steps:[
 {id:'step_1',tool:'trello.create_card',description:'Tạo thẻ Trello',args:{listId:'L_1',title:'Chuẩn bị báo cáo'},dependsOn:[]},
 {id:'step_2',tool:'myslack.chat_postMessage',description:'Phản hồi trong thread nguồn',args:{channel:'C_ONE',thread_ts:'1730000000.000001',text:{$template:'Đã tạo thẻ công việc: ${step_1.output.url}'}},dependsOn:['step_1']},
],connections:{myslack:{bindings:{connection:sourceBinding},steps:{step_2:{connectionId:'connection',tool:'myslack.chat_postMessage',dependencies:[{refStepId:'step_1',path:'output.url',service:'trello',kind:'other'}],policyReference:sourcePolicy}}}}});
it('validates source-bound referenced thread reply plans while keeping validateSlackPostPlan source-free',()=>{
 const p=sourceReplyPlan();
 expect(()=>validateSlackPostPlan(p,'owner')).toThrow();
 const validated=validateSlackSourceReplyPlan(p,'owner');
 expect(validated.binding).toEqual(sourceBinding);
 expect(validated.step.id).toBe('step_2');
 expect(validated.params.thread_ts).toBe('1730000000.000001');
 expect(validated.dependencies).toEqual([{refStepId:'step_1',path:'output.url',service:'trello',kind:'other'}]);
});
it.each(['noThread','uncertifiedField','sharedSlack','notLast','missingDep','wrongOwner'])('rejects invalid source-bound reply plan (%s)',kind=>{
 const p:any=sourceReplyPlan();
 if(kind==='noThread')delete p.steps[1].args.thread_ts;
 if(kind==='uncertifiedField'){p.steps[1].args.text={$template:'${step_1.output.rawSecret}'};p.connections.myslack.steps.step_2.dependencies=[{refStepId:'step_1',path:'output.rawSecret',service:'trello',kind:'other'}];}
 if(kind==='sharedSlack')p.steps[0].tool='slack.send_message';
 if(kind==='notLast')p.steps.reverse();
 if(kind==='missingDep')p.steps[1].dependsOn=[];
 if(kind==='wrongOwner')p.connections.myslack.bindings.connection.atiUserId='other';
 expect(()=>validateSlackSourceReplyPlan(p,'owner')).toThrow();
});
