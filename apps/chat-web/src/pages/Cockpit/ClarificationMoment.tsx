// Source: AppStagePage.tsx moment 3. API supplies question/options/context; no invented recommendation or timestamp.
// The free-text card stays expanded to preserve the required single visible composer.
import type { KeyboardEvent, RefObject } from 'react';
import { SERVICE_REGISTRY } from '@wap/tool-schemas';
import { ServiceLogo } from '../../components/ServiceLogo';
interface Props {
  question: string;
  context?: string;
  options: string[];
  selected: string | null;
  onSelect: (option: string | null) => void;
  draft: string;
  onDraft: (text: string) => void;
  planning: boolean;
  input: RefObject<HTMLTextAreaElement | null>;
  inputHidden?: boolean;
  onSend: (text: string) => void;
  onBack: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}
export function ClarificationMoment({
  question,
  context,
  options,
  selected,
  onSelect,
  draft,
  onDraft,
  planning,
  input,
  inputHidden,
  onSend,
  onBack,
  onKeyDown,
}: Props) {
  return (
    <section
      id="moment-3"
      className="stage-section is-active v3-space-y-8"
      data-moment="3"
      aria-label="Cockpit"
    >
      <div className="v3-space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-800 rounded-lg text-xs font-medium border border-amber-200">
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span>Tôi cần bạn xác nhận thêm một thông tin</span>
        </div>{' '}
        <h1
          id="heading-moment-3"
          className="font-display text-3xl sm:text-4xl lg:text-[44px] text-brand-text font-normal leading-tight"
          tabIndex={-1}
        >
          {question}
        </h1>
        {context && <p className="text-base text-brand-muted max-w-2xl leading-relaxed">{context}</p>}
      </div>
      <form
        aria-label="Nhập yêu cầu"
        onSubmit={(event) => {
          event.preventDefault();
          onSend(selected ?? draft);
        }}
      >
        <div
          className="v3-space-y-3 max-w-xl"
          role="radiogroup"
          aria-labelledby="heading-moment-3"
          onKeyDown={(event) => {
            const radio = (event.target as HTMLElement).closest<HTMLElement>(
              '[role="radio"]',
            );
            if (
              !radio ||
              ![
                'ArrowDown',
                'ArrowUp',
                'ArrowLeft',
                'ArrowRight',
                'Home',
                'End',
              ].includes(event.key)
            )
              return;
            event.preventDefault();
            const radios = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="radio"]',
              ),
            ];
            const index = radios.indexOf(radio as HTMLButtonElement);
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? radios.length - 1
                  : (index +
                      (['ArrowDown', 'ArrowRight'].includes(event.key)
                        ? 1
                        : -1) +
                      radios.length) %
                    radios.length;
            onSelect(options[next] ?? null);
            radios[next]?.focus();
          }}
        >
          {options.map((option) => {
            const normalized = option.trim().toLocaleLowerCase();
            const service = SERVICE_REGISTRY.find(row => row.name.toLocaleLowerCase() === normalized || row.id === normalized);
            return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected === option}
              tabIndex={selected === option ? 0 : -1}
              onClick={() => onSelect(option)}
              className={
                'w-full text-left p-4 bg-white hover:bg-neutral-50 rounded-2xl ' +
                (selected === option
                  ? 'border-2 border-brand-primary'
                  : 'border border-brand-border') +
                ' shadow-sm transition-all flex items-center justify-between gap-3 group'
              }
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div title={service?.name ?? 'Lựa chọn'} className="w-10 h-10 rounded-xl bg-neutral-100 text-neutral-600 flex items-center justify-center font-bold text-sm shadow-sm flex-shrink-0">
                  {service ? <ServiceLogo service={service.id} className="w-5 h-5 shrink-0" /> : <svg aria-hidden="true" className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h8m-8 4h5M6 3h9l3 3v15H6z" /></svg>}
                </div>
                <span className="text-base font-semibold text-brand-text group-hover:text-brand-primary transition-colors break-words">
                  {option}
                </span>
              </div>
              <div
                aria-hidden="true"
                className={
                  'w-5 h-5 rounded-full border flex-shrink-0 ' +
                  (selected === option
                    ? 'border-brand-primary text-brand-primary'
                    : 'border-neutral-300')
                }
              >
                {selected === option ? '✓' : ''}
              </div>
            </button>
          ); })}
          <div
            id="custom-sheet-container"
            className="bg-white rounded-2xl border border-dashed border-neutral-300 shadow-sm transition-all overflow-hidden"
          >
            <button
              id="btn-toggle-custom-sheet"
              type="button"
              role="radio"
              aria-checked={selected === null}
              tabIndex={selected === null ? 0 : -1}
              onClick={() => {
                onSelect(null);
                input.current?.focus();
              }}
              className="w-full text-left p-4 hover:bg-neutral-50 flex items-center justify-between group"
            >
              <div className="flex items-center gap-3.5">
                <div
                  aria-hidden="true"
                  className="w-10 h-10 rounded-xl bg-neutral-100 text-neutral-600 flex items-center justify-center text-lg font-medium"
                >
                  +
                </div>
                <span className="text-sm font-medium text-brand-text group-hover:text-brand-primary transition-colors">
                  Để tôi gõ tên hoặc link khác
                </span>
              </div>
              <span aria-hidden="true">⌄</span>
            </button>
            <div
              id="custom-sheet-form"
              className="p-4 pt-1 bg-neutral-50 border-t border-dashed border-neutral-200 v3-space-y-2"
            >
              <label
                htmlFor="custom-sheet-input"
                className="text-xs font-medium text-brand-text"
              >
                Nhập tên, link hoặc câu trả lời:
              </label>
              {!inputHidden && (
                <textarea
                  ref={input}
                  id="custom-sheet-input"
                  rows={2}
                  value={draft}
                  onChange={(event) => {
                    onSelect(null);
                    onDraft(event.target.value);
                  }}
                  onKeyDown={onKeyDown}
                  aria-label="Nhập câu trả lời làm rõ yêu cầu"
                  className="w-full px-3 py-2 bg-white rounded-xl border border-brand-border text-xs sm:text-sm text-brand-text focus:v3-outline-none focus:border-brand-primary resize-none"
                />
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            disabled={planning || !(selected ?? draft).trim()}
            onClick={() => onSend(selected ?? draft)}
            className="px-6 py-2.5 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-semibold rounded-xl shadow-sm transition-all"
          >
            Xác nhận và tiếp tục
          </button>
          <button
            type="button"
            onClick={onBack}
            className="px-4 py-2.5 text-sm font-medium text-brand-muted hover:text-brand-text transition-colors"
          >
            Quay lại
          </button>
        </div>
      </form>
    </section>
  );
}
