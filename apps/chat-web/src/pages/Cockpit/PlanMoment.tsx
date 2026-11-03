// Source: AppStagePage.tsx moment-4. Demo actions replaced with the approved-plan API callbacks.
import { useState, type ReactNode } from 'react';
import type { ActivePlan, PlanStep, ServiceInfo } from '../../types';
import { ServiceLogo } from '../../components/ServiceLogo';
import { WorkflowFlowCanvas } from '../../components/WorkflowFlowCanvas';
import { operation, planStepDataFlows, serviceId, servicePalette, serviceName } from './presentation';
import { formatCalendarDateTime, formatRecurrenceLabel } from './PreviewContents';
import { RequestEcho } from './RequestEcho';

function extractSuggestedFreeSlots(warning: string): string[] {
  const hintIndex = warning.indexOf('Gợi ý khung giờ trống');
  const targetText = hintIndex >= 0 ? warning.slice(hintIndex) : '';
  if (!targetText) return [];
  const matches = targetText.match(/\b\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}\b/g);
  return matches ? Array.from(new Set(matches.map(s => s.replace(/\s+/g, '')))) : [];
}

export function PlanMoment({request,runtimeMode,plan,services,destination,onPreview,onApprove,onCancel,onEdit,inlineComposer}:{request?:string;runtimeMode:'sandbox'|'live'|null;plan:ActivePlan;services:ServiceInfo[];destination:(step:PlanStep,labels?:Record<string,string>)=>string;onPreview:(step:PlanStep)=>void;onApprove:()=>void;onCancel:()=>void;onEdit:(prefillText?:string)=>void;inlineComposer:ReactNode}) {
 const [techOpen,setTechOpen]=useState(false);
 const slackRead = !!plan.connections?.myslack&&plan.steps.every(s=>s.tool!=='myslack.chat_postMessage');
 const slackPost=plan.steps.some(s=>s.tool==='myslack.chat_postMessage');
 const [selectedService,setSelectedService]=useState<string|null>(null);
 const dataFlows=planStepDataFlows(plan.steps);
 return (<section id="moment-4" className="stage-section is-active v3-space-y-6 relative" aria-label="Cockpit" data-moment="4" aria-labelledby="heading-moment-4">
          <div className="v3-space-y-2">
            <RequestEcho request={request} />
            <h1 id="heading-moment-4" className="font-display text-4xl sm:text-5xl text-brand-text font-normal tracking-tight leading-tight" tabIndex={-1}>
              Tôi sẽ làm {plan.steps.length} việc, theo thứ tự
            </h1>
            <p className="text-sm sm:text-base text-brand-muted">
              {slackRead ? 'Xem workspace và phạm vi tra cứu trước khi duyệt.' : 'Xin hãy xem trước nội dung sẽ được ghi vào các công cụ dưới đây trước khi duyệt.'}
            </p>
          </div>
          {plan.steps.some(step => step.tool.startsWith('gmail.')) && plan.connections?.gmail && <p className="text-sm text-brand-text break-words">Gửi từ: {plan.connections.gmail.email}</p>}
          {plan.connections?.mycalendar?.email && <p className="text-sm text-brand-text break-words">Tài khoản: {plan.connections.mycalendar.email} (Google Calendar của bạn)</p>}
          {plan.connections?.mysheets?.email && <p className="text-sm text-brand-text break-words">Tài khoản: {plan.connections.mysheets.email} (Google Sheets của bạn)</p>}
          {plan.connections?.myslack && Object.values(plan.connections.myslack.bindings).map(binding => <p key={binding.connectionId} className="text-sm text-brand-text [overflow-wrap:anywhere]">Workspace: {plan.resourceLabels?.[binding.connectionId] ?? `${binding.workspaceId} · ${binding.slackUserId}`}</p>)}
          {plan.connections?.trello?.username && <p className="text-sm text-brand-text break-words">Tài khoản: @{plan.connections.trello.username} (Trello của bạn)</p>}
          {plan.connections?.github?.login && <p className="text-sm text-brand-text break-words">Tài khoản: @{plan.connections.github.login} (GitHub của bạn)</p>}
          {plan.connections?.notion?.workspaceName && <p className="text-sm text-brand-text break-words">Workspace Notion: {plan.connections.notion.workspaceName}</p>}
          {plan.connections?.telegram?.username && <p className="text-sm text-brand-text break-words">Tài khoản: @{plan.connections.telegram.username} (Telegram của bạn)</p>}
          {plan.connections?.myjira && <p className="text-sm text-brand-text break-words">Tài khoản Atlassian: {plan.connections.myjira.atlassianAccountId} · Workspace: {plan.connections.myjira.workspaceId}</p>}
          <WorkflowFlowCanvas steps={plan.steps} mode="preview" resourceLabels={plan.resourceLabels} selectedService={selectedService} onSelectService={setSelectedService} onStepPreview={onPreview} />
          {/* 4 Task Action Cards (NHÓM 2: Hiện so le dưới 300ms, NHÓM 8: Biểu tượng SVG) */}
          <div className="v3-space-y-3" id="plan-cards-container" role="list" aria-label="Các bước thực thi">
            {plan.steps.map((step,index) => { const service=serviceId(step.tool), palette=servicePalette(service), isHighlighted=selectedService===service, incomingFlows=dataFlows.filter(edge=>edge.toStepId===step.id); return (
            <article key={step.id} data-highlighted-step={isHighlighted ? 'true' : undefined} className={`plan-card-stagger-${Math.min(index+1, 4)} bg-white rounded-2xl border ${isHighlighted ? 'border-brand-primary ring-2 ring-brand-primary/20' : 'border-brand-border'} p-4 sm:p-5 shadow-soft-card transition-all hover:border-neutral-300`} data-od-id={`plan-item-${index+1}`}>
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
                      {incomingFlows.map(edge => (
                        <span key={`${edge.fromStepId}-${edge.field}`} data-testid="plan-step-data-flow-badge" className="text-[11px] font-semibold px-2 py-0.5 bg-[#FFF6EE] text-[#FF5701] border border-[#FFDFC6] rounded-full">
                          Dữ liệu từ Việc {edge.fromIndex} → Việc {edge.toIndex} ({edge.field})
                        </span>
                      ))}
                    </div>
                    <h2 className="text-base font-semibold text-brand-text mt-1.5 leading-snug">
                      {step.tool === 'mysheets.read_range'
                        ? `Đọc từ bảng tính của bạn: ${plan.resourceLabels?.[String(step.args.spreadsheetId)] ?? step.description}`
                        : step.description}
                    </h2>
                    <p className="text-xs text-brand-muted mt-1 break-words">
                      Đích đến: {destination(step, plan.resourceLabels)}
                    </p>
                    {service==='myjira' && plan.connections?.myjira?.siteSteps?.[step.id] && (()=>{const siteStep=plan.connections!.myjira!.siteSteps[step.id],siteLabel=plan.resourceLabels?.[siteStep.siteId] ?? plan.resourceLabels?.[`jira_site:${siteStep.siteId}`] ?? siteStep.siteId,projectLabel=(typeof step.args.projectKey==='string'&&step.args.projectKey) || (siteStep.projectId ? (plan.resourceLabels?.[siteStep.projectId] ?? plan.resourceLabels?.[`jira_project:${siteStep.projectId}`] ?? siteStep.projectId) : undefined);return <p className="text-xs text-brand-muted mt-1 break-words">Site đích: {siteLabel}{projectLabel?` · Dự án: ${projectLabel}`:''}</p>;})()}
                    {step.tool==='myslack.chat_postMessage'&&<div className="mt-3 whitespace-pre-wrap break-words text-sm text-brand-text"><span className="font-semibold">Nội dung gửi:</span><p>{String(step.args.text)}</p></div>}
                    {(service === 'mycalendar' || service === 'calendar') && (step.args.createMeetLink === true || Boolean(formatRecurrenceLabel(step.args.recurrence)) || (typeof step.args.location === 'string' && step.args.location.trim().length > 0)) && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {step.args.createMeetLink === true && (
                          <span className="text-[11px] font-semibold px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full">
                            🎥 Google Meet
                          </span>
                        )}
                        {formatRecurrenceLabel(step.args.recurrence) && (
                          <span className="text-[11px] font-semibold px-2 py-0.5 bg-indigo-50 text-indigo-800 border border-indigo-200 rounded-full">
                            🔁 {formatRecurrenceLabel(step.args.recurrence)}
                          </span>
                        )}
                        {typeof step.args.location === 'string' && step.args.location.trim().length > 0 && (
                          <span className="text-[11px] font-medium px-2 py-0.5 bg-amber-50 text-amber-900 border border-amber-200 rounded-full">
                            📍 {step.args.location.trim()}
                          </span>
                        )}
                      </div>
                    )}
                    {service === 'notion' && (() => {
                      const rawProps = step.args.properties && typeof step.args.properties === 'object' && !Array.isArray(step.args.properties)
                        ? (step.args.properties as Record<string, unknown>)
                        : null;
                      const propKeys = rawProps ? Object.keys(rawProps) : [];
                      const statusEntry = rawProps
                        ? Object.entries(rawProps).find(([k]) => /^(status|trạng thái|stage|tình trạng)$/i.test(k.trim()))
                        : undefined;
                      const filterStatus = typeof step.args.status === 'string' && step.args.status.trim() ? step.args.status.trim() : null;
                      const statusText = statusEntry && typeof statusEntry[1] === 'string' ? statusEntry[1] : filterStatus;
                      const hasContent = (typeof step.args.content === 'string' && step.args.content.trim().length > 0) || (typeof step.args.text === 'string' && step.args.text.trim().length > 0);
                      const isArchived = step.args.archived === true;
                      if (!statusText && propKeys.length === 0 && !hasContent && !isArchived) return null;
                      return (
                        <div data-testid="notion-step-pills" className="flex flex-wrap items-center gap-1.5 mt-2">
                          {statusText && (
                            <span className="text-[11px] font-semibold px-2 py-0.5 bg-sky-50 text-sky-800 border border-sky-200 rounded-full">
                              🏷️ {statusText}
                            </span>
                          )}
                          {propKeys.length > 0 && (
                            <span className="text-[11px] font-medium px-2 py-0.5 bg-neutral-100 text-neutral-700 border border-neutral-200 rounded-full">
                              📋 {propKeys.length} thuộc tính
                            </span>
                          )}
                          {hasContent && (
                            <span className="text-[11px] font-medium px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full">
                              📝 Có nội dung văn bản
                            </span>
                          )}
                          {isArchived && (
                            <span className="text-[11px] font-semibold px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-full">
                              📦 Lưu trữ trang
                            </span>
                          )}
                        </div>
                      );
                    })()}
                    {service === 'trello' && (() => {
                      const rawMembers = Array.isArray(step.args.idMembers)
                        ? step.args.idMembers.filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
                        : typeof step.args.memberId === 'string' && step.args.memberId.trim().length > 0
                          ? [step.args.memberId.trim()]
                          : [];
                      const checklistItems = Array.isArray(step.args.items)
                        ? step.args.items.filter((it): it is string => typeof it === 'string' && it.trim().length > 0)
                        : [];
                      const hasDue = typeof step.args.due === 'string' && step.args.due.trim().length > 0;
                      const dueComplete = typeof step.args.dueComplete === 'boolean' ? step.args.dueComplete : null;
                      const isClosed = step.args.closed === true;
                      const chkState = step.tool === 'trello.update_checklist_item' && (step.args.state === 'complete' || step.args.state === 'incomplete')
                        ? step.args.state
                        : null;
                      const isComment = step.tool === 'trello.add_comment' && typeof step.args.text === 'string' && step.args.text.trim().length > 0;
                      if (rawMembers.length === 0 && checklistItems.length === 0 && !hasDue && dueComplete === null && !isClosed && !chkState && !isComment) {
                        return null;
                      }
                      return (
                        <div data-testid="trello-step-pills" className="flex flex-wrap items-center gap-1.5 mt-2">
                          {rawMembers.length > 0 && (
                            <span className="text-[11px] font-medium px-2 py-0.5 bg-blue-50 text-blue-800 border border-blue-200 rounded-full">
                              👤 {rawMembers.length} thành viên
                            </span>
                          )}
                          {hasDue && (
                            <span className="text-[11px] font-medium px-2 py-0.5 bg-amber-50 text-amber-900 border border-amber-200 rounded-full">
                              📅 Hạn: {formatCalendarDateTime(step.args.due)}
                            </span>
                          )}
                          {dueComplete !== null && (
                            <span className={`text-[11px] font-semibold px-2 py-0.5 border rounded-full ${dueComplete ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-neutral-100 text-neutral-700 border-neutral-200'}`}>
                              {dueComplete ? '✓ Hoàn thành hạn' : '⏳ Chưa hoàn thành hạn'}
                            </span>
                          )}
                          {checklistItems.length > 0 && (
                            <span className="text-[11px] font-medium px-2 py-0.5 bg-sky-50 text-sky-800 border border-sky-200 rounded-full">
                              ☑️ {checklistItems.length} mục checklist
                            </span>
                          )}
                          {chkState && (
                            <span className={`text-[11px] font-semibold px-2 py-0.5 border rounded-full ${chkState === 'complete' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>
                              {chkState === 'complete' ? '☑ Đã hoàn thành' : '☐ Chưa xong'}
                            </span>
                          )}
                          {isComment && (
                            <span className="text-[11px] font-medium px-2 py-0.5 bg-neutral-100 text-neutral-700 border border-neutral-200 rounded-full">
                              💬 Có bình luận
                            </span>
                          )}
                          {isClosed && (
                            <span className="text-[11px] font-semibold px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-full">
                              📦 Lưu trữ thẻ
                            </span>
                          )}
                        </div>
                      );
                    })()}
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
                {slackPost?'Gửi nguyên văn bằng tài khoản Slack của bạn sau khi duyệt. Nếu chưa rõ kết quả, hãy đối soát trước khi tạo lần gửi khác.':slackRead ? 'Chỉ đọc Slack sau khi duyệt. Kết quả được lưu tối đa 1 ngày và có thể bị ẩn khi quyền hoặc nguồn thay đổi.' : runtimeMode==='sandbox' ? 'Các thao tác này chỉ chạy trong chế độ thử nghiệm, không ghi lên công cụ thật.' : runtimeMode==='live' ? 'Các thao tác này ghi thật vào công cụ của nhóm và không tự hoàn tác.' : 'Hãy kiểm tra chế độ máy chủ trước khi duyệt các thao tác ghi.'}
              </div>
              <div className="text-neutral-600">
                Kế hoạch được giữ trong 30 phút. Bạn có thể sửa đổi bằng chat hoặc bấm duyệt để bắt đầu ngay.
              </div>
            </div>
          </div>
          {plan.warnings && plan.warnings.length > 0 && (
            <div data-testid="plan-warnings-callout" className="p-3.5 rounded-xl bg-amber-50/90 border border-amber-200 v3-space-y-2">
              <div className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
                <span aria-hidden="true">⚠️</span>
                <span>Lưu ý kiểm tra trước khi thực thi</span>
              </div>
              {plan.warnings.map((warning,index)=>{
                const freeSlots = extractSuggestedFreeSlots(warning);
                if (warning.includes('trùng giờ') || freeSlots.length > 0) {
                  return (
                    <div key={index} data-testid="calendar-conflict-banner" className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 v3-space-y-2.5">
                      <p className="text-xs font-medium text-brand-danger leading-relaxed">{warning}</p>
                      {freeSlots.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-semibold text-rose-800">Đổi nhanh khung giờ trống:</span>
                          {freeSlots.map((slot) => (
                            <button
                              key={slot}
                              type="button"
                              onClick={() => onEdit(`Đổi khung giờ họp sang ${slot}`)}
                              className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white hover:bg-rose-100 text-rose-800 border border-rose-300 shadow-2xs transition-colors"
                            >
                              Đổi sang {slot}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }
                return <p key={index} className="text-xs text-brand-danger font-medium leading-relaxed">{warning}</p>;
              })}
            </div>
          )}
          {!plan.id && <p role="alert">Kế hoạch thiếu mã định danh hợp lệ. Hãy tải lại hội thoại trước khi duyệt.</p>}
          {techOpen && <div id="tech-details-panel" className="p-4 rounded-xl bg-neutral-900 text-neutral-200 font-mono text-xs v3-space-y-3 border border-neutral-800"><pre className="whitespace-pre-wrap break-all">{JSON.stringify(slackRead ? {summary:plan.summary,steps:plan.steps} : plan,null,2)}</pre></div>}
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
                <button id="btn-edit-plan" type="button" onClick={() => onEdit()} className="px-3.5 sm:px-4 py-2.5 sm:py-3 bg-white hover:bg-neutral-100 border border-brand-border text-brand-text text-xs sm:text-sm font-medium rounded-xl shadow-sm transition-colors flex items-center justify-center gap-1.5 flex-shrink-0">
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
