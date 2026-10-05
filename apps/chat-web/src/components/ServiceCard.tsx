import React, { useState } from 'react';

export interface ServiceCardProps {
  service: string;
  title: string;
  connected?: boolean;
  allowedScope?: string[];
  credentialFields?: Array<{ key: string; label: string; type?: 'text' | 'password' | 'multiline' }>;
  scopeLabel?: string;
  onSave?: (input: { credentials: Record<string, string>; allowedScope: string[] }) => Promise<ServiceActionResult> | void;
  onTestConnection?: () => Promise<ServiceActionResult> | void;
}

export interface ServiceActionResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

export const ServiceCard: React.FC<ServiceCardProps> = ({
  service,
  title,
  connected = false,
  allowedScope: initialScope = [],
  credentialFields = [
    { key: 'apiKey', label: 'API Key / Client ID', type: 'password' },
    { key: 'token', label: 'OAuth / API Token', type: 'password' },
  ],
  scopeLabel = 'board hoặc channel',
  onSave,
  onTestConnection,
}) => {
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [scopes, setScopes] = useState<string[]>(initialScope);
  const [newScope, setNewScope] = useState('');
  const [feedback, setFeedback] = useState<ServiceActionResult | null>(null);
  const [busy, setBusy] = useState(false);

  const handleTest = async () => {
    if (!onTestConnection) return;
    setFeedback(null);
    setBusy(true);
    try {
      const result = await onTestConnection();
      if (result) setFeedback(result);
    } catch (error) {
      setFeedback({ success: false, message: error instanceof Error ? error.message : 'Không thể kiểm tra kết nối' });
    } finally {
      setBusy(false);
    }
  };

  const handleAddScope = () => {
    if (newScope.trim() && !scopes.includes(newScope.trim())) {
      setScopes([...scopes, newScope.trim()]);
      setNewScope('');
    }
  };

  const handleRemoveScope = (scopeToRemove: string) => {
    setScopes(scopes.filter((s) => s !== scopeToRemove));
  };

  const handleSave = async () => {
    if (!onSave) return;
    setFeedback(null);
    setBusy(true);
    try {
      const selected = Object.fromEntries(credentialFields.map(({ key }) => [key, credentials[key] ?? '']));
      const result = await onSave({ credentials: selected, allowedScope: scopes });
      if (result) setFeedback(result);
      // Clear saved values, preserving fields edited while this submission was pending.
      if (result?.success) setCredentials((current) => Object.fromEntries(
        Object.entries(current).filter(([key, value]) => value !== selected[key]),
      ));
    } catch (error) {
      setFeedback({ success: false, message: error instanceof Error ? error.message : 'Không thể lưu cấu hình' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-surface rounded-2xl border border-border shadow-sm p-6 max-w-xl">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary-tint text-primary-text flex items-center justify-center font-bold text-xs uppercase shadow-xs">
            {service[0]}
          </div>
          <h4 className="font-semibold text-text text-base">{title}</h4>
        </div>
        <span
          className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
            connected
              ? 'bg-success-tint text-success-text border border-border'
              : 'bg-surface-raised text-text-muted border border-border'
          }`}
        >
          {connected ? 'Đã cấu hình' : 'Chưa cấu hình'}
        </span>
      </div>

      {/* Credential Inputs */}
      <div className="mt-4 flex flex-col gap-3">
        {credentialFields.map((field) => <div key={field.key}>
          <label htmlFor={`${service}-${field.key}`} className="block text-xs font-semibold text-text-secondary mb-1">{field.label}</label>
          {field.type === 'multiline'
            ? <textarea id={`${service}-${field.key}`} rows={4} spellCheck={false} autoComplete="off"
              value={credentials[field.key] ?? ''}
              onChange={(e) => setCredentials({ ...credentials, [field.key]: e.target.value })}
              placeholder="••••••••••••••••"
              className="w-full bg-surface-inset border border-border rounded-xl px-3.5 py-2 text-xs font-mono text-text placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-primary" />
            : <input id={`${service}-${field.key}`} type={field.type ?? 'password'}
              value={credentials[field.key] ?? ''}
              onChange={(e) => setCredentials({ ...credentials, [field.key]: e.target.value })}
              placeholder="••••••••••••••••"
              className="w-full bg-surface-inset border border-border rounded-xl px-3.5 py-2 text-xs text-text placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-primary" />}
        </div>)}
      </div>

      {/* Allowed Scope Section */}
      <div className="mt-4 pt-3 border-t border-border">
        <label className="block text-xs font-semibold text-text mb-1">
          Phạm vi được phép truy cập (Allowed Scope)
        </label>
        <p className="text-sm text-text-muted mb-2">
          Giới hạn {scopeLabel} mà AI được phép đọc và ghi.
        </p>

        {/* Chips */}
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {scopes.map((sc) => (
            <span
              key={sc}
              className="inline-flex items-center gap-1.5 bg-surface-inset border border-border text-text text-xs px-2.5 py-1 rounded-lg"
            >
              <span>{sc}</span>
              <button
                type="button"
                onClick={() => handleRemoveScope(sc)}
                aria-label={`Xóa phạm vi ${sc}`}
                className="shrink-0 text-text-muted hover:text-danger-text font-bold text-xs"
              >
                ✕
              </button>
            </span>
          ))}
        </div>

        {/* Add Scope Input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={newScope}
            onChange={(e) => setNewScope(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddScope();
              }
            }}
            placeholder={`Thêm ${scopeLabel}...`}
            className="flex-1 bg-surface-inset border border-border rounded-xl px-3 py-1.5 text-xs text-text placeholder-text-muted focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAddScope}
            className="text-xs font-medium text-primary-text border border-border-strong hover:bg-primary-tint px-3 py-1.5 rounded-lg transition"
          >
            Thêm
          </button>
        </div>
      </div>

      {feedback && (
        <p role="status" className={`mt-3 text-xs ${feedback.success ? 'text-success-text' : 'text-danger-text'}`}>
          {feedback.message}{feedback.latencyMs !== undefined ? ` (${feedback.latencyMs}ms)` : ''}
        </p>
      )}

      {/* Action Footer */}
      <div className="mt-6 pt-4 border-t border-border flex items-center justify-between">
        {onTestConnection && (
          <button
            type="button"
            onClick={handleTest}
            disabled={busy}
            className="text-xs font-medium text-primary-text border border-border-strong hover:bg-primary-tint px-4 py-2 rounded-full transition"
          >
            {busy ? 'Đang xử lý...' : 'Kiểm tra kết nối'}
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={busy || !onSave}
          className="text-xs font-medium bg-primary text-white hover:bg-primary px-5 py-2 rounded-full transition shadow-xs ml-auto"
        >
          Lưu cấu hình
        </button>
      </div>
    </div>
  );
};
