import { getServiceDefinition } from '@wap/tool-schemas';
import { toolDefinition } from '../../services/tool-definitions';
import assets from '../../assets/cockpit-services.json';
import type { PlanStep, ServiceInfo, StepState } from '../../types';
import type { ExecutionStepInfo } from '../../components/ExecutionProgress';

interface Palette { icon:string; name:string; logo?:string; badge?:string; previewBadge?:string; receiptHover?:string }
interface Operation { action:string; done:string; receipt:string; kind:string; link:string; titleField?:string; titlePrefix?:string; previewStyle?:string }
const palettes:Record<string,Palette>=Object.fromEntries(Object.entries(assets.services).map(([id,value])=>[id,{...value.suggestion,...value}]));
const operations:Record<string,Operation>=assets.operations;
export function serviceRecoveryLink(id:string):{url:string;argument:string;query:string}|undefined {return (assets.services as Record<string,{recoveryLink?:{url:string;argument:string;query:string}}>)[id]?.recoveryLink;}
const FRIENDLY_SERVICE_NAMES: Record<string, string> = (assets as { serviceNames?: Record<string, string> }).serviceNames ?? {};

const FRIENDLY_FIELD_LABELS: Record<string, string> = {
  htmlLink: 'Đường dẫn sự kiện',
  shortUrl: 'Đường dẫn thẻ Trello',
  url: 'Đường dẫn kết quả',
  permalink: 'Đường dẫn tin nhắn Slack',
  webViewLink: 'Đường dẫn xem trực tuyến',
  updatedRange: 'Vùng dữ liệu đã cập nhật',
  spreadsheetUrl: 'Đường dẫn trang tính',
  spreadsheetId: 'Trang tính đích',
  cardId: 'Thẻ Trello',
  id: 'Mã mục vừa tạo',
  issueKey: 'Mã công việc Jira',
  key: 'Mã công việc',
  messageId: 'Mã tin nhắn',
  threadId: 'Chuỗi hội thoại email',
  eventId: 'Sự kiện Lịch',
  subject: 'Tiêu đề email',
  title: 'Tiêu đề',
  name: 'Tên mục',
  summary: 'Tóm tắt nội dung',
  text: 'Nội dung',
  body: 'Nội dung',
  items: 'Danh sách kết quả',
  rows: 'Dữ liệu bảng tính',
  cards: 'Danh sách thẻ',
  messages: 'Danh sách email',
  events: 'Danh sách lịch hẹn',
  issues: 'Danh sách công việc',
  start: 'Thời gian bắt đầu',
  end: 'Thời gian kết thúc',
  due: 'Hạn hoàn thành',
  dueDate: 'Hạn hoàn thành',
  channel: 'Kênh nhận tin',
  to: 'Người nhận',
  from: 'Người gửi',
};

export function friendlyFieldLabel(field: string): string {
  const trimmed = field.trim();
  if (!trimmed) return 'Dữ liệu kết quả';
  const direct = FRIENDLY_FIELD_LABELS[trimmed] ?? FRIENDLY_FIELD_LABELS[trimmed.toLowerCase()];
  if (direct) return direct;
  const lastSegment = trimmed.split('.').pop()?.replace(/\[\d*\]/g, '') ?? trimmed;
  if (FRIENDLY_FIELD_LABELS[lastSegment]) return FRIENDLY_FIELD_LABELS[lastSegment];
  return lastSegment.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
}

