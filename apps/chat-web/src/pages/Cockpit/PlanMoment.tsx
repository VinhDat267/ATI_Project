// Source: AppStagePage.tsx moment-4. Demo actions replaced with the approved-plan API callbacks.
import { useState, type ReactNode } from 'react';
import type { ActivePlan, PlanStep, ServiceInfo } from '../../types';
import { PlanoraWorkflowSteps } from '../../planora/workspace/PlanoraWorkflowSteps';
import { RequestEcho } from './RequestEcho';
import { operation } from './presentation';

function getSingleStepApproveVerb(step: PlanStep): string {
  const tool = step.tool || '';
  if (tool.startsWith('slack.')) return 'Gửi tin nhắn Slack ngay';
  if (tool.startsWith('mysheets.') || tool.startsWith('sheets.')) return 'Lưu vào bảng tính';
  if (tool.startsWith('mycalendar.') || tool.startsWith('calendar.')) return 'Lưu vào lịch';
  if (tool.startsWith('gmail.')) return 'Gửi email ngay';
  if (tool.startsWith('trello.')) return 'Tạo thẻ Trello';
  if (tool.startsWith('github.')) return 'Tạo issue trên GitHub';
  if (tool.startsWith('myjira.') || tool.startsWith('jira.')) return 'Tạo công việc Jira';
  if (tool.startsWith('telegram.')) return 'Gửi tin Telegram ngay';
  if (tool.startsWith('notion.')) return 'Lưu vào Notion';
  const op = operation(tool);
  return `${op.action} ngay`;
}

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
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [approvingLocal, setApprovingLocal] = useState(false);
  const [isReplacedByChat, setIsReplacedByChat] = useState(false);

  const isBusy = approvingLocal || isApproving;
  const isApproveDisabled = !plan.id || isBusy || isReplacedByChat;

  const handleApprove = () => {
    if (isApproveDisabled) return;
    setApprovingLocal(true);
    onApprove();
  };

  const handleEdit = () => {
    setIsReplacedByChat(true);
    onEdit();
  };

  const stepCount = plan.steps?.length ?? 0;
  const approveButtonText =
    stepCount === 1
      ? getSingleStepApproveVerb(plan.steps[0])
      : `Duyệt và thực hiện ${stepCount} việc`;

  return (
    <section
      id="moment-4"
      className={`stage-section is-active v3-space-y-6 relative max-w-full transition-all ${
        isReplacedByChat ? 'opacity-70 bg-[var(--planora-canvas)]/60 rounded-2xl p-3 sm:p-4' : ''
      }`}
      aria-label="Cockpit"
      data-moment="4"
      aria-labelledby="heading-moment-4"
    >
      <div className="v3-space-y-2">
        <RequestEcho request={request} />
        {isReplacedByChat && (
          <div
            data-testid="plan-replaced-badge"
            role="status"
            className="p-3.5 rounded-xl bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] text-xs sm:text-sm text-[var(--planora-muted)] font-medium flex items-center gap-2 shadow-2xs"
          >
            <svg className="w-4 h-4 flex-shrink-0 text-[var(--planora-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Đã thay thế bằng đề xuất mới trong cuộc trò chuyện</span>
          </div>
        )}
        <h1
          id="heading-moment-4"
          className="font-display text-4xl sm:text-5xl text-[var(--planora-text)] font-normal tracking-tight leading-tight"
          tabIndex={-1}
        >
          Tôi sẽ làm {stepCount} việc, theo thứ tự
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
        destination={destination}
        serviceInfos={services}
        showStepCards={true}
      />

      {/* Internal Plan Binding (no raw plan_hash/UUID exposed on UI) */}
      <div
        data-testid="plan-hash-binding"
        data-plan-id={plan.id}
        data-plan-hash={(plan as { plan_hash?: string }).plan_hash}
        className="hidden"
        aria-hidden="true"
      />

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
              {isBusy ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="9" className="opacity-30" />
                    <path d="M12 3a9 9 0 0 1 9 9" />
                  </svg>
                  <span>Đang xử lý...</span>
                </>
              ) : (
                <>
                  <span data-testid="planora-approve-btn-text">{approveButtonText}</span>
                  <span className="text-base sm:text-lg">✓</span>
                </>
              )}
            </button>
            <button
              id="btn-edit-plan"
              type="button"
              disabled={isReplacedByChat}
              onClick={handleEdit}
              className="px-3.5 sm:px-4 py-2.5 sm:py-3 bg-[var(--planora-paper)] hover:bg-[var(--planora-surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed border border-[var(--planora-divider)] text-[var(--planora-text)] text-xs sm:text-sm font-medium rounded-xl shadow-sm transition-colors flex items-center justify-center gap-1.5 flex-shrink-0 cursor-pointer"
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
        </div>
      </div>
    </section>
  );
}
