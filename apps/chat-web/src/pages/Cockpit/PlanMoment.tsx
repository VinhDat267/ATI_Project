// Source: AppStagePage.tsx moment-4. Demo actions replaced with the approved-plan API callbacks.
import { useState, type ReactNode } from 'react';
import type { ActivePlan, PlanStep, ServiceInfo } from '../../types';
import { ServiceLogo } from '../../components/ServiceLogo';
import { PlanoraWorkflowSteps } from '../../planora/workspace/PlanoraWorkflowSteps';
import { operation, planStepDataFlows, serviceId, servicePalette, serviceName } from './presentation';
import { RequestEcho } from './RequestEcho';

export function PlanMoment({
  request,
  runtimeMode,
  plan,
  services,
  destination,
  onPreview,
  onApprove,
  onCancel,
  onEdit,
  inlineComposer,
  isApproving = false,
}: {
  request?: string;
  runtimeMode: 'sandbox' | 'live' | null;
  plan: ActivePlan;
  services: ServiceInfo[];
  destination: (step: PlanStep, labels?: Record<string, string>) => string;
  onPreview: (step: PlanStep) => void;
  onApprove: () => void;
  onCancel: () => void;
  onEdit: () => void;
  inlineComposer: ReactNode;
  isApproving?: boolean;
}) {
  const [techOpen, setTechOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [approvingLocal, setApprovingLocal] = useState(false);
  const dataFlows = planStepDataFlows(plan.steps);

  const handleApprove = () => {
    if (approvingLocal || isApproving || !plan.id) return;
    setApprovingLocal(true);
    onApprove();
  };

  const isApproveDisabled = !plan.id || approvingLocal || isApproving;

  return (
    <section
      id="moment-4"
      className="stage-section is-active v3-space-y-6 relative max-w-full"
      aria-label="Cockpit"
      data-moment="4"
      aria-labelledby="heading-moment-4"
    >
      <div className="v3-space-y-2">
        <RequestEcho request={request} />
        <h1
          id="heading-moment-4"
          className="font-display text-4xl sm:text-5xl text-[var(--planora-text)] font-normal tracking-tight leading-tight"
          tabIndex={-1}
        >
          Tôi sẽ làm {plan.steps.length} việc, theo thứ tự
        </h1>
        <p className="text-sm sm:text-base text-[var(--planora-muted)]">
          Xin hãy xem trước nội dung sẽ được ghi vào các công cụ dưới đây trước khi duyệt.
        </p>
      </div>

      {plan.steps.some((step) => step.tool.startsWith('gmail.')) && plan.connections?.gmail && (
        <p className="text-sm text-[var(--planora-text)] break-words">Gửi từ: {plan.connections.gmail.email}</p>
      )}
      {plan.connections?.mycalendar?.email && (
        <p className="text-sm text-[var(--planora-text)] break-words">
          Tài khoản: {plan.connections.mycalendar.email} (Google Calendar của bạn)
        </p>
      )}
      {plan.connections?.mysheets?.email && (
        <p className="text-sm text-[var(--planora-text)] break-words">
          Tài khoản: {plan.connections.mysheets.email} (Google Sheets của bạn)
        </p>
      )}
      {plan.connections?.trello?.username && (
        <p className="text-sm text-[var(--planora-text)] break-words">
          Tài khoản: @{plan.connections.trello.username} (Trello của bạn)
        </p>
      )}
      {plan.connections?.github?.login && (
        <p className="text-sm text-[var(--planora-text)] break-words">
          Tài khoản: @{plan.connections.github.login} (GitHub của bạn)
        </p>
      )}
      {plan.connections?.telegram?.username && (
        <p className="text-sm text-[var(--planora-text)] break-words">
          Tài khoản: @{plan.connections.telegram.username} (Telegram của bạn)
        </p>
      )}

      {/* Planora Workflow Steps: responsive cards sequence */}
      <PlanoraWorkflowSteps
        steps={plan.steps}
        mode="preview"
        resourceLabels={plan.resourceLabels}
        selectedService={selectedService}
        onSelectService={setSelectedService}
        onStepPreview={onPreview}
        showStepCards={false}
      />

      {/* 4 Task Action Cards */}
      <div className="v3-space-y-3" id="plan-cards-container" role="list" aria-label="Các bước thực thi">
        {plan.steps.map((step, index) => {
          const service = serviceId(step.tool);
          const palette = servicePalette(service);
          const isHighlighted = selectedService === service;
          const incomingFlows = dataFlows.filter((edge) => edge.toStepId === step.id);
          return (
            <article
              key={step.id}
              data-highlighted-step={isHighlighted ? 'true' : undefined}
              className={`plan-card-stagger-${Math.min(index + 1, 4)} bg-[var(--planora-paper)] rounded-2xl border ${
                isHighlighted
                  ? 'border-[var(--planora-primary)] ring-2 ring-[var(--planora-primary)]/20'
                  : 'border-[var(--planora-divider)]'
              } p-4 sm:p-5 shadow-soft-card transition-all hover:border-[var(--planora-border-strong)]`}
              data-od-id={`plan-item-${index + 1}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3.5 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-xl ${palette.icon} flex items-center justify-center flex-shrink-0 mt-0.5 border shadow-sm`}
                  >
                    <ServiceLogo service={service} className={`w-4 h-4 ${palette.logo ?? ''}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-semibold px-2 py-0.5 ${palette.badge} rounded-md`}>
                        {serviceName(service, services)}
                      </span>
                      <span className="text-xs font-medium px-2 py-0.5 bg-[var(--planora-surface-inset)] text-[var(--planora-text)] rounded-md border border-[var(--planora-divider)]">
                        {operation(step.tool).action}
                      </span>
                      <span className="text-xs text-[var(--planora-muted)]">Việc {index + 1}</span>
                      {incomingFlows.map((edge) => (
                        <span
                          key={`${edge.fromStepId}-${edge.field}`}
                          data-testid="plan-step-data-flow-badge"
                          className="text-[11px] font-semibold px-2 py-0.5 bg-[var(--planora-pending-bg)] text-[var(--planora-pending-text)] border border-[var(--planora-pending-border)] rounded-full"
                        >
                          Dữ liệu từ Việc {edge.fromIndex} → Việc {edge.toIndex} ({edge.field})
                        </span>
                      ))}
                    </div>
                    <h2 className="text-base font-semibold text-[var(--planora-text)] mt-1.5 leading-snug">
                      {step.tool === 'mysheets.read_range'
                        ? `Đọc từ bảng tính của bạn: ${plan.resourceLabels?.[String(step.args.spreadsheetId)] ?? step.description}`
                        : step.description}
                    </h2>
                    <p className="text-xs text-[var(--planora-muted)] mt-1 break-words">
                      Đích đến: {destination(step, plan.resourceLabels)}
                    </p>
                  </div>
                </div>
                <button
                  id={`preview-${step.id}`}
                  type="button"
                  onClick={() => onPreview(step)}
                  className="flex-shrink-0 px-3 py-1.5 bg-[var(--planora-surface-inset)] hover:bg-[var(--planora-surface-hover)] text-[var(--planora-text)] text-xs font-medium rounded-lg border border-[var(--planora-divider)] transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                  aria-label="Xem trước"
                >
                  <svg className="w-3.5 h-3.5 text-[var(--planora-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                  <span>Xem trước</span>
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {/* Cryptographic Plan Hash Binding */}
      <div
        data-testid="plan-hash-binding"
        className="text-[11px] font-mono text-[var(--planora-muted)] bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] p-2.5 sm:p-3 rounded-xl break-all"
      >
        Mã băm ràng buộc kế hoạch (plan_hash): <code>{(plan as { plan_hash?: string }).plan_hash ?? plan.id}</code>
      </div>

      {/* Warning Banner */}
      <div className="p-4 rounded-xl bg-[var(--planora-pending-bg)] border border-[var(--planora-pending-border)] flex items-start gap-3">
        <svg
          className="w-5 h-5 text-[var(--planora-pending-text)] flex-shrink-0 mt-0.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <div className="text-xs sm:text-sm text-[var(--planora-pending-text)] v3-space-y-0.5">
          <div className="font-semibold">
            {runtimeMode === 'sandbox'
              ? 'Các thao tác này chỉ chạy trong chế độ thử nghiệm, không ghi lên công cụ thật.'
              : runtimeMode === 'live'
                ? 'Các thao tác này ghi thật vào công cụ của nhóm và không tự hoàn tác.'
                : 'Hãy kiểm tra chế độ máy chủ trước khi duyệt các thao tác ghi.'}
          </div>
          <div className="opacity-90">
            Kế hoạch được giữ trong 30 phút. Bạn có thể sửa đổi bằng chat hoặc bấm duyệt để bắt đầu ngay.
          </div>
        </div>
      </div>

      {plan.warnings?.map((warning, index) => (
        <p key={index} className="text-xs text-[var(--planora-error-text)] font-medium">
          {warning}
        </p>
      ))}

      {!plan.id && (
        <p role="alert" className="text-xs text-[var(--planora-error-text)] font-semibold">
          Kế hoạch thiếu mã định danh hợp lệ. Hãy tải lại hội thoại trước khi duyệt.
        </p>
      )}

      {techOpen && (
        <div
          id="tech-details-panel"
          className="p-4 rounded-xl bg-neutral-900 text-neutral-200 font-mono text-xs v3-space-y-3 border border-neutral-800 overflow-x-auto"
        >
          <pre className="whitespace-pre-wrap break-all">{JSON.stringify(plan, null, 2)}</pre>
        </div>
      )}

      {/* Sticky Bottom Action Bar with Busy Locking */}
      <div
        id="moment-4-sticky-bar"
        className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-[var(--planora-paper)]/95 backdrop-blur-md border-t border-[var(--planora-divider)] mt-6 shadow-[0_-4px_16px_rgba(0,0,0,0.04)]"
      >
        {inlineComposer}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap w-full sm:w-auto">
            <button
              id="btn-approve-plan"
              type="button"
              aria-label="Duyệt kế hoạch"
              disabled={isApproveDisabled}
              onClick={handleApprove}
              className="w-full sm:w-auto px-5 sm:px-7 py-3 bg-[var(--planora-primary)] hover:bg-[var(--planora-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-[var(--planora-on-primary)] text-sm sm:text-base font-bold rounded-xl shadow-md transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2 flex-shrink-0 cursor-pointer"
            >
              <span>Duyệt kế hoạch</span>
              <span className="text-base sm:text-lg">✓</span>
            </button>
            <button
              id="btn-edit-plan"
              type="button"
              onClick={onEdit}
              className="px-3.5 sm:px-4 py-2.5 sm:py-3 bg-[var(--planora-paper)] hover:bg-[var(--planora-surface-hover)] border border-[var(--planora-divider)] text-[var(--planora-text)] text-xs sm:text-sm font-medium rounded-xl shadow-sm transition-colors flex items-center justify-center gap-1.5 flex-shrink-0 cursor-pointer"
            >
              <svg className="w-4 h-4 text-[var(--planora-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
              <span>Sửa qua Chat</span>
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-medium text-[var(--planora-muted)] hover:text-[var(--planora-error-text)] transition-colors flex-shrink-0 cursor-pointer"
            >
              Hủy
            </button>
          </div>
          <div>
            <button
              type="button"
              onClick={() => setTechOpen(!techOpen)}
              aria-controls="tech-details-panel"
              className="text-xs text-[var(--planora-muted)] hover:text-[var(--planora-text)] font-mono inline-flex items-center gap-1.5 py-1 px-2 rounded hover:bg-[var(--planora-surface-hover)] transition-colors cursor-pointer"
              aria-expanded={techOpen ? 'true' : 'false'}
              id="btn-tech-toggle"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              <span>Chi tiết kỹ thuật</span>
              <span id="tech-toggle-arrow">{techOpen ? '▲' : '▼'}</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

