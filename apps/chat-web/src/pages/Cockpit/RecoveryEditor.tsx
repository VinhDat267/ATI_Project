import { useState } from 'react';
import { toolDefinition } from '../../services/tool-definitions';
import { CockpitDialog } from '../../components/CockpitDialog';
import { recoveryFieldLabel } from './recovery-labels';

export function RecoveryEditor({
  tool,
  stepArgs,
  prompt,
  busy,
  onClose,
  onSubmit,
}: {
  tool: string;
  stepArgs?: Record<string, unknown>;
  prompt?: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (args: Record<string, unknown>, prompt?: string) => void;
}) {
  const schema = toolDefinition(tool)?.inputSchema as
    | { properties?: Record<string, { description?: string; type?: string }>; required?: string[] }
    | undefined;

  const [args] = useState<Record<string, unknown>>(stepArgs ?? {});
  const [fieldText, setFieldText] = useState<Record<string, string>>({});
  const [json, setJson] = useState(JSON.stringify(stepArgs ?? {}, null, 2));
  const [promptText, setPrompt] = useState(prompt ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const parse = (): Record<string, unknown> | null => {
    try {
      const result = schema ? { ...args } : JSON.parse(json);
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Object required');
      if (schema) {
        for (const [key, property] of Object.entries(schema.properties ?? {})) {
          if (Object.hasOwn(fieldText, key)) {
            const raw = fieldText[key];
            result[key] = ['object', 'array', 'boolean'].includes(property.type ?? '')
              ? JSON.parse(raw)
              : ['number', 'integer'].includes(property.type ?? '')
              ? raw.trim() ? Number(raw) : NaN
              : raw;
          }
          const value = result[key];
          if (value === undefined && !schema.required?.includes(key)) continue;
          if (property.type === 'array' && !Array.isArray(value)) throw new Error('Array required');
          if (property.type === 'object' && (!value || typeof value !== 'object' || Array.isArray(value)))
            throw new Error('Object required');
          if (
            ['number', 'integer'].includes(property.type ?? '') &&
            (typeof value !== 'number' || !Number.isFinite(value) || (property.type === 'integer' && !Number.isInteger(value)))
          )
            throw new Error('Number required');
          if (property.type === 'boolean' && typeof value !== 'boolean') throw new Error('Boolean required');
          if (property.type === 'string' && typeof value !== 'string') throw new Error('String required');
        }
      }
      return result;
    } catch {
      setError('Định dạng JSON không hợp lệ. Vui lòng nhập một đối tượng tham số.');
      return null;
    }
  };

  const getFieldValue = (key: string): string => {
    if (Object.hasOwn(fieldText, key)) return fieldText[key];
    const val = args[key];
    if (val === undefined || val === null) return '';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  };

  const getFieldLabel = (key: string, description?: string): string => {
    if (key === 'channel') return 'Tên kênh hoặc mã kênh';
    if (['text', 'body', 'message', 'content'].includes(key) && (tool.startsWith('slack') || tool.startsWith('telegram'))) {
      return 'Nội dung tin nhắn';
    }
    return recoveryFieldLabel(tool, key, description);
  };

  return (
    <CockpitDialog
      title="Sửa rồi thử lại"
      returnFocusId="btn-recovery-edit"
      onClose={() => {
        if (busy) return;
        if (confirm) setConfirm(false);
        else onClose();
      }}
    >
      <form
        className="p-5 v3-space-y-4 text-sm text-[var(--planora-text)]"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          const result = parse();
          if (!result) return;
          if (!confirm) setConfirm(true);
          else onSubmit(result, promptText || undefined);
        }}
      >
        <p className="text-[var(--planora-muted)] leading-relaxed">
          Để chỉnh lại nội dung công việc, cần dừng kế hoạch cũ và lập kế hoạch mới. Chưa có lệnh ghi nào chạy cho tới khi bạn duyệt lại.
        </p>

        <div className="v3-space-y-3">
          {schema ? (
            Object.entries(schema.properties ?? {}).map(([key, property]) => {
              const label = getFieldLabel(key, property.description);
              const isChannel = key === 'channel';
              const isLongText =
                ['text', 'body', 'message', 'content', 'description'].includes(key) &&
                !['name', 'title', 'summary'].includes(key);
              const val = getFieldValue(key);

              return (
                <label key={key} className="block v3-space-y-1">
                  <span className="text-xs font-semibold text-[var(--planora-text)]">{label}</span>
                  {isLongText ? (
                    <textarea
                      aria-label={label}
                      rows={3}
                      disabled={busy || confirm}
                      className="block w-full rounded-xl border border-[var(--planora-divider)] p-3 bg-[var(--planora-paper)] text-[var(--planora-text)] focus:border-[var(--planora-primary)] focus:outline-none transition-colors"
                      value={val}
                      onChange={(event) => setFieldText((cur) => ({ ...cur, [key]: event.target.value }))}
                    />
                  ) : (
                    <input
                      type="text"
                      aria-label={label}
                      placeholder={isChannel ? 'Ví dụ: #general, #thong-bao hoặc C12345' : undefined}
                      disabled={busy || confirm}
                      className="block w-full rounded-xl border border-[var(--planora-divider)] p-2.5 sm:p-3 bg-[var(--planora-paper)] text-[var(--planora-text)] focus:border-[var(--planora-primary)] focus:outline-none transition-colors"
                      value={val}
                      onChange={(event) => setFieldText((cur) => ({ ...cur, [key]: event.target.value }))}
                    />
                  )}
                </label>
              );
            })
          ) : (
            <label className="block v3-space-y-1">
              <span className="text-xs font-semibold text-[var(--planora-text)]">Tham số thực thi (JSON)</span>
              <textarea
                aria-label="Tham số thực thi"
                rows={6}
                disabled={busy || confirm}
                className="block w-full font-mono text-xs rounded-xl border border-[var(--planora-divider)] p-3 bg-[var(--planora-paper)] text-[var(--planora-text)] focus:border-[var(--planora-primary)] focus:outline-none transition-colors"
                value={json}
                onChange={(event) => setJson(event.target.value)}
              />
            </label>
          )}
        </div>

        <label className="block v3-space-y-1">
          <span className="text-xs font-semibold text-[var(--planora-text)]">Ghi chú thêm (không bắt buộc)</span>
          <textarea
            value={promptText}
            rows={2}
            disabled={busy || confirm}
            placeholder="Ví dụ: Kèm thông báo họp lúc 14h..."
            onChange={(event) => setPrompt(event.target.value)}
            className="block w-full rounded-xl border border-[var(--planora-divider)] p-3 bg-[var(--planora-paper)] text-[var(--planora-text)] focus:border-[var(--planora-primary)] focus:outline-none transition-colors"
          />
        </label>

        {error && <p role="alert" className="text-sm text-[var(--planora-error-text)]">{error}</p>}

        {confirm && (
          <p
            role="status"
            className="text-sm font-medium text-[var(--planora-text)] p-3 rounded-xl bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)]"
          >
            Không thể tiếp tục sau khi dừng. Các kết quả đã hoàn thành trước đó được giữ nguyên. Gửi nội dung sửa để Planora lập kế hoạch mới?
          </p>
        )}

        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => (confirm ? setConfirm(false) : onClose())}
            className="px-5 py-2.5 bg-[var(--planora-paper)] hover:bg-[var(--planora-surface-hover)] border border-[var(--planora-divider)] text-[var(--planora-text)] text-sm font-medium rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            {confirm ? 'Quay lại sửa' : 'Hủy sửa'}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="px-6 py-2.5 bg-[var(--planora-primary)] hover:bg-[var(--planora-primary-hover)] text-[var(--planora-on-primary)] text-sm font-semibold rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-50"
          >
            {confirm ? 'Dừng và gửi yêu cầu sửa' : 'Xem lại nội dung sửa'}
          </button>
        </div>
      </form>
    </CockpitDialog>
  );
}
