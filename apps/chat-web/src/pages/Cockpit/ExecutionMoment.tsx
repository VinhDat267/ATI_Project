// Source: AppStagePage.tsx moment-5 and execution state classes. No demo timer or simulated progress.
import { useState } from 'react';
import type { PlanStep } from '../../types';
import type { ExecutionStepInfo } from '../../components/ExecutionProgress';
import { ServiceLogo } from '../../components/ServiceLogo';
import { WorkflowFlowCanvas } from '../../components/WorkflowFlowCanvas';
import { operation, planStepDataFlows, serviceId, servicePalette, statusLabel, OutcomeLink } from './presentation';
import { RequestEcho } from './RequestEcho';

const ITEM_DONE = 'p-3.5 bg-white rounded-lg border border-[#E5E5E3] flex items-center justify-between gap-3';
const ITEM_RUNNING = 'p-3.5 bg-white rounded-lg border border-[#111827] flex items-center justify-between gap-3 opacity-100';
const ITEM_SKIPPED = 'p-3.5 bg-[#F8F8F7] rounded-lg border border-[#E5E5E3] flex items-center justify-between gap-3 opacity-80';
const ITEM_PENDING = 'p-3.5 bg-[#F9F9F8] rounded-lg border border-[#ECECE9] flex items-center justify-between gap-3 opacity-80';
const BADGE_DONE = 'text-[11px] bg-[#DCFAE5] text-[#04250E] px-2 py-0.5 rounded-[6px] font-medium';
const BADGE_RUNNING = 'text-[11px] bg-[#1D1F20] text-white px-2 py-0.5 rounded-[6px] font-medium';
const BADGE_PENDING = 'text-[11px] text-[#5F6368] bg-[#F4F4F3] border border-[#E5E5E3] px-2 py-0.5 rounded-[6px] font-medium';

