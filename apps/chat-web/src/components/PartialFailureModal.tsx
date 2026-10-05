import React, { useState, useEffect } from 'react';

export interface PartialFailureModalProps {
  stepId: string;
  tool: string;
  errorMessage: string;
  stepArgs?: Record<string, any>;
  prompt?: string;
  onRetry: () => void;
  onEditAndRetry: (updatedArgs?: Record<string, any>, updatedPrompt?: string) => void;
  onSkip: () => void;
  onStop: () => void;
  onClose?: () => void;
  busy?: boolean;
  allowedActions?: Array<'retry' | 'skip' | 'stop'>;
  allowEdit?: boolean;
}

export const PartialFailureModal: React.FC<PartialFailureModalProps> = ({
  stepId,
  tool,
  errorMessage,
  stepArgs,
  prompt,
  onRetry,
  onEditAndRetry,
  onSkip,
  onStop,
  onClose,
  busy = false,
  allowedActions = ['retry', 'skip', 'stop'],
  allowEdit = true,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [argsText, setArgsText] = useState(() =>
    stepArgs ? JSON.stringify(stepArgs, null, 2) : ''
  );
  const [promptText, setPromptText] = useState(
    () => prompt ?? (typeof stepArgs?.prompt === 'string' ? stepArgs.prompt : '')
  );
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);

  const handleClose = () => {
    if (busy) return;
    if (confirmStop) setConfirmStop(false);
    else onClose?.();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  const handleEditAndRetryClick = () => {
    let parsed: Record<string, any> | undefined = stepArgs;
    if (argsText.trim()) {
      try {
        parsed = JSON.parse(argsText);
        setJsonError(null);
      } catch {
        setJsonError('Định dạng JSON không hợp lệ. Vui lòng kiểm tra lại.');
        setIsEditing(true);
        return;
      }
    }
    const cleanPrompt = promptText.trim() || undefined;
    if (parsed && cleanPrompt && ('prompt' in (stepArgs || {}) || 'prompt' in parsed)) {
      parsed.prompt = cleanPrompt;
    }
    if (cleanPrompt !== undefined) {
      onEditAndRetry(parsed, cleanPrompt);
    } else {
      onEditAndRetry(parsed);
    }
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="failure-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
    >
      <div
        className="bg-surface rounded-2xl border-l-4 border-l-danger border-border border shadow-2xl p-5 md:p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-primary-text font-semibold text-sm">
            <span className="text-base">⚠️</span>
            <h3 id="failure-modal-title">Tạm dừng quy trình tại bước: {stepId}</h3>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={handleClose}
            aria-label="Đóng hộp thoại"
            className="text-text-muted hover:text-text-secondary text-sm font-semibold p-1 rounded-md"
          >
            ✕
          </button>
        </div>

        <div className="bg-surface-inset rounded-xl p-3.5 my-3 text-xs text-text-secondary leading-relaxed border border-border">
          <div className="font-semibold text-text mb-1 flex items-center gap-1.5">
            <span>Công cụ:</span>
            <span className="font-mono text-primary-text bg-primary-tint px-1.5 py-0.5 rounded border border-border">
              {tool}
            </span>
          </div>
          <div className="text-danger-text font-medium my-1.5">
            Lỗi: {errorMessage}
          </div>
          <div className="text-text-muted text-sm mt-2 pt-2 border-t border-border">
            🛡️ Bảo vệ an toàn dữ liệu: Các bước đã hoàn thành được bảo toàn nguyên vẹn. Hệ thống tạm dừng để người vận hành kiểm soát.
          </div>
        </div>

        {/* Step Arguments Inspection & Editing */}
        <div className="my-3 p-3 bg-surface-inset rounded-xl border border-border">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-text-secondary">
              Tham số thực thi (Arguments):
            </span>
            <button
              type="button"
              hidden={!allowEdit}
              disabled={busy}
              onClick={() => setIsEditing(!isEditing)}
              className="text-xs text-primary-text hover:underline cursor-pointer"
            >
              {isEditing ? 'Ẩn chỉnh sửa ▲' : 'Chỉnh sửa tham số ▼'}
            </button>
          </div>

          {/* Prompt Inspection and Editing */}
          {(promptText || isEditing) && (
            <div className="mb-2.5">
              <span className="text-sm font-semibold text-text-secondary block mb-1">
                Yêu cầu / Prompt:
              </span>
              {isEditing ? (
                <textarea
                  aria-label="Yêu cầu / Prompt"
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  placeholder="Nhập yêu cầu hoặc prompt..."
                  rows={2}
                  className="w-full text-xs p-2.5 bg-surface border border-border-strong rounded-xl focus:outline-none focus:ring-1 focus:ring-primary text-text"
                />
              ) : (
                <p
                  data-testid="step-prompt-preview"
                  className="text-xs text-text-secondary bg-surface p-2.5 rounded-lg border border-border font-normal whitespace-pre-wrap"
                >
                  {promptText}
                </p>
              )}
            </div>
          )}

          {isEditing ? (
            <div className="space-y-1.5 mt-2">
              <span className="text-sm font-semibold text-text-secondary block mb-0.5">
                Tham số JSON (Arguments):
              </span>
              <textarea
                aria-label="Tham số thực thi (JSON)"
                value={argsText}
                onChange={(e) => {
                  setArgsText(e.target.value);
                  if (jsonError) setJsonError(null);
                }}
                placeholder='{\n  "param": "value"\n}'
                rows={4}
                className="w-full font-mono text-xs p-2.5 bg-surface border border-border-strong rounded-xl focus:outline-none focus:ring-1 focus:ring-primary text-text"
              />
              {jsonError && <p className="text-danger-text text-xs font-medium">{jsonError}</p>}
            </div>
          ) : (
            <pre
              data-testid="step-args-preview"
              className="font-mono text-sm text-text-secondary bg-surface p-2.5 rounded-lg border border-border overflow-x-auto max-h-28"
            >
              {argsText || '(Không có tham số bổ sung)'}
            </pre>
          )}
        </div>

        {/* 4 Recovery Actions */}
        <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-border">
          <button
            type="button"
            disabled={busy}
            hidden={!allowedActions.includes('retry')}
            onClick={onRetry}
            className="text-xs font-medium bg-primary text-white hover:bg-primary px-4 py-2 rounded-full shadow-xs transition cursor-pointer flex items-center gap-1.5"
          >
            🔄 Thử lại bước này
          </button>

          <button
            type="button"
            disabled={busy}
            hidden={!allowEdit || !allowedActions.includes('retry')}
            onClick={handleEditAndRetryClick}
            className="text-xs font-medium text-primary-text border border-border-strong hover:bg-primary-tint px-4 py-2 rounded-full transition cursor-pointer flex items-center gap-1.5"
          >
            ✏️ Sửa & tiếp tục
          </button>

          <button
            type="button"
            disabled={busy}
            hidden={!allowedActions.includes('skip')}
            onClick={onSkip}
            className="text-xs font-medium text-text-secondary border border-border-strong hover:bg-surface-raised px-4 py-2 rounded-full transition cursor-pointer flex items-center gap-1.5"
          >
            ⏭ Bỏ qua bước này
          </button>

          <button
            type="button"
            disabled={busy}
            hidden={!allowedActions.includes('stop')}
            onClick={() => setConfirmStop(true)}
            className="text-xs font-medium text-danger-text hover:bg-danger-tint px-3.5 py-2 rounded-full transition cursor-pointer ml-auto"
          >
            ⏹ Dừng lại toàn bộ
          </button>
        </div>
        {confirmStop && (
          <div className="mt-3 p-3 border border-border rounded-xl" role="group" aria-label="Xác nhận dừng">
            <p>Dừng hẳn? Không thể chạy tiếp sau khi dừng.</p>
            <button type="button" disabled={busy} onClick={onStop} className="text-danger-text p-2">Dừng hẳn quy trình</button>
            <button type="button" disabled={busy} onClick={() => setConfirmStop(false)} className="p-2">Quay lại xử lý lỗi</button>
          </div>
        )}
      </div>
    </div>
  );
};
