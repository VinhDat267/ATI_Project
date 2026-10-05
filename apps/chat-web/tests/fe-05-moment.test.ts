import { expect, it } from 'vitest';
import { selectMoment, type MomentState } from '../src/services/cockpit-moment';
import type { ExecutionSnapshot } from '../src/types';
const idle: MomentState = { planStatus:'idle',stepStatuses:{},activeClarification:null,messages:[],isPlanning:false };
const snapshot = (status: ExecutionSnapshot['execution']['status'], step: ExecutionSnapshot['steps'][number]['status'] = 'pending'): ExecutionSnapshot => ({ plan:{id:'p1',convId:'c1',status},execution:{status},steps:[{stepId:'s1',tool:'trello.create_card',status:step}],recoveryActions:[] });
it.each([
  ['restart', {planStatus:'executing'}, snapshot('reconciliation_required','unknown'),9],
  ['unknown above failed and executing', {planStatus:'executing',stepStatuses:{a:'failed',b:'unknown'}},null,8],
  ['snapshot unknown above completed', {planStatus:'completed'},snapshot('completed','unknown'),8],
  ['known failure above completed', {planStatus:'completed',stepStatuses:{a:'failed'}},null,7],
  ['completed above clarification', {planStatus:'completed',activeClarification:{question:'Choose',options:[]}},null,6],
  ['approving above preview/clarification', {planStatus:'approving',activeClarification:{question:'Choose',options:[]}},null,5],
  ['executing', {planStatus:'executing'},null,5],
  ['preview above clarification', {planStatus:'preview',activeClarification:{question:'Choose',options:[]}},null,4],
  ['new preview above older successful snapshot', {planStatus:'preview'},snapshot('completed','succeeded'),4],
  ['clarification above refusal', {activeClarification:{question:'Choose',options:[]},messages:[{id:'r',role:'assistant',content:'No',metadata:{type:'refusal'}}]},null,3],
  ['refusal above planning', {isPlanning:true,messages:[{id:'r',role:'assistant',content:'No',metadata:{type:'refusal'}}]},null,'refusal'],
  ['legacy refusal', {messages:[{id:'r',role:'assistant',content:'Từ chối yêu cầu: No'}]},null,'refusal'],
  ['planning without gather above stopped', {isPlanning:true,planStatus:'stopped'},null,2],
  ['stopped', {planStatus:'stopped'},null,'unsuccessful'],
  ['rejected', {planStatus:'rejected'},null,'unsuccessful'],
  ['failed without failed step', {planStatus:'failed'},null,'unsuccessful'],
  ['idle', {},null,1],
] as const)('FE-05 selector: %s', (_name, state, saved, expected) => {
  expect(selectMoment({...idle,...state} as MomentState,saved as ExecutionSnapshot | null)).toBe(expected);
});
it('only the newest message can select refusal', () => {
  expect(selectMoment({...idle,messages:[{id:'r',role:'assistant',content:'No',metadata:{type:'refusal'}},{id:'u',role:'user',content:'New request'}]},null)).toBe(1);
});
