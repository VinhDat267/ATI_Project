import { useState } from 'react';
import { toolDefinition } from '../../services/tool-definitions';
import type { PlanStep, StepState } from '../../types';
import type { ExecutionStepInfo } from '../../components/ExecutionProgress';
import { resourceDestination } from '../../components/Cockpit';
import { ServiceLogo } from '../../components/ServiceLogo';
import { StatusBadge } from '../components/StatusBadge';
import {
  operation,
  planStepDataFlows,
  serviceId,
  serviceName,
  servicePalette,
  statusLabel,
  resultTitle,
} from '../../pages/Cockpit/presentation';
import type {
  WorkflowFlowCanvasProps,
  WorkflowFlowMode,
  WorkflowFlowStep,
} from '../../components/WorkflowFlowCanvas';
import { formatBusinessArgValue } from '../../pages/Cockpit/PreviewContents';

interface GroupedServiceNode {
  service: string;
  label: string;
  steps: WorkflowFlowStep[];
  stepCount: number;
  status: StepState;
}

function resolveAggregateStatus(statuses: StepState[], mode: WorkflowFlowMode): StepState {
  if (statuses.length === 0) return mode === 'receipt' ? 'succeeded' : 'pending';
  if (statuses.some((s) => s === 'failed' || s === 'unknown')) return 'failed';
  if (statuses.some((s) => s === 'running')) return 'running';
  if (statuses.some((s) => s === 'paused')) return 'paused';
  if (statuses.every((s) => s === 'succeeded' || s === 'skipped')) return 'succeeded';
  if (mode === 'receipt') return 'succeeded';
  return 'pending';
}

function extractScopeBadges(step: WorkflowFlowStep, resourceLabels?: Record<string, string>): string[] {
  const args = step.args ?? {};
  const badges: string[] = [];
  const candidateKeys = [
    'spreadsheetId',
    'calendarId',
    'boardId',
    'listId',
    'channel',
    'channelId',
    'repo',
    'chatId',
    'projectKey',
    'databaseId',
    'threadId',
  ];
  for (const key of candidateKeys) {
    const raw = args[key];
    if (typeof raw === 'string' && raw.trim()) {
      const resolved = resourceLabels?.[raw] ?? raw;
      if (!badges.includes(resolved)) badges.push(resolved);
    }
  }
  return badges;
}

const ARG_NAMES_VI: Record<string, string> = {
  title: 'Tiêu đề',
  name: 'Tên',
  summary: 'Tiêu đề',
  body: 'Nội dung',
  text: 'Nội dung',
  desc: 'Mô tả',
  description: 'Mô tả',
  channel: 'Kênh đích',
  to: 'Người nhận',
  repo: 'Kho mã',
  range: 'Vùng dữ liệu',
  sheetTitle: 'Trang tính',
  spreadsheetId: 'Bảng tính',
  boardId: 'Bảng việc',
  listId: 'Cột việc',
};

function extractBusinessArgs(step: WorkflowFlowStep): Array<{ label: string; value: string; isRef: boolean }> {
  const args = step.args ?? {};
  const result: Array<{ label: string; value: string; isRef: boolean }> = [];
  const priorityKeys = ['title', 'text', 'body', 'desc', 'channel', 'to', 'repo', 'sheetTitle', 'range'];

  for (const key of priorityKeys) {
    if (args[key] != null) {
      const formatted = formatBusinessArgValue(args[key]);
      result.push({
        label: ARG_NAMES_VI[key] ?? key,
        value: formatted.text,
        isRef: formatted.isRef || formatted.text.includes('‹danh sách công việc'),
      });
    }
  }

  // Add any other non-resource args if priority keys didn't catch anything
  if (result.length === 0) {
    for (const [key, val] of Object.entries(args)) {
      if (val != null && typeof val !== 'object' && !key.toLowerCase().includes('token')) {
        const formatted = formatBusinessArgValue(val);
        result.push({
          label: ARG_NAMES_VI[key] ?? key,
          value: formatted.text,
          isRef: formatted.isRef,
        });
      }
    }
  }

  return result;
}

