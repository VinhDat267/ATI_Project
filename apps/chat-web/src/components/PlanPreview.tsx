import React, { useState } from 'react';
import type { ActivePlan } from '../types';
import { PlanStepItem } from './PlanStepItem';

export interface PlanPreviewProps {
  plan: ActivePlan;
  onApprove?: () => void;
  onEdit?: () => void;
  onCancel?: () => void;
  isApproving?: boolean;
}

export const PlanPreview: React.FC<PlanPreviewProps> = ({
  plan,
  onApprove,
  onEdit,
  onCancel,
  isApproving = false,
}) => {
  const [showThinking, setShowThinking] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-md p-5 md:p-6 my-4 max-w-2xl">
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-zinc-100">
        <div className="flex items-center gap-2">
          <span className="text-base">📋</span>
          <h3 className="font-semibold text-zinc-900 text-base">
            {plan.summary || 'Kế hoạch thực thi'}
          </h3>
        </div>
        <span className="bg-[#fafafc] border border-zinc-200 text-xs font-medium text-zinc-600 px-2.5 py-0.5 rounded-lg">
          {plan.steps.length} bước
        </span>
      </div>

      {/* Thinking Accordion */}
      {plan.thinking && (
        <div className="my-3.5 bg-[#f5f5f7] border border-zinc-200/70 rounded-xl overflow-hidden transition">
          <button
            type="button"
            onClick={() => setShowThinking(!showThinking)}
            className="w-full text-left p-3 flex items-center justify-between text-xs font-semibold text-zinc-700 hover:bg-zinc-200/40 transition cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <span>💭</span>
              <span>Suy luận của AI (Chain-of-Thought)</span>
            </span>
            <span className="text-zinc-400 font-normal">
              {showThinking ? 'Ẩn ▲' : 'Xem ▼'}
            </span>
          </button>
          {showThinking && (
            <div className="p-3 pt-0 text-xs text-zinc-600 italic leading-relaxed whitespace-pre-wrap">
              {plan.thinking}
            </div>
          )}
        </div>
      )}

      {/* Warnings Banner */}
      {plan.warnings && plan.warnings.length > 0 && (
        <div className="my-3 p-3 bg-amber-50/70 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start gap-2">
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
            index={idx}
            isLast={idx === plan.steps.length - 1}
          />
        ))}
      </div>

      {/* Action Bar */}
      <div className="mt-6 pt-4 border-t border-zinc-100 flex flex-wrap items-center justify-end gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs font-medium text-red-500 hover:bg-red-50 px-4 py-2 rounded-full transition cursor-pointer"
          >
            Hủy
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="text-xs font-medium text-[#0066cc] border border-blue-400 hover:bg-blue-50 px-4 py-2 rounded-full transition cursor-pointer"
          >
            Sửa qua Chat
          </button>
        )}
        {onApprove && (
          <button
            type="button"
            onClick={onApprove}
            disabled={isApproving}
            className="text-xs font-medium bg-[#0071e3] text-white hover:bg-blue-600 disabled:opacity-50 px-6 py-2.5 rounded-full shadow-xs transition cursor-pointer flex items-center gap-1.5"
          >
            {isApproving ? 'Đang kích hoạt...' : 'Duyệt kế hoạch ✓'}
          </button>
        )}
      </div>
    </div>
  );
};
