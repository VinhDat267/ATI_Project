// Source: AppStagePage.tsx moments 1–2. Content comes from the registered catalog and gatherState.
import type { KeyboardEvent, RefObject, ReactNode } from 'react';
import { getServiceDefinition, getToolDefinition } from '@wap/tool-schemas';
import { ServiceLogo } from '../../components/ServiceLogo';
import type { ServiceInfo, GatherState } from '../../types';
interface Props {
  services: ServiceInfo[];
  loading: boolean;
  error: string | null;
  draft: string;
  planning: boolean;
  input: RefObject<HTMLTextAreaElement | null>;
  inputHidden?: boolean;
  feedback?: ReactNode;
  onDraft: (value: string) => void;
  onSend: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSettings: () => void;
  navigate: (path: string) => void;
  servicePrompt: (service: ServiceInfo) => string;
}
const connections = {
  healthy: 'Kết nối tốt',
  unhealthy: 'Không kết nối được',
  unchecked: 'Chưa kiểm tra',
  unconfigured: 'Chưa kết nối',
};
export function RequestMoment({
  services,
  loading,
  error,
  draft,
  planning,
  input,
  inputHidden,
  feedback,
  onDraft,
  onSend,
  onKeyDown,
  onSettings,
  navigate,
  servicePrompt,
}: Props) {
  return (
    <section
      id="moment-1"
      className="stage-section is-active v3-space-y-8"
      data-moment="1"
      aria-label="Cockpit"
    >
      <div className="v3-space-y-3 text-center sm:text-left">
        <h1
          id="heading-moment-1"
          className="font-display text-4xl sm:text-5xl lg:text-[52px] text-brand-text font-normal tracking-tight leading-[1.12]"
          tabIndex={-1}
        >
          Hôm nay bạn muốn nhờ việc gì?
        </h1>
        <p className="text-base sm:text-lg text-brand-muted max-w-2xl leading-relaxed">
          Mô tả bằng lời thường điều bạn cần. Tôi sẽ tự chia việc, lên kế hoạch
          và thao tác trên các công cụ của nhóm.
        </p>
      </div>
      {feedback}
      {/* Large Input Area */}
      <form
        aria-label="Nhập yêu cầu"
        aria-busy={planning}
        onSubmit={(event) => {
          event.preventDefault();
          onSend(draft);
        }}
        className="relative bg-white rounded-2xl border border-brand-border shadow-soft-card p-3 sm:p-4 focus-within:border-brand-primary focus-within:shadow-orange-glow transition-all"
      >
        <label htmlFor="prompt-input" className="sr-only">
          Nội dung bạn muốn nhờ
        </label>{' '}
        {!inputHidden && (
          <textarea
            ref={input}
            id="prompt-input"
            rows={3}
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Mô tả công việc bạn muốn thực hiện"
            className="w-full text-base sm:text-lg text-brand-text placeholder-neutral-400 bg-transparent resize-none border-0 focus:ring-0 focus:v3-outline-none p-1"
            placeholder="Ví dụ: Tạo card Trello cho lỗi đăng nhập Google, tạo issue GitHub, ghi vào Google Sheets và báo kênh Slack..."
          />
        )}{' '}
        <div className="flex items-center justify-between pt-2 border-t border-brand-border-subtle mt-1">
          <span className="text-xs text-brand-muted inline-flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-300 rounded text-[10px] font-mono">
              Enter
            </kbd>
            {' để gửi'}
          </span>
          <button
            type="button"
            disabled={!draft.trim() || planning}
            onClick={() => onSend(draft)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-semibold rounded-xl shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
          >
            <span>Gửi yêu cầu</span>
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M14 5l7 7m0 0l-7 7m7-7H3"
              />
            </svg>
          </button>
        </div>
      </form>

      {services.some((service) => service.configured) ? (
        <div className="v3-space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
            Gợi ý việc phổ biến theo công cụ của bạn
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {services
              .filter((service) => service.configured)
              .map((service) => (
                <button
                  key={service.id}
                  type="button"
                  aria-label={servicePrompt(service)}
                  disabled={planning}
                  onClick={() => {
                    onDraft(servicePrompt(service));
                    input.current?.focus();
                  }}
                  className="relative overflow-hidden text-left p-4 bg-white hover:bg-neutral-50 rounded-2xl border border-brand-border shadow-soft-card transition-all duration-200 group hover:-translate-y-0.5 hover:shadow-md flex items-start gap-3.5"
                >
                  <div className="absolute -right-6 -bottom-6 w-20 h-20 rounded-full bg-blue-500/5 group-hover:bg-blue-500/10 transition-colors pointer-events-none" />
                  <div className="flex items-center -v3-space-x-1.5 flex-shrink-0 mt-0.5">
                    <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center shadow-sm border border-blue-100">
                      <ServiceLogo
                        service={service.id}
                        className="w-4 h-4 shrink-0"
                      />
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-brand-text group-hover:text-brand-primary transition-colors">
                      {servicePrompt(service)}
                    </p>
                    <p className="text-xs text-brand-muted mt-1">
                      {service.name}
                    </p>
                  </div>
                </button>
              ))}
          </div>
        </div>
      ) : (
        <div className="v3-space-y-3">
          <p className="text-sm text-brand-muted">
            Chưa có dịch vụ nào được kết nối
          </p>
          <a
            href="/settings"
            className="text-sm text-brand-primary hover:underline font-medium"
            onClick={(event) => {
              event.preventDefault();
              onSettings();
            }}
          >
            Kết nối dịch vụ
          </a>
        </div>
      )}
      <div className="pt-4 border-t border-brand-border flex flex-col gap-2.5 text-xs text-brand-muted">
        <div
          className="flex flex-wrap items-center gap-2 text-xs text-brand-muted"
          aria-label="Dịch vụ đã thiết lập"
        >
          <span>Đã kết nối:</span>
          {services
            .filter((service) => service.configured)
            .map((service) => (
              <span
                key={service.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white rounded-lg border border-brand-border text-neutral-800 font-medium shadow-sm"
              >
                <ServiceLogo
                  service={service.id}
                  className="w-3.5 h-3.5 shrink-0"
                />
                <span>{service.name}</span>
                {service.connectionStatus !== 'healthy' && (
                  <span>
                    <span aria-hidden="true">
                      {service.connectionStatus === 'unhealthy' ? '⚠' : '?'}
                    </span>{' '}
                    {connections[service.connectionStatus ?? 'unchecked']}
                  </span>
                )}
              </span>
            ))}
        </div>
        <div className="flex items-center gap-2 text-neutral-500 flex-wrap w-full">
          <span>Chưa kết nối:</span>
          {services
            .filter((service) => !service.configured)
            .map((service) => (
              <span
                key={service.id}
                className="inline-flex items-center gap-1 text-neutral-400"
              >
                <ServiceLogo
                  service={service.id}
                  className="w-3.5 h-3.5 shrink-0 fill-current opacity-60"
                />
                {service.name}
              </span>
            ))}
          <a
            href="/settings"
            onClick={(event) => {
              event.preventDefault();
              onSettings();
            }}
            className="text-brand-primary hover:underline font-medium"
          >
            Kết nối thêm
          </a>
          <span>·</span>
          <a
            href="/guide"
            onClick={(event) => {
              event.preventDefault();
              navigate('/guide');
            }}
            className="text-brand-primary hover:underline font-medium"
          >
            Cẩm nang &amp; Mẫu câu lệnh
          </a>
        </div>
      </div>
      {loading && <p role="status">Đang tải dịch vụ…</p>}
      {error && <p role="status">{error}</p>}
    </section>
  );
}
export function DiscoveryMoment({
  request,
  gather,
  services,
}: {
  request: string;
  gather: GatherState | null;
  services: ServiceInfo[];
}) {
  return (
    <section
      id="moment-2"
      className="stage-section is-active v3-space-y-8"
      data-moment="2"
      aria-label="Cockpit"
    >
      <div className="p-6 bg-white rounded-2xl border border-brand-border shadow-soft-card v3-space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-brand-primary">
          Đang phân tích yêu cầu
        </div>
        <h1
          id="heading-moment-2"
          className="font-display text-2xl sm:text-3xl text-brand-text font-normal leading-snug"
          tabIndex={-1}
        >
          <span id="moment-2-query-display">{`“${request}”`}</span>
        </h1>
      </div>
      <div className="bg-white rounded-2xl border border-brand-border p-6 shadow-soft-card v3-space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-brand-border-subtle">
          <div className="flex items-center gap-2">
            <div
              id="moment-2-pulse"
              className="w-2.5 h-2.5 rounded-full bg-brand-primary animate-ping"
            />
            <span
              id="moment-2-status-text"
              className="text-sm font-semibold text-brand-text"
            >
              Tôi đang kiểm tra các tài nguyên liên quan
            </span>
          </div>
        </div>
        <ul
          className="v3-space-y-3 text-sm"
          id="discovery-steps-list"
          aria-live="polite"
        >
          {!gather?.steps.length ? (
            <li className="text-brand-muted">Đang đọc yêu cầu…</li>
          ) : (
            gather.steps.map((step, index) => {
              const service =
                getToolDefinition(step.tool)?.service ??
                step.tool.split('.')[0];
              const found = step.status === 'completed';
              return (
                <li
                  key={step.tool + '-' + index}
                  id={'disc-step-' + (index + 1)}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="disc-icon w-4 h-4 flex items-center justify-center flex-shrink-0"
                      aria-hidden="true"
                    >
                      {found ? (
                        '✓'
                      ) : (
                        <span className="w-2 h-2 bg-brand-primary rounded-full animate-pulse" />
                      )}
                    </span>
                    <span className="break-words">
                      {found ? 'Đã tìm thông tin' : 'Đang tìm nơi phù hợp'} trên{' '}
                      {services.find((row) => row.id === service)?.name ??
                        getServiceDefinition(service)?.name ??
                        service}{' '}
                      {step.result && <strong>{step.result}</strong>}
                    </span>
                  </span>
                  <span
                    className={
                      found
                        ? 'text-xs text-emerald-600'
                        : 'text-xs text-brand-muted'
                    }
                  >
                    {found ? 'Đã thấy' : 'Đang tìm…'}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </section>
  );
}
