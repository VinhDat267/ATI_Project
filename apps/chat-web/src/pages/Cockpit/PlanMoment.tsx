// Source: AppStagePage.tsx moment-4. Demo actions replaced with the approved-plan API callbacks.
import { useState, type ReactNode } from 'react';
import type { ActivePlan, PlanStep, ServiceInfo } from '../../types';
import { ServiceLogo } from '../../components/ServiceLogo';
import { operation, serviceId, servicePalette, serviceName } from './presentation';
export function PlanMoment({plan,services,destination,onPreview,onApprove,onCancel,onEdit,inlineComposer}:{plan:ActivePlan;services:ServiceInfo[];destination:(step:PlanStep,labels?:Record<string,string>)=>string;onPreview:(step:PlanStep)=>void;onApprove:()=>void;onCancel:()=>void;onEdit:()=>void;inlineComposer:ReactNode}) {
 const [techOpen,setTechOpen]=useState(false);
 return (<section id="moment-4" className="stage-section is-active v3-space-y-6 relative" aria-label="Cockpit" data-moment="4" aria-labelledby="heading-moment-4">
          <div className="v3-space-y-2">
            <h1 id="heading-moment-4" className="font-display text-4xl sm:text-5xl text-brand-text font-normal tracking-tight leading-tight" tabIndex={-1}>
              Tôi sẽ làm {plan.steps.length} việc, theo thứ tự
            </h1>
            <p className="text-sm sm:text-base text-brand-muted">
              Xin hãy xem trước nội dung sẽ được ghi vào các công cụ dưới đây trước khi duyệt.
            </p>
          </div>
          {/* 4 Task Action Cards (NHÓM 2: Hiện so le dưới 300ms, NHÓM 8: Biểu tượng SVG) */}
          <div className="v3-space-y-3" id="plan-cards-container">
            {plan.steps.map((step,index) => { const service=serviceId(step.tool), palette=servicePalette(service); return (
            <article key={step.id} className={`plan-card-stagger-${Math.min(index+1, 4)} bg-white rounded-2xl border border-brand-border p-4 sm:p-5 shadow-soft-card transition-all hover:border-neutral-300`} data-od-id={`plan-item-${index+1}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className={`w-9 h-9 rounded-xl ${palette.icon} flex items-center justify-center flex-shrink-0 mt-0.5 border shadow-sm`}><ServiceLogo service={service} className={`w-4 h-4 ${palette.logo ?? ''}`} /></div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-semibold px-2 py-0.5 ${palette.badge} rounded-md`}>
                        {serviceName(service, services)}
                      </span>
                      <span className="text-xs font-medium px-2 py-0.5 bg-neutral-100 text-neutral-700 rounded-md">
                        {operation(step.tool).action}
                      </span>
                      <span className="text-xs text-brand-muted">
                        Việc {index+1}
                      </span>
                    </div>
                    <h2 className="text-base font-semibold text-brand-text mt-1.5 leading-snug">
                      {step.description}
                    </h2>
                    <p className="text-xs text-brand-muted mt-1">
                      Đích đến: {destination(step, plan.resourceLabels)}
                    </p>
                  </div>
                </div>
                <button id={`preview-${step.id}`} type="button" onClick={() => onPreview(step)} className="flex-shrink-0 px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-brand-text text-xs font-medium rounded-lg transition-colors inline-flex items-center gap-1.5" aria-label="Xem trước">
                  <svg className="w-3.5 h-3.5 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  <span>
                    Xem trước
                  </span>
                </button>
              </div>
            </article>
            ); })}
          </div>
          {/* Warning Banner */}
          <div className="p-4 rounded-xl bg-[#FFF6EE] border border-[#FFDFC6] flex items-start gap-3">
            <svg className="w-5 h-5 text-brand-primary flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="text-xs sm:text-sm text-neutral-800 v3-space-y-0.5">
              <div className="font-semibold text-neutral-900">
                Các thao tác này ghi thật vào công cụ của nhóm và không tự hoàn tác.
              </div>
              <div className="text-neutral-600">
                Kế hoạch được giữ trong 30 phút. Bạn có thể sửa đổi bằng chat hoặc bấm duyệt để bắt đầu ngay.
              </div>
            </div>
          </div>
          {plan.warnings?.map((warning,index)=><p key={index} className="text-xs text-brand-danger">{warning}</p>)}
          {!plan.id && <p role="alert">Kế hoạch thiếu mã định danh hợp lệ. Hãy tải lại hội thoại trước khi duyệt.</p>}
          {techOpen && <div id="tech-details-panel" className="p-4 rounded-xl bg-neutral-900 text-neutral-200 font-mono text-xs v3-space-y-3 border border-neutral-800"><pre className="whitespace-pre-wrap break-all">{JSON.stringify(plan,null,2)}</pre></div>}
          {/* NHÓM 1: Thanh hành động sticky ở đáy màn hình, luôn nhìn thấy và bấm được; KHÔNG bị che; có ô sửa qua chat ngay phía trên */}
          <div id="moment-4-sticky-bar" className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-[#F8F8F6]/95 backdrop-blur-md border-t border-brand-border mt-6 shadow-[0_-4px_16px_rgba(0,0,0,0.04)]">
            {/* Ô nhập sửa qua Chat ngay phía trên thanh hành động (Ẩn mặc định) */}
            {inlineComposer}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap w-full sm:w-auto">
                <button id="btn-approve-plan" type="button" aria-label="Duyệt kế hoạch" disabled={!plan.id} onClick={onApprove} className="w-full sm:w-auto px-5 sm:px-7 py-3 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm sm:text-base font-bold rounded-xl shadow-md transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2 flex-shrink-0">
                  <span>
                    Duyệt kế hoạch
                  </span>
                  <span className="text-base sm:text-lg">
                    ✓
                  </span>
                </button>
                <button id="btn-edit-plan" type="button" onClick={onEdit} className="px-3.5 sm:px-4 py-2.5 sm:py-3 bg-white hover:bg-neutral-100 border border-brand-border text-brand-text text-xs sm:text-sm font-medium rounded-xl shadow-sm transition-colors flex items-center justify-center gap-1.5 flex-shrink-0">
                  <svg className="w-4 h-4 text-brand-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  <span>
                    Sửa qua Chat
                  </span>
                </button>
                <button type="button" onClick={onCancel} className="px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-medium text-brand-muted hover:text-brand-danger transition-colors flex-shrink-0">
                  {" Hủy "}
                </button>
              </div>
              <div>
                <button type="button" onClick={() => setTechOpen(!techOpen)} aria-controls="tech-details-panel" className="text-xs text-brand-muted hover:text-brand-text font-mono inline-flex items-center gap-1.5 py-1 px-2 rounded hover:bg-neutral-100 transition-colors" aria-expanded={techOpen ? 'true' : 'false'} id="btn-tech-toggle">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                  <span>
                    Chi tiết kỹ thuật
                  </span>
                  <span id="tech-toggle-arrow">
                    {techOpen ? '▲' : '▼'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </section>);
}
