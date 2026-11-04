import React from 'react';
import type { StepState, PlanStatus } from '../types';
import { type JSONSchema } from '@wap/tool-schemas';
import { toolDefinition } from '../services/tool-definitions';
import { ServiceLogo } from './ServiceLogo';
import { SlackReadResult } from './SlackReadResult';

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

const resultNames: Record<string, string> = { name: 'Tên', title: 'Tiêu đề', summary: 'Tiêu đề công việc', fullName: 'Tên đầy đủ', displayName: 'Tên thành viên', accountId: 'Mã tài khoản', repo: 'Kho mã', projectKey: 'Mã dự án', issueKey: 'Mã công việc', parentKey: 'Epic / Issue cha', state: 'Trạng thái', status: 'Trạng thái', newStatus: 'Trạng thái mới', priority: 'Độ ưu tiên', issueType: 'Loại công việc', assignee: 'Người phụ trách', dueDate: 'Hạn hoàn thành', body: 'Nội dung', desc: 'Mô tả', description: 'Mô tả / Agenda', text: 'Nội dung', content: 'Nội dung trang', due: 'Hạn chót', idList: 'Mã cột', idBoard: 'Mã bảng', senderName: 'Người gửi', chatTitle: 'Cuộc trò chuyện', chatId: 'Mã chat', issueNumber: 'Số issue', url: 'Liên kết', html_url: 'Liên kết', meetLink: 'Phòng họp Meet', location: 'Địa điểm', attendeesCount: 'Số người tham dự', recurrence: 'Lặp lại', busyCount: 'Số sự kiện bận', durationMinutes: 'Thời lượng (phút)', label: 'Khung giờ', id: 'Mã', key: 'Mã', number: 'Số', messageId: 'Mã tin nhắn', createdAt: 'Thời gian', updatedAt: 'Cập nhật', lastEditedTime: 'Cập nhật lần cuối', date: 'Thời gian', start: 'Bắt đầu', end: 'Kết thúc', sheet: 'Trang tính', range: 'Vùng đọc', updatedRange: 'Phạm vi cập nhật', updatedRows: 'Số dòng cập nhật', updatedCells: 'Số ô cập nhật', skippedDuplicates: 'Số dòng trùng bỏ qua', totalMatched: 'Số dòng khớp', totalDataRows: 'Tổng số dòng dữ liệu', rowNumber: 'Dòng số', mimeType: 'Loại tệp', folderId: 'Mã thư mục', author: 'Tác giả', user: 'Người gửi', channel: 'Kênh Slack', ts: 'Mã thời gian' };
const timeFields = new Set(['createdAt', 'updatedAt', 'lastEditedTime', 'start', 'end', 'date', 'due']);
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeURL = (text: string) => { try { const url = new URL(text); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } };

