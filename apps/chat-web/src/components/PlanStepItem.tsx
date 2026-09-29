import React from 'react';
import type { PlanStep } from '../types';

export interface PlanStepItemProps {
  step: PlanStep;
  index: number;
  isLast?: boolean;
}

export const PlanStepItem: React.FC<PlanStepItemProps> = ({
  step,
  index,
  isLast = false,
}) => {
  return (
    <div className="relative flex items-start gap-3.5">
      {/* Step Circle & Connector */}
      <div className="flex flex-col items-center">
        <div className="w-6 h-6 rounded-full bg-[#0071e3] text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">
          {index + 1}
        </div>
        {!isLast && <div className="w-0.5 bg-zinc-200 h-10 my-1" />}
      </div>

      {/* Step Details */}
      <div className="flex-1 pb-4">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="bg-[#5ac8fa]/15 text-[#0071e3] border border-blue-200 font-mono text-xs font-semibold px-2 py-0.5 rounded">
            {step.tool}
          </span>
          <span className="text-sm font-semibold text-zinc-900">
            {step.description}
          </span>
        </div>

        {/* Arguments display */}
        {step.args && Object.keys(step.args).length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs text-zinc-600 bg-zinc-50 p-2 rounded-lg border border-zinc-100">
            {Object.entries(step.args).map(([k, v]) => {
              const valStr = String(v);
              const isRef = valStr.startsWith('$step_');
              return (
                <span key={k} className="inline-flex items-center gap-1">
                  <span className="text-zinc-400">{k}:</span>
                  {isRef ? (
                    <span className="font-mono bg-blue-50 text-blue-700 px-1 py-0.5 rounded border border-blue-200 text-[11px]">
                      {valStr}
                    </span>
                  ) : (
                    <span className="font-mono text-zinc-800 text-[11px]">
                      {valStr}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
