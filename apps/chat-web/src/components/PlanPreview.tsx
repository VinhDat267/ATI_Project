import React, { useState } from 'react';
import type { ActivePlan } from '../types';
import { PlanStepItem } from './PlanStepItem';

export interface PlanPreviewProps {
  plan: ActivePlan;
  onApprove?: () => void;
  onEdit?: () => void;
  onCancel?: () => void;
  isApproving?: boolean;
  approvalDisabled?: boolean;
}

export const PlanPreview: React.FC<PlanPreviewProps> = ({
  plan,
  onApprove,
  onEdit,
  onCancel,
  isApproving = false,
  approvalDisabled = false,
}) => {
  const [showThinking, setShowThinking] = useState(false);


  return (
    <div className="bg-surface rounded-2xl border border-border shadow-md p-5 md:p-6 my-4 max-w-2xl">
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-base">📋</span>
          <h3 className="font-semibold text-text text-base">
            {plan.summary || 'Kế hoạch thực thi'}
          </h3>
        </div>
        <span className="bg-surface-inset border border-border text-xs font-medium text-text-secondary px-2.5 py-0.5 rounded-lg">
          {plan.steps.length} bước
        </span>
      </div>

      {/* Thinking Accordion */}
      {plan.thinking && (
        <div className="my-3.5 bg-surface-inset border border-border rounded-xl overflow-hidden transition">
          <button
            type="button"
            onClick={() => setShowThinking(!showThinking)}
            className="w-full text-left p-3 flex items-center justify-between text-xs font-semibold text-text-secondary hover:bg-surface-raised transition cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <span>💭</span>
              <span>Phân tích & lập luận của AI</span>
            </span>
            <span className="text-text-muted font-normal">
              {showThinking ? 'Ẩn ▲' : 'Xem ▼'}
            </span>
          </button>
          {showThinking && (
            <div className="p-3 pt-0 text-xs text-text-secondary italic leading-relaxed whitespace-pre-wrap">
              {plan.thinking}
            </div>
          )}
        </div>
      )}

      {/* Warnings Banner */}
      {plan.warnings && plan.warnings.length > 0 && (
        <div className="my-3 p-3 bg-warning-tint border border-border rounded-xl text-xs text-warning-text flex items-start gap-2">
          <span className="text-sm">⚠️</span>
          <div className="flex-1">
            {plan.warnings.map((w, idx) => (
              <p key={idx}>{w}</p>
            ))}
          </div>
        </div>
      )}

      {/* Step Sequence */}
      <div className="mt-4">
        {plan.steps.map((st, idx) => (
          <PlanStepItem
            key={st.id || idx}
            step={st}
            resourceLabels={plan.resourceLabels}
            index={idx}
            isLast={idx === plan.steps.length - 1}
          />
        ))}
      </div>

      {/* Action Bar */}
      <div className="mt-6 pt-4 border-t border-border flex flex-wrap items-center justify-end gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs font-medium text-danger-text hover:bg-danger-tint px-4 py-2 rounded-full transition cursor-pointer"
          >
            Hủy
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="text-xs font-medium text-primary-text border border-border-strong hover:bg-primary-tint px-4 py-2 rounded-full transition cursor-pointer"
          >
            Sửa qua Chat
          </button>
        )}
        {onApprove && (
          <button
            type="button"
            onClick={onApprove}
            disabled={isApproving || approvalDisabled}
            className="text-xs font-medium bg-primary text-white hover:bg-primary disabled:opacity-50 px-6 py-2.5 rounded-full shadow-xs transition cursor-pointer flex items-center gap-1.5"
          >
            {isApproving ? (
              <>
                <svg
                  className="animate-spin -ml-1 mr-1 h-3.5 w-3.5 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8H4z"
                  />
                </svg>
                <span>Đang kích hoạt...</span>
              </>
            ) : (
              <span>Duyệt kế hoạch ✓</span>
            )}
          </button>
        )}
      </div>
    </div>
  );
};
