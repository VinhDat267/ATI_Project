import React from 'react';
import type { StepState, PlanStatus } from '../types';

export interface ExecutionStepInfo {
  id: string;
  tool: string;
  description: string;
  status: StepState;
  duration?: string;
  output?: unknown;
  completedAt?: string | null;
  error?: string;
}

export interface ExecutionProgressProps {
  steps: ExecutionStepInfo[];
  title?: string;
  status?: PlanStatus;
}

function ResultFields({ output }: { output: unknown }) {
  let value = output;
  if (typeof output === 'string') { try { value = JSON.parse(output); } catch { /* Plain text remains visible. */ } }
  const fields = value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
  const names: Record<string, string> = { name: 'Tên', title: 'Tiêu đề', url: 'Liên kết', html_url: 'Liên kết', id: 'Mã', messageId: 'Mã tin nhắn', createdAt: 'Thời gian', updatedAt: 'Cập nhật' };
  const safeURL = (text: string) => { try { const url = new URL(text); return ['http:', 'https:'].includes(url.protocol); } catch { return false; } };
  return <div className="mt-2 text-xs text-zinc-700 break-words">
    {fields.length ? <dl>{fields.filter(([key, field]) => key in names && (typeof field === 'string' || typeof field === 'number')).map(([key, field]) => <div key={key} className="flex gap-2"><dt>{names[key]}:</dt><dd>{typeof field === 'string' && safeURL(field) ? <a href={field} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">{field}</a> : String(field)}</dd></div>)}</dl> : <p>{typeof value === 'object' ? `${Array.isArray(value) ? value.length : 0} kết quả` : String(value)}</p>}
    <details className="mt-2"><summary className="cursor-pointer">Chi tiết</summary><pre className="whitespace-pre-wrap break-all mt-1">{JSON.stringify(value, null, 2)}</pre></details>
  </div>;
}

export const ExecutionProgress: React.FC<ExecutionProgressProps> = ({
  steps,
  title = '⚡ Tiến trình thực thi liên dịch vụ',
  status,
}) => {
  const getStatusIcon = (status: StepState) => {
    switch (status) {
      case 'succeeded':
        return (
          <div className="w-6 h-6 rounded-full bg-[#34c759] text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">
            ✓
          </div>
        );
      case 'running':
        return (
          <div className="w-6 h-6 rounded-full bg-[#007aff] text-white flex items-center justify-center text-xs font-bold shrink-0 animate-pulse shadow-xs">
            ⏳
          </div>
        );
      case 'failed':
        return (
          <div className="w-6 h-6 rounded-full bg-[#ff3b30] text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">
            ✕
          </div>
        );
      case 'paused':
        return (
          <div className="w-6 h-6 rounded-full bg-[#ff9500] text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">
            ⏸
          </div>
        );
      case 'unknown':
        return (
          <div className="w-6 h-6 rounded-full bg-[#af52de] text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">
            ?
          </div>
        );
      default:
        return (
          <div className="w-6 h-6 rounded-full bg-zinc-200 text-zinc-500 flex items-center justify-center text-xs shrink-0">
            ○
          </div>
        );
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5 md:p-6 my-4 max-w-2xl">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-100 mb-4">
        <h3 className="font-semibold text-zinc-900 text-base flex items-center gap-2">
          {title}
        </h3>
        <span className="text-xs text-zinc-500 font-medium">
          {steps.filter((s) => s.status === 'succeeded').length}/{steps.length} hoàn thành
        </span>
      </div>

      <div className="flex flex-col">
        {steps.map((step, idx) => {
          const isLast = idx === steps.length - 1;
          return (
            <div key={step.id || idx} className="relative flex items-start gap-3.5">
              {/* Status indicator and line */}
              <div className="flex flex-col items-center">
                {getStatusIcon(step.status)}
                {!isLast && (
                  <div
                    className={`w-0.5 h-10 my-1 ${
                      step.status === 'succeeded' ? 'bg-[#34c759]' : 'bg-zinc-200'
                    }`}
                  />
                )}
              </div>

              {/* Step info */}
              <div className="flex-1 pb-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="bg-[#5ac8fa]/15 text-[#0071e3] border border-blue-200 font-mono text-[11px] font-semibold px-2 py-0.5 rounded">
                      {step.tool}
                    </span>
                    <span className="text-sm font-semibold text-zinc-900">
                      {step.description}
                    </span>
                  </div>
                  {step.duration && (
                    <span className="text-xs text-zinc-400 font-mono">
                      {step.duration}
                    </span>
                  )}
                </div>

                {step.completedAt && <time className="text-xs text-zinc-500" dateTime={step.completedAt}>{new Date(step.completedAt).toLocaleString('vi-VN', { hour12: false })}</time>}
                {step.output != null && <ResultFields output={step.output} />}

                {step.error && (
                  <div className="mt-1 text-xs text-red-600 font-medium">
                    {step.error}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {status === 'completed' && <p role="status" className="text-sm text-green-700">Đã hoàn thành {steps.filter(step => step.status === 'succeeded').length}/{steps.length} bước{steps.some(step => step.status === 'skipped') ? `; ${steps.filter(step => step.status === 'skipped').length} bước đã bỏ qua` : ''}.</p>}
    </div>
  );
};
