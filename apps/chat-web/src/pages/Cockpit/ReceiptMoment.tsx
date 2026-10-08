// Source: AppStagePage.tsx moment-6. Receipt connections come only from approved-plan references.
import { Fragment } from 'react';
import { getToolDefinition } from '@wap/tool-schemas';
import type { PlanStep,ServiceInfo } from '../../types';
import { ServiceLogo } from '../../components/ServiceLogo';
import { ResultFields, type ExecutionStepInfo } from '../../components/ExecutionProgress';
import { operation,serviceId,serviceName,servicePalette,statusLabel,resultTitle,outcomeURL,receiptReferences } from './presentation';
interface CardProps {services:ServiceInfo[];planSteps:PlanStep[];labels?:Record<string,string>;destination:(step:PlanStep,labels?:Record<string,string>)=>string}
function ReceiptCard({step,index,services,planSteps,labels,destination}:CardProps & {step:ExecutionStepInfo;index:number}) { const service=serviceId(step.tool),palette=servicePalette(service);return (<div className={`receipt-stagger-${Math.min(index+1,4)} flex-1 bg-white rounded-2xl border border-brand-border p-4 sm:p-5 shadow-soft-card flex flex-col justify-between ${palette.receiptHover} transition-all group`} aria-label={serviceName(service,services)}>
                  <div className="v3-space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-8 h-8 rounded-xl ${palette.icon} flex items-center justify-center p-1.5 border shadow-sm flex-shrink-0`}><ServiceLogo service={service} className={`w-4 h-4 ${palette.logo ?? ''}`}/></div>
                        <span className="text-xs font-semibold text-brand-muted uppercase tracking-wider truncate">
                          {serviceName(service,services)} {operation(step.tool).kind}
                        </span>
                      </div>
                      <span className={`text-[11px] font-semibold ${step.status==='succeeded' ? 'text-emerald-600 bg-emerald-50' : 'text-neutral-600 bg-neutral-100'} px-2.5 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap`}>
                        {step.status==='succeeded' ? `✓ ${operation(step.tool).receipt}` : statusLabel(step.status)}
                      </span>
                    </div>
                    <div>
                      <h3 className="text-sm sm:text-base font-bold text-brand-text line-clamp-2 leading-snug">
                        {resultTitle(step)}
                      </h3>
                      <p className="text-xs text-brand-muted mt-1">
                        {destination(planSteps.find(row=>row.id===step.id) ?? {id:step.id,tool:step.tool,description:step.description,args:{}}, labels)}
                      </p>
                    </div>
                  </div>
                  <div className="pt-3 border-t border-brand-border-subtle mt-4 flex items-center justify-between">
                    {outcomeURL(step) && <a href={outcomeURL(step)} target="_blank" rel="noopener noreferrer" className={`text-xs font-semibold ${palette.name} hover:underline inline-flex items-center gap-1`}>
                      <span>{operation(step.tool).link}</span>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                    </a>}
                    {step.status==='succeeded' && step.duration && <span className="text-xs text-neutral-500 font-body">{step.duration}</span>}

                  </div>
                  {step.status==='succeeded' && getToolDefinition(step.tool)?.sideEffect==='read' && step.output!=null && <ResultFields output={step.output} tool={step.tool}/>}
                  <details className="mt-2 text-xs text-brand-muted"><summary>Chi tiết kỹ thuật</summary><code>{step.tool}</code>{step.completedAt && <time className="block" dateTime={step.completedAt}>{new Date(step.completedAt).toLocaleString('vi-VN',{hour12:false})}</time>}{step.status==='succeeded' && step.output!=null && <pre className="whitespace-pre-wrap break-all">{JSON.stringify(step.output,null,2)}</pre>}</details>
                </div>);}
function ReceiptConnector({from,to,label}:{from:string;to:string;label:string}) {return (<div data-receipt-connector data-from={from} data-to={to} className="connector-stagger-1 flex md:flex-col items-center justify-center py-1 md:py-0 md:px-1 flex-shrink-0">
                  <div className="hidden md:block w-4 lg:w-8 h-0.5 bg-neutral-300 my-auto" />
                  <span className="px-2 py-0.5 bg-neutral-100 text-neutral-600 border border-neutral-200 rounded-md text-[10px] font-medium whitespace-nowrap shadow-sm" title="Dữ liệu được truyền sang bước tiếp theo">
                    {' '}
                    <span className="md:hidden">
                      {label} ↓
                    </span>
                    {' '}
                    <span className="hidden md:inline">
                      {label} →
                    </span>
                    {' '}
                  </span>
                  <div className="hidden md:block w-4 lg:w-8 h-0.5 bg-neutral-300 my-auto" />
                </div>);}
