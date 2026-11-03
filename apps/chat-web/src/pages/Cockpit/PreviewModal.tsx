// Source: AppStagePage.tsx preview-modal and PREVIEW content frame. No fabricated identifiers or resolved values.
import { useRef } from 'react';
import type { PlanStep, ServiceInfo } from '../../types';
import { PreviewContents } from './PreviewContents';
import { servicePalette, serviceName, serviceId } from './presentation';
import { useDialogFocus } from './useDialogFocus';

export function PreviewModal({
  step,
  services,
  labels,
  sender,
  destination,
  onClose,
}: {
  step: PlanStep;
  services: ServiceInfo[];
  labels?: Record<string, string>;
  sender?: string;
  destination: (step: PlanStep, labels?: Record<string, string>) => string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(dialog, onClose, `preview-${step.id}`);

  return (
    <div
      ref={dialog}
      tabIndex={-1}
      aria-label="Xem trước nội dung"
      id="preview-modal"
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        id="preview-modal-box"
        className="bg-[var(--planora-paper)] rounded-2xl max-w-xl w-full border border-[var(--planora-divider)] shadow-2xl overflow-hidden flex flex-col max-h-[85vh] min-w-0"
      >
        <div className="px-5 py-4 border-b border-[var(--planora-divider)] flex items-center justify-between bg-[var(--planora-surface-inset)]">
          <div className="flex items-center gap-2 min-w-0">
            <span
              id="preview-service-tag"
              className={`px-2 py-0.5 rounded text-xs font-semibold ${
                servicePalette(serviceId(step.tool)).previewBadge ?? servicePalette(serviceId(step.tool)).badge
              }`}
            >
              {serviceName(serviceId(step.tool), services)}
            </span>
            <h3 id="preview-modal-title" className="font-display font-semibold text-base text-[var(--planora-text)] truncate">
              Xem trước nội dung
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--planora-muted)] hover:text-[var(--planora-text)] hover:bg-[var(--planora-surface-hover)] transition-colors cursor-pointer"
            aria-label="Đóng Xem trước nội dung"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div
          className="p-5 overflow-y-auto v3-space-y-4 text-xs sm:text-sm text-[var(--planora-text)] min-w-0"
          id="preview-modal-content"
        >
          {step.tool.startsWith('gmail.') && sender && <p className="break-words">Gửi từ: {sender}</p>}
          <PreviewContents step={step} labels={labels} destination={destination(step, labels)} />
        </div>
        <div className="px-5 py-3 border-t border-[var(--planora-divider)] bg-[var(--planora-surface-inset)] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-[var(--planora-primary)] hover:bg-[var(--planora-primary-hover)] text-[var(--planora-on-primary)] text-xs font-medium rounded-xl transition-colors cursor-pointer"
          >
            Đóng xem trước
          </button>
        </div>
      </div>
    </div>
  );
}

