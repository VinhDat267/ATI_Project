import React, { useState } from "react";

export interface ClarificationCardProps {
  question: string;
  options?: string[];
  onSelectOption?: (option: string) => void;
  onSubmitText?: (text: string) => void;
  onSkip?: () => void;
}

export const ClarificationCard: React.FC<ClarificationCardProps> = ({
  question,
  options = [],
  onSelectOption,
  onSubmitText,
  onSkip,
}) => {
  const [customText, setCustomText] = useState("");
  const [selectedOpt, setSelectedOpt] = useState<string | null>(null);

  const handleOptionClick = (opt: string) => {
    setSelectedOpt(opt);
    onSelectOption?.(opt);
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customText.trim()) {
      onSubmitText?.(customText.trim());
      setCustomText("");
    }
  };

  return (
    <div className="clarification-card">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold text-zinc-900 text-sm leading-relaxed">
          {question}
        </p>
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-zinc-400 hover:text-zinc-600 transition"
          >
            Bỏ qua
          </button>
        )}
      </div>

      {options.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3.5">
          {options.map((opt) => {
            const isSelected = selectedOpt === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => handleOptionClick(opt)}
                className={`text-xs px-3.5 py-1.5 rounded-lg border transition font-medium ${
                  isSelected ? "btn primary" : "btn"
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      )}

      {(!options || options.length === 0 || onSubmitText) && (
        <form onSubmit={handleTextSubmit} className="flex gap-2 mt-3">
          <input
            type="text"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            aria-label="Nhập câu trả lời làm rõ yêu cầu"
            placeholder="Nhập câu trả lời..."
            className="flex-1 bg-[#f5f5f7] border border-zinc-200 rounded-xl px-3.5 py-2 text-xs text-zinc-800 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={!customText.trim()}
            className="btn primary"
          >
            Gửi
          </button>
        </form>
      )}
    </div>
  );
};
