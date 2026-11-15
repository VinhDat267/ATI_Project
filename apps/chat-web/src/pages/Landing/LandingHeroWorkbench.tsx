import type { ComponentProps } from 'react';
import { useEffect, useState } from 'react';
import landingPlaybooks from '../../assets/landing-playbooks.json';
import { ServiceLogo } from '../../components/ServiceLogo';
import { WorkflowFlowCanvas } from '../../components/WorkflowFlowCanvas';
import { operation, serviceId, serviceName } from '../Cockpit/presentation';

type CanvasProps = ComponentProps<typeof WorkflowFlowCanvas>;

interface PlaybookScenario {
  id: string;
  tabTitle: string;
  flowSummary: string;
  prompt: string;
  scopeSummary: string;
  handoffSummary: string;
  resourceLabels?: Record<string, string>;
  steps: CanvasProps['steps'];
}

export interface LandingHeroWorkbenchProps {
  onOpenSignup: (trigger: HTMLElement | null) => void;
  onOpenGoogle: (trigger: HTMLElement | null) => void;
  onTryPrompt: (prompt: string, trigger: HTMLElement | null) => void;
  signupEnabled: boolean;
  googleEnabled: boolean;
}

const PLAYBOOKS = (landingPlaybooks.playbooks as unknown) as PlaybookScenario[];

function resolveStepScopes(
  args: Record<string, unknown> | undefined,
  resourceLabels?: Record<string, string>,
): string[] {
  if (!args || !resourceLabels) return [];
  const scopes: string[] = [];
  for (const val of Object.values(args)) {
    if (typeof val === 'string' && resourceLabels[val] && !scopes.includes(resourceLabels[val])) {
      scopes.push(resourceLabels[val]);
    }
  }
  return scopes;
}

