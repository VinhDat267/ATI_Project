// Source: AppStagePage.tsx moment-5 and execution state classes. No demo timer or simulated progress.
import type { PlanStep } from '../../types';
import type { ExecutionStepInfo } from '../../components/ExecutionProgress';
import { ServiceLogo } from '../../components/ServiceLogo';
import { operation, serviceId, servicePalette, statusLabel, OutcomeLink } from './presentation';
const ITEM_DONE = 'p-4 bg-white rounded-2xl border border-brand-border shadow-sm flex items-center justify-between gap-3';
const ITEM_RUNNING = 'p-4 bg-white rounded-2xl border-2 border-brand-primary shadow-orange-glow animate-pulse-soft flex items-center justify-between gap-3 opacity-100';
const ITEM_SKIPPED = 'p-4 bg-neutral-100 rounded-2xl border border-neutral-300 flex items-center justify-between gap-3 opacity-80';
const BADGE_DONE = 'text-xs text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded font-medium';
const BADGE_RUNNING = 'text-xs text-brand-primary bg-orange-50 px-1.5 py-0.5 rounded font-medium';
const ITEM_PENDING='p-4 bg-neutral-50 rounded-2xl border border-dashed border-neutral-200 flex items-center justify-between gap-3 opacity-60';
const BADGE_PENDING='text-xs text-neutral-500 bg-neutral-200 px-1.5 py-0.5 rounded font-medium';
export function ExecutionMoment({steps,planSteps,labels,destination}:{steps:ExecutionStepInfo[];planSteps:PlanStep[];labels?:Record<string,string>;destination:(step:PlanStep,labels?:Record<string,string>)=>string}){
 const completed=steps.filter(step=>['succeeded','skipped'].includes(step.status)).length;
 const running=steps.findIndex(step=>step.status==='running');
 const current=running<0 ? Math.min(completed+1,steps.length) : running+1;
 return (<section id="moment-5" className="stage-section is-active v3-space-y-6" aria-label="Cockpit" data-moment="5" aria-labelledby="heading-moment-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 id="heading-moment-5" className="font-display text-3xl sm:text-4xl text-brand-text font-normal leading-tight" tabIndex={-1}>
                Đang thực hiện công việc
              </h1>
              <p className="text-sm text-brand-muted mt-1">
                Xin vui lòng chờ một lát, tôi đang thao tác theo thứ tự.
              </p>
            </div>
            <div className="text-right">
              <div id="exec-progress-label" className="inline-flex items-center gap-1.5 px-3 py-1 bg-orange-50 text-brand-primary font-semibold text-xs rounded-full border border-orange-200">
                <span className="w-2 h-2 rounded-full bg-brand-primary animate-pulse" />
                <span id="exec-step-counter">
                  {`Việc ${current}/${steps.length}`}
                </span>
              </div>
            </div>
          </div>
          <div className="w-full bg-neutral-200 h-1.5 rounded-full overflow-hidden">
            <div id="exec-progress-bar" className="bg-brand-primary h-full transition-all duration-500 rounded-full" role="progressbar" aria-label="Tiến độ công việc" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={completed} style={{ width: `${steps.length ? completed/steps.length*100 : 0}%` }} />
          </div>
          {/* NHÓM 4 & 8: Thời lượng viết kiểu Việt Nam "1,2 giây", font thân, icon SVG dịch vụ */}
          <div className="v3-space-y-3" id="exec-timeline">
            {steps.map((step,index)=>{const service=serviceId(step.tool), palette=servicePalette(service); return (
            <div key={step.id} id={`exec-item-${index+1}`} className={step.status === 'running' ? ITEM_RUNNING : step.status === 'pending' ? ITEM_PENDING : step.status === 'skipped' ? ITEM_SKIPPED : ITEM_DONE}>
              <div className="flex items-center gap-3 min-w-0">
                <div id={`exec-icon-${index+1}`} className={`w-8 h-8 rounded-xl ${palette.icon} flex items-center justify-center flex-shrink-0 border shadow-sm`}><ServiceLogo service={service} className={`w-4 h-4 ${palette.logo ?? ''}`}/></div>
                <div className="min-w-0">
                  <div className={step.status==='pending' || step.status==='skipped' ? 'text-sm font-medium text-neutral-700 flex items-center gap-2 flex-wrap' : 'text-sm font-semibold text-brand-text flex items-center gap-2 flex-wrap'}>
                    <span className="truncate">
                      {step.description}
                    </span>
                    <span id={`exec-badge-${index+1}`} className={`${step.status === 'succeeded' ? BADGE_DONE : step.status === 'running' ? BADGE_RUNNING : BADGE_PENDING} flex-shrink-0`}>
                      {step.status === 'succeeded' ? `✓ ${operation(step.tool).done}` : statusLabel(step.status)}
                    </span>
                  </div>
                  <div className={step.status==='running' ? 'text-xs text-brand-primary font-normal mt-0.5 truncate' : step.status==='pending' ? 'text-xs text-neutral-500 mt-0.5 truncate' : 'text-xs text-neutral-600 font-normal mt-0.5 truncate'}>
                    {destination(planSteps.find(row=>row.id===step.id) ?? {id:step.id,tool:step.tool,description:step.description,args:{}}, labels)}
                    {step.status === 'succeeded' && <OutcomeLink step={step} className={`${palette.name} hover:underline`}/>}
                  </div>
                </div>
              </div>
              <span id={`exec-time-${index+1}`} className={step.status==='running' ? 'text-xs font-semibold text-brand-primary font-body flex-shrink-0' : step.status==='pending' || step.status==='skipped' ? 'text-xs text-neutral-400 font-body flex-shrink-0' : 'text-xs text-neutral-500 font-body flex-shrink-0'}>
                {step.status === 'succeeded' ? step.duration : statusLabel(step.status)}
              </span>
            </div>
            );})}
          </div>
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-brand-muted">
              Đang chạy tự động an toàn
            </span>
          </div>
        </section>);
}
