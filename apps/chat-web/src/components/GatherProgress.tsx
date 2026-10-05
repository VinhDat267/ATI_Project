import React, { useState } from 'react';

export interface GatherStep {
  tool: string;
  result?: string;
  status?: 'running' | 'completed';
}

export interface GatherProgressProps {
  summary: string;
  steps?: GatherStep[];
}

export const GatherProgress: React.FC<GatherProgressProps> = ({
  summary,
  steps = [],
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="bg-surface rounded-2xl border border-border shadow-xs max-w-xl my-2.5 overflow-hidden transition">
      <div className="p-3.5 flex items-center justify-between gap-3 bg-surface-inset">
        <div className="flex items-center gap-2">
          <span className="text-sm">🔍</span>
          <span className="text-xs font-semibold text-text">
            Khảo sát bối cảnh tích hợp
          </span>
          <span className="bg-success-tint text-success-text border border-border text-sm font-medium px-2.5 py-0.5 rounded-full ml-1">
            {summary}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs text-text-muted hover:text-text font-medium px-2 py-1 rounded hover:bg-surface-raised transition cursor-pointer"
        >
          {isExpanded ? 'Thu gọn ▲' : 'Chi tiết ▼'}
        </button>
      </div>

      {isExpanded && steps.length > 0 && (
        <div className="p-3.5 border-t border-border flex flex-col gap-2 bg-surface">
          {steps.map((st, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-surface-inset"
            >
              <div className="flex items-center gap-2">
                <span className="text-success-text font-bold">✓</span>
                <span className="bg-primary-tint text-primary-text font-mono text-sm font-semibold px-2 py-0.5 rounded">
                  {st.tool}
                </span>
              </div>
              {st.result && (
                <span className="text-text-muted text-sm font-medium">
                  {st.result}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
