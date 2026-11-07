// Source: AppStagePage.tsx moment 3. API supplies question/options/context; no invented recommendation or timestamp.
// The free-text card stays expanded to preserve the required single visible composer.
import type { KeyboardEvent, RefObject } from 'react';
import { SERVICE_REGISTRY } from '@wap/tool-schemas';
import { ServiceLogo } from '../../components/ServiceLogo';
import { NoWritesNotice } from '../Responses/ResponseMoment';
import { RequestEcho } from './RequestEcho';

interface Props {
  request?: string;
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

function matchExactService(option: string) {
  const normalized = option.trim().toLocaleLowerCase();
  return SERVICE_REGISTRY.find(
    (row) => row.name.toLocaleLowerCase() === normalized || row.id === normalized,
  );
}

export function ClarificationMoment({
  request,
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
  const combinedValue =
    selected && draft.trim() ? `${selected}\n${draft.trim()}` : (selected ?? draft);
  const canSubmit = !planning && Boolean(combinedValue.trim());

  return (
    <section
      id="moment-3"
      className="stage-section is-active max-w-2xl mx-auto w-full pt-2 sm:pt-4"
      data-moment="3"
      aria-label="Cockpit"
    >
      <div className="bg-white rounded-2xl border border-[#E5E5E0] shadow-2xs overflow-hidden">
        {/* Top Workflow Stepper & Safety Assurance */}
        <div className="px-5 py-3 bg-[#F8F8F6] border-b border-[#EAEAE4] flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium hidden sm:inline-flex">
              <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
              </svg>
              <span>1. Phân tích</span>
            </span>
            <span className="text-[#9CA3AF] hidden sm:inline" aria-hidden="true">
              →
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-[#DEDED8] font-semibold text-[#111827] shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-[#FF5701]" aria-hidden="true" />
              <span>2. Bổ sung thông tin</span>
            </span>
            <span className="text-[#9CA3AF] hidden md:inline" aria-hidden="true">
              →
            </span>
            <span className="text-[#6B7280] font-medium hidden md:inline">
              3. Xem trước kế hoạch
            </span>
          </div>
          <span className="text-xs font-medium text-[#6B7280]">
            Bước 2 / 3
          </span>
        </div>

        {/* Question & Context Header */}
        <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-[#F1F1EC] v3-space-y-2">
          <RequestEcho request={request} />
          <h1
            id="heading-moment-3"
            className="text-lg sm:text-xl font-semibold text-[#111827] leading-relaxed [overflow-wrap:anywhere]"
            tabIndex={-1}
          >
            {question}
          </h1>
          {context && (
            <p className="text-sm text-[#4B5563] leading-relaxed [overflow-wrap:anywhere]">
              {context}
            </p>
          )}
        </div>

        {/* Selection & Additional Details Form */}
        <form
          aria-label="Nhập yêu cầu"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) onSend(combinedValue);
          }}
          className="px-5 sm:px-6 py-5 v3-space-y-4 bg-white"
        >
          <div
            className="v3-space-y-2.5"
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
            {options.length > 0 && (
              <div className="text-xs font-semibold text-[#374151] mb-1">
                Chọn nhanh từ tài nguyên đã kết nối
              </div>
            )}

            {options.map((option) => {
              const service = matchExactService(option);
              const isRepoLike = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(option.trim());
              const isSelected = selected === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => onSelect(option)}
                  className={`w-full text-left px-4 py-3 rounded-xl transition-all flex items-center justify-between gap-3 group cursor-pointer ${
                    isSelected
                      ? 'bg-[#FFF9F5] border-2 border-[#FF5701] shadow-2xs'
                      : 'bg-white hover:bg-[#FAFAF8] border border-[#E2E2DC] hover:border-[#C7C7C0]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      title={service?.name ?? 'Lựa chọn'}
                      className={`w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0 ${
                        isSelected
                          ? 'bg-white border-[#FFDFC6]'
                          : 'bg-[#F8F8F6] border-[#EAEAE4]'
                      }`}
                    >
                      {service ? (
                        <ServiceLogo service={service.id} className="w-4 h-4 shrink-0" />
                      ) : (
                        <svg
                          aria-hidden="true"
                          className="w-4 h-4 text-[#4B5563] shrink-0"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.75"
                        >
                          {isRepoLike ? (
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
                            />
                          ) : (
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M8 10h8m-8 4h5M6 3h9l3 3v15H6z"
                            />
                          )}
                        </svg>
                      )}
                    </div>
                    <span className="text-sm font-semibold text-[#111827] [overflow-wrap:anywhere]">
                      {option}
                    </span>
                  </div>
                  <div
                    aria-hidden="true"
                    className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                      isSelected
                        ? 'bg-[#FF5701] text-white border border-[#FF5701]'
                        : 'border border-[#D1D5DB] bg-white group-hover:border-[#9CA3AF]'
                    }`}
                  >
                    {isSelected && (
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </button>
              );
            })}

            {/* Unified Custom / Supplemental Details Input */}
            <div
              id="custom-sheet-container"
              className={`rounded-xl border transition-colors overflow-hidden ${
                selected === null
                  ? 'bg-[#FAFAF8] border-[#D5D5CE]'
                  : 'bg-[#FAFAF8] border-[#EAEAE4]'
              }`}
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
                className="w-full text-left px-4 py-2.5 hover:bg-[#F3F3EE] flex items-center justify-between gap-3 group cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    aria-hidden="true"
                    className={`w-6 h-6 rounded-md border flex items-center justify-center flex-shrink-0 ${
                      selected === null
                        ? 'bg-white border-[#111827] text-[#111827]'
                        : 'bg-white border-[#DEDED8] text-[#6B7280]'
                    }`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </span>
                  <span className="text-xs font-semibold text-[#374151] group-hover:text-[#111827]">
                    Để tôi gõ tên hoặc link khác
                  </span>
                </div>
                {selected !== null && (
                  <span className="text-[11px] text-[#6B7280] hidden sm:inline">
                    Hoặc gõ thêm chi tiết bên dưới
                  </span>
                )}
              </button>

              <div
                id="custom-sheet-form"
                className="px-4 pb-3.5 pt-2 border-t border-[#EAEAE4] v3-space-y-1.5"
              >
                <label
                  htmlFor="custom-sheet-input"
                  className="block text-xs font-medium text-[#4B5563]"
                >
                  {selected
                    ? `Bổ sung chi tiết cho "${selected}" (ví dụ: tiêu đề, nội dung cần tạo):`
                    : 'Nhập câu trả lời, tiêu đề hoặc đường dẫn cụ thể:'}
                </label>
                {!inputHidden && (
                  <textarea
                    ref={input}
                    id="custom-sheet-input"
                    rows={3}
                    spellCheck={false}
                    value={draft}
                    placeholder={
                      selected
                        ? 'Ví dụ: Tiêu đề: Lỗi đăng nhập Google — Nội dung: Kiểm tra lại callback OAuth...'
                        : 'Nhập tên kho/bảng, đường dẫn hoặc nội dung chi tiết tại đây...'
                    }
                    onChange={(event) => {
                      onDraft(event.target.value);
                    }}
                    onKeyDown={onKeyDown}
                    aria-label="Nhập câu trả lời làm rõ yêu cầu"
                    className="w-full px-3 py-2.5 bg-white rounded-lg border border-[#DEDED8] text-sm text-[#111827] placeholder:text-[#9CA3AF] v3-outline-none focus:v3-outline-none focus:border-[#111827] resize-none"
                  />
                )}
              </div>
            </div>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-[#F1F1EC]">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => onSend(combinedValue)}
                className={`px-5 py-2.5 text-sm font-semibold rounded-xl transition-all !opacity-100 flex items-center gap-1.5 ${
                  canSubmit
                    ? 'bg-[#FF5701] hover:bg-[#E04D00] text-white shadow-2xs cursor-pointer'
                    : 'bg-[#F4F4F1] text-[#6B7280] border border-[#E5E5E0] cursor-not-allowed'
                }`}
              >
                <span>Xác nhận và tiếp tục</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
              <button
                type="button"
                onClick={onBack}
                className="px-4 py-2.5 text-sm font-medium text-[#4B5563] hover:text-[#111827] hover:bg-[#F4F4F1] rounded-xl transition-colors cursor-pointer"
              >
                Quay lại
              </button>
            </div>
          </div>

          <NoWritesNotice />
        </form>
      </div>
    </section>
  );
}
