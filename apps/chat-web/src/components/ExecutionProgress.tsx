import React from 'react';
import type { StepState, PlanStatus } from '../types';
import { getToolDefinition, type JSONSchema } from '@wap/tool-schemas';
import { ServiceLogo } from './ServiceLogo';

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

const resultNames: Record<string, string> = { name: 'Tên', title: 'Tiêu đề', fullName: 'Tên đầy đủ', url: 'Liên kết', html_url: 'Liên kết', id: 'Mã', key: 'Mã', number: 'Số', messageId: 'Mã tin nhắn', createdAt: 'Thời gian', updatedAt: 'Cập nhật', start: 'Bắt đầu', end: 'Kết thúc' };
const timeFields = new Set(['createdAt', 'updatedAt', 'start', 'end']);
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeURL = (text: string) => { try { const url = new URL(text); return ['http:', 'https:'].includes(url.protocol); } catch { return false; } };

function FieldList({ value }: { value: Record<string, unknown> }) {
  return <dl>{Object.entries(value).filter(([key, field]) => Object.hasOwn(resultNames, key) && (typeof field === 'string' || typeof field === 'number')).map(([key, field]) =>
    <div key={key} className="flex gap-2"><dt>{resultNames[key]}:</dt><dd>{typeof field === 'string' && safeURL(field)
      ? <a href={field} target="_blank" rel="noopener noreferrer" className="text-primary-text underline">{field}</a>
      : typeof field === 'string' && timeFields.has(key) && Number.isFinite(Date.parse(field))
        ? <time dateTime={field}>{new Date(field).toLocaleString('vi-VN', { hour12: false })}</time> : String(field)}</dd></div>)}</dl>;
}

/** Read collections are taken only from the tool's declared output shape. */
function collectionRows(value: unknown, tool: string): unknown[] | undefined {
  const definition = getToolDefinition(tool);
  if (definition?.sideEffect !== 'read') return;
  const schema = definition.outputSchema;
  if (schema.type === 'array' && schema.items?.type === 'object') return Array.isArray(value) ? value : undefined;
  if (schema.type !== 'object' || !isRecord(value)) return;
  const collections = Object.entries(schema.properties ?? {}).filter(([, field]) =>
    (field as JSONSchema).type === 'array' && (field as JSONSchema).items?.type === 'object');
  if (collections.length) return collections.flatMap(([key]) => Array.isArray(value[key]) ? value[key] : []);
}

export function ResultFields({ output, tool }: { output: unknown; tool: string }) {
  let value = output;
  if (typeof output === 'string') { try { value = JSON.parse(output); } catch { /* Plain text remains visible. */ } }
  const rows = collectionRows(value, tool);
  return <div className="mt-2 text-xs text-text-secondary break-words">
    {isRecord(value) && <FieldList value={value} />}
    {rows ? <><p>{rows.length} kết quả</p><ol aria-label="Kết quả đọc" className="space-y-2 mt-1">{rows.filter(isRecord).map((row, index) => <li key={index}><FieldList value={row} /></li>)}</ol></>
      : !isRecord(value) && <p>{typeof value === 'object' ? `${Array.isArray(value) ? value.length : 0} kết quả` : String(value)}</p>}
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
          <div className="w-6 h-6 rounded-full bg-success-tint text-success-text flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">
            ✓
          </div>
        );
      case 'running':
        return (
          <div className="w-6 h-6 rounded-full bg-primary-tint text-primary-text flex items-center justify-center text-xs font-bold shrink-0 animate-pulse shadow-xs">
            ⏳
          </div>
        );
      case 'failed':
        return (
          <div className="w-6 h-6 rounded-full bg-danger text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">
            ✕
          </div>
        );
      case 'paused':
        return (
          <div className="w-6 h-6 rounded-full bg-warning-tint text-warning-text flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">
            ⏸
          </div>
        );
      case 'unknown':
        return (
          <div className="w-6 h-6 rounded-full bg-primary-tint text-primary-text flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">
            ?
          </div>
        );
      default:
        return (
          <div className="w-6 h-6 rounded-full bg-surface-raised text-text-muted flex items-center justify-center text-xs shrink-0">
            ○
          </div>
        );
    }
  };

  return (
    <div className="bg-surface rounded-2xl border border-border shadow-sm p-5 md:p-6 my-4 max-w-2xl">
      <div className="flex items-center justify-between pb-3 border-b border-border mb-4">
        <h3 className="font-semibold text-text text-base flex items-center gap-2">
          {title}
        </h3>
        <span className="text-xs text-text-muted font-medium">
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
                      step.status === 'succeeded' ? 'bg-success' : 'bg-surface-raised'
                    }`}
                  />
                )}
              </div>

              {/* Step info */}
              <div className="flex-1 pb-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <ServiceLogo service={getToolDefinition(step.tool)?.service ?? step.tool.split('.')[0]} />
                    <span className="text-sm font-semibold text-text">
                      {step.description}
                    </span>
                    <span className="text-sm text-text-secondary">{({ pending:'Chờ chạy', running:'Đang chạy', succeeded:'Hoàn thành', failed:'Lỗi đã biết', paused:'Tạm dừng', skipped:'Đã bỏ qua', unknown:'Chưa rõ kết quả' })[step.status]}</span>
                  </div>
                  {step.duration && (
                    <span className="text-xs text-text-muted font-mono">
                      {step.duration}
                    </span>
                  )}
                </div>

                {step.completedAt && <time className="text-xs text-text-muted" dateTime={step.completedAt}>{new Date(step.completedAt).toLocaleString('vi-VN', { hour12: false })}</time>}
                {step.output != null && <ResultFields output={step.output} tool={step.tool} />}
                <details className="text-sm"><summary>Thông tin bước</summary><code>{step.tool}</code></details>

                {step.error && (
                  <div className="mt-1 text-xs text-danger-text font-medium">
                    {step.error}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {status === 'completed' && <p role="status" className="text-sm text-success-text">Đã hoàn thành {steps.filter(step => step.status === 'succeeded').length}/{steps.length} bước{steps.some(step => step.status === 'skipped') ? `; ${steps.filter(step => step.status === 'skipped').length} bước đã bỏ qua` : ''}.</p>}
    </div>
  );
};
