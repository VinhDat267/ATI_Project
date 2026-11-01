import {describe,it,expect} from 'vitest';
import {defaultSlackAssistantConfig} from '@wap/tool-schemas';
import {evaluateSlackRules,slackPersonalRelevance} from '../../../src/services/slack/slack-rules-engine.js';
const message=(text:string,user='U_OTHER')=>({text,user,ts:'1730000000.000001',threadTs:'1730000000.000001'});
const context=(text:string,user='U_OTHER',type:'public'|'private'|'im'|'mpim'='public',followed=false)=>({slackUserId:'U_ONE',conversationType:type,followedThread:followed,message:message(text,user)});
describe('deterministic Slack personal relevance and literal rules',()=>{
 it('proves personal ID mention but not here/channel or a coincidental name',()=>{
  expect(slackPersonalRelevance(context('<@U_ONE> chuẩn bị báo cáo'))?.kind).toBe('mention');
  for(const text of ['<!here> có lỗi chung','<!channel> ai trực server?','Alex chuẩn bị báo cáo'])expect(slackPersonalRelevance(context(text))).toBeNull();
 });
 it('distinguishes self commitment, direct DM and explicitly followed threads',()=>{
  expect(slackPersonalRelevance(context('Tôi sẽ chuẩn bị báo cáo','U_ONE'))?.kind).toBe('self_commitment');
  expect(slackPersonalRelevance(context('Mình sẽ nhận việc này','U_ONE'))?.kind).toBe('self_commitment');
  expect(slackPersonalRelevance(context('Bạn làm giúp báo cáo nhé','U_OTHER','im'))?.kind).toBe('direct_message');
  expect(slackPersonalRelevance(context('Chuẩn bị báo cáo trước thứ Sáu','U_OTHER','im'))?.kind).toBe('direct_message');
  expect(slackPersonalRelevance(context('Bạn làm giúp báo cáo nhé','U_ONE','im'))).toBeNull();
  expect(slackPersonalRelevance(context('Bạn làm giúp báo cáo nhé','U_OTHER','mpim'))).toBeNull();
  expect(slackPersonalRelevance(context('Hôm nay trời mưa','U_OTHER','im'))).toBeNull();
  expect(slackPersonalRelevance(context('Cập nhật vào thứ Sáu','U_OTHER','private',true))?.kind).toBe('followed_thread');
  expect(slackPersonalRelevance(context('Nhờ <@U_OTHER> làm giúp','U_ONE'))).toBeNull();
 });
 it('applies rules only after personal relevance, including messages typed freely by the same human',()=>{
  const cfg=defaultSlackAssistantConfig();const matched=evaluateSlackRules(cfg.rules,context('<@U_ONE> chuẩn bị báo cáo'));
  expect(matched).toMatchObject({kind:'proposal',ruleId:cfg.rules[0]!.id,intent:{action:'task',service:'trello'}});
  expect(evaluateSlackRules(cfg.rules,context('<!channel> chuẩn bị báo cáo'))).toMatchObject({kind:'no_action',reason:'not_relevant'});
  expect(evaluateSlackRules(cfg.rules,context('<@U_ONE> chúc mừng sinh nhật')).kind).toBe('no_action');
  expect(evaluateSlackRules(cfg.rules,context('Tôi sẽ nhận việc này','U_ONE')).kind).toBe('proposal');
 });
 it('uses bounded literal keyword/author/type conditions without regular expression execution',()=>{
  const cfg=defaultSlackAssistantConfig();const rule=cfg.rules[0]!;rule.keywords=['báo cáo'];rule.authorIds=['U_REQUESTER'];rule.conversationTypes=['private'];
  expect(evaluateSlackRules([rule],context('<@U_ONE> BÁO CÁO','U_REQUESTER','private')).kind).toBe('proposal');
  expect(evaluateSlackRules([rule],context('<@U_ONE> báo cáo','U_OTHER','private')).kind).toBe('no_action');
  expect(evaluateSlackRules([rule],context('<@U_ONE> báo cáo','U_REQUESTER','public')).kind).toBe('no_action');
  rule.keywords=['(a+)+$'];expect(evaluateSlackRules([rule],context('<@U_ONE> aaaaa','U_REQUESTER','private')).kind).toBe('no_action');
 });
 it('never runs disabled rules and requires every keyword for all matching',()=>{
  const cfg=defaultSlackAssistantConfig();cfg.rules[0]!.keywords=['báo cáo','thứ sáu'];cfg.rules[0]!.keywordMode='all';
  expect(evaluateSlackRules(cfg.rules,context('<@U_ONE> báo cáo')).kind).toBe('no_action');
  expect(evaluateSlackRules(cfg.rules,context('<@U_ONE> báo cáo thứ sáu')).kind).toBe('proposal');
  cfg.rules[0]!.enabled=false;expect(evaluateSlackRules(cfg.rules,context('<@U_ONE> báo cáo thứ sáu')).kind).toBe('no_action');
 });
});