export function LandingHeroWorkbench({
  onOpenSignup,
  onOpenGoogle,
  onTryPrompt,
  signupEnabled,
  googleEnabled,
}: LandingHeroWorkbenchProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [inspectedService, setInspectedService] = useState<string | null>(null);
  const current = PLAYBOOKS[activeIdx] ?? PLAYBOOKS[0];

  const handleSelectScenario = (idx: number) => {
    setActiveIdx(idx);
    setInspectedService(null);
  };

  useEffect(() => {
    if (!inspectedService) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setInspectedService(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [inspectedService]);

  const inspectedSteps = inspectedService
    ? (current.steps ?? []).filter((step) => serviceId(step.tool) === inspectedService)
    : [];

  return (
    <section
      id="workflow-showcase"
      data-od-id="hero-section"
      className="pl-hero"
    >
      <div className="pl-wrap">
        {/* Centered Dawn Poster Hierarchy (tasteskill.dev composition) */}
        <div className="pl-hero-poster pl-enter">
          <span className="pl-hero-pill">
            <span className="pl-hero-pill-dot" aria-hidden="true" />
            Điều phối công việc đa công cụ · Chỉ ghi sau khi bạn duyệt
          </span>

          <h1 className="pl-hero-h1">
            Nói một câu. Việc trên nhiều công cụ được làm xong —{' '}
            <span className="pl-hero-h1-accent">sau khi bạn duyệt.</span>
          </h1>

          <p className="pl-hero-lead">
            Thay vì mở năm sáu cửa sổ để sao chép từng đầu việc, bạn chỉ cần nhắn yêu cầu bằng tiếng Việt. Planora đọc đúng những gì bạn cho phép, lập kế hoạch từng bước để bạn rà trước, rồi mới thực hiện và trả về biên nhận rõ ràng.
          </p>

          <div className="pl-hero-ctas">
            <a
              href={signupEnabled ? '/signup' : '/login'}
              data-od-id="btn-hero-signup"
              onClick={(e) => {
                e.preventDefault();
                onOpenSignup(e.currentTarget);
              }}
              className="pl-btn-light pl-btn-lg"
            >
              {signupEnabled ? 'Tạo không gian miễn phí' : 'Đăng nhập không gian làm việc'}
              <span className="pl-arrow" aria-hidden="true">&rarr;</span>
            </a>

            {googleEnabled && (
              <a
                href="/auth/google/start"
                data-od-id="btn-hero-google"
                onClick={(e) => {
                  e.preventDefault();
                  onOpenGoogle(e.currentTarget);
                }}
                className="pl-btn-espresso pl-btn-lg"
              >
                Tiếp tục bằng Google
              </a>
            )}

            <a
              href="#product-film"
              className="pl-hero-film-link"
            >
              Xem phim thực tế 20 giây &darr;
            </a>
          </div>
        </div>

        {/* Wide Centered App Workbench Frame */}
        <div className="pl-workbench-shell pl-enter-delay">
          <div
            data-testid="landing-hero-orbital-preview"
            className="pl-workbench"
          >
            {/* Segmented 1-Row Scenario Track (0 right-side blank gap) */}
            <div
              className="pl-workbench-tabs"
              role="tablist"
              aria-label="Chọn kịch bản công việc"
            >
              {PLAYBOOKS.map((pb, idx) => {
                const isSelected = idx === activeIdx;
                return (
                  <button
                    key={pb.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    data-testid={`landing-playbook-tab-${idx}`}
                    onClick={() => handleSelectScenario(idx)}
                    className={`pl-segment-tab ${isSelected ? 'is-selected' : ''}`}
                  >
                    <span className="pl-segment-idx">0{idx + 1}</span>
                    <span className="pl-segment-title">{pb.tabTitle}</span>
                  </button>
                );
              })}
            </div>

            {/* Quiet Window Chrome */}
            <div className="pl-workbench-chrome">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full bg-[#FF5701] flex-shrink-0" aria-hidden="true" />
                <span className="text-xs font-semibold text-[var(--pl-ink)] truncate">
                  Planora · Xem trước kế hoạch chờ duyệt
                </span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs text-[var(--pl-ink-subtle)] hidden sm:inline">
                  Bấm vào công cụ để xem bước &middot;
                </span>
                <span className="pl-mono text-xs text-[var(--pl-ink-subtle)]">
                  Chưa ghi dữ liệu
                </span>
              </div>
            </div>

            {/* Prompt Strip */}
            <div className="pl-workbench-prompt">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <span className="pl-prompt-label !mb-0">Câu lệnh tiếng Việt</span>
                <span className="pl-mono text-xs text-[var(--pl-ink-subtle)]">
                  {current.flowSummary}
                </span>
              </div>
              <p className="pl-prompt-text">&ldquo;{current.prompt}&rdquo;</p>
            </div>

            {/* Fixed-Envelope Graph Stage with Non-Stretching Floating Inspector */}
            <div className="pl-workbench-stage">
              <WorkflowFlowCanvas
                steps={current.steps}
                resourceLabels={current.resourceLabels}
                mode="preview"
                compact
                hideInlineInspector
                selectedService={inspectedService}
                onSelectService={setInspectedService}
                className="!border-0 !rounded-none !bg-transparent !p-0"
              />

              {inspectedService && inspectedSteps.length > 0 && (
                <div
                  data-testid="workbench-node-overlay"
                  role="region"
                  aria-label={`Chi tiết thao tác ${serviceName(inspectedService)}`}
                  className="pl-workbench-overlay"
                >
                  <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-[var(--pl-rule)]">
                    <div className="flex items-center gap-2 min-w-0">
                      <ServiceLogo service={inspectedService} className="w-4 h-4 flex-shrink-0" />
                      <span className="text-xs font-semibold text-[var(--pl-ink)] truncate">
                        {serviceName(inspectedService)}
                      </span>
                      <span className="pl-mono text-xs text-[var(--pl-ink-subtle)]">
                        · {inspectedSteps.length} bước
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setInspectedService(null)}
                      aria-label="Đóng chi tiết công cụ"
                      className="pl-overlay-close"
                    >
                      Đóng &times;
                    </button>
                  </div>

                  <div className="space-y-1.5 max-h-[112px] overflow-y-auto pr-1">
                    {inspectedSteps.map((step) => {
                      const op = operation(step.tool);
                      const scopes = resolveStepScopes(step.args, current.resourceLabels);
                      return (
                        <div key={step.id} className="text-xs space-y-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="pl-mono text-xs font-semibold text-[var(--pl-label)]">
                              {op.action}
                            </span>
                            {scopes.map((scope) => (
                              <span
                                key={scope}
                                className="pl-mono text-xs text-[var(--pl-ink-subtle)]"
                              >
                                · Phạm vi: {scope}
                              </span>
                            ))}
                          </div>
                          <p className="text-[var(--pl-ink-muted)] leading-snug m-0">
                            {step.description}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Ruled Workbench Footer */}
            <div className="pl-workbench-meta">
              <div className="space-y-1.5 min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="pl-status-tag">
                    <span className="pl-status-dot pl-status-dot--ok" aria-hidden="true" />
                    Khoá vùng: {current.scopeSummary}
                  </span>
                </div>
                <p className="text-xs sm:text-[13px] text-[var(--pl-ink-muted)] leading-relaxed m-0">
                  {current.handoffSummary}
                </p>
              </div>

              <button
                type="button"
                data-testid="landing-try-playbook-btn"
                onClick={(e) => onTryPrompt(current.prompt, e.currentTarget)}
                className="pl-btn-primary text-sm py-2 px-4 min-h-[40px]"
              >
                Dùng thử kịch bản này
                <span className="pl-arrow" aria-hidden="true">&rarr;</span>
              </button>
            </div>
          </div>

          {/* 3 Quiet Hairline Proof Facts Below Workbench */}
          <div
            data-testid="landing-hero-trust-pills"
            className="pl-hero-facts"
          >
            <div className="pl-hero-fact">
              <span className="pl-hero-fact-num">01 · Phạm vi gọn</span>
              <span className="pl-hero-fact-label">Khóa phạm vi từng bảng &amp; kênh bạn cho phép.</span>
            </div>
            <div className="pl-hero-fact">
              <span className="pl-hero-fact-num">02 · Dừng hỏi trước</span>
              <span className="pl-hero-fact-label">Xem trước nguyên văn trước khi ghi dữ liệu.</span>
            </div>
            <div className="pl-hero-fact">
              <span className="pl-hero-fact-num">03 · Biên nhận thật</span>
              <span className="pl-hero-fact-label">Biên nhận kèm liên kết gốc từng đầu việc.</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
