import React, { useState, useEffect, useRef, useCallback } from "react";

export interface PartialFailureModalProps {
  stepId: string;
  tool: string;
  errorMessage: string;
  stepArgs?: Record<string, any>;
  prompt?: string;
  onRetry: () => void;
  onEditAndRetry: (
    updatedArgs?: Record<string, any>,
    updatedPrompt?: string,
  ) => void;
  onSkip: () => void;
  onStop: () => void;
  onClose?: () => void;
  busy?: boolean;
  allowedActions?: Array<"retry" | "skip" | "stop">;
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
  allowedActions = ["retry", "skip", "stop"],
  allowEdit = true,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [argsText, setArgsText] = useState(() =>
    stepArgs ? JSON.stringify(stepArgs, null, 2) : "",
  );
  const [promptText, setPromptText] = useState(
    () =>
      prompt ?? (typeof stepArgs?.prompt === "string" ? stepArgs.prompt : ""),
  );
  const [jsonError, setJsonError] = useState<string | null>(null);

  const [confirmStop, setConfirmStop] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const handleClose = useCallback(() => {
    if (!busy) onClose?.();
  }, [busy, onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
      if (e.key === "Tab") {
        const items = [
          ...(panel.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled):not([hidden]),textarea:not(:disabled)",
          ) || []),
        ].filter((item) => !item.closest("[hidden]"));
        const first = items[0],
          last = items.at(-1);
        if (
          (!e.shiftKey && document.activeElement === last) ||
          document.activeElement === panel.current
        ) {
          e.preventDefault();
          first?.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose]);

