import React from 'react';
import type { PlanStep } from '../types';
import { getToolDefinition } from '@wap/tool-schemas';

export interface PlanStepItemProps {
  step: PlanStep;
  index: number;
  isLast?: boolean;
  resourceLabels?: Record<string, string>;
}

/** "step_1.output.url" -> "‹kết quả step_1: url›" */
function describeReference(path: string): string {
  const [stepId, , ...field] = path.split('.');
  return `‹kết quả ${stepId}${field.length ? `: ${field.join('.')}` : ''}›`;
}

/** What an argument will carry, so the reviewer approves text they can read. */
export function formatArgValue(value: unknown): { text: string; isRef: boolean } {
  if (typeof value === 'string' && value.startsWith('$step_')) return { text: value, isRef: true };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const { $ref, $template } = value as { $ref?: unknown; $template?: unknown };
    if (typeof $ref === 'string') return { text: describeReference($ref), isRef: true };
    if (typeof $template === 'string') {
      return { text: $template.replace(/\$\{([^}]+)\}/g, (_, path: string) => describeReference(path)), isRef: false };
    }
    return { text: JSON.stringify(value), isRef: false };
  }
  if (Array.isArray(value)) {
    return { text: value.map((item) => formatArgValue(item).text).join(', '), isRef: false };
  }
  return { text: String(value), isRef: false };
}

export const PlanStepItem: React.FC<PlanStepItemProps> = ({
  step,
  index,
  isLast = false,
  resourceLabels = {},
}) => {
  const tool = getToolDefinition(step.tool);
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
          {tool && <><span className="text-xs font-semibold">{tool.sideEffect === 'write' ? 'Ghi' : 'Đọc'}</span><span className="text-xs text-zinc-600">Rủi ro {({ low: 'thấp', medium: 'trung bình', high: 'cao' })[tool.riskLevel]}</span></>}
        </div>

        {/* Arguments display */}
        {step.args && Object.keys(step.args).length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs text-zinc-600 bg-zinc-50 p-2 rounded-lg border border-zinc-100">
            {Object.entries(step.args).map(([k, v]) => {
              const { text: valStr, isRef } = formatArgValue(v);
              const isResource = Boolean(tool?.inputSchema.properties?.[k]?.['x-resource']);
              const label = isResource && (typeof v === 'string' || typeof v === 'number') ? resourceLabels[String(v)] : undefined;
              return (
                <span key={k} className="inline-flex items-start gap-1">
                  <span className="text-zinc-400">{k}:</span>
                  {label && <span className="font-semibold text-zinc-900">{label}</span>}
                  {isRef ? (
                    <span data-testid={`arg-${k}`} className="font-mono bg-blue-50 text-blue-700 px-1 py-0.5 rounded border border-blue-200 text-[11px]">
                      {valStr}
                    </span>
                  ) : (
                    <span data-testid={`arg-${k}`} className="font-mono text-zinc-800 text-[11px] whitespace-pre-wrap break-words">
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
