import {
 SLACK_PROPOSAL_WORKFLOW_TOOLS,
 deriveSlackDependencySelectors,
 validateSlackSourceReplyPlan,
 type PlanResponse,
 type PlanStep,
 type SlackAssistantIntent,
 type SlackBinding,
 type SlackIntentService,
 type SlackPolicyReference,
} from '@wap/tool-schemas';

export interface SlackProposalPlanInput {
 ownerId:string;
 binding:SlackBinding;
 policyReference:SlackPolicyReference;
 source:{channelId:string;messageTs:string;threadTs?:string|null};
 proposal:{
  title:string;
  rationale:string;
  intents:SlackAssistantIntent[];
  sourceTexts:string[];
 };
 targets:{
  overrideService?:SlackIntentService;
  task?:{listId?:string;allowedListIds?:string[]};
  bug?:{projectKey?:string;allowedProjectKeys?:string[]};
  progress?:{spreadsheetId?:string;sheet?:string;allowedSpreadsheetIds?:string[]};
  calendar?:{calendarId?:string;startIso?:string;endIso?:string};
  github?:{repo?:string;allowedRepos?:string[]};
  gmail?:{toEmail?:string};
  replyInThread?:boolean;
 };
 instruction?:string;
}

export type SlackProposalPlanOutcome =
 | {kind:'plan';plan:PlanResponse}
 | {kind:'needs_info';question:string};

const ISO_DATE=/\b(20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))\b/;
const NO_DUE=/(?:khong can han|bo han|khong gan han|không cần hạn|bỏ hạn|không gắn hạn|no due)/i;
const VAGUE_DEADLINE=/(?:som nhe|khi nao ranh|tuan sau|vai ngay toi|cuoi thang|sớm nhé|khi nào rảnh|tuần sau|vài ngày tới|cuối tháng|thứ sáu|thu sau|ngay mai|ngày mai|asap|soon|next week|friday|tomorrow)/i;

function appendReplyStep(
 steps:PlanStep[],
 input:SlackProposalPlanInput,
 refStepId:string,
 templateText:string,
):Pick<PlanResponse,'steps'|'connections'>{
 const replyStep:PlanStep={
  id:`step_${steps.length+1}`,
  tool:SLACK_PROPOSAL_WORKFLOW_TOOLS.replyPostTool,
  description:'Phản hồi kết quả đã duyệt vào luồng Slack nguồn',
  args:{
   channel:input.source.channelId,
   thread_ts:input.source.threadTs??input.source.messageTs,
   text:{$template:templateText},
  },
  dependsOn:[refStepId],
 };
 const allSteps=[...steps,replyStep];
 const dependencies=deriveSlackDependencySelectors(replyStep.args,allSteps);
 return {
  steps:allSteps,
  connections:{
   myslack:{
    bindings:{[input.binding.connectionId]:input.binding},
    steps:{
     [replyStep.id]:{
      connectionId:input.binding.connectionId,
      tool:replyStep.tool,
      dependencies,
      policyReference:input.policyReference,
     },
    },
   },
  },
 };
}