  const handleEditAndRetryClick = () => {
    let parsed: Record<string, any> | undefined = stepArgs;
    if (argsText.trim()) {
      try {
        parsed = JSON.parse(argsText);
        setJsonError(null);
      } catch {
        setJsonError("Định dạng JSON không hợp lệ. Vui lòng kiểm tra lại.");
        setIsEditing(true);
        return;
      }
    }
    const cleanPrompt = promptText.trim() || undefined;
    if (
      parsed &&
      cleanPrompt &&
      ("prompt" in (stepArgs || {}) || "prompt" in parsed)
    ) {
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
      className="failure-overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        className="failure-panel bg-white rounded-2xl border-l-4 border-l-[#ff3b30] border-zinc-200 border shadow-2xl p-5 md:p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-[#ff3b30] font-semibold text-sm">
            <span className="text-base">⚠️</span>
            <h3 id="failure-modal-title">
              Tạm dừng quy trình tại bước: {stepId}
            </h3>
          </div>
          <button
            type="button"
            disabled={busy}

            onClick={handleClose}
            aria-label="Đóng hộp thoại"
            className="text-zinc-400 hover:text-zinc-600 text-sm font-semibold p-1 rounded-md"
          >
            ✕
          </button>
        </div>

        <div className="bg-[#f5f5f7] rounded-xl p-3.5 my-3 text-xs text-zinc-700 leading-relaxed border border-zinc-200/60">
          <div className="font-semibold text-zinc-800 mb-1 flex items-center gap-1.5">
            <span>Công cụ:</span>
            <span className="font-mono text-[#0071e3] bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
              {tool}
            </span>
          </div>
          <div className="text-red-600 font-medium my-1.5">
            Lỗi: {errorMessage}
          </div>
          <div className="text-zinc-500 text-[11px] mt-2 pt-2 border-t border-zinc-200">
            🛡️ Bảo vệ an toàn dữ liệu: Các bước đã hoàn thành được bảo toàn
            nguyên vẹn. Hệ thống tạm dừng để người vận hành kiểm soát.
          </div>
        </div>

        {/* Step Arguments Inspection & Editing */}
        <div className="my-3 p-3 bg-zinc-50 rounded-xl border border-zinc-200">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-zinc-700">
              Tham số thực thi (Arguments):
            </span>
            <button
              type="button"
              hidden={!allowEdit}
              disabled={busy}
              onClick={() => setIsEditing(!isEditing)}
              className="text-xs text-[#0071e3] hover:underline cursor-pointer"
            >
              {isEditing ? "Ẩn chỉnh sửa ▲" : "Chỉnh sửa tham số ▼"}
            </button>
          </div>

          {/* Prompt Inspection and Editing */}
          {(promptText || isEditing) && (
            <div className="mb-2.5">
              <span className="text-[11px] font-semibold text-zinc-600 block mb-1">
                Yêu cầu / Prompt:
              </span>
              {isEditing ? (
                <textarea
                  aria-label="Yêu cầu / Prompt"
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  placeholder="Nhập yêu cầu hoặc prompt..."
                  rows={2}
                  className="w-full text-xs p-2.5 bg-white border border-zinc-300 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 text-zinc-800"
                />
              ) : (
                <p
                  data-testid="step-prompt-preview"
                  className="text-xs text-zinc-700 bg-white p-2.5 rounded-lg border border-zinc-200 font-normal whitespace-pre-wrap"
                >
                  {promptText}
                </p>
              )}
            </div>
          )}

          {isEditing ? (
            <div className="space-y-1.5 mt-2">
              <span className="text-[11px] font-semibold text-zinc-600 block mb-0.5">
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
                className="w-full font-mono text-xs p-2.5 bg-white border border-zinc-300 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 text-zinc-800"
              />
              {jsonError && (
                <p className="text-red-500 text-xs font-medium">{jsonError}</p>
              )}
            </div>
          ) : (
            <pre
              data-testid="step-args-preview"
              className="font-mono text-[11px] text-zinc-600 bg-white p-2.5 rounded-lg border border-zinc-200 overflow-x-auto max-h-28"
            >
              {argsText || "(Không có tham số bổ sung)"}
            </pre>
          )}
        </div>

        <div className="stop-confirmation" hidden={!confirmStop}>
          <p>
            Dừng hẳn? Không thể chạy tiếp sau khi dừng. Các thay đổi đã tạo được
            giữ lại.
          </p>
          <button className="btn" onClick={() => setConfirmStop(false)}>
            Quay lại
          </button>
          <button className="btn primary" disabled={busy} onClick={onStop}>
            Xác nhận dừng
          </button>
        </div>
        {/* Recovery Actions */}
        <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-zinc-100">
          <button
            type="button"
            disabled={busy}
            hidden={!allowedActions.includes("retry")}
            onClick={onRetry}
            className="text-xs font-medium bg-[#0071e3] text-white hover:bg-blue-600 px-4 py-2 rounded-full shadow-xs transition cursor-pointer flex items-center gap-1.5"
          >
            🔄 Thử lại bước này
          </button>

          <button
            type="button"
            disabled={busy}
            hidden={!allowEdit || !allowedActions.includes("retry")}
            onClick={handleEditAndRetryClick}
            className="text-xs font-medium text-[#0066cc] border border-blue-400 hover:bg-blue-50 px-4 py-2 rounded-full transition cursor-pointer flex items-center gap-1.5"
          >
            ✏️ Sửa & tiếp tục
          </button>

          <button
            type="button"
            disabled={busy}
            hidden={!allowedActions.includes("skip")}
            onClick={onSkip}
            className="text-xs font-medium text-zinc-700 border border-zinc-300 hover:bg-zinc-100 px-4 py-2 rounded-full transition cursor-pointer flex items-center gap-1.5"
          >
            ⏭ Bỏ qua bước này
          </button>

          <button
            type="button"
            disabled={busy}

            hidden={!allowedActions.includes("stop")}
            onClick={() => setConfirmStop(true)}
            className="text-xs font-medium text-red-500 hover:bg-red-50 px-3.5 py-2 rounded-full transition cursor-pointer ml-auto"
          >
            ⏹ Dừng lại toàn bộ
          </button>
        </div>
      </div>
    </div>
  );
};
