// Source: AppStagePage.tsx moments 7–9. Demo data/actions replaced by durable execution state.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { ExecutionSnapshot, PlanStep, ServiceInfo } from '../../types';
import type { ExecutionStepInfo } from '../../components/ExecutionProgress';
import { CockpitDialog } from '../../components/CockpitDialog';
import { OutcomeLink, serviceId, serviceName, serviceRecoveryLink, statusLabel } from './presentation';
import { RecoveryEditor } from './RecoveryEditor';

export interface RecoveryControls {
  busy: boolean; error: string | null;
  onRetry: (stepId: string) => void; onSkip: (stepId: string) => void;
  onStop: () => void; onContinue: () => void;
  onEdit: (stepId: string, args: Record<string, unknown>, prompt?: string) => void;
}
const primary='px-6 py-3 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-semibold rounded-xl shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50';
const secondary='px-5 py-3 bg-white hover:bg-neutral-100 border border-brand-border text-brand-text text-sm font-medium rounded-xl shadow-sm transition-colors disabled:opacity-50';
const card='bg-white rounded-2xl border border-brand-border p-5 sm:p-6 shadow-soft-card v3-space-y-4';

/** Reference values shown for manual inspection come only from saved successful outputs. */
export function savedArguments(value: unknown, snapshot: ExecutionSnapshot): unknown {
  const resolve = (path: string): unknown => {
    const [id, ...keys] = path.split('.');
    const row=snapshot.steps.find(step=>step.stepId===id && step.status==='succeeded');
    if(!row || row.output==null) return undefined;
    let result:unknown=typeof row.output==='object' && Object.hasOwn(row.output,'output') ? row.output : {output:row.output};
    for(const key of keys) { if(!result || typeof result!=='object' || !Object.hasOwn(result,key)) return undefined; result=(result as Record<string,unknown>)[key]; }
    return keys.length ? result : row.output;
  };
  if(Array.isArray(value)) return value.map(item=>savedArguments(item,snapshot));
  if(value && typeof value==='object') {
    const record=value as Record<string,unknown>;
    if(typeof record.$ref==='string') {const result=resolve(record.$ref);return result===undefined?value:result;}
    if(typeof record.$template==='string') return record.$template.replace(/\$\{([^}]+)\}/g,(token,path:string)=>{const result=resolve(path.trim());return result===undefined ? token : result===null ? '' : String(result);});
    return Object.fromEntries(Object.entries(record).map(([key,item])=>[key,savedArguments(item,snapshot)]));
  }
  return value;
}
/** Links are grounded in saved arguments; no guessed resource id or success output. */
export function recoveryDestination(step?:PlanStep):string|undefined {
  if(!step) return;
  const safe=(value:unknown)=>{if(typeof value!=='string')return;try{const url=new URL(value);if(url.protocol==='https:' && !url.username && !url.password)return url.href;}catch{/* Opaque ids are not URLs. */}};
  for(const field of ['url','siteUrl','site_url','webUrl']) {const url=safe(step.args[field]);if(url)return url;}
  const target=serviceRecoveryLink(serviceId(step.tool));
  if(target && typeof step.args[target.argument]==='string' && safe(target.url)) {const url=new URL(target.url);url.searchParams.set(target.query,step.args[target.argument] as string);return url.href;}
  return;
}
function SavedWork({steps}:{steps:ExecutionStepInfo[]}) { return <div className="v3-space-y-2.5 pt-2">{steps.map((step,index)=>
  <div key={step.id} className={step.status==='succeeded' ? 'p-3 rounded-xl bg-neutral-50 border border-neutral-200 flex items-center justify-between text-xs sm:text-sm gap-3' : 'p-3 rounded-xl bg-white border border-dashed border-neutral-300 flex items-center justify-between text-xs sm:text-sm text-neutral-500 gap-3'}>
    <div className="flex items-center gap-2.5 min-w-0"><span className={`w-5 h-5 rounded-full ${step.status==='succeeded'?'bg-emerald-100 text-emerald-700':'bg-neutral-200 text-neutral-600'} flex items-center justify-center font-bold text-xs flex-shrink-0`}>{step.status==='succeeded'?'✓':index+1}</span><span className={step.status==='succeeded'?'font-medium text-neutral-800 break-words min-w-0':'break-words min-w-0'}>Việc {index+1}: {step.description}</span></div>
    <div className="flex-shrink-0">{step.status==='succeeded' && step.duration && <span className="text-xs text-neutral-500 mr-2">{step.duration}</span>}<OutcomeLink step={step} className="text-brand-primary hover:underline font-medium inline-flex items-center gap-1"/>{step.status!=='succeeded' && <span className="text-neutral-500 italic">{step.status==='pending'?'Chưa làm':statusLabel(step.status)}</span>}</div>
  </div>)}</div>; }
