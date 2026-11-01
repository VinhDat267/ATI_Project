import {describe,it,expect} from 'vitest';
import {defaultSlackAssistantConfig,validateSlackAssistantConfig,validateSlackAssistantVersion,validateSlackTriageDecision} from '../src/myslack-assistant.js';

describe('Slack assistant owned configuration and untrusted model output',()=>{
 it('defaults to disabled hybrid with finite budgets and independent configuration objects',()=>{
  const a=defaultSlackAssistantConfig(),b=defaultSlackAssistantConfig();
  expect(a).toMatchObject({enabled:false,mode:'hybrid',retentionDays:1,maxQueueLength:1000,digest:{enabled:false,time:'09:00'}});
  expect(a.budget.dailyCalls).toBe(20);expect(a.budget.monthlyCalls).toBe(200);expect(a.budget.maxOutputTokens).toBe(1024);
  a.rules[0]!.keywords.push('private');expect(b.rules[0]!.keywords).not.toContain('private');
  expect(validateSlackAssistantConfig(b)).toEqual(b);
 });
 it.each(['rules','ai','hybrid'] as const)('retains the independent %s mode',mode=>{
  const c=defaultSlackAssistantConfig('America/New_York');c.mode=mode;c.enabled=true;
  expect(validateSlackAssistantConfig(c)).toMatchObject({mode,enabled:true,timezone:'America/New_York'});
 });
 it.each(['mode','calls','monthly','tokens','queue','retention','timezone','digest','actor','secret','regex','ruleActor','duplicateRule'])('rejects malformed or authority-bearing %s config',kind=>{
  const c:any=defaultSlackAssistantConfig();
  if(kind==='mode')c.mode='all';if(kind==='calls')c.budget.dailyCalls=0;if(kind==='monthly')c.budget.monthlyCalls=1;
  if(kind==='tokens')c.budget.dailyTokens=Infinity;if(kind==='queue')c.maxQueueLength=10001;if(kind==='retention')c.retentionDays=8;
  if(kind==='timezone')c.timezone='not/a/timezone';if(kind==='digest')c.digest.time='24:00';if(kind==='actor')c.atiUserId='foreign';
  if(kind==='secret')c.budget.token='xoxp-private';if(kind==='regex')c.rules[0]!.pattern='(a+)+$';if(kind==='ruleActor')c.rules[0]!.executionActorId='foreign';
  if(kind==='duplicateRule')c.rules.push(structuredClone(c.rules[0]!));
  expect(()=>validateSlackAssistantConfig(c)).toThrow();
 });
 it('preserves SQL bigint version strings without Number coercion',()=>{
  expect(validateSlackAssistantVersion('9223372036854775807')).toBe('9223372036854775807');
  for(const v of ['0','01','-1','9223372036854775808',123,undefined])expect(()=>validateSlackAssistantVersion(v)).toThrow();
 });
 const proposal=()=>({kind:'proposal',title:'Chuẩn bị báo cáo',rationale:'Được nhắc trực tiếp',sourceIndices:[0],relevance:{kind:'mention',sourceIndex:0,evidence:'<@U_ONE>'},intents:[{action:'task',service:'trello',summary:'Chuẩn bị báo cáo',deadlineText:'thứ Sáu'}]});
 it('parses bounded proposal, clarification and metadata-only no_action decisions',()=>{
  expect(validateSlackTriageDecision(proposal(),1)).toEqual(proposal());expect(validateSlackTriageDecision({kind:'no_action'},1)).toEqual({kind:'no_action'});
  const p:any=proposal();p.kind='needs_clarification';delete p.intents;p.question='Thứ Sáu ngày nào?';expect(validateSlackTriageDecision(p,1).kind).toBe('needs_clarification');
 });
 it.each(['binding','foreignSource','missingSource','recipient','noActionText','overflow'])('rejects model authority/provenance bypass %s',kind=>{
  const p:any=proposal();if(kind==='binding')p.binding={atiUserId:'other'};if(kind==='foreignSource')p.sourceIndices=[99];
  if(kind==='missingSource')p.sourceIndices=[];if(kind==='recipient')p.relevance.actorId='OTHER';if(kind==='noActionText'){p.kind='no_action';}
  if(kind==='overflow')p.title='x'.repeat(161);expect(()=>validateSlackTriageDecision(p,1)).toThrow();
 });
});
