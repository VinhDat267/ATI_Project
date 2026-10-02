import React, { useState } from "react";

export interface GatherStep {
  tool: string;
  result?: string;
  status?: "running" | "completed";
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
    <div className="gather-card">
      <div className="p-3.5 flex items-center justify-between gap-3 bg-zinc-50/50">
        <div className="flex items-center gap-2">
          <span className="text-sm">🔍</span>
          <span className="text-xs font-semibold text-zinc-800">
            Khảo sát bối cảnh tích hợp
          </span>
          <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-medium px-2.5 py-0.5 rounded-full ml-1">
            {summary}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs text-zinc-500 hover:text-zinc-800 font-medium px-2 py-1 rounded hover:bg-zinc-200/50 transition cursor-pointer"
        >
          {isExpanded ? "Thu gọn ▲" : "Chi tiết ▼"}
        </button>
      </div>

      {isExpanded && steps.length > 0 && (
        <div className="p-3.5 border-t border-zinc-100 flex flex-col gap-2 bg-white">
          {steps.map((st, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-zinc-50"
            >
              <div className="flex items-center gap-2">
                <span className="text-emerald-500 font-bold">
                  {st.status === "running" ? (
                    <span className="spinner" aria-label="Đang khảo sát" />
                  ) : st.status === "completed" ? (
                    "✓"
                  ) : (
                    "·"
                  )}
                </span>
                <span className="bg-[#5ac8fa]/15 text-[#0071e3] font-mono text-[11px] font-semibold px-2 py-0.5 rounded">
                  {st.tool}
                </span>
              </div>
              {st.result && (
                <span className="text-zinc-500 text-[11px] font-medium">
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