export function RecoveryMoment({moment,snapshot,steps,services,controls}:{moment:7|8|9;snapshot:ExecutionSnapshot|null;steps:ExecutionStepInfo[];services:ServiceInfo[];controls:RecoveryControls|null}) {
  const [dialog,setDialog]=useState<'stop'|'edit'|null>(null);
  const unknown=steps.filter(step=>step.status==='unknown');
  const paused=steps.find(step=>step.id===snapshot?.execution.pausedStepId && (step.status==='unknown'||step.status==='failed')) ?? unknown[0] ?? steps.find(step=>step.status==='failed');
  const planStep=snapshot?.plan.steps?.find(step=>step.id===paused?.id);
  const actions=snapshot?.recoveryActions ?? [];
  const busy=controls?.busy ?? false;
  const service=serviceName(serviceId(paused?.tool ?? ''),services);
  const destination=recoveryDestination(planStep && snapshot ? {...planStep,args:savedArguments(planStep.args,snapshot) as Record<string,unknown>}:planStep);
  const hasUnknown=unknown.length>0;
  const canRetry=moment===7 && !hasUnknown && paused?.status==='failed' && actions.includes('retry');
  const canContinue=moment===9 && !hasUnknown && !steps.some(step=>['failed','running'].includes(step.status)) && actions.includes('continue');
  const error=paused?.error ?? 'Dịch vụ không thể hoàn thành việc này.';
  const unknownInstructions=<>
    <p className="text-base text-brand-text leading-relaxed">Tôi không chắc lệnh đã tới {service || 'dịch vụ'} hay chưa. Hãy kiểm tra trên {service || 'dịch vụ'} trước khi quyết định.</p>
    <div className="v3-space-y-2 p-4 rounded-xl bg-neutral-50 border border-neutral-200 text-xs sm:text-sm"><div className="font-semibold text-neutral-800">Hướng dẫn xử lý:</div><ul className="v3-space-y-1.5 text-neutral-700">
      <li className="flex items-start gap-2"><span className="text-emerald-600 font-bold">•</span><span>Nếu đã thấy kết quả → bỏ qua bước này và làm tiếp.</span></li>
      <li className="flex items-start gap-2"><span className="text-red-600 font-bold">•</span><span>Nếu chưa có: dừng kế hoạch rồi gửi lại yêu cầu.</span></li>
    </ul></div><div className="text-xs text-neutral-500 italic">* Lưu ý an toàn: Để tránh ghi lặp, hệ thống không thử lại ở bước chưa rõ kết quả.</div>
  </>;
  return <section id={`moment-${moment}`} className="stage-section is-active v3-space-y-6" aria-label="Cockpit" data-moment={moment} aria-labelledby={`heading-moment-${moment}`} aria-busy={busy}>
    <div className="v3-space-y-2">
      <div className={`inline-flex items-center gap-1.5 px-3 py-1 ${moment===7?'bg-red-50 text-red-700 border-red-200':moment===8?'bg-amber-50 text-amber-800 border-amber-200':'bg-neutral-100 text-neutral-800 border-neutral-300'} text-xs font-semibold rounded-lg border`}>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={moment===7?'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z':moment===8?'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z':'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15'}/></svg>
        <span>{moment===7?'Cần bạn xử lý · Lỗi đã biết':moment===8?'Cần bạn xử lý · Chưa chắc kết quả':'Khôi phục phiên làm việc'}</span>
      </div>{' '}
      <h1 id={`heading-moment-${moment}`} className="font-display text-3xl sm:text-4xl text-brand-text font-normal leading-tight" tabIndex={-1}>{moment===7?`${service} chưa hoàn thành việc này`:moment===8?`Chưa rõ kết quả trên ${service}`:'Hệ thống vừa khởi động lại'}</h1>
      {moment===7 && <p className="text-sm text-brand-muted">{paused?.description}</p>}
    </div>
    <div className={card}>
      {moment===7 ? <>
        <div className="v3-space-y-1"><div className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Chuyện gì đã xảy ra</div><p className="text-sm text-brand-text leading-relaxed">{error}</p></div>
        <div className="v3-space-y-1 pt-3 border-t border-brand-border-subtle"><div className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Ảnh hưởng hiện tại</div><div className="text-sm text-brand-text v3-space-y-1">{steps.filter(step=>step.status==='succeeded' || step.status==='pending').map(step=><div key={step.id} className={`flex items-center gap-2 ${step.status==='succeeded'?'text-emerald-700':'text-amber-700'}`}><span className="font-bold">{step.status==='succeeded'?'✓':'!'}</span><span>Việc {steps.indexOf(step)+1} ({serviceName(serviceId(step.tool),services)}): {step.status==='succeeded'?'đã xong và được giữ nguyên.':'tạm thời chưa làm.'} <OutcomeLink step={step} className="text-brand-primary hover:underline font-medium inline-flex items-center gap-1"/></span></div>)}</div></div>
        <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs sm:text-sm text-brand-text v3-space-y-1"><span className="font-semibold text-brand-primary">Cần làm gì:</span>{' '}<p>Kiểm tra quyền truy cập và nội dung của việc chưa làm, rồi chọn cách xử lý dưới đây.</p></div>
      </> : moment===8 ? unknownInstructions : <>
        <p className="text-base text-brand-text leading-relaxed">Hệ thống vừa khởi động lại trong lúc đang làm việc của bạn. Các kết quả đã lưu được giữ nguyên; các việc còn chờ chưa từng được gửi tới dịch vụ.</p>
        <SavedWork steps={steps}/>
        {hasUnknown ? unknownInstructions : !canContinue && <p className="text-xs text-brand-muted">Chưa đủ dữ liệu để làm tiếp an toàn. Bạn chỉ có thể dừng kế hoạch này.</p>}
      </>}
      {paused && <details className="text-xs text-brand-muted"><summary>Chi tiết để đối chiếu</summary><code>{paused.tool}</code><p>{paused.description}</p>{planStep && snapshot && <pre className="whitespace-pre-wrap break-all">{JSON.stringify(savedArguments(planStep.args,snapshot),null,2)}</pre>}{paused.duration && <p>{paused.duration}</p>}</details>}
    </div>
    {controls?.error && <p role="alert" className="text-sm text-brand-danger">{controls.error}</p>}
    <div className="flex flex-wrap items-center gap-3">
      {canRetry && <><button type="button" disabled={busy} onClick={()=>paused && controls?.onRetry(paused.id)} className={primary}>Thử lại việc {steps.findIndex(step=>step.id===paused?.id)+1}</button><button id="btn-recovery-edit" type="button" disabled={busy || !actions.includes('stop')} onClick={()=>setDialog('edit')} className={secondary}>Sửa rồi thử lại</button></>}
      {canContinue && <button type="button" disabled={busy} onClick={()=>controls?.onContinue()} className={primary}>Làm tiếp các việc còn lại</button>}
      {paused && actions.includes('skip') && <button type="button" disabled={busy} onClick={()=>controls?.onSkip(paused.id)} className={hasUnknown?primary:secondary}>{hasUnknown?'Đã thấy kết quả → Bỏ qua bước này và làm tiếp':'Bỏ qua việc này'}</button>}
      {actions.includes('stop') && <button id="btn-recovery-stop" type="button" disabled={busy} onClick={()=>setDialog('stop')} className={moment===7?'px-4 py-3 text-sm font-medium text-brand-muted hover:text-brand-danger transition-colors disabled:opacity-50':secondary}>Dừng kế hoạch</button>}
      {hasUnknown && destination && <a href={destination} target="_blank" rel="noopener noreferrer" className="px-4 py-3 text-sm font-medium text-brand-muted hover:text-brand-text inline-flex items-center gap-1.5 transition-colors">Kiểm tra trên {service}<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg></a>}
    </div>
    {busy && <p role="status" className="text-xs text-brand-muted">Đang gửi yêu cầu và tải lại trạng thái…</p>}
    {dialog==='stop' && createPortal(<CockpitDialog title="Dừng kế hoạch?" returnFocusId="btn-recovery-stop" onClose={()=>{if(!busy)setDialog(null);}}><div className="p-5 v3-space-y-4"><p>Không thể chạy tiếp sau khi dừng. Các kết quả đã có và bằng chứng chưa rõ kết quả được giữ nguyên.</p><button type="button" disabled={busy} className={secondary} onClick={()=>setDialog(null)}>Tiếp tục xem</button><button type="button" disabled={busy} className={primary} onClick={()=>{setDialog(null);controls?.onStop();}}>Dừng hẳn quy trình</button></div></CockpitDialog>,document.body)}
    {dialog==='edit' && paused && createPortal(<RecoveryEditor tool={paused.tool} stepArgs={snapshot && planStep ? savedArguments(planStep.args,snapshot) as Record<string,unknown> : planStep?.args} busy={busy} onClose={()=>setDialog(null)} onSubmit={(args,prompt)=>{setDialog(null);controls?.onEdit(paused.id,args,prompt);}}/>,document.body)}
  </section>;
}
