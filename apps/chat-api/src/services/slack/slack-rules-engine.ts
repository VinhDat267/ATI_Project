import type {SlackAssistantRule,SlackConversationKind,SlackAssistantIntent} from '@wap/tool-schemas';
export interface SlackRuleContext {slackUserId:string;conversationType:SlackConversationKind;followedThread:boolean;message:{text:string;user?:string;ts:string;threadTs?:string}}
export interface PersonalSlackRelevance {kind:'mention'|'direct_message'|'self_commitment'|'followed_thread';evidence:string}
const normalized=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLocaleLowerCase('vi');
export function slackPersonalRelevance(context:SlackRuleContext):PersonalSlackRelevance|null{
 const text=context.message.text;if(!/^[UW][A-Za-z0-9_-]{1,63}$/.test(context.slackUserId)||typeof text!=='string'||text.length>20000)return null;
 const mention=text.match(new RegExp(`<@${context.slackUserId}(?:\\|[^>]{1,80})?>`));
 if(mention)return {kind:'mention',evidence:mention[0]};
 if(context.followedThread)return {kind:'followed_thread',evidence:text.slice(0,200)||'Followed thread'};
 const plain=normalized(text);
 if(context.conversationType==='im'&&/(?:giup|nho|hay |vui long|lam |can ban|please|could you|can you|would you|\?)/.test(plain))return {kind:'direct_message',evidence:text.slice(0,200)};
 if(context.message.user===context.slackUserId&&/(?:toi|minh|to|em|anh|chi) (?:se |nhan |dam nhan|tu lam)|i(?: will|'ll) /.test(plain))return {kind:'self_commitment',evidence:text.slice(0,200)};
 return null;
}
export type SlackRulesResult={kind:'no_action';reason:'not_relevant'|'rule_not_matched'}|{kind:'proposal';ruleId:string;relevance:PersonalSlackRelevance;intent:SlackAssistantIntent};
export function evaluateSlackRules(rules:SlackAssistantRule[],context:SlackRuleContext):SlackRulesResult{
 const relevance=slackPersonalRelevance(context);if(!relevance)return {kind:'no_action',reason:'not_relevant'};
 const text=normalized(context.message.text);
 for(const rule of rules){
  if(!rule.enabled||!rule.conversationTypes.includes(context.conversationType)||(rule.authorIds.length&&!rule.authorIds.includes(context.message.user??''))||(rule.requireMention&&relevance.kind!=='mention'))continue;
  const matches=rule.keywords.map(word=>text.includes(normalized(word)));
  if(matches.length&&!(rule.keywordMode==='all'?matches.every(Boolean):matches.some(Boolean)))continue;
  return {kind:'proposal',ruleId:rule.id,relevance,intent:{action:rule.intent.action,service:rule.intent.service,summary:rule.intent.template||context.message.text.slice(0,2000)}};
 }
 return {kind:'no_action',reason:'rule_not_matched'};
}