function ReceiptBetweenRows({from,to,sourceLabel,targetLabel,field}:{from:string;to:string;sourceLabel:string;targetLabel:string;field:string}) {return (<div data-receipt-connector data-from={from} data-to={to} className="connector-stagger-2 flex items-center justify-center my-0.5 md:my-1 w-full">
                <div className="hidden md:flex items-center justify-between w-full px-4 gap-3 text-neutral-400">
                  <div className="flex-1 h-px bg-neutral-200" />
                  {' '}
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-neutral-100 border border-neutral-200 rounded-full text-[11px] font-medium text-neutral-600 shadow-sm" title="Dữ liệu được truyền giữa các bước trong kế hoạch đã duyệt">
                    <span>
                      {sourceLabel}
                    </span>
                    <svg className="w-3.5 h-3.5 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                    <span className="text-neutral-700 font-semibold">
                      {field}
                    </span>
                    <svg className="w-3.5 h-3.5 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                    <span>
                      {targetLabel}
                    </span>
                  </div>
                  {' '}
                  <div className="flex-1 h-px bg-neutral-200" />
                </div>
                {/* Mobile: xếp dọc nối tiếp 2 xuống 3 */}
                <div className="flex md:hidden items-center justify-center py-1">
                  <span className="px-2 py-0.5 bg-neutral-100 text-neutral-600 border border-neutral-200 rounded-md text-[10px] font-medium whitespace-nowrap shadow-sm" title="Dữ liệu được truyền sang bước tiếp theo">
                    {`${sourceLabel} · ${field} → ${targetLabel} ↓`}
                  </span>
                </div>
              </div>);}