export function PlanoraWorkflowSteps({
  steps = [],
  services = [],
  stepStatuses = {},
  resourceLabels,
  mode = 'preview',
  isAutoDigest = false,
  compact = false,
  selectedService: controlledSelectedService,
  onSelectService,
  onStepPreview,
  className = '',
  showStepCards = true,
  serviceInfos,
  destination,
}: WorkflowFlowCanvasProps) {
  const [internalSelectedService, setInternalSelectedService] = useState<string | null>(null);

  const selectedService =
    controlledSelectedService !== undefined ? controlledSelectedService : internalSelectedService;

  const handleToggleService = (svc: string | null) => {
    const next = svc && selectedService === svc ? null : svc;
    if (controlledSelectedService === undefined) {
      setInternalSelectedService(next);
    }
    onSelectService?.(next);
  };

  // Build service summary nodes
  const serviceNodes: GroupedServiceNode[] = [];

  if (steps.length > 0) {
    const byService = new Map<string, WorkflowFlowStep[]>();
    for (const step of steps) {
      const svc = serviceId(step.tool);
      const list = byService.get(svc) ?? [];
      list.push(step);
      byService.set(svc, list);
    }

    for (const [svc, svcSteps] of byService.entries()) {
      const resolvedStatuses = svcSteps.map(
        (st) => stepStatuses[st.id] ?? st.status ?? (mode === 'receipt' ? 'succeeded' : 'pending')
      );
      const status = resolveAggregateStatus(resolvedStatuses, mode);
      serviceNodes.push({
        service: svc,
        label: serviceName(svc, serviceInfos ?? []),
        steps: svcSteps,
        stepCount: svcSteps.length,
        status,
      });
    }
  } else if (services.length > 0) {
    const uniqueServices = [...new Set(services.filter(Boolean))];
    uniqueServices.forEach((svc, idx) => {
      serviceNodes.push({
        service: svc,
        label: serviceName(svc, serviceInfos ?? []),
        steps: [
          {
            id: `svc-${svc}-${idx + 1}`,
            tool: `${svc}.action`,
            description:
              mode === 'schedule'
                ? idx === 0
                  ? `Đọc dữ liệu định kỳ từ ${serviceName(svc, serviceInfos ?? [])}`
                  : `Gửi bản tin định kỳ qua ${serviceName(svc, serviceInfos ?? [])}`
                : `Thao tác tự động trên ${serviceName(svc, serviceInfos ?? [])}`,
            args: {},
          },
        ],
        stepCount: 1,
        status: mode === 'receipt' ? 'succeeded' : 'pending',
      });
    });
  }

  if (serviceNodes.length === 0 && steps.length === 0) return null;

  const hasRouterNode = serviceNodes.length >= 3;

  // Data-flow mappings ($ref / $template) between steps
  const dataFlowBadges =
    steps.length > 1
      ? planStepDataFlows(
          steps.map((s) => ({
            id: s.id,
            tool: s.tool,
            description: s.description,
            args: s.args ?? {},
            dependsOn: s.dependsOn,
          }))
        )
      : [];

  return (
    <div
      data-testid="workflow-flow-canvas"
      data-planora-workflow-steps="true"
      data-flow-mode={mode}
      data-router-node={hasRouterNode ? 'true' : undefined}
      data-auto-digest={mode === 'schedule' ? (isAutoDigest ? 'true' : 'false') : undefined}
      className={`planora-workflow-steps w-full rounded-2xl border border-[var(--planora-divider)] bg-[var(--planora-paper)] ${
        compact ? 'p-3 sm:p-4' : 'p-4 sm:p-5'
      } shadow-xs min-w-0 overflow-hidden ${className}`}
    >
      {/* Top Stage Header */}
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2.5 border-b border-[var(--planora-divider)]">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--planora-text)]">
            <span
              aria-hidden="true"
              className={`w-2 h-2 rounded-full ${
                mode === 'receipt'
                  ? 'bg-emerald-600'
                  : mode === 'executing'
                    ? 'bg-[var(--planora-primary)] animate-ping'
                    : 'bg-[var(--planora-primary)]'
              }`}
            />
            <span>
              {mode === 'preview'
                ? 'Các bước thực hiện trong kế hoạch'
                : mode === 'executing'
                  ? 'Tiến trình thực thi thời gian thực'
                  : mode === 'receipt'
                    ? 'Biên nhận kết quả hoàn tất'
                    : mode === 'schedule'
                      ? 'Chuỗi công việc theo lịch'
                      : 'Mô hình quy trình'}
            </span>
          </div>
          <span className="text-[11px] text-[var(--planora-muted)]">
            Chuỗi công việc tuần tự Planora
          </span>
        </div>
      )}

      {/* Auto-Digest Badge for Schedule Mode */}
      {mode === 'schedule' && isAutoDigest && (
        <div
          data-testid="workflow-auto-digest-node"
          className="mb-3 px-3.5 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-semibold flex items-center gap-2"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
          <span>Auto-Digest: Tự động gửi bản tin theo lịch định kỳ</span>
        </div>
      )}

      {/* Clean Editorial Service Filter Strip */}
      {serviceNodes.length > 0 && (
        <div
          data-testid="workflow-upstream-chain"
          className="flex flex-wrap items-center gap-2 mb-3 pb-2.5 border-b border-[var(--planora-divider)]"
        >
          <span className="text-xs font-semibold text-[var(--planora-muted)]">Công cụ:</span>
          {serviceNodes.map((node) => {
            const isSelected = selectedService === node.service;
            return (
              <button
                key={node.service}
                type="button"
                data-testid={`workflow-node-${node.service}`}
                data-service={node.service}
                data-step-count={node.stepCount}
                aria-label={`Dịch vụ ${node.label} (${node.stepCount} bước)`}
                aria-pressed={isSelected ? 'true' : 'false'}
                onClick={() => handleToggleService(node.service)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-[var(--planora-primary-soft)] text-[var(--planora-primary)] border-[var(--planora-primary)] shadow-xs font-semibold'
                    : 'bg-[var(--planora-canvas)] text-[var(--planora-text)] border-[var(--planora-divider)] hover:border-[var(--planora-border-strong)]'
                }`}
              >
                <ServiceLogo service={node.service} className="w-3.5 h-3.5" />
                <span>{node.label}</span>
                <span className="text-[10px] text-[var(--planora-muted)] font-mono">({node.stepCount})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Planora Step Cards: Structured Grid (desktop 2-cols, mobile vertical) */}
      {steps.length > 0 && showStepCards && (
        <div
          id={mode === 'preview' ? 'plan-cards-container' : undefined}
          role={mode === 'preview' ? 'list' : undefined}
          aria-label={mode === 'preview' ? 'Các bước thực thi' : undefined}
          className="mt-2"
        >
          <div
            data-testid="planora-step-cards-grid"
            className="grid grid-cols-1 md:grid-cols-2 gap-3.5"
          >
            {steps.map((step, index) => {
              const svc = serviceId(step.tool);
              const palette = servicePalette(svc);
              const isHighlighted = selectedService === svc;
              const toolDef = toolDefinition(step.tool);
              const isRead =
                toolDef?.sideEffect === 'read' ||
                step.tool.includes('.read_') ||
                step.tool.includes('.get_') ||
                step.tool.includes('.list_') ||
                step.tool.includes('.search_');
              const incomingFlows = dataFlowBadges.filter((edge) => edge.toStepId === step.id);
              const stepStatus = stepStatuses[step.id] ?? step.status ?? (mode === 'receipt' ? 'succeeded' : 'pending');
              const scopes = extractScopeBadges(step, resourceLabels);
              const resolvedDest = destination
                ? destination(step as PlanStep, resourceLabels)
                : resourceDestination(step as PlanStep, resourceLabels);
              const nonRedundantScopes = scopes.filter(
                (scope) =>
                  !resolvedDest ||
                  (!resolvedDest.toLowerCase().includes(scope.toLowerCase()) &&
                    !scope.toLowerCase().includes(resolvedDest.toLowerCase()))
              );
              const businessArgs = extractBusinessArgs(step).filter(
                (a) => a.isRef || (!resolvedDest || !resolvedDest.toLowerCase().includes(a.value.toLowerCase()))
              );
              const hasDependentRef = businessArgs.some((a) => a.isRef);

              return (
                <article
                  key={step.id}
                  data-testid={`planora-step-card-${step.id}`}
                  data-step-index={index + 1}
                  data-od-id={`plan-item-${index + 1}`}
                  data-highlighted-step={isHighlighted ? 'true' : undefined}
                  className={`plan-card-stagger-${Math.min(index + 1, 4)} p-4 sm:p-5 rounded-2xl border transition-all ${
                    isHighlighted
                      ? 'border-[var(--planora-primary)] ring-2 ring-[var(--planora-primary)]/20 bg-[var(--planora-paper)] shadow-sm'
                      : 'border-[var(--planora-divider)] bg-[var(--planora-canvas)] hover:border-[var(--planora-border-strong)]'
                  } flex flex-col justify-between gap-3 min-w-0`}
                >
                  <div>
                    {/* Step Card Header */}
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-2.5 pb-2 border-b border-[var(--planora-divider)]/60">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-8 h-8 rounded-xl ${palette.icon} flex items-center justify-center p-1.5 border shadow-2xs flex-shrink-0`}>
                          <ServiceLogo service={svc} className="w-4 h-4" />
                        </div>
                        <span className="font-semibold text-xs text-[var(--planora-text)] truncate">
                          Bước {index + 1}: {serviceName(svc, serviceInfos ?? [])}
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            isRead
                              ? 'bg-[var(--planora-primary-soft)] text-[var(--planora-primary)]'
                              : 'bg-[var(--planora-pending-bg)] text-[var(--planora-pending-text)] border border-[var(--planora-pending-border)]'
                          }`}
                        >
                          {isRead ? 'Chỉ đọc' : 'Ghi'}
                        </span>
                      </div>
                      <StatusBadge
                        status={
                          stepStatus === 'succeeded'
                            ? 'success'
                            : stepStatus === 'failed'
                              ? 'error'
                              : 'pending'
                        }
                        label={statusLabel(stepStatus)}
                      />
                    </div>

                    {/* Step Title & Action Description */}
                    <div>
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs font-semibold px-2 py-0.5 bg-[var(--planora-surface-inset)] text-[var(--planora-text)] rounded-md border border-[var(--planora-divider)]">
                          {operation(step.tool).action}
                        </span>
                        <span className="text-xs text-[var(--planora-muted)]">Việc {index + 1}</span>
                        {mode === 'receipt' && stepStatus === 'succeeded' && (
                          <span className="text-xs font-semibold text-emerald-600">
                            ✓ {operation(step.tool).receipt}
                          </span>
                        )}
                      </div>

                      <h3 className="text-sm sm:text-base font-semibold text-[var(--planora-text)] mt-1.5 leading-snug break-words">
                        {mode === 'receipt'
                          ? `Kết quả: ${resultTitle(step as ExecutionStepInfo)}`
                          : mode === 'executing'
                            ? `Bước ${index + 1}: ${step.description}`
                            : step.tool === 'mysheets.read_range'
                              ? `Đọc từ bảng tính của bạn: ${resourceLabels?.[String(step.args?.spreadsheetId)] ?? step.description}`
                              : step.description}
                      </h3>

                      {mode !== 'receipt' && resolvedDest && (
                        <p className="text-xs text-[var(--planora-muted)] mt-1 break-words font-medium">
                          Đích đến: {resolvedDest}
                        </p>
                      )}
                    </div>

                    {/* Honest Data Disclosure (Chuẩn D1): Read Step Notice */}
                    {isRead && mode === 'preview' && (
                      <div
                        data-testid={`read-step-notice-${step.id}`}
                        className="mt-2.5 p-2.5 rounded-xl bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] text-xs text-[var(--planora-muted)] flex items-center gap-2 font-medium"
                      >
                        <svg className="w-4 h-4 text-[var(--planora-primary)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>Sẽ đọc khi bạn duyệt kế hoạch</span>
                      </div>
                    )}

                    {/* Business Parameters & Dependent Placeholders Preview */}
                    {!isRead && mode === 'preview' && hasDependentRef && (
                      <div className="mt-2.5 p-2.5 rounded-xl bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] text-xs v3-space-y-1.5">
                        <div className="text-[10px] font-semibold text-[var(--planora-muted)] uppercase tracking-wider">
                          Xem trước nội dung sẽ gửi/ghi:
                        </div>
                        {businessArgs.map(({ label, value, isRef }) => (
                          <div key={label} className="flex flex-col sm:flex-row sm:items-baseline gap-1 text-xs">
                            <span className="font-medium text-[var(--planora-muted)] sm:min-w-[65px]">{label}:</span>
                            <span className={`text-[var(--planora-text)] break-words ${isRef ? 'italic font-medium text-[var(--planora-primary)]' : ''}`}>
                              {value}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Scopes & Dependencies Badges */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {nonRedundantScopes.map((scope) => (
                        <span
                          key={scope}
                          className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--planora-surface-inset)] text-[var(--planora-text)] border border-[var(--planora-divider)] truncate max-w-full"
                        >
                          Phạm vi: {scope}
                        </span>
                      ))}
                      {step.dependsOn && step.dependsOn.length > 0 && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--planora-surface-inset)] text-[var(--planora-muted)] border border-[var(--planora-divider)]">
                          Phụ thuộc: {step.dependsOn.map((depId) => {
                            const depIndex = steps.findIndex((s) => s.id === depId);
                            return depIndex >= 0 ? `Việc ${depIndex + 1}` : depId;
                          }).join(', ')}
                        </span>
                      )}
                      {incomingFlows.map((edge) => (
                        <span
                          key={`${edge.fromStepId}-${edge.field}`}
                          data-testid="plan-step-data-flow-badge"
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--planora-pending-bg)] text-[var(--planora-pending-text)] border border-[var(--planora-pending-border)]"
                        >
                          Dữ liệu từ Việc {edge.fromIndex} → Việc {edge.toIndex} ({edge.field})
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Step Card Footer */}
                  <div className="pt-2.5 border-t border-[var(--planora-divider)] flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      {stepStatus === 'succeeded' && step.duration && (
                        <span className="text-[11px] font-mono text-[var(--planora-muted)]">
                          Thời gian: {step.duration}
                        </span>
                      )}
                    </div>
                    {onStepPreview && (
                      <button
                        id={`preview-${step.id}`}
                        data-testid={`preview-step-btn-${step.id}`}
                        type="button"
                        aria-label="Xem trước"
                        onClick={() =>
                          onStepPreview({
                            id: step.id,
                            tool: step.tool,
                            description: step.description,
                            args: step.args ?? {},
                            dependsOn: step.dependsOn,
                          })
                        }
                        className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-[var(--planora-surface-inset)] hover:bg-[var(--planora-surface-hover)] text-[var(--planora-text)] border border-[var(--planora-divider)] transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <svg className="w-3.5 h-3.5 text-[var(--planora-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                          />
                        </svg>
                        <span>Xem trước</span>
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {/* Data-Flow Mapping Strip ($ref / $template between steps) */}
      {dataFlowBadges.length > 0 && (
        <div
          data-testid="workflow-data-flow-strip"
          className="mt-3 pt-3 border-t border-[var(--planora-divider)] flex flex-wrap items-center gap-1.5"
        >
          <span className="text-[11px] font-semibold text-[var(--planora-muted)]">Luồng truyền dữ liệu:</span>
          {dataFlowBadges.map((edge) => (
            <span
              key={`${edge.fromStepId}-${edge.toStepId}-${edge.field}`}
              data-testid="workflow-data-flow-pill"
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] text-[11px] font-medium text-[var(--planora-text)] shadow-2xs"
            >
              <span className="font-semibold text-[var(--planora-primary)]">
                Dữ liệu từ Việc {edge.fromIndex} → Việc {edge.toIndex}
              </span>
              <span className="text-[var(--planora-muted)] font-mono text-[10px]">({edge.field})</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default PlanoraWorkflowSteps;
