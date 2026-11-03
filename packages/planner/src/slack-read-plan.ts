import {MYSLACK_CORE_READ_TOOLS,isSlackReadTool,deriveSlackDependencySelectors,type PlannerResponse,type ToolDefinition} from '@wap/tool-schemas';
import {validatePlan} from './validator.js';
import type {LLMProvider} from './types.js';
export interface SlackReadPlanInput {request:string;slackUserId:string;signal?:AbortSignal;timeoutMs?:number}
const refusal=():PlannerResponse=>({kind:'refusal',reason:'Chưa lập được kế hoạch đọc Slack an toàn.',suggestion:'Hãy nêu rõ thao tác đọc và mã kênh hoặc người cần tra cứu.'});
/** Extract a proposal from user-authored input only. No history, gather or service data reaches this provider. */
export async function planSlackRead(provider:LLMProvider,input:SlackReadPlanInput):Promise<PlannerResponse>{
 const timeout=input.timeoutMs??15000;
 if(!input.request.trim()||input.request.length>4000||!Number.isSafeInteger(timeout)||timeout<1||timeout>15000)throw new Error('SLACK_READ_REQUEST_INVALID');
 const signal=input.signal?AbortSignal.any([input.signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
 signal.throwIfAborted();
 const catalog:ToolDefinition[]=MYSLACK_CORE_READ_TOOLS.map(tool=>{
  const inputSchema=structuredClone(tool.inputSchema);delete inputSchema.properties.binding;
  inputSchema.required=(inputSchema.required??[]).filter((key:string)=>key!=='binding');
  return {name:tool.name,service:tool.service,description:tool.description,sideEffect:'read',riskLevel:tool.riskLevel,inputSchema,outputSchema:tool.outputSchema};
 });
 const pending=provider.generatePlan({
  systemPrompt:'Bạn lập đề xuất đọc Slack cá nhân, chỉ dùng các công cụ đọc được cấp. Chưa được đọc dữ liệu trước khi người dùng duyệt. Trả JSON kind=plan (thinking,summary,steps,warnings), clarification (question,context), hoặc refusal (reason,suggestion). Mỗi step có id,tool,description,args,dependsOn. Chỉ dùng mã tài nguyên người dùng cung cấp; không đoán mã hoặc chọn phần tử đầu để thay một tên chưa xác minh. Có thể đề xuất liệt kê kênh/người trước, rồi để người dùng chọn mã cho yêu cầu tiếp theo. Không tạo binding/connections, không ghi dịch vụ, không tạo lịch. Slack user của người đang kết nối: '+input.slackUserId+'. Tối đa8 bước đọc và100 kết quả mỗi lời gọi.',
  conversationHistory:[{role:'user',content:input.request}],toolCatalog:catalog,workingMemory:{},signal,
 });
 const output=await new Promise<string>((resolve,reject)=>{
  const abort=()=>reject(new Error('SLACK_READ_PLANNING_ABORTED'));signal.addEventListener('abort',abort,{once:true});
  pending.then(value=>{signal.removeEventListener('abort',abort);if(signal.aborted)abort();else resolve(value);},()=>{signal.removeEventListener('abort',abort);reject(new Error('SLACK_READ_PLANNING_FAILED'));});
 });
 if(output.length>65536)return refusal();
 let value:any;try{value=JSON.parse(output);}catch{return refusal();}
 if(value?.kind==='plan'){
  // Explicit projection removes all model-owned connection and metadata fields.
  value={kind:'plan',thinking:value.thinking,summary:value.summary,steps:value.steps,warnings:value.warnings};
  if(!Array.isArray(value.steps)||!value.steps.length||value.steps.length>8||value.steps.some((s:any)=>!isSlackReadTool(s.tool)))return refusal();
 }
 const checked=validatePlan(JSON.stringify(value),catalog,{slackReadPlan:true});
 if(!checked.valid)return refusal();
 if(checked.parsed.kind!=='plan')return checked.parsed;
 for(const step of checked.parsed.steps){
  if(deriveSlackDependencySelectors(step.args,checked.parsed.steps).length)return refusal();
  for(const key of ['channel','user','ts','message_ts','thread_ts']){
   const id=step.args[key];if(id===undefined)continue;
   if(typeof id!=='string'||(key==='user'&&id===input.slackUserId))continue;
   if(!input.request.split(/[\s,;:()[\]{}"'<>]+/).includes(id))return {kind:'clarification',question:'Hãy chọn mã kênh hoặc người cần đọc. Bạn có thể yêu cầu liệt kê kênh/người trước.',context:'Slack cần mã tài nguyên được bạn chọn rõ.'};
  }
 }
 return checked.parsed;
}
