import { useState } from 'react';
import assets from '../assets/cockpit-services.json';
import type { PlanStep, StepState } from '../types';
import { ServiceLogo } from './ServiceLogo';
import { friendlyFieldLabel, operation, planStepDataFlows, serviceId, serviceName } from '../pages/Cockpit/presentation';

export type WorkflowFlowMode = 'preview' | 'executing' | 'receipt' | 'schedule' | 'blueprint';

export interface WorkflowFlowStep {
  id: string;
  tool: string;
  description: string;
  args?: Record<string, unknown>;
  dependsOn?: string[];
  status?: StepState;
  duration?: string;
}

export interface WorkflowFlowCanvasProps {
  steps?: WorkflowFlowStep[];
  services?: string[];
  stepStatuses?: Record<string, StepState>;
  resourceLabels?: Record<string, string>;
  mode?: WorkflowFlowMode;
  isAutoDigest?: boolean;
  compact?: boolean;
  hideInlineInspector?: boolean;
  selectedService?: string | null;
  onSelectService?: (service: string | null) => void;
  onStepPreview?: (step: PlanStep) => void;
  className?: string;
}

interface OrbitalServiceMeta {
  label: string;
  ringClass: string;
  strokeHex: string;
  badgeClass: string;
}

const orbitalAssets = assets.services as Record<string, { orbital?: OrbitalServiceMeta }>;

function getOrbitalMeta(service: string): OrbitalServiceMeta {
  const configured = orbitalAssets[service]?.orbital;
  if (configured) return configured;
  return {
    label: serviceName(service),
    ringClass: 'ring-[#FF5701]/25 border-[#FF5701]',
    strokeHex: '#FF5701',
    badgeClass: 'bg-orange-50 text-orange-800 border-orange-200',
  };
}

interface GroupedServiceNode {
  service: string;
  label: string;
  meta: OrbitalServiceMeta;
  steps: WorkflowFlowStep[];
  stepCount: number;
  status: StepState;
  actionSummary: string;
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
    'issueKey',
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
  if (Array.isArray(args.threadIds)) {
    for (const item of args.threadIds) {
      if (typeof item === 'string' && item.trim()) {
        const resolved = resourceLabels?.[item] ?? item;
        if (!badges.includes(resolved)) badges.push(resolved);
      }
    }
  }
  if (badges.length === 0 && step.tool.startsWith('gmail.') && Array.isArray(args.to)) {
    for (const item of args.to) {
      if (typeof item === 'string' && item.trim() && !badges.includes(item)) {
        badges.push(item);
      }
    }
  }
  return badges;
}

function ordinalLabel(index: number): string {
  return `Nhánh ${index + 1}`;
}

function resolveConnectorToneClass(mode: WorkflowFlowMode, rawHex?: string): string {
  if (mode === 'receipt') return 'text-[#64748B] dark:text-[#94A3B8]';
  if (mode === 'executing') return 'text-[#475569] dark:text-[#CBD5E1]';
  switch ((rawHex ?? '').trim().toUpperCase()) {
    case '#0079BF':
    case '#1A73E8':
    case '#0052CC':
    case '#229ED9':
      return 'text-[#0284C7] dark:text-[#38BDF8]';
    case '#188038':
      return 'text-[#15803D] dark:text-[#4ADE80]';
    case '#EA4335':
      return 'text-[#DC2626] dark:text-[#F87171]';
    case '#FF5701':
      return 'text-[#EA580C] dark:text-[#FB923C]';
    default:
      return 'text-[#475569] dark:text-[#94A3B8]';
  }
}

