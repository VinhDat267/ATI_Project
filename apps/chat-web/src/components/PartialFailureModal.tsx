import React from 'react';

export interface PartialFailureModalProps {
  stepId: string;
  tool: string;
  errorMessage: string;
  onRetry: () => void;
  onEditAndRetry: () => void;
  onSkip: () => void;
  onStop: () => void;
}

export const PartialFailureModal: React.FC<PartialFailureModalProps> = ({
  stepId,
  tool,
  errorMessage,
  onRetry,
  onEditAndRetry,
  onSkip,
  onStop,
}) => {
  return (
    <div className="bg-white rounded-2xl border-l-4 border-l-[#ff3b30] border-zinc-200 border shadow-md p-5 my-3 max-w-2xl">
      <div className="flex items-center gap-2 text-[#ff3b30] font-semibold text-sm mb-2">
        <span className="text-base">⚠️</span>
        <span>Xử lý sự cố tại {stepId} (Partial Failure Recovery)</span>
      </div>

      <div className="bg-[#f5f5f7] rounded-xl p-3 my-2 text-xs text-zinc-700 leading-relaxed border border-zinc-200/60">
        <div className="font-semibold text-zinc-800 mb-1 flex items-center gap-1.5">
          <span>Công cụ:</span>
          <span className="font-mono text-[#0071e3] bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
            {tool}
          </span>
        </div>
        <div className="text-red-600 font-medium my-1">
          Lỗi: {errorMessage}
        </div>
        <div className="text-zinc-500 text-[11px] mt-1.5 pt-1.5 border-t border-zinc-200">
          🛡️ Nguyên tắc Write Safety: Các bước trước đó đã hoàn thành và dữ liệu đã được bảo toàn. Hệ thống tạm dừng để người vận hành kiểm soát.
        </div>
      </div>

      {/* 4 Recovery Actions */}
      <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-zinc-100">
        <button
          type="button"
          onClick={onRetry}
          className="text-xs font-medium bg-[#0071e3] text-white hover:bg-blue-600 px-4 py-2 rounded-full shadow-xs transition cursor-pointer flex items-center gap-1.5"
        >
          🔄 Thử lại bước này
        </button>

        <button
          type="button"
          onClick={onEditAndRetry}
          className="text-xs font-medium text-[#0066cc] border border-blue-400 hover:bg-blue-50 px-4 py-2 rounded-full transition cursor-pointer flex items-center gap-1.5"
        >
          ✏️ Sửa & tiếp tục
        </button>

        <button
          type="button"
          onClick={onSkip}
          className="text-xs font-medium text-zinc-700 border border-zinc-300 hover:bg-zinc-100 px-4 py-2 rounded-full transition cursor-pointer flex items-center gap-1.5"
        >
          ⏭ Bỏ qua bước này
        </button>

        <button
          type="button"
          onClick={onStop}
          className="text-xs font-medium text-red-500 hover:bg-red-50 px-3.5 py-2 rounded-full transition cursor-pointer ml-auto"
        >
          ⏹ Dừng lại toàn bộ
        </button>
      </div>
    </div>
  );
};