function FieldList({ value }: { value: Record<string, unknown> }) {
  const recordEntries = isRecord(value.record)
    ? Object.entries(value.record).filter(([, v]) => (typeof v === 'string' || typeof v === 'number') && String(v).trim().length > 0)
    : [];
  const notionPropEntries = isRecord(value.properties)
    ? Object.entries(value.properties).filter(([k, v]) => k !== value.title && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || (Array.isArray(v) && v.length > 0)) && String(v).trim().length > 0)
    : [];
  const schemaEntries = Array.isArray(value.schema)
    ? value.schema.filter(isRecord).map((col) => `${String(col.name ?? '')} (${String(col.type ?? '')})`).filter((s) => !s.startsWith(' ('))
    : [];
  const checklistSummaries = Array.isArray(value.checklists)
    ? value.checklists
        .filter(isRecord)
        .map((chk) => {
          const chkName = typeof chk.name === 'string' && chk.name.trim() ? chk.name.trim() : 'Checklist';
          const items = Array.isArray(chk.items) ? chk.items.filter(isRecord) : [];
          const done = items.filter((item) => item.state === 'complete').length;
          return `${chkName} (${done}/${items.length})`;
        })
    : [];
  return <dl>{Object.entries(value).filter(([key, field]) => Object.hasOwn(resultNames, key) && (typeof field === 'string' || typeof field === 'number')).map(([key, field]) =>
    <div key={key} className="flex gap-2 min-w-0"><dt className="shrink-0">{resultNames[key]}:</dt><dd className="min-w-0 flex-1 [overflow-wrap:anywhere]">{typeof field === 'string' && safeURL(field)
      ? <a href={field} target="_blank" rel="noopener noreferrer" className="text-primary-text underline">{field}</a>
      : typeof field === 'string' && timeFields.has(key) && Number.isFinite(Date.parse(field))
        ? <time dateTime={field}>{new Date(field).toLocaleString('vi-VN', { hour12: false })}</time>
        : typeof field === 'number' && timeFields.has(key) && field > 1_000_000_000 && field < 10_000_000_000
          ? <time dateTime={new Date(field * 1000).toISOString()}>{new Date(field * 1000).toLocaleString('vi-VN', { hour12: false })}</time>
          : String(field)}</dd></div>)}
    {typeof value.dueComplete === 'boolean' && (
      <div className="flex gap-2 min-w-0"><dt className="shrink-0">Hoàn thành hạn:</dt><dd className="min-w-0 flex-1">{value.dueComplete ? 'Đã xong' : 'Chưa xong'}</dd></div>
    )}
    {checklistSummaries.length > 0 && (
      <div className="flex gap-2 min-w-0"><dt className="shrink-0">Checklist:</dt><dd className="min-w-0 flex-1 [overflow-wrap:anywhere]">{checklistSummaries.join(', ')}</dd></div>
    )}
    {Array.isArray(value.updatedFields) && value.updatedFields.length > 0 && (
      <div className="flex gap-2 min-w-0"><dt className="shrink-0">Trường cập nhật:</dt><dd className="min-w-0 flex-1 [overflow-wrap:anywhere]">{value.updatedFields.join(', ')}</dd></div>
    )}
    {Array.isArray(value.comments) && value.comments.length > 0 && (
      <div className="flex gap-2 min-w-0"><dt className="shrink-0">Bình luận:</dt><dd className="min-w-0 flex-1 [overflow-wrap:anywhere]">{value.comments.length} bình luận</dd></div>
    )}
    {recordEntries.map(([colKey, colVal]) => (
      <div key={`rec-${colKey}`} className="flex gap-2 min-w-0"><dt className="shrink-0 font-medium">{colKey}:</dt><dd className="min-w-0 flex-1 [overflow-wrap:anywhere]">{String(colVal)}</dd></div>
    ))}
    {notionPropEntries.length > 0 && (
      <div data-testid="notion-result-properties" className="flex flex-wrap items-center gap-1.5 pt-1">
        {notionPropEntries.map(([propKey, propVal]) => (
          <span key={`nprop-${propKey}`} className="px-2 py-0.5 rounded bg-neutral-100 text-neutral-800 border border-neutral-200 text-[11px]">
            <strong className="font-semibold">{propKey}:</strong> {Array.isArray(propVal) ? propVal.join(', ') : String(propVal)}
          </span>
        ))}
      </div>
    )}
    {schemaEntries.length > 0 && (
      <div className="flex gap-2 min-w-0 pt-1"><dt className="shrink-0 font-medium">Schema cột:</dt><dd className="min-w-0 flex-1 [overflow-wrap:anywhere]">{schemaEntries.join(', ')}</dd></div>
    )}
  </dl>;
}

/** Read collections are taken only from the tool's declared output shape. */
function collectionRows(value: unknown, tool: string): unknown[] | undefined {
  const definition = toolDefinition(tool);
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
  if(tool==='myslack.chat_postMessage'&&isRecord(value))return <div className="mt-2 text-sm"><p>Đã xác nhận gửi trên Slack</p><p>Kênh: {String(value.channel??'')}</p><p>Mã tin: {String(value.ts??'')}</p></div>;
  if (tool.startsWith('myslack.')) return <SlackReadResult value={value} />;
  const rows = collectionRows(value, tool);
  const matrixRows = isRecord(value) && Array.isArray(value.values)
    ? (value.values.filter(Array.isArray) as unknown[][])
    : undefined;
  return <div className="mt-2 text-xs text-text-secondary break-words">
    {isRecord(value) && <FieldList value={value} />}
    {matrixRows && matrixRows.length > 0 && (
      <div data-testid="sheets-read-preview-table" className="mt-2 border border-neutral-200 rounded-lg overflow-x-auto bg-neutral-50">
        <table className="w-full text-left text-[11px]">
          <tbody className="divide-y divide-neutral-200">
            {matrixRows.slice(0, 5).map((r, rIdx) => (
              <tr key={rIdx} className={rIdx === 0 ? 'font-semibold bg-neutral-100 text-neutral-800' : 'bg-white text-neutral-700'}>
                {r.map((cell, cIdx) => (
                  <td key={cIdx} className="px-2 py-1 border-r last:border-r-0 border-neutral-200">{String(cell ?? '')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
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
                    <ServiceLogo service={toolDefinition(step.tool)?.service ?? step.tool.split('.')[0]} />
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