export function ReceiptMoment({terminalStatus,steps,planSteps,services,labels,destination,totalDuration,onNewConversation,onFollowup,servicePrompt,onSettings,servicesLoading,servicesError}:CardProps & {terminalStatus?:string;steps:ExecutionStepInfo[];totalDuration?:string;onNewConversation:()=>void;onFollowup:(text:string)=>void;servicePrompt:(service:ServiceInfo)=>string;onSettings:()=>void;servicesLoading:boolean;servicesError:string|null}) {
 const rows:ExecutionStepInfo[][]=[];for(let index=0;index<steps.length;index+=2) rows.push(steps.slice(index,index+2));
 const ids=new Set(steps.map(step=>step.id)); const refs=receiptReferences(planSteps).filter(edge=>ids.has(edge.from) && ids.has(edge.to));
 const cardProps={services,planSteps,labels,destination};
 return (<section id={terminalStatus?"moment-unsuccessful":"moment-6"} className="stage-section is-active v3-space-y-7 w-full max-w-[1120px] mx-auto" aria-label="Cockpit" data-moment={terminalStatus?"unsuccessful":"6"} aria-labelledby="heading-moment-6">
          <div className="v3-space-y-3">
            <div className={`w-14 h-14 rounded-2xl ${terminalStatus?'bg-neutral-100 border-neutral-300 text-neutral-600':'bg-emerald-50 border-emerald-200 text-emerald-600'} flex items-center justify-center shadow-sm`}>
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path className="animate-draw-check" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={terminalStatus?'M6 6l12 12M6 18L18 6':'M5 13l4 4L19 7'} />
              </svg>
            </div>
            <div>
              <h1 id="heading-moment-6" className="font-display text-3xl sm:text-4xl lg:text-[42px] text-brand-text font-normal tracking-tight" tabIndex={-1}>
                {terminalStatus ? terminalStatus==='stopped'?'Kế hoạch đã dừng':terminalStatus==='rejected'?'Kế hoạch đã hủy':'Kế hoạch chưa hoàn thành' : <>Đã xong {steps.filter(step=>step.status==='succeeded').length} việc trên {new Set(steps.filter(step=>step.status==='succeeded').map(step=>serviceId(step.tool))).size} công cụ</>}
              </h1>
              {terminalStatus && <><p role="status" className="sr-only">{terminalStatus==='stopped'?'Quy trình đã dừng.':terminalStatus==='rejected'?'Kế hoạch đã hủy; chưa thực thi.':'Quy trình không hoàn thành.'}</p><p className="text-sm text-brand-muted mt-1.5">Đã làm {steps.filter(step=>step.status==='succeeded').length} việc; {steps.filter(step=>step.status!=='succeeded').length} việc chưa hoàn thành.</p></>}
              <div className="mt-1.5 flex items-center gap-2">
                {totalDuration && <span id="moment-6-duration-tag" className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold font-body">
                  Trong {totalDuration}
                </span>}
              </div>
            </div>
          </div>
          {/* NHÓM 7: Chuỗi 4 biên nhận dạng lưới 2x2 trên desktop (1->2 ở hàng trên, chuyển Z xuống 3, 3->4 ở hàng dưới), 1 cột trên mobile */}
          <div className="v3-space-y-3">
            <div id="receipt-chain" className="flex flex-col gap-3">
              {rows.map((row,rowIndex)=>{const horizontal=row.length===2 ? refs.filter(edge=>edge.from===row[0].id && edge.to===row[1].id):[];
                const incoming=refs.filter(edge=>row.some(step=>step.id===edge.to) && !horizontal.includes(edge));
                return <Fragment key={row[0].id}>
                  {incoming.map(edge=><ReceiptBetweenRows key={`${edge.from}-${edge.to}-${edge.field}`} from={edge.from} to={edge.to} sourceLabel={`${serviceName(serviceId(steps.find(s=>s.id===edge.from)!.tool),services)} (việc ${steps.findIndex(s=>s.id===edge.from)+1})`} targetLabel={`${serviceName(serviceId(steps.find(s=>s.id===edge.to)!.tool),services)} (việc ${steps.findIndex(s=>s.id===edge.to)+1})`} field={edge.field}/>)}
                  <div className={`grid grid-cols-1 ${horizontal.length ? 'md:grid-cols-[1fr_auto_1fr]' : 'md:grid-cols-2'} items-stretch md:items-center gap-3`}>
                    <ReceiptCard step={row[0]} index={rowIndex*2} {...cardProps}/>
                    {horizontal.length>0 && <ReceiptConnector from={row[0].id} to={row[1].id} label={horizontal.map(edge=>edge.field).join(' + ')}/>}
                    {row[1] && <ReceiptCard step={row[1]} index={rowIndex*2+1} {...cardProps}/>}
                  </div>
                </Fragment>;
              })}
            </div>
            {/* Dòng lưu ý theo NHÓM 7: Cần sửa? Nhắn thêm với tôi hoặc mở từng mục để chỉnh trực tiếp trên công cụ đó. */}
            <div className="text-xs text-brand-muted text-center sm:text-left pt-1">
              Cần sửa? Nhắn thêm với tôi hoặc mở từng mục để chỉnh trực tiếp trên công cụ đó.
            </div>
          </div>
          {/* NHÓM 7: "Tiếp theo" với 2 gợi ý theo kết quả vừa có + nút Nhờ việc khác */}
          <div className="pt-4 border-t border-brand-border v3-space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
              Tiếp theo:
            </div>
            <div role="group" aria-label="Gợi ý tiếp theo" className="flex flex-wrap items-center gap-2.5">
              {services.filter(service=>service.configured).slice(0,2).map(service=><button key={service.id} type="button" onClick={()=>onFollowup(servicePrompt(service))} className="px-4 py-2.5 bg-white hover:bg-neutral-50 border border-brand-border hover:border-brand-primary text-brand-text text-xs sm:text-sm font-medium rounded-xl shadow-sm transition-all flex items-center gap-2 group"><span className="text-brand-primary font-bold">+</span><span>{servicePrompt(service)}</span></button>)}
              {!servicesLoading && !servicesError && !services.some(service=>service.configured) && <p className="text-xs text-brand-muted">Chưa có dịch vụ nào được kết nối. <a href="/settings" onClick={event=>{event.preventDefault();onSettings();}} className="underline">Kết nối thêm</a></p>}
              <button type="button" onClick={onNewConversation} className="px-5 py-2.5 bg-brand-primary hover:bg-brand-primary-hover text-white text-xs sm:text-sm font-semibold rounded-xl shadow-sm transition-all">Nhờ việc khác</button>
            </div>
          </div>
        </section>);
}