export const serviceId=(tool:string)=>toolDefinition(tool)?.service ?? tool.split('.')[0];
export const serviceName=(id:string,services:ServiceInfo[]=[])=>{
  const resolved=services.find(service=>service.id===id)?.name;
  if (resolved && resolved !== id && resolved !== 'MyCalendar' && resolved !== 'MySheets') return resolved;
  return FRIENDLY_SERVICE_NAMES[id] ?? getServiceDefinition(id)?.name ?? resolved ?? id;
};
export function servicePalette(id:string) { const palette=palettes[id] ?? {icon:'bg-neutral-100 border-neutral-200',name:'text-neutral-800'}; return {...palette,badge:palette.badge ?? `${palette.icon.split(' ').filter(cls=>cls.startsWith('bg-')).join(' ')} ${palette.name}`,receiptHover:palette.receiptHover ?? 'hover:border-neutral-300'}; }
export function operation(tool:string):Operation {
  if(tool==='myslack.chat_postMessage')return {action:'Gửi tin',done:'Đã gửi',receipt:'Đã gửi trên Slack',kind:'Tin nhắn',link:'Mở Slack'};
  if(operations[tool]) return operations[tool];
  const verb=tool.split('.')[1] ?? '';
  const isRead=toolDefinition(tool)?.sideEffect==='read' || /^(search|find|list|get|read|query|fetch)(_|$)/i.test(verb);
  const action=isRead ? 'Tra cứu dữ liệu' : /^create/.test(verb) ? 'Tạo mới' : /^(send|post)/.test(verb) ? 'Gửi tin' : 'Cập nhật';
  return {action,done:isRead?'Đã tra cứu':action==='Tạo mới'?'Đã tạo':action==='Gửi tin'?'Đã gửi':'Đã cập nhật',receipt:isRead?'Đã tra cứu':'Đã hoàn thành',kind:isRead?'Dữ liệu':action,link:'Mở kết quả'};
}
export const statusLabel=(status:StepState)=>({pending:'Chờ',running:'Đang chạy',succeeded:'Hoàn thành',failed:'Lỗi đã biết',paused:'Tạm dừng',skipped:'Đã bỏ qua',unknown:'Chưa rõ kết quả'})[status];
export function formatDuration(milliseconds:number):string {
  if(milliseconds<100) return '< 0,1 giây';
  return `${(milliseconds/1000).toLocaleString('vi-VN',{minimumFractionDigits:1,maximumFractionDigits:1})} giây`;
}
export function resultObject(output:unknown):Record<string,unknown>|null {
  if(typeof output==='string') {try {output=JSON.parse(output);}catch {return null;}}
  return output && typeof output==='object' && !Array.isArray(output) ? output as Record<string,unknown> : null;
}
export function outcomeURL(step:ExecutionStepInfo):string|undefined {
  if(step.status!=='succeeded') return;
  const output=resultObject(step.output);
  for(const field of ['url','html_url','webUrl','permalink']) {
    const value=output?.[field]; if(typeof value!=='string') continue;
    try {const url=new URL(value); if(url.protocol==='https:' && !url.username && !url.password) return value;}catch { /* Untrusted output is kept only in technical details. */ }
  }
}
export function outcomeMeetURL(step:ExecutionStepInfo):string|undefined {
  if(step.status!=='succeeded') return;
  const output=resultObject(step.output);
  const value=output?.meetLink;
  if(typeof value!=='string') return;
  try {
    const url=new URL(value);
    if(url.protocol==='https:' && !url.username && !url.password) return value;
  } catch { /* Untrusted output is kept only in technical details. */ }
}
export function resultTitle(step:ExecutionStepInfo):string {
  if(step.status!=='succeeded') return step.description;
  const op=operation(step.tool), output=resultObject(step.output), value=op.titleField && output?.[op.titleField];
  return typeof value==='string' || typeof value==='number' ? `${op.titlePrefix ?? ''}${value}` : step.description;
}
export function OutcomeLink({step,className}:{step:ExecutionStepInfo;className:string}) {
  const url=outcomeURL(step); return url ? <a href={url} target="_blank" rel="noopener noreferrer" className={className}>{operation(step.tool).link}</a> : null;
}

export interface MultiServicePlaybook { id:string; title:string; services:string[]; prompt:string }
export const multiServicePlaybooks:MultiServicePlaybook[]=(assets as {playbooks?:MultiServicePlaybook[]}).playbooks ?? [];

export interface ReceiptReference { from:string; to:string; field:string }
/** Only explicit executor reference constructs create a data edge; dependsOn is merely ordering. */
export function receiptReferences(steps:PlanStep[]):ReceiptReference[] {
  const edges:ReceiptReference[]=[];
  for(let index=0;index<steps.length;index++) {
    const step=steps[index], earlier=new Set(steps.slice(0,index).map(row=>row.id));
    const add=(path:string)=>{const match=path.match(/^([^\.]+)\.output\.(.+)$/);if(match && earlier.has(match[1]) && !edges.some(edge=>edge.from===match[1] && edge.to===step.id && edge.field===match[2])) edges.push({from:match[1],to:step.id,field:match[2]});};
    const visit=(value:unknown):void=>{
      if(Array.isArray(value)){value.forEach(visit);return;}
      if(!value || typeof value!=='object')return;
      const record=value as Record<string,unknown>;
      if(typeof record.$ref==='string') add(record.$ref);
      if(typeof record.$template==='string') for(const match of record.$template.matchAll(/\$\{([^}]+)\}/g)) add(match[1].trim());
      Object.entries(record).filter(([key])=>key!=='$ref' && key!=='$template').forEach(([,child])=>visit(child));
    };
    visit(step.args);
  }
  return edges;
}

export interface StepDataFlowBadge { fromStepId:string; fromIndex:number; toStepId:string; toIndex:number; field:string }
export function planStepDataFlows(steps:PlanStep[]):StepDataFlowBadge[] {
  const indexById=new Map(steps.map((s,i)=>[s.id,i+1]));
  const rawEdges=receiptReferences(steps);
  return rawEdges.map(edge=>({
    fromStepId:edge.from,
    fromIndex:indexById.get(edge.from) ?? 1,
    toStepId:edge.to,
    toIndex:indexById.get(edge.to) ?? 2,
    field:edge.field,
  }));
}