export function ExecutionMoment({
  request,
  steps,
  planSteps,
  labels,
  destination,
}: {
  request?: string;
  steps: ExecutionStepInfo[];
  planSteps: PlanStep[];
  labels?: Record<string, string>;
  destination: (step: PlanStep, labels?: Record<string, string>) => string;
}) {
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const completed = steps.filter(step => ['succeeded', 'skipped'].includes(step.status)).length;
  const running = steps.findIndex(step => step.status === 'running');
  const current = running < 0 ? Math.min(completed + 1, steps.length) : running + 1;
  const stepStatuses = Object.fromEntries(steps.map(step => [step.id, step.status]));
  const canvasSteps: PlanStep[] = planSteps.length
    ? planSteps
    : steps.map(step => ({ id: step.id, tool: step.tool, description: step.description, args: {} }));
  const uniqueServicesCount = new Set(canvasSteps.map(step => serviceId(step.tool))).size;
  const showFlowDiagram = uniqueServicesCount >= 2 || planStepDataFlows(canvasSteps).length > 0;

  return (
    <section
      id="moment-5"
      className="stage-section is-active w-full max-w-3xl mx-auto v3-space-y-4"
      aria-label="Cockpit"
      data-moment="5"
      aria-labelledby="heading-moment-5"
    >
      <div className="rounded-xl border border-[#E5E5E3] bg-white overflow-hidden">
        <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-[#ECECE9]">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2 text-[#5F6368] font-medium">
              <span className="inline-flex items-center gap-1 text-[#4B5563]">
                <svg aria-hidden="true" className="w-3.5 h-3.5 text-[#047857]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                </svg>
                <span>Đã duyệt</span>
              </span>
              <span aria-hidden="true" className="text-[#9CA3AF]">→</span>
              <span className="inline-flex items-center gap-1.5 font-medium text-[#111827]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#1D1F20] animate-pulse" />
                <span>Đang thực thi tự động</span>
              </span>
            </div>
            <div
              id="exec-progress-label"
              className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-[#F4F4F3] text-[#111827] font-medium text-xs rounded-[6px] border border-[#E5E5E3] tabular-nums"
            >
              <span id="exec-step-counter">{`Việc ${current}/${steps.length}`}</span>
            </div>
          </div>

          <RequestEcho request={request} />
          <h1
            id="heading-moment-5"
            className="font-sans text-xl sm:text-[22px] text-[#111111] font-semibold tracking-[-0.02em] leading-snug"
            tabIndex={-1}
          >
            Đang thực hiện công việc
          </h1>
          <p className="text-sm text-[#5F6368] mt-1">
            Đang thao tác theo thứ tự đã được bạn phê duyệt.
          </p>
        </div>

        <div className="p-5 sm:p-6 v3-space-y-4">
          <div className="w-full bg-[#ECECE9] h-1 rounded-full overflow-hidden">
            <div
              id="exec-progress-bar"
              className="bg-[#1D1F20] h-full transition-[width] duration-500 rounded-full"
              role="progressbar"
              aria-label="Tiến độ công việc"
              aria-valuemin={0}
              aria-valuemax={steps.length}
              aria-valuenow={completed}
              style={{ width: `${steps.length ? (completed / steps.length) * 100 : 0}%` }}
            />
          </div>

          {showFlowDiagram && (
            <WorkflowFlowCanvas
              compact
              steps={canvasSteps}
              stepStatuses={stepStatuses}
              resourceLabels={labels}
              selectedService={selectedService}
              onSelectService={setSelectedService}
              mode="executing"
            />
          )}

          {/* NHÓM 4 & 8: Thời lượng viết kiểu Việt Nam "1,2 giây", font thân, icon SVG dịch vụ */}
          <div className="v3-space-y-2" id="exec-timeline">
            {steps.map((step, index) => {
              const service = serviceId(step.tool);
              const palette = servicePalette(service);
              const isHighlighted = selectedService === service;
              return (
                <div
                  key={step.id}
                  id={`exec-item-${index + 1}`}
                  data-highlighted-step={isHighlighted ? 'true' : undefined}
                  className={
                    step.status === 'running'
                      ? ITEM_RUNNING
                      : step.status === 'pending'
                        ? ITEM_PENDING
                        : step.status === 'skipped'
                          ? ITEM_SKIPPED
                          : ITEM_DONE
                  }
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      id={`exec-icon-${index + 1}`}
                      className="w-8 h-8 rounded-md bg-[#F8F8F7] border border-[#E6E6E3] flex items-center justify-center flex-shrink-0"
                    >
                      <ServiceLogo service={service} className={`w-4 h-4 ${palette.logo === 'text-white' ? 'text-[#111827]' : (palette.logo ?? '')}`} />
                    </div>
                    <div className="min-w-0">
                      <div
                        className={
                          step.status === 'pending' || step.status === 'skipped'
                            ? 'text-sm font-medium text-[#4B5563] flex items-center gap-2 flex-wrap'
                            : 'text-sm font-semibold text-[#111827] flex items-center gap-2 flex-wrap'
                        }
                      >
                        <span className="truncate">{step.description}</span>
                        <span
                          id={`exec-badge-${index + 1}`}
                          className={`${
                            step.status === 'succeeded'
                              ? BADGE_DONE
                              : step.status === 'running'
                                ? BADGE_RUNNING
                                : BADGE_PENDING
                          } flex-shrink-0`}
                        >
                          {step.status === 'succeeded' ? `✓ ${operation(step.tool).done}` : statusLabel(step.status)}
                        </span>
                      </div>
                      <div
                        className={
                          step.status === 'running'
                            ? 'text-xs text-[#111827] font-medium mt-0.5 truncate'
                            : step.status === 'pending'
                              ? 'text-xs text-[#6B7280] mt-0.5 truncate'
                              : 'text-xs text-[#5F6368] font-normal mt-0.5 truncate'
                        }
                      >
                        {destination(
                          planSteps.find(row => row.id === step.id) ?? {
                            id: step.id,
                            tool: step.tool,
                            description: step.description,
                            args: {},
                          },
                          labels,
                        )}
                        {step.status === 'succeeded' && (
                          <OutcomeLink step={step} className={`ml-2 font-medium ${palette.name} hover:underline`} />
                        )}
                      </div>
                    </div>
                  </div>
                  <span
                    id={`exec-time-${index + 1}`}
                    className={
                      step.status === 'running'
                        ? 'text-xs font-medium text-[#111827] tabular-nums flex-shrink-0'
                        : step.status === 'pending' || step.status === 'skipped'
                          ? 'text-xs text-[#6B7280] tabular-nums flex-shrink-0'
                          : 'text-xs text-[#5F6368] tabular-nums flex-shrink-0'
                    }
                  >
                    {step.status === 'succeeded' ? step.duration : statusLabel(step.status)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
