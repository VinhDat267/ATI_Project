import React, { useState } from 'react';

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
  const [customText, setCustomText] = useState('');
  const [selectedOpt, setSelectedOpt] = useState<string | null>(null);

  const handleOptionClick = (opt: string) => {
    setSelectedOpt(opt);
    onSelectOption?.(opt);
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customText.trim()) {
      onSubmitText?.(customText.trim());
      setCustomText('');
    }
  };

  return (
    <div
      className="bg-surface rounded-2xl p-5 border border-border shadow-sm max-w-xl my-3 border-l-4"
      style={{ borderLeftColor: 'var(--primary)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold text-text text-sm leading-relaxed">
          {question}
        </p>
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-text-muted hover:text-text-secondary transition"
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
                  isSelected
                    ? 'bg-primary text-white border-border-strong shadow-xs'
                    : 'bg-surface-inset text-text border-border hover:bg-surface-inset hover:border-border-strong'
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
            className="flex-1 bg-surface-inset border border-border rounded-xl px-3.5 py-2 text-xs text-text placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={!customText.trim()}
            className="bg-primary text-white text-xs font-medium px-4 py-2 rounded-full hover:bg-primary disabled:opacity-50 transition shadow-xs"
          >
            Gửi
          </button>
        </form>
      )}
    </div>
  );
};
