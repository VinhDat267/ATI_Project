import { getServiceDefinition, getToolDefinition } from '@wap/tool-schemas';
import assets from '../../assets/cockpit-services.json';
import type { PlanStep, ServiceInfo, StepState } from '../../types';
import type { ExecutionStepInfo } from '../../components/ExecutionProgress';

interface Palette { icon:string; name:string; logo?:string; badge?:string; previewBadge?:string; receiptHover?:string }
interface Operation { action:string; done:string; receipt:string; kind:string; link:string; titleField?:string; titlePrefix?:string; previewStyle?:string }
const palettes:Record<string,Palette>=Object.fromEntries(Object.entries(assets.services).map(([id,value])=>[id,{...value.suggestion,...value}]));
const operations:Record<string,Operation>=assets.operations;
export const serviceId=(tool:string)=>getToolDefinition(tool)?.service ?? tool.split('.')[0];
export const serviceName=(id:string,services:ServiceInfo[])=>services.find(service=>service.id===id)?.name ?? getServiceDefinition(id)?.name ?? id;
export function servicePalette(id:string) { const palette=palettes[id] ?? {icon:'bg-neutral-100 border-neutral-200',name:'text-neutral-800'}; return {...palette,badge:palette.badge ?? `${palette.icon.split(' ').filter(cls=>cls.startsWith('bg-')).join(' ')} ${palette.name}`,receiptHover:palette.receiptHover ?? 'hover:border-neutral-300'}; }
export function operation(tool:string):Operation {
  if(operations[tool]) return operations[tool];
  const verb=tool.split('.')[1] ?? '';
  const action=getToolDefinition(tool)?.sideEffect==='read' ? 'Đọc' : /^create/.test(verb) ? 'Tạo mới' : /^(send|post)/.test(verb) ? 'Gửi tin' : 'Cập nhật';
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