function DottedConnector({
  mode,
  fromColor,
  toColor,
  label,
  compact = false,
  stretch = false,
}: {
  mode: WorkflowFlowMode;
  fromColor: string;
  toColor: string;
  label?: string;
  compact?: boolean;
  stretch?: boolean;
}) {
  const isExecuting = mode === 'executing';
  const toneClass = resolveConnectorToneClass(mode, fromColor || toColor);

  return (
    <div
      data-flow-connector="true"
      className={`flex flex-col items-center justify-center ${
        compact && stretch
          ? 'flex-1 min-w-[18px] px-1'
          : compact
            ? 'px-1 sm:px-1.5 flex-shrink-0'
            : 'px-1 sm:px-2 flex-shrink-0'
      } select-none relative ${toneClass}`}
      aria-hidden="true"
    >
      {label && (
        <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-[#F4F4F3] dark:bg-[#19233B] text-[#4B5563] dark:text-[#CBD5E1] border border-[#E5E5E3] dark:border-[#2C3B5E] mb-1 whitespace-nowrap">
          {label}
        </span>
      )}
      {compact && stretch ? (
        <div className="relative flex items-center w-full h-3.5">
          <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0" />
          <svg
            width="100%"
            height="14"
            fill="none"
            className={`flex-1 min-w-[10px] h-3.5 overflow-visible ${isExecuting ? 'animate-pulse' : ''}`}
          >
            <line
              x1="1"
              y1="7"
              x2="100%"
              y2="7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="4 4"
            />
          </svg>
          <svg
            data-connector-arrow="true"
            width="8"
            height="14"
            viewBox="0 0 8 14"
            fill="none"
            className="w-2 h-3.5 flex-shrink-0 -ml-1"
          >
            <path
              d="M1.5 3.5L6 7L1.5 10.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span data-flow-filter-badge="true" className="sr-only">
            Ánh xạ dữ liệu
          </span>
        </div>
      ) : (
        <div className="relative flex items-center justify-center">
          <svg
            width={compact ? '36' : '48'}
            height={compact ? '14' : '18'}
            viewBox="0 0 48 18"
            fill="none"
            className={`${compact ? 'w-8 sm:w-9 h-3.5' : 'w-9 sm:w-12 h-4'} ${isExecuting ? 'animate-pulse' : ''}`}
          >
            <line
              x1="4"
              y1="9"
              x2="42"
              y2="9"
              stroke="currentColor"
              strokeWidth={compact ? '2' : '2.2'}
              strokeLinecap="round"
              strokeDasharray="4 4"
            />
            <circle cx="5" cy="9" r="2" fill="currentColor" />
            <path
              data-connector-arrow="true"
              d="M39 5L44 9L39 13"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {!compact && (
            <span
              data-flow-filter-badge="true"
              className="absolute w-4 h-4 rounded-full bg-white dark:bg-[#131B2F] border border-[#E5E5E3] dark:border-[#2C3B5E] flex items-center justify-center text-[#6B7280] dark:text-[#CBD5E1]"
              title="Ánh xạ dữ liệu giữa các bước"
            >
              <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </span>
          )}
          {compact && (
            <span data-flow-filter-badge="true" className="sr-only">
              Ánh xạ dữ liệu
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function OrbitalNodeButton({
  node,
  index,
  isLast,
  mode,
  compact = false,
  fullWidth = false,
  isSelected,
  onSelect,
}: {
  node: GroupedServiceNode;
  index: number;
  isLast?: boolean;
  mode: WorkflowFlowMode;
  compact?: boolean;
  fullWidth?: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const showStatusBubble =
    (mode === 'executing' || mode === 'receipt') &&
    (node.status === 'succeeded' || node.status === 'running' || node.status === 'failed');

  if (compact) {
    return (
      <div className={`inline-flex items-center ${fullWidth ? 'w-full' : 'flex-shrink-0'}`}>
        <div className={`relative inline-flex items-center ${fullWidth ? 'w-full' : ''}`}>
          {index > 0 && <span data-connector-ear="true" aria-hidden="true" className="sr-only" />}
          {!isLast && <span data-connector-ear="true" aria-hidden="true" className="sr-only" />}
          <button
            type="button"
            data-testid={`workflow-node-${node.service}`}
            data-service={node.service}
            data-step-count={node.stepCount}
            aria-label={`Nút dịch vụ ${node.label} (${node.stepCount} bước)`}
            aria-expanded={isSelected ? 'true' : 'false'}
            onClick={onSelect}
            className={`inline-flex items-center gap-1.5 sm:gap-2 pl-1.5 sm:pl-2 pr-2 sm:pr-2.5 py-1.5 rounded-lg bg-white dark:bg-[#131B2F] border transition-colors cursor-pointer focus:v3-outline-none ${
              fullWidth ? 'w-full' : ''
            } ${
              isSelected
                ? 'border-[#111827] dark:border-[#F8FAFC] bg-[#F5F5F4] dark:bg-[#1E293B]'
                : 'border-[#E5E5E3] dark:border-[#2C3B5E] hover:border-[#CFCFC9] dark:hover:border-[#475569]'
            } ${mode === 'executing' && node.status === 'running' ? 'animate-pulse' : ''}`}
          >
            <span className="relative w-7 h-7 rounded-md bg-[#F8F8F7] dark:bg-[#19233B] border border-[#ECECE9] dark:border-[#2C3B5E] flex items-center justify-center flex-shrink-0">
              <ServiceLogo service={node.service} className="w-4 h-4 text-[#111827] dark:text-[#F1F5F9]" />
              <span
                data-testid={`node-bubble-${node.service}`}
                data-step-count={node.stepCount}
                data-status-icon={showStatusBubble ? node.status : 'count'}
                className={`absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full text-[11px] font-semibold flex items-center justify-center border pointer-events-none tabular-nums ${
                  showStatusBubble && node.status === 'succeeded'
                    ? 'bg-[#DCFAE5] text-[#04250E] border-[#B7EBCA]'
                    : showStatusBubble && node.status === 'running'
                      ? 'bg-[#1D1F20] text-white border-[#1D1F20]'
                      : showStatusBubble && node.status === 'failed'
                        ? 'bg-[#FEE2E2] text-[#7F1D1D] border-[#FECACA]'
                        : 'bg-white dark:bg-[#131B2F] text-[#111827] dark:text-[#F1F5F9] border-[#DFDFDC] dark:border-[#2C3B5E]'
                }`}
              >
                {showStatusBubble && node.status === 'succeeded' ? (
                  '✓'
                ) : showStatusBubble && node.status === 'running' ? (
                  <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <circle cx="12" cy="12" r="9" className="opacity-30" />
                    <path d="M12 3a9 9 0 0 1 9 9" />
                  </svg>
                ) : showStatusBubble && node.status === 'failed' ? (
                  '!'
                ) : (
                  node.stepCount
                )}
              </span>
            </span>
            <span className="text-left min-w-0">
              <span className="block text-xs font-semibold text-[#111827] dark:text-[#F1F5F9] leading-tight truncate">
                {node.label}
              </span>
              <span className="block text-[11px] text-[#5F6368] dark:text-[#94A3B8] leading-tight truncate mt-0.5">
                {node.actionSummary}
              </span>
            </span>
          </button>
          {mode === 'schedule' && index === 0 && (
            <span
              data-trigger-badge="schedule"
              title="Kích hoạt tự động theo lịch định kỳ"
              className="ml-1 w-5 h-5 rounded-full bg-[#1D1F20] dark:bg-[#1E293B] dark:border dark:border-[#475569] text-white flex items-center justify-center flex-shrink-0 pointer-events-none"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2">
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
              </svg>
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center text-center min-w-[76px] max-w-[116px]">
      <div className="relative flex items-center justify-center">
        {/* Left Connector Ear */}
        {index > 0 && (
          <span
            data-connector-ear="true"
            aria-hidden="true"
            className="absolute -left-1.5 w-2 h-3 rounded-l-full bg-white dark:bg-[#131B2F] border border-[#DFDFDC] dark:border-[#2C3B5E] pointer-events-none z-0"
          />
        )}
        {/* Right Connector Ear */}
        {!isLast && (
          <span
            data-connector-ear="true"
            aria-hidden="true"
            className="absolute -right-1.5 w-2 h-3 rounded-r-full bg-white dark:bg-[#131B2F] border border-[#DFDFDC] dark:border-[#2C3B5E] pointer-events-none z-0"
          />
        )}

        <button
          type="button"
          data-testid={`workflow-node-${node.service}`}
          data-service={node.service}
          data-step-count={node.stepCount}
          aria-label={`Nút dịch vụ ${node.label} (${node.stepCount} bước)`}
          aria-expanded={isSelected ? 'true' : 'false'}
          onClick={onSelect}
          className={`w-16 h-16 rounded-full bg-white ring-4 dark:bg-[#131B2F] ring-[#111827]/[0.03] dark:ring-[#F1F5F9]/10 border transition-colors flex items-center justify-center relative z-10 group cursor-pointer focus:v3-outline-none ${
            isSelected ? 'border-[#111827] dark:border-[#F8FAFC] bg-[#F8F8F7] dark:bg-[#1E293B]' : 'border-[#DFDFDC] dark:border-[#2C3B5E] hover:border-[#BDBDB7] dark:hover:border-[#475569]'
          } ${mode === 'executing' && node.status === 'running' ? 'animate-pulse' : ''}`}
        >
          <ServiceLogo service={node.service} className="w-6 h-6 text-[#111827] dark:text-[#F1F5F9]" />
        </button>

        {/* Schedule Clock Trigger Badge on First Node */}
        {mode === 'schedule' && index === 0 && (
          <span
            data-trigger-badge="schedule"
            title="Kích hoạt tự động theo lịch định kỳ"
            className="absolute -bottom-1 -left-1 z-20 w-5 h-5 rounded-full bg-[#1D1F20] dark:bg-[#1E293B] text-white border-2 border-white dark:border-[#475569] flex items-center justify-center pointer-events-none"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2">
              <circle cx="12" cy="12" r="9" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
            </svg>
          </span>
        )}

        {/* Top-Right Step Count or Status Bubble */}
        <span
          data-testid={`node-bubble-${node.service}`}
          data-step-count={node.stepCount}
          data-status-icon={showStatusBubble ? node.status : 'count'}
          className={`absolute -top-1 -right-1 z-20 min-w-[20px] h-[20px] px-1 rounded-full text-[11px] font-semibold flex items-center justify-center border pointer-events-none tabular-nums ${
            showStatusBubble && node.status === 'succeeded'
              ? 'bg-[#DCFAE5] text-[#04250E] border-[#B7EBCA]'
              : showStatusBubble && node.status === 'running'
                ? 'bg-[#1D1F20] text-white border-[#1D1F20]'
                : showStatusBubble && node.status === 'failed'
                  ? 'bg-[#FEE2E2] text-[#7F1D1D] border-[#FECACA]'
                  : 'bg-white dark:bg-[#131B2F] text-[#111827] dark:text-[#F1F5F9] border-[#DFDFDC] dark:border-[#2C3B5E]'
          }`}
        >
          {showStatusBubble && node.status === 'succeeded' ? (
            '✓'
          ) : showStatusBubble && node.status === 'running' ? (
            <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <circle cx="12" cy="12" r="9" className="opacity-30" />
              <path d="M12 3a9 9 0 0 1 9 9" />
            </svg>
          ) : showStatusBubble && node.status === 'failed' ? (
            '!'
          ) : (
            node.stepCount
          )}
        </span>
      </div>

      {/* Node Footer Label */}
      <div className="mt-1.5 flex items-center justify-center max-w-full">
        <span className="text-xs font-semibold text-[#111827] dark:text-[#F1F5F9] truncate">{node.label}</span>
      </div>
      <span className="text-[11px] text-[#5F6368] dark:text-[#94A3B8] line-clamp-1 mt-0.5">{node.actionSummary}</span>
    </div>
  );
}

function DataFlowStrip({ badges }: { badges: ReturnType<typeof planStepDataFlows> }) {
  const colsClass =
    badges.length === 1 ? 'sm:grid-cols-1' : badges.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2';
  return (
    <div
      data-testid="workflow-data-flow-strip"
      className="mt-2.5 pt-2 border-t border-[#E6E6E3] dark:border-[#24324D] space-y-1.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-[#5F6368] dark:text-[#94A3B8]">
          Luồng truyền dữ liệu:
        </span>
      </div>
      <div className={`grid grid-cols-1 gap-1.5 ${colsClass}`}>
        {badges.map((edge) => (
          <span
            key={`${edge.fromStepId}-${edge.toStepId}-${edge.field}`}
            data-testid="workflow-data-flow-pill"
            className="flex items-center justify-between gap-2 px-2.5 py-1 rounded-md bg-white dark:bg-[#131B2F] border border-[#E5E5E3] dark:border-[#2C3B5E] text-[11px] font-medium text-[#111827] dark:text-[#F1F5F9] min-w-0"
          >
            <span className="font-medium text-[#111827] dark:text-[#F1F5F9] truncate">
              Dữ liệu từ Việc {edge.fromIndex} → Việc {edge.toIndex}
            </span>
            <span className="text-[#5F6368] dark:text-[#94A3B8] text-[11px] truncate flex-shrink-0">
              ({friendlyFieldLabel(edge.field)})
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function WorkflowFlowCanvas({
  steps = [],
  services = [],
  stepStatuses = {},
  resourceLabels,
  mode = 'preview',
  isAutoDigest = false,
  compact = false,
  hideInlineInspector = false,
  selectedService: controlledSelectedService,
  onSelectService,
  onStepPreview,
  className = '',
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

  // Build grouped service nodes in topological/first-seen execution order
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
      const meta = getOrbitalMeta(svc);
      const resolvedStatuses = svcSteps.map(
        (st) => stepStatuses[st.id] ?? st.status ?? (mode === 'receipt' ? 'succeeded' : 'pending')
      );
      const status = resolveAggregateStatus(resolvedStatuses, mode);
      const actionSummary =
        svcSteps.length === 1
          ? operation(svcSteps[0].tool).action
          : `${svcSteps.length} thao tác`;

      serviceNodes.push({
        service: svc,
        label: meta.label,
        meta,
        steps: svcSteps,
        stepCount: svcSteps.length,
        status,
        actionSummary,
      });
    }
  } else if (services.length > 0) {
    const uniqueServices = [...new Set(services.filter(Boolean))];
    uniqueServices.forEach((svc, idx) => {
      const meta = getOrbitalMeta(svc);
      const actionSummary =
        mode === 'schedule'
          ? idx === 0
            ? 'Đọc nguồn định kỳ'
            : 'Gửi báo cáo'
          : 'Tự động hoá';
      serviceNodes.push({
        service: svc,
        label: meta.label,
        meta,
        steps: [
          {
            id: `svc-${svc}-${idx + 1}`,
            tool: `${svc}.action`,
            description:
              mode === 'schedule'
                ? idx === 0
                  ? `Đọc dữ liệu định kỳ từ ${meta.label}`
                  : `Gửi bản tin định kỳ qua ${meta.label}`
                : `Thao tác tự động trên ${meta.label}`,
            args: {},
          },
        ],
        stepCount: 1,
        status: mode === 'receipt' ? 'succeeded' : 'pending',
        actionSummary,
      });
    });
  }

  if (serviceNodes.length === 0) return null;

  // Compute Make.com Router topology:
  // Keep sequential upstream services in a linear chain BEFORE Router, and place Router right before parallel destination branches.
  const hasRouterNode = serviceNodes.length >= 3;
  let routerSplitIndex = 1;
  if (hasRouterNode) {
    const stepToNodeIndex = new Map<string, number>();
    serviceNodes.forEach((node, nodeIdx) => {
      node.steps.forEach((st) => stepToNodeIndex.set(st.id, nodeIdx));
    });

    let explicitFanOutNodeIdx: number | null = null;
    for (let i = 0; i <= serviceNodes.length - 3; i++) {
      const downstreamDependents = new Set<number>();
      for (let j = i + 1; j < serviceNodes.length; j++) {
        for (const st of serviceNodes[j].steps) {
          for (const depId of st.dependsOn ?? []) {
            if (stepToNodeIndex.get(depId) === i) {
              downstreamDependents.add(j);
            }
          }
        }
      }
      if (downstreamDependents.size >= 2) {
        explicitFanOutNodeIdx = i;
      }
    }

    if (explicitFanOutNodeIdx !== null) {
      routerSplitIndex = explicitFanOutNodeIdx + 1;
    } else if (serviceNodes.length >= 4) {
      routerSplitIndex = serviceNodes.length - 2;
    } else {
      routerSplitIndex = 1;
    }
  }

  const upstreamNodes = hasRouterNode ? serviceNodes.slice(0, routerSplitIndex) : serviceNodes;
  const destinationNodes = hasRouterNode ? serviceNodes.slice(routerSplitIndex) : [];
  const inspectedNode = serviceNodes.find((n) => n.service === selectedService) ?? null;

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
      data-flow-mode={mode}
      data-router-node={hasRouterNode ? 'true' : undefined}
      data-auto-digest={mode === 'schedule' ? (isAutoDigest ? 'true' : 'false') : undefined}
      className={`w-full rounded-xl border border-[#E6E6E3] dark:border-[#24324D] bg-[#F9F9F8] dark:bg-[#0E1528] ${
        compact ? 'px-2.5 py-1.5 sm:px-3 sm:py-2' : 'p-3 sm:p-3.5'
      } min-w-0 overflow-hidden ${className}`}
    >
      {/* Top Stage Header Pill */}
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-[#4B5563] dark:text-[#CBD5E1]">
            <span
              aria-hidden="true"
              className={`w-1.5 h-1.5 rounded-full ${
                mode === 'receipt'
                  ? 'bg-[#047857]'
                  : mode === 'executing'
                    ? 'bg-[#1D1F20] animate-ping'
                    : 'bg-[#5F6368]'
              }`}
            />
            <span>
              {mode === 'preview'
                ? 'Sơ đồ luồng tự động hoá'
                : mode === 'executing'
                  ? 'Luồng dữ liệu đang chạy trực tiếp'
                  : mode === 'receipt'
                    ? 'Luồng thực thi hoàn tất'
                    : mode === 'schedule'
                      ? 'Chuỗi dịch vụ chạy theo lịch'
                      : 'Mô hình luồng mẫu'}
            </span>
          </div>
          {inspectedNode ? (
            <button
              type="button"
              onClick={() => handleToggleService(null)}
              className="text-xs font-medium text-[#5F6368] dark:text-[#94A3B8] hover:text-[#111827] dark:hover:text-[#F1F5F9] cursor-pointer"
            >
              Bỏ lọc ({inspectedNode.label})
            </button>
          ) : serviceNodes.length > 0 ? (
            <span className="text-[11px] font-medium text-[#5F6368] dark:text-[#94A3B8]">
              Bấm vào dịch vụ để xem chi tiết bước
            </span>
          ) : null}
        </div>
      )}

      {/* Pipeline Canvas Area */}
      {!hasRouterNode ? (
        <div className={compact && dataFlowBadges.length > 0 ? 'space-y-2' : ''}>
          <div
            data-testid="workflow-upstream-chain"
            className={`flex items-center ${
              compact
                ? 'flex-wrap sm:flex-nowrap justify-between w-full gap-y-2 overflow-x-auto'
                : 'flex-wrap justify-center gap-y-4 py-1.5'
            }`}
          >
            {serviceNodes.map((node, index) => (
              <div
                key={node.service}
                className={
                  compact
                    ? index < serviceNodes.length - 1
                      ? 'flex items-center flex-1 min-w-0'
                      : 'flex items-center flex-shrink-0'
                    : 'flex items-center'
                }
              >
                <OrbitalNodeButton
                  node={node}
                  index={index}
                  isLast={index === serviceNodes.length - 1}
                  mode={mode}
                  compact={compact}
                  isSelected={selectedService === node.service}
                  onSelect={() => handleToggleService(node.service)}
                />

                {/* Schedule Auto-Digest Central Pill */}
                {mode === 'schedule' && isAutoDigest && index === 0 && serviceNodes.length >= 2 && (
                  <>
                    <DottedConnector
                      mode={mode}
                      compact={compact}
                      stretch={compact}
                      fromColor={node.meta.strokeHex}
                      toColor="#6B7280"
                    />
                    <div
                      data-testid="workflow-auto-digest-node"
                      className={
                        compact
                          ? 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white dark:bg-[#131B2F] border border-[#DFDFDC] dark:border-[#2C3B5E] flex-shrink-0'
                          : 'flex flex-col items-center text-center px-1'
                      }
                    >
                      <div
                        className={
                          compact
                            ? 'w-5 h-5 rounded bg-[#1D1F20] dark:bg-[#1E293B] dark:border dark:border-[#475569] text-white flex items-center justify-center flex-shrink-0'
                            : 'w-11 h-11 rounded-full bg-[#1D1F20] dark:bg-[#1E293B] text-white border border-[#1D1F20] dark:border-[#475569] flex items-center justify-center'
                        }
                      >
                        <svg className={compact ? 'w-3 h-3' : 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M13 10V3L4 14h7v7l9-11h-7z"
                          />
                        </svg>
                      </div>
                      <span className={`${compact ? 'text-xs font-medium text-[#111827] dark:text-[#F1F5F9]' : 'mt-1.5 text-[11px] font-semibold text-[#111827] dark:text-[#F1F5F9]'} whitespace-nowrap`}>
                        Bản tin tự động
                      </span>
                      {!compact && <span className="text-[11px] text-[#5F6368] dark:text-[#94A3B8]">Tổng hợp &amp; gửi tự động</span>}
                    </div>
                  </>
                )}

                {index < serviceNodes.length - 1 && (
                  <DottedConnector
                    mode={mode}
                    compact={compact}
                    stretch={compact}
                    fromColor={
                      mode === 'schedule' && isAutoDigest && index === 0
                        ? '#6B7280'
                        : node.meta.strokeHex
                    }
                    toColor={serviceNodes[index + 1].meta.strokeHex}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Router Fan-Out Layout: Sequential Upstream Chain -> Phân luồng -> Curved Dotted Branches -> Destinations */
        <div
          className={
            compact
              ? 'flex flex-col sm:flex-row sm:flex-nowrap items-stretch sm:items-center justify-between gap-2 sm:gap-1 w-full py-0.5 overflow-x-auto'
              : 'flex flex-col md:flex-row items-center justify-center gap-3 md:gap-2 py-1.5'
          }
        >
          {/* Upstream Linear Service Chain BEFORE Router */}
          <div
            data-testid="workflow-upstream-chain"
            className={
              compact
                ? 'flex flex-wrap sm:flex-nowrap items-center flex-1 min-w-0 gap-y-2'
                : 'flex flex-wrap items-center justify-center gap-y-2.5'
            }
          >
            {upstreamNodes.map((uNode, uIdx) => (
              <div key={uNode.service} className={compact ? 'flex items-center flex-1 min-w-0' : 'flex items-center'}>
                <OrbitalNodeButton
                  node={uNode}
                  index={uIdx}
                  isLast={false}
                  mode={mode}
                  compact={compact}
                  isSelected={selectedService === uNode.service}
                  onSelect={() => handleToggleService(uNode.service)}
                />
                <DottedConnector
                  mode={mode}
                  compact={compact}
                  stretch={compact}
                  fromColor={uNode.meta.strokeHex}
                  toColor={
                    uIdx < upstreamNodes.length - 1
                      ? upstreamNodes[uIdx + 1].meta.strokeHex
                      : '#6B7280'
                  }
                />
              </div>
            ))}
          </div>

          {/* Central Phân luồng Node */}
          <div
            className={
              compact
                ? 'inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-white dark:bg-[#131B2F] border border-[#DFDFDC] dark:border-[#2C3B5E] flex-shrink-0'
                : 'flex flex-col items-center text-center min-w-[72px]'
            }
          >
            <div className="relative flex items-center justify-center">
              <span
                data-connector-ear="true"
                aria-hidden="true"
                className={compact ? 'sr-only' : 'absolute -left-1.5 w-2 h-3 rounded-l-full bg-white dark:bg-[#131B2F] border border-[#DFDFDC] dark:border-[#2C3B5E] pointer-events-none z-0'}
              />
              <span
                data-connector-ear="true"
                aria-hidden="true"
                className={compact ? 'sr-only' : 'absolute -right-1.5 w-2 h-3 rounded-r-full bg-white dark:bg-[#131B2F] border border-[#DFDFDC] dark:border-[#2C3B5E] pointer-events-none z-0'}
              />
              <div
                data-testid="workflow-router-node"
                data-router-node="true"
                className={
                  compact
                    ? 'w-7 h-7 rounded-md bg-[#1D1F20] dark:bg-[#1E293B] dark:border dark:border-[#475569] text-white flex items-center justify-center relative z-10'
                    : 'w-14 h-14 rounded-full bg-[#1D1F20] dark:bg-[#1E293B] text-white border border-[#1D1F20] dark:border-[#475569] flex items-center justify-center relative z-10'
                }
              >
                <svg
                  className={compact ? 'w-4 h-4' : 'w-6 h-6'}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="3" fill="currentColor" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h5m7-5 5-2m-5 2 3 4m-3 3 5 2m-5-2 3-4" />
                </svg>
              </div>
            </div>
            <div className={compact ? 'text-left' : 'mt-1.5 flex items-center gap-1'}>
              <span className="text-xs font-semibold text-[#111827] dark:text-[#F1F5F9] block whitespace-nowrap">Phân luồng</span>
              <span className="text-[11px] font-medium px-1.5 rounded border border-[#E5E5E3] dark:border-[#2C3B5E] bg-[#F4F4F3] dark:bg-[#19233B] text-[#4B5563] dark:text-[#CBD5E1] tabular-nums whitespace-nowrap">
                {destinationNodes.length} nhánh
              </span>
            </div>
            {!compact && <span className="text-[11px] text-[#5F6368] dark:text-[#94A3B8]">Điều phối nhiều nhánh</span>}
          </div>

          {/* Fan-Out Branches to Destination Nodes */}
          <div
            data-testid="workflow-branch-chain"
            className={
              compact
                ? 'flex flex-col gap-1.5 items-stretch sm:min-w-[152px] flex-shrink-0'
                : 'flex flex-col gap-2.5 w-full md:w-auto items-center md:items-start'
            }
          >
            {destinationNodes.map((destNode, branchIdx) => (
              <div
                key={destNode.service}
                className={compact ? 'flex items-center justify-between gap-1' : 'flex items-center justify-center'}
              >
                {/* Curved Dotted Branch SVG */}
                <div
                  className={`flex flex-col items-center ${compact ? 'px-0.5 sm:px-1' : 'px-1 sm:px-2'} flex-shrink-0 relative text-[#475569] dark:text-[#94A3B8]`}
                  aria-hidden="true"
                >
                  <span className="text-[11px] font-medium text-[#4B5563] dark:text-[#CBD5E1] bg-white dark:bg-[#131B2F] border border-[#E5E5E3] dark:border-[#2C3B5E] px-1.5 py-0.2 rounded mb-0.5 tabular-nums whitespace-nowrap">
                    {ordinalLabel(branchIdx)}
                  </span>
                  <div className="relative flex items-center justify-center">
                    <svg
                      width={compact ? '36' : '52'}
                      height={compact ? '18' : '24'}
                      viewBox="0 0 52 24"
                      fill="none"
                      className={`${compact ? 'w-7 sm:w-8 h-4' : 'w-10 sm:w-13 h-6'} ${mode === 'executing' ? 'animate-pulse' : ''}`}
                    >
                      <path
                        d={
                          branchIdx === 0
                            ? 'M 2 18 C 20 18, 28 6, 48 6'
                            : branchIdx === destinationNodes.length - 1
                              ? 'M 2 6 C 20 6, 28 18, 48 18'
                              : 'M 2 12 L 48 12'
                        }
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeDasharray="4 4"
                      />
                      <path
                        data-connector-arrow="true"
                        d={
                          branchIdx === 0
                            ? 'M 45 3 L 49 6 L 45 9'
                            : branchIdx === destinationNodes.length - 1
                              ? 'M 45 15 L 49 18 L 45 21'
                              : 'M 45 9 L 49 12 L 45 15'
                        }
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span
                      data-flow-filter-badge="true"
                      className={compact ? 'sr-only' : 'absolute w-3.5 h-3.5 rounded-full bg-white dark:bg-[#131B2F] border border-[#E5E5E3] dark:border-[#2C3B5E] flex items-center justify-center text-[#6B7280] dark:text-[#CBD5E1]'}
                    >
                      <svg className="w-2 h-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m6-6H6" />
                      </svg>
                    </span>
                  </div>
                </div>

                <OrbitalNodeButton
                  node={destNode}
                  index={upstreamNodes.length + branchIdx}
                  isLast={true}
                  mode={mode}
                  compact={compact}
                  fullWidth={compact}
                  isSelected={selectedService === destNode.service}
                  onSelect={() => handleToggleService(destNode.service)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Data-Flow Mapping Strip between steps */}
      {dataFlowBadges.length > 0 && <DataFlowStrip badges={dataFlowBadges} />}

      {/* Interactive Node Inspector Popover */}
      {!hideInlineInspector && inspectedNode && (
        <div
          data-testid="workflow-node-inspector"
          role="region"
          aria-label={`Chi tiết nút ${inspectedNode.label}`}
          className="mt-2.5 p-3 rounded-lg bg-white dark:bg-[#131B2F] border border-[#E5E5E3] dark:border-[#293653] v3-space-y-2"
        >
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#ECECE9] dark:border-[#24324D]">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-md bg-[#F8F8F7] dark:bg-[#19233B] border border-[#E6E6E3] dark:border-[#2C3B5E] flex items-center justify-center flex-shrink-0">
                <ServiceLogo service={inspectedNode.service} className="w-3.5 h-3.5 text-[#111827] dark:text-[#F1F5F9]" />
              </div>
              <span className="text-xs font-semibold text-[#111827] dark:text-[#F1F5F9] truncate">
                {inspectedNode.label}
              </span>
              <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-[#F4F4F3] dark:bg-[#19233B] text-[#4B5563] dark:text-[#CBD5E1] border border-[#E5E5E3] dark:border-[#2C3B5E] tabular-nums">
                {inspectedNode.stepCount} bước
              </span>
            </div>
            <button
              type="button"
              aria-label="Đóng chi tiết nút"
              onClick={() => handleToggleService(null)}
              className="text-xs font-medium text-[#5F6368] dark:text-[#94A3B8] hover:text-[#111827] dark:hover:text-[#F1F5F9] px-2 py-1 rounded-md hover:bg-[#F5F5F4] dark:hover:bg-[#1F2A44] transition-colors inline-flex items-center gap-1 cursor-pointer"
            >
              <span>Đóng</span>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <ul className="v3-space-y-1.5">
            {inspectedNode.steps.map((step, sIdx) => {
              const op = operation(step.tool);
              const scopes = extractScopeBadges(step, resourceLabels);
              return (
                <li
                  key={step.id}
                  className="p-2.5 rounded-md bg-[#F9F9F8] dark:bg-[#0E1528] border border-[#ECECE9] dark:border-[#24324D] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="v3-space-y-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-white dark:bg-[#131B2F] border border-[#E5E5E3] dark:border-[#2C3B5E] text-[#5F6368] dark:text-[#94A3B8] tabular-nums">
                        Bước {sIdx + 1}
                      </span>
                      <span className="font-medium text-[#111827] dark:text-[#F1F5F9] px-2 py-0.5 rounded bg-white dark:bg-[#131B2F] border border-[#E5E5E3] dark:border-[#2C3B5E]">
                        {op.action}
                      </span>
                      {scopes.map((scope) => (
                        <span
                          key={scope}
                          className="text-[11px] font-medium px-2 py-0.5 rounded bg-white dark:bg-[#131B2F] text-[#4B5563] dark:text-[#CBD5E1] border border-[#E5E5E3] dark:border-[#2C3B5E]"
                        >
                          Phạm vi: {scope}
                        </span>
                      ))}
                    </div>
                    <p className="text-[#111827] dark:text-[#F1F5F9] font-medium break-words">{step.description}</p>
                  </div>
                  {onStepPreview && step.args && (
                    <button
                      type="button"
                      onClick={() =>
                        onStepPreview({
                          id: step.id,
                          tool: step.tool,
                          description: step.description,
                          args: step.args ?? {},
                          dependsOn: step.dependsOn,
                        })
                      }
                      className="flex-shrink-0 h-7 px-2.5 rounded-md bg-white dark:bg-[#131B2F] hover:bg-[#F3F3F1] dark:hover:bg-[#1F2A44] border border-[#DFDFDC] dark:border-[#2C3B5E] text-[#111827] dark:text-[#F1F5F9] text-[11px] font-medium transition-colors cursor-pointer"
                    >
                      Mở bản xem trước
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
