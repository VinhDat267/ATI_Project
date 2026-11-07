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
export const serviceId=(tool:string)=>toolDefinition(tool)?.service ?? tool.split('.')[0];
export const serviceName=(id:string,services:ServiceInfo[])=>services.find(service=>service.id===id)?.name ?? getServiceDefinition(id)?.name ?? id;
export function servicePalette(id:string) { const palette=palettes[id] ?? {icon:'bg-neutral-100 border-neutral-200',name:'text-neutral-800'}; return {...palette,badge:palette.badge ?? `${palette.icon.split(' ').filter(cls=>cls.startsWith('bg-')).join(' ')} ${palette.name}`,receiptHover:palette.receiptHover ?? 'hover:border-neutral-300'}; }
export const TOOL_ACTION_LABELS: Record<string, string> = {
  // Trello
  'trello.list_cards': 'Đọc danh sách công việc Trello',
  'trello.search_cards': 'Tìm thẻ công việc Trello',
  'trello.create_card': 'Tạo thẻ công việc Trello',
  'trello.add_member': 'Gán thành viên vào thẻ Trello',
  'trello.update_card': 'Cập nhật thẻ công việc Trello',
  'trello.add_comment': 'Thêm bình luận Trello',
  'trello.list_boards': 'Đọc danh sách bảng Trello',
  'trello.list_lists': 'Đọc danh sách cột Trello',

  // Slack
  'slack.post_message': 'Gửi thông báo Slack',
  'slack.send_message': 'Gửi thông báo Slack',
  'slack.list_channels': 'Đọc danh sách kênh Slack',
  'slack.search_channels': 'Tìm kênh Slack',
  'slack.list_messages': 'Đọc tin nhắn Slack',
  'slack.read_messages': 'Đọc tin nhắn Slack',

  // Google Sheets
  'mysheets.read_range': 'Đọc dữ liệu bảng tính Google Sheets',
  'mysheets.append_rows': 'Thêm dòng vào bảng tính Google Sheets',
  'mysheets.update_range': 'Cập nhật dữ liệu bảng tính Google Sheets',
  'mysheets.list_sheets': 'Đọc danh sách trang tính Google Sheets',
  'sheets.read_range': 'Đọc dữ liệu bảng tính Google Sheets',
  'sheets.append_rows': 'Thêm dòng vào bảng tính Google Sheets',
  'sheets.update_range': 'Cập nhật dữ liệu bảng tính Google Sheets',
  'sheets.list_sheets': 'Đọc danh sách trang tính Google Sheets',

  // Gmail
  'gmail.send_message': 'Gửi email Gmail',
  'gmail.reply': 'Trả lời email Gmail',
  'gmail.forward': 'Chuyển tiếp email Gmail',
  'gmail.search_threads': 'Tìm thư trong Gmail',
  'gmail.get_thread': 'Đọc nội dung thư Gmail',
  'gmail.list_labels': 'Đọc nhãn thư Gmail',
  'gmail.create_draft': 'Tạo bản nháp Gmail',
  'gmail.modify_thread_labels': 'Thay đổi nhãn thư Gmail',
  'gmail.trash_thread': 'Chuyển thư vào thùng rác',
  'gmail.create_label': 'Tạo nhãn thư mới trong Gmail',

  // Google Calendar
  'calendar.list_events': 'Đọc lịch hẹn Google Calendar',
  'calendar.create_event': 'Tạo sự kiện Google Calendar',
  'calendar.list_calendars': 'Đọc danh sách lịch Google Calendar',
  'mycalendar.list_events': 'Đọc lịch hẹn Google Calendar',
  'mycalendar.create_event': 'Tạo sự kiện Google Calendar',
  'mycalendar.list_calendars': 'Đọc danh sách lịch Google Calendar',

  // GitHub
  'github.search_issues': 'Tìm công việc trên GitHub',
  'github.list_issues': 'Đọc danh sách công việc GitHub',
  'github.get_issue': 'Đọc chi tiết công việc GitHub',
  'github.create_issue': 'Tạo công việc mới trên GitHub',
  'github.update_issue': 'Cập nhật công việc GitHub',
  'github.add_label': 'Gắn nhãn công việc GitHub',
  'github.add_comment': 'Thêm bình luận trên GitHub',
  'github.get_pull_request': 'Đọc pull request GitHub',
  'github.search_repos': 'Tìm kho mã nguồn GitHub',

  // Jira
  'jira.search_issues': 'Tìm công việc trên Jira',
  'myjira.search_issues': 'Tìm công việc trên Jira',
  'jira.create_issue': 'Tạo công việc Jira',
  'myjira.create_issue': 'Tạo công việc Jira',
  'jira.add_comment': 'Thêm bình luận Jira',
  'myjira.add_comment': 'Thêm bình luận Jira',
  'jira.search_projects': 'Tìm dự án Jira',
  'myjira.search_projects': 'Tìm dự án Jira',

  // Notion
  'notion.search': 'Tìm kiếm trong Notion',
  'notion.create_page': 'Tạo trang Notion',
  'notion.append_blocks': 'Thêm nội dung trang Notion',

  // Telegram
  'telegram.send_message': 'Gửi tin nhắn Telegram',
  'telegram.search_chats': 'Tìm cuộc trò chuyện Telegram',
};

const SERVICE_DISPLAY_NAMES: Record<string, string> = {
  trello: 'Trello',
  slack: 'Slack',
  sheets: 'Google Sheets',
  mysheets: 'Google Sheets',
  gmail: 'Gmail',
  calendar: 'Google Calendar',
  mycalendar: 'Google Calendar',
  github: 'GitHub',
  jira: 'Jira',
  myjira: 'Jira',
  notion: 'Notion',
  telegram: 'Telegram',
};

export function toolActionLabel(tool: string): string {
  if (TOOL_ACTION_LABELS[tool]) return TOOL_ACTION_LABELS[tool];
  const [service, ...actionParts] = tool.split('.');
  const serviceName = SERVICE_DISPLAY_NAMES[service] ?? service;
  const action = actionParts.join(' ');
  const actionVi = action.startsWith('list') ? 'Đọc danh sách'
    : action.startsWith('search') ? 'Tìm kiếm'
    : action.startsWith('get') ? 'Xem chi tiết'
    : action.startsWith('create') ? 'Tạo mới'
    : action.startsWith('update') ? 'Cập nhật'
    : action.startsWith('send') ? 'Gửi'
    : 'Thao tác';
  return `${actionVi} trên ${serviceName}`;
}

export function operation(tool:string):Operation {
  if(operations[tool]) return operations[tool];
  const verb=tool.split('.')[1] ?? '';
  const action=toolDefinition(tool)?.sideEffect==='read' ? 'Đọc' : /^create/.test(verb) ? 'Tạo mới' : /^(send|post)/.test(verb) ? 'Gửi tin' : 'Cập nhật';
  return {action,done:action==='Đọc'?'Đã đọc':action==='Tạo mới'?'Đã tạo':action==='Gửi tin'?'Đã gửi':'Đã cập nhật',receipt:action==='Đọc'?'Đã đọc':'Đã hoàn thành',kind:action,link:'Mở kết quả'};
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
  for(const field of ['url','html_url','webUrl']) {
    const value=output?.[field]; if(typeof value!=='string') continue;
    try {const url=new URL(value); if(url.protocol==='https:' && !url.username && !url.password) return value;}catch { /* Untrusted output is kept only in technical details. */ }
  }
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