export function planSlackProposalWorkflow(input:SlackProposalPlanInput):SlackProposalPlanOutcome{
 const intent=input.proposal.intents[0];
 const combinedInstruction=input.instruction?.trim()??'';
 const targetService=input.targets.overrideService??intent?.service;
 const isQuestionOrDirectReply=
  targetService===SLACK_PROPOSAL_WORKFLOW_TOOLS.replyService||
  (!input.targets.overrideService&&(!intent||intent.action==='question'));

 if(!intent&&!input.targets.overrideService){
  return {kind:'needs_info',question:input.proposal.rationale||'Cần làm rõ thêm thông tin trước khi tạo kế hoạch hành động.'};
 }

 if(isQuestionOrDirectReply){
  if(!combinedInstruction){
   return {kind:'needs_info',question:input.proposal.rationale||'Nhập nội dung câu trả lời để phản hồi trực tiếp vào luồng Slack.'};
  }
  const replyStep:PlanStep={
   id:'step_1',
   tool:SLACK_PROPOSAL_WORKFLOW_TOOLS.replyPostTool,
   description:'Phản hồi trực tiếp câu trả lời đã duyệt vào luồng Slack nguồn',
   args:{
    channel:input.source.channelId,
    thread_ts:input.source.threadTs??input.source.messageTs,
    text:combinedInstruction.slice(0,4000),
   },
   dependsOn:[],
  };
  const plan:PlanResponse={
   kind:'plan',
   thinking:'Phản hồi trực tiếp câu trả lời của người dùng vào luồng Slack nguồn.',
   summary:`Phản hồi vào Slack: ${input.proposal.title.trim().slice(0,120)||'Trả lời luồng tin'}`,
   warnings:['Chỉ thực thi sau khi bạn phê duyệt.'],
   steps:[replyStep],
   connections:{
    myslack:{
     bindings:{[input.binding.connectionId]:input.binding},
     steps:{
      step_1:{
       connectionId:input.binding.connectionId,
       tool:replyStep.tool,
       dependencies:[],
       policyReference:input.policyReference,
      },
     },
    },
   },
  };
  validateSlackSourceReplyPlan(plan,input.ownerId);
  return {kind:'plan',plan};
 }

 const explicitDate=
  combinedInstruction.match(ISO_DATE)?.[1]??
  intent?.deadlineText?.match(ISO_DATE)?.[1]??
  input.proposal.sourceTexts.join(' ').match(ISO_DATE)?.[1];
 const skipDue=NO_DUE.test(combinedInstruction);
 const hasVagueDeadline=
  targetService===SLACK_PROPOSAL_WORKFLOW_TOOLS.taskService&&
  !explicitDate&&
  !skipDue&&
  (Boolean(intent?.deadlineText?.trim())||VAGUE_DEADLINE.test(input.proposal.sourceTexts.join(' ')));
 if(hasVagueDeadline){
  return {
   kind:'needs_info',
   question:'Tin nhắn Slack có nhắc thời hạn chưa cụ thể. Vui lòng chọn ngày hạn chót (YYYY-MM-DD) hoặc xác nhận tạo việc không gắn hạn chót.',
  };
 }

 const title=input.proposal.title.trim().slice(0,160)||'Công việc từ Slack';
 const summary=(combinedInstruction&&!ISO_DATE.test(combinedInstruction)&&!skipDue?combinedInstruction:intent?.summary??input.proposal.rationale).trim().slice(0,2000)||title;
 const replyInThread=input.targets.replyInThread===true;

 if(targetService===SLACK_PROPOSAL_WORKFLOW_TOOLS.calendarService){
  const calendarId=input.targets.calendar?.calendarId?.trim()||'primary';
  const startIso=input.targets.calendar?.startIso?.trim();
  const endIso=input.targets.calendar?.endIso?.trim();
  if(!startIso||!endIso){
   return {kind:'needs_info',question:'Vui lòng chọn thời gian bắt đầu và kết thúc hợp lệ để tạo lịch họp trên Google Calendar.'};
  }
  const baseSteps:PlanStep[]=[
   {
    id:'step_1',
    tool:SLACK_PROPOSAL_WORKFLOW_TOOLS.calendarCreateTool,
    description:'Tạo sự kiện lịch họp trên Google Calendar từ đề xuất Slack',
    args:{calendarId,summary:title,description:summary,start:startIso,end:endIso},
    dependsOn:[],
   },
  ];
  const withReply=replyInThread
   ?appendReplyStep(baseSteps,input,'step_1','Đã tạo lịch họp: ${step_1.output.url}')
   :{steps:baseSteps,connections:undefined};
  const plan:PlanResponse={
   kind:'plan',
   thinking:'Tạo sự kiện lịch họp trên Google Calendar theo khung giờ đã chọn.',
   summary:`Tạo lịch họp: ${title}`,
   warnings:['Chỉ thực thi sau khi bạn phê duyệt.'],
   steps:withReply.steps,
   ...(withReply.connections?{connections:withReply.connections}:{}),
  };
  if(replyInThread)validateSlackSourceReplyPlan(plan,input.ownerId);
  return {kind:'plan',plan};
 }

 if(targetService===SLACK_PROPOSAL_WORKFLOW_TOOLS.githubService){
  const repo=input.targets.github?.repo?.trim();
  const allowed=input.targets.github?.allowedRepos;
  if(!repo||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)||(allowed&&allowed.length>0&&!allowed.includes(repo))){
   return {kind:'needs_info',question:'Chưa có repository GitHub đích hợp lệ (định dạng owner/repo) để kiểm tra và tạo Issue.'};
  }
  const baseSteps:PlanStep[]=[
   {
    id:'step_1',
    tool:SLACK_PROPOSAL_WORKFLOW_TOOLS.githubSearchTool,
    description:'Tra cứu GitHub Issue hiện có trước khi tạo mới',
    args:{repo,query:title,limit:5},
    dependsOn:[],
   },
   {
    id:'step_2',
    tool:SLACK_PROPOSAL_WORKFLOW_TOOLS.githubCreateTool,
    description:'Tạo GitHub Issue mới sau khi kiểm tra trùng lặp',
    args:{repo,title,body:summary},
    dependsOn:['step_1'],
   },
  ];
  const withReply=replyInThread
   ?appendReplyStep(baseSteps,input,'step_2','Đã tạo GitHub Issue: ${step_2.output.url}')
   :{steps:baseSteps,connections:undefined};
  const plan:PlanResponse={
   kind:'plan',
   thinking:'Tra cứu GitHub Issue trùng lặp trước khi tạo mới từ đề xuất Slack.',
   summary:`Kiểm tra và tạo GitHub Issue: ${title}`,
   warnings:['Chỉ thực thi sau khi bạn phê duyệt.'],
   steps:withReply.steps,
   ...(withReply.connections?{connections:withReply.connections}:{}),
  };
  if(replyInThread)validateSlackSourceReplyPlan(plan,input.ownerId);
  return {kind:'plan',plan};
 }

 if(targetService===SLACK_PROPOSAL_WORKFLOW_TOOLS.gmailService){
  const toEmail=input.targets.gmail?.toEmail?.trim();
  if(!toEmail||!/^[^\s@<>",;:()\\[\]]+@[^\s@<>",;:()\\[\]]+\.[^\s@<>",;:()\\[\]]+$/.test(toEmail)){
   return {kind:'needs_info',question:'Vui lòng nhập địa chỉ email người nhận hợp lệ để tạo bản nháp Gmail.'};
  }
  const baseSteps:PlanStep[]=[
   {
    id:'step_1',
    tool:SLACK_PROPOSAL_WORKFLOW_TOOLS.gmailDraftTool,
    description:'Tạo bản nháp email trên Gmail từ đề xuất Slack',
    args:{to:[toEmail],subject:title,body:summary},
    dependsOn:[],
   },
  ];
  const withReply=replyInThread
   ?appendReplyStep(baseSteps,input,'step_1','Đã tạo bản nháp email phản hồi: ${step_1.output.id}')
   :{steps:baseSteps,connections:undefined};
  const plan:PlanResponse={
   kind:'plan',
   thinking:'Tạo bản nháp email trên Gmail để người dùng kiểm tra trước khi gửi.',
   summary:`Tạo bản nháp Gmail: ${title}`,
   warnings:['Chỉ thực thi sau khi bạn phê duyệt.'],
   steps:withReply.steps,
   ...(withReply.connections?{connections:withReply.connections}:{}),
  };
  if(replyInThread)validateSlackSourceReplyPlan(plan,input.ownerId);
  return {kind:'plan',plan};
 }

 if((!input.targets.overrideService&&intent?.action==='issue')||targetService===SLACK_PROPOSAL_WORKFLOW_TOOLS.bugService){
  const projectKey=input.targets.bug?.projectKey?.trim();
  const allowed=input.targets.bug?.allowedProjectKeys;
  if(!projectKey||(allowed&&allowed.length>0&&!allowed.includes(projectKey))){
   return {kind:'needs_info',question:'Chưa có dự án đích hợp lệ trong phạm vi được cấp quyền để kiểm tra và tạo phiếu lỗi.'};
  }
  const baseSteps:PlanStep[]=[
   {
    id:'step_1',
    tool:SLACK_PROPOSAL_WORKFLOW_TOOLS.bugSearchTool,
    description:'Tra cứu phiếu lỗi hiện có trước khi tạo mới',
    args:{projectKey,query:title,limit:5},
    dependsOn:[],
   },
   {
    id:'step_2',
    tool:SLACK_PROPOSAL_WORKFLOW_TOOLS.bugCreateTool,
    description:'Tạo phiếu lỗi mới sau khi kiểm tra trùng lặp',
    args:{projectKey,summary:title,description:summary,issueType:'Bug'},
    dependsOn:['step_1'],
   },
  ];
  const withReply=replyInThread
   ?appendReplyStep(baseSteps,input,'step_2','Đã ghi nhận phiếu lỗi: ${step_2.output.url}')
   :{steps:baseSteps,connections:undefined};
  const plan:PlanResponse={
   kind:'plan',
   thinking:'Tra cứu lỗi trùng lặp trước khi tạo phiếu mới từ đề xuất Slack.',
   summary:`Kiểm tra và tạo phiếu lỗi: ${title}`,
   warnings:['Chỉ thực thi sau khi bạn phê duyệt.'],
   steps:withReply.steps,
   ...(withReply.connections?{connections:withReply.connections}:{}),
  };
  if(replyInThread)validateSlackSourceReplyPlan(plan,input.ownerId);
  return {kind:'plan',plan};
 }

 if((!input.targets.overrideService&&intent?.action==='progress')||targetService===SLACK_PROPOSAL_WORKFLOW_TOOLS.progressService){
  const spreadsheetId=input.targets.progress?.spreadsheetId?.trim();
  const sheet=(input.targets.progress?.sheet??'Sheet1').trim()||'Sheet1';
  const allowed=input.targets.progress?.allowedSpreadsheetIds;
  if(!spreadsheetId||!allowed||!allowed.includes(spreadsheetId)){
   return {kind:'needs_info',question:'Bảng tính đích chưa nằm trong phạm vi bảng tính cá nhân được cấp quyền.'};
  }
  const baseSteps:PlanStep[]=[
   {
    id:'step_1',
    tool:SLACK_PROPOSAL_WORKFLOW_TOOLS.progressAppendTool,
    description:'Ghi dòng cập nhật tiến độ vào bảng tính đã cấp quyền',
    args:{spreadsheetId,sheet,rows:[[title,summary,input.source.messageTs]]},
    dependsOn:[],
   },
  ];
  const withReply=replyInThread
   ?appendReplyStep(baseSteps,input,'step_1','Đã cập nhật tiến độ tại: ${step_1.output.updatedRange}')
   :{steps:baseSteps,connections:undefined};
  const plan:PlanResponse={
   kind:'plan',
   thinking:'Ghi nhận dòng cập nhật tiến độ vào bảng tính nằm trong phạm vi cho phép.',
   summary:`Cập nhật tiến độ: ${title}`,
   warnings:['Chỉ thực thi sau khi bạn phê duyệt.'],
   steps:withReply.steps,
   ...(withReply.connections?{connections:withReply.connections}:{}),
  };
  if(replyInThread)validateSlackSourceReplyPlan(plan,input.ownerId);
  return {kind:'plan',plan};
 }

 const listId=input.targets.task?.listId?.trim();
 const allowedLists=input.targets.task?.allowedListIds;
 if(!listId||(allowedLists&&allowedLists.length>0&&!allowedLists.includes(listId))){
  return {kind:'needs_info',question:'Chưa có danh sách đích hợp lệ trong phạm vi được cấp quyền để tạo thẻ công việc.'};
 }
 const baseSteps:PlanStep[]=[
  {
   id:'step_1',
   tool:SLACK_PROPOSAL_WORKFLOW_TOOLS.taskCreateTool,
   description:'Tạo thẻ công việc từ đề xuất Slack',
   args:{listId,title,desc:summary,...(explicitDate?{due:explicitDate}:{})},
   dependsOn:[],
  },
 ];
 const withReply=replyInThread
  ?appendReplyStep(baseSteps,input,'step_1','Đã tạo thẻ công việc: ${step_1.output.url}')
  :{steps:baseSteps,connections:undefined};
 const plan:PlanResponse={
  kind:'plan',
  thinking:'Tạo thẻ công việc từ đề xuất Slack đã được người dùng kiểm tra.',
  summary:`Tạo công việc: ${title}`,
  warnings:['Chỉ thực thi sau khi bạn phê duyệt.'],
  steps:withReply.steps,
  ...(withReply.connections?{connections:withReply.connections}:{}),
 };
 if(replyInThread)validateSlackSourceReplyPlan(plan,input.ownerId);
 return {kind:'plan',plan};
}
