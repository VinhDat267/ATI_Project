/** Owner-authored settings and untrusted classifier output; never credentials or execution authority. */
export type SlackAssistantMode = 'rules' | 'ai' | 'hybrid';
export type SlackConversationKind = 'public' | 'private' | 'im' | 'mpim';
export type SlackIntentAction = 'task' | 'issue' | 'progress' | 'question';
export const SLACK_ASSISTANT_INTENT_SERVICES=['trello','jira','mysheets','myslack'] as const;
export type SlackIntentService=(typeof SLACK_ASSISTANT_INTENT_SERVICES)[number];
export interface SlackAssistantBudget {dailyCalls:number;monthlyCalls:number;dailyTokens:number;monthlyTokens:number;maxOutputTokens:number}
export interface SlackAssistantRule {
 id:string;name:string;enabled:boolean;authorIds:string[];conversationTypes:SlackConversationKind[];keywords:string[];keywordMode:'any'|'all';requireMention:boolean;
 intent:{action:SlackIntentAction;service:SlackIntentService;template:string};
}
export interface SlackAssistantConfig {
 enabled:boolean;mode:SlackAssistantMode;rules:SlackAssistantRule[];budget:SlackAssistantBudget;maxQueueLength:number;retentionDays:number;timezone:string;
 digest:{enabled:boolean;time:string};
 targets:{trello?:{boardId:string;listId:string};jira?:{projectKey:string};mysheets?:{spreadsheetId:string;range:string};replyToSource?:boolean};
}
export interface SlackAssistantIntent {action:SlackIntentAction;service:SlackIntentService;summary:string;deadlineText?:string}
export interface SlackRelevanceEvidence {kind:'mention'|'direct_message'|'self_commitment'|'followed_thread';sourceIndex:number;evidence:string}
export type SlackTriageDecision = {kind:'no_action'} | {
 kind:'proposal';title:string;rationale:string;sourceIndices:number[];relevance:SlackRelevanceEvidence;intents:SlackAssistantIntent[];
} | {kind:'needs_clarification';title:string;rationale:string;sourceIndices:number[];relevance:SlackRelevanceEvidence;question:string};
const modes=['rules','ai','hybrid'],types=['public','private','im','mpim'],actions=['task','issue','progress','question'],services=SLACK_ASSISTANT_INTENT_SERVICES;
function invalid():never{throw new TypeError('SLACK_ASSISTANT_INVALID');}
function object(v:unknown,keys:string[]):Record<string,any>{
 if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v))||Object.keys(v).some(k=>!keys.includes(k)))invalid();
 return v as Record<string,any>;
}
function string(v:unknown,max:number,min=1):string{if(typeof v!=='string'||v.length<min||v.length>max||v.includes('\u0000'))invalid();return v;}
function integer(v:unknown,min:number,max:number):number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)invalid();return v;}
function boolean(v:unknown):boolean{if(typeof v!=='boolean')invalid();return v;}
function oneOf<T extends string>(v:unknown,values:readonly string[]):T{if(typeof v!=='string'||!values.includes(v))invalid();return v as T;}
function array<T>(v:unknown,min:number,max:number,parse:(v:unknown)=>T):T[]{if(!Array.isArray(v)||v.length<min||v.length>max)invalid();return v.map(parse);}
function unique<T>(v:T[]):T[]{if(new Set(v).size!==v.length)invalid();return v;}
export function validateSlackAssistantVersion(v:unknown):string{
 if(typeof v!=='string'||!/^[1-9][0-9]{0,18}$/.test(v)||BigInt(v)>9223372036854775807n)invalid();return v;
}
export function defaultSlackAssistantConfig(timezone='Asia/Ho_Chi_Minh'):SlackAssistantConfig{
 return {enabled:false,mode:'hybrid',timezone,retentionDays:1,maxQueueLength:1000,
 budget:{dailyCalls:20,monthlyCalls:200,dailyTokens:1000000,monthlyTokens:10000000,maxOutputTokens:1024},digest:{enabled:false,time:'09:00'},targets:{},
 rules:[{id:'personal-work',name:'Việc được nhờ trực tiếp',enabled:true,authorIds:[],conversationTypes:['public','private','im','mpim'],keywords:['việc','báo cáo','giúp','chuẩn bị','làm','task','bug','lỗi','cập nhật','nhận','report','fix','please'],keywordMode:'any',requireMention:false,intent:{action:'task',service:'trello',template:''}}]};
}
export function validateSlackAssistantConfig(value:unknown):SlackAssistantConfig{
 const c=object(value,['enabled','mode','rules','budget','maxQueueLength','retentionDays','timezone','digest','targets']);
 const budget=object(c.budget,['dailyCalls','monthlyCalls','dailyTokens','monthlyTokens','maxOutputTokens']);
 const b:SlackAssistantBudget={dailyCalls:integer(budget.dailyCalls,1,1000000),monthlyCalls:integer(budget.monthlyCalls,1,10000000),dailyTokens:integer(budget.dailyTokens,1,1000000000),monthlyTokens:integer(budget.monthlyTokens,1,10000000000),maxOutputTokens:integer(budget.maxOutputTokens,256,4096)};
 if(b.monthlyCalls<b.dailyCalls||b.monthlyTokens<b.dailyTokens)invalid();
 const timezone=string(c.timezone,80);try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format(0);}catch{invalid();}
 const d=object(c.digest,['enabled','time']);const time=string(d.time,5);if(!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(time))invalid();
 const rules=array(c.rules,0,20,(value):SlackAssistantRule=>{
  const r=object(value,['id','name','enabled','authorIds','conversationTypes','keywords','keywordMode','requireMention','intent']);
  const id=string(r.id,64);if(!/^[A-Za-z0-9_-]+$/.test(id))invalid();const intent=object(r.intent,['action','service','template']);
  return {id,name:string(r.name,100),enabled:boolean(r.enabled),authorIds:unique(array(r.authorIds,0,30,x=>{const s=string(x,64);if(!/^[UW][A-Za-z0-9_-]+$/.test(s))invalid();return s;})),
   conversationTypes:unique(array(r.conversationTypes,1,4,x=>oneOf<SlackConversationKind>(x,types))),keywords:unique(array(r.keywords,0,30,x=>string(x,100))),keywordMode:oneOf(r.keywordMode,['any','all']),requireMention:boolean(r.requireMention),
   intent:{action:oneOf(intent.action,actions),service:oneOf(intent.service,services),template:string(intent.template,512,0)}};
 });
 unique(rules.map(r=>r.id));
 const t=object(c.targets,['trello','jira','mysheets','replyToSource']);const targets:SlackAssistantConfig['targets']={};
 if(t.trello!==undefined){const x=object(t.trello,['boardId','listId']);targets.trello={boardId:string(x.boardId,256),listId:string(x.listId,256)};}
 if(t.jira!==undefined){const x=object(t.jira,['projectKey']);targets.jira={projectKey:string(x.projectKey,128)};}
 if(t.mysheets!==undefined){const x=object(t.mysheets,['spreadsheetId','range']);targets.mysheets={spreadsheetId:string(x.spreadsheetId,256),range:string(x.range,256)};}
 if(t.replyToSource!==undefined)targets.replyToSource=boolean(t.replyToSource);
 return {enabled:boolean(c.enabled),mode:oneOf(c.mode,modes),rules,budget:b,maxQueueLength:integer(c.maxQueueLength,1,10000),retentionDays:integer(c.retentionDays,1,7),timezone,digest:{enabled:boolean(d.enabled),time},targets};
}
export function validateSlackTriageDecision(value:unknown,contextCount:number):SlackTriageDecision{
 integer(contextCount,1,20);const raw=object(value,['kind','title','rationale','sourceIndices','relevance','intents','question']);
 if(raw.kind==='no_action'){object(value,['kind']);return {kind:'no_action'};}
 const kind=oneOf<'proposal'|'needs_clarification'>(raw.kind,['proposal','needs_clarification']);
 object(value,kind==='proposal'?['kind','title','rationale','sourceIndices','relevance','intents']:['kind','title','rationale','sourceIndices','relevance','question']);
 const sourceIndices=unique(array(raw.sourceIndices,1,20,x=>integer(x,0,contextCount-1)));
 const r=object(raw.relevance,['kind','sourceIndex','evidence']);const sourceIndex=integer(r.sourceIndex,0,contextCount-1);if(!sourceIndices.includes(sourceIndex))invalid();
 const common={title:string(raw.title,160),rationale:string(raw.rationale,1500),sourceIndices,relevance:{kind:oneOf<SlackRelevanceEvidence['kind']>(r.kind,['mention','direct_message','self_commitment','followed_thread']),sourceIndex,evidence:string(r.evidence,512)}};
 if(kind==='needs_clarification')return {kind,...common,question:string(raw.question,1000)};
 return {kind,...common,intents:array(raw.intents,1,4,(value):SlackAssistantIntent=>{const i=object(value,['action','service','summary','deadlineText']);return {action:oneOf(i.action,actions),service:oneOf(i.service,services),summary:string(i.summary,2000),...(i.deadlineText!==undefined?{deadlineText:string(i.deadlineText,128)}:{})};})};
}

export interface SlackAssistantSettingsView {config:SlackAssistantConfig;configVersion:string;available:boolean;pausedReason:'budget_exceeded'|'backlog_full'|null;queue?:{pending:number;running:number;held:number;needsAttention:number}}
export function validateSlackAssistantSettingsView(value:unknown):SlackAssistantSettingsView{
 const v=object(value,['config','configVersion','available','pausedReason','queue']);
 const pausedReason=v.pausedReason===null?null:oneOf<'budget_exceeded'|'backlog_full'>(v.pausedReason,['budget_exceeded','backlog_full']);
 let queue:SlackAssistantSettingsView['queue'];if(v.queue!==undefined){const q=object(v.queue,['pending','running','held','needsAttention']);queue={pending:integer(q.pending,0,2147483647),running:integer(q.running,0,2147483647),held:integer(q.held,0,2147483647),needsAttention:integer(q.needsAttention,0,2147483647)};}
 return {config:validateSlackAssistantConfig(v.config),configVersion:validateSlackAssistantVersion(v.configVersion),available:boolean(v.available),pausedReason,...(queue?{queue}:{})};
}
