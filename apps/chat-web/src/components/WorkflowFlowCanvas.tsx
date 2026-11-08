import { useState } from 'react';
import { getServiceDefinition } from '@wap/tool-schemas';
import assets from '../assets/cockpit-services.json';
import type { PlanStep, StepState } from '../types';
import { ServiceLogo } from './ServiceLogo';
import { operation, planStepDataFlows, serviceId } from '../pages/Cockpit/presentation';

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
    label: getServiceDefinition(service)?.name ?? service,
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
  if (index === 0) return '1st';
  if (index === 1) return '2nd';
  if (index === 2) return '3rd';
  return `${index + 1}th`;
}

function DottedConnector({
  mode,
  fromColor,
  toColor,
  label,
  compact = false,
}: {
  mode: WorkflowFlowMode;
  fromColor: string;
  toColor: string;
  label?: string;
  compact?: boolean;
}) {
  const isReceipt = mode === 'receipt';
  const isExecuting = mode === 'executing';
  const strokeColor = isReceipt ? '#9CA3AF' : isExecuting ? '#6B7280' : fromColor || toColor || '#9CA3AF';

  return (
    <div
      data-flow-connector="true"
      className={`flex flex-col items-center justify-center ${compact ? 'px-1.5 sm:px-2.5' : 'px-1 sm:px-2'} flex-shrink-0 select-none relative`}
      aria-hidden="true"
    >
      {label && (
        <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-[#F4F4F3] text-[#4B5563] border border-[#E5E5E3] mb-1 whitespace-nowrap">
          {label}
        </span>
      )}
      <div className="relative flex items-center justify-center">
        <svg
          width={compact ? '36' : '48'}
          height={compact ? '14' : '18'}
          viewBox="0 0 48 18"
          fill="none"
          className={`${compact ? 'w-8 sm:w-9 h-3.5' : 'w-9 sm:w-12 h-4'} ${isExecuting ? 'animate-pulse' : ''}`}
        >
          <line
            x1="2"
            y1="9"
            x2="46"
            y2="9"
            stroke={strokeColor}
            strokeWidth={compact ? '2' : '2.2'}
            strokeLinecap="round"
            strokeDasharray="4 4"
          />
          <circle cx="6" cy="9" r="2" fill={strokeColor} />
          <circle cx="42" cy="9" r="2" fill={strokeColor} />
        </svg>
        {!compact && (
          <span
            data-flow-filter-badge="true"
            className="absolute w-4 h-4 rounded-full bg-white border border-[#E5E5E3] flex items-center justify-center text-[#6B7280]"
            title="Bộ lọc & ánh xạ dữ liệu giữa các bước"
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
    </div>
  );
}

function OrbitalNodeButton({
  node,
  index,
  isLast,
  mode,
  compact = false,
  isSelected,
  onSelect,
}: {
  node: GroupedServiceNode;
  index: number;
  isLast?: boolean;
  mode: WorkflowFlowMode;
  compact?: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const showStatusBubble =
    (mode === 'executing' || mode === 'receipt') &&
    (node.status === 'succeeded' || node.status === 'running' || node.status === 'failed');

  if (compact) {
    return (
      <div className="inline-flex items-center">
        <div className="relative inline-flex items-center">
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
            className={`inline-flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-lg bg-white border transition-colors cursor-pointer focus:v3-outline-none ${
              isSelected
                ? 'border-[#111827] bg-[#F5F5F4]'
                : 'border-[#E5E5E3] hover:border-[#CFCFC9]'
            } ${mode === 'executing' && node.status === 'running' ? 'animate-pulse' : ''}`}
          >
            <span className="relative w-7 h-7 rounded-md bg-[#F8F8F7] border border-[#ECECE9] flex items-center justify-center flex-shrink-0">
              <ServiceLogo service={node.service} className="w-4 h-4 text-[#111827]" />
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
                        : 'bg-white text-[#111827] border-[#DFDFDC]'
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
              <span className="block text-xs font-semibold text-[#111827] leading-tight truncate">
                {node.label}
              </span>
              <span className="block text-[11px] text-[#5F6368] leading-tight truncate mt-0.5">
                {node.actionSummary}
              </span>
            </span>
          </button>
          {mode === 'schedule' && index === 0 && (
            <span
              data-trigger-badge="schedule"
              title="Kích hoạt tự động theo lịch định kỳ"
              className="ml-1 w-5 h-5 rounded-full bg-[#1D1F20] text-white flex items-center justify-center pointer-events-none"
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
            className="absolute -left-1.5 w-2 h-3 rounded-l-full bg-white border border-[#DFDFDC] pointer-events-none z-0"
          />
        )}
        {/* Right Connector Ear */}
        {!isLast && (
          <span
            data-connector-ear="true"
            aria-hidden="true"
            className="absolute -right-1.5 w-2 h-3 rounded-r-full bg-white border border-[#DFDFDC] pointer-events-none z-0"
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
          className={`w-16 h-16 rounded-full bg-white ring-4 ring-[#111827]/[0.03] border transition-colors flex items-center justify-center relative z-10 group cursor-pointer focus:v3-outline-none ${
            isSelected ? 'border-[#111827] bg-[#F8F8F7]' : 'border-[#DFDFDC] hover:border-[#BDBDB7]'
          } ${mode === 'executing' && node.status === 'running' ? 'animate-pulse' : ''}`}
        >
          <ServiceLogo service={node.service} className="w-6 h-6 text-[#111827]" />
        </button>

        {/* Schedule Clock Trigger Badge on First Node */}
        {mode === 'schedule' && index === 0 && (
          <span
            data-trigger-badge="schedule"
            title="Kích hoạt tự động theo lịch định kỳ"
            className="absolute -bottom-1 -left-1 z-20 w-5 h-5 rounded-full bg-[#1D1F20] text-white border-2 border-white flex items-center justify-center pointer-events-none"
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
                  : 'bg-white text-[#111827] border-[#DFDFDC]'
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
        <span className="text-xs font-semibold text-[#111827] truncate">{node.label}</span>
      </div>
      <span className="text-[11px] text-[#5F6368] line-clamp-1 mt-0.5">{node.actionSummary}</span>
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
      className={`w-full rounded-lg border border-[#E6E6E3] bg-[#F9F9F8] ${
        compact ? 'px-3.5 py-2.5' : 'p-3.5 sm:p-4'
      } min-w-0 overflow-hidden ${className}`}
    >
      {/* Top Stage Header Pill */}
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-[#4B5563]">
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
          {inspectedNode && (
            <button
              type="button"
              onClick={() => handleToggleService(null)}
              className="text-xs font-medium text-[#5F6368] hover:text-[#111827] cursor-pointer"
            >
              Bỏ lọc ({inspectedNode.label})
            </button>
          )}
        </div>
      )}

      {/* Pipeline Canvas Area */}
      {!hasRouterNode ? (
        <div
          className={
            compact && dataFlowBadges.length > 0
              ? 'flex flex-wrap items-center justify-between gap-x-4 gap-y-2'
              : ''
          }
        >
          <div
            data-testid="workflow-upstream-chain"
            className={`flex flex-wrap items-center ${
              compact ? 'justify-start gap-y-2' : 'justify-center gap-y-4 py-1.5'
            }`}
          >
            {serviceNodes.map((node, index) => (
              <div key={node.service} className="flex items-center">
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
                      fromColor={node.meta.strokeHex}
                      toColor="#6B7280"
                    />
                    <div
                      data-testid="workflow-auto-digest-node"
                      className={
                        compact
                          ? 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-[#DFDFDC]'
                          : 'flex flex-col items-center text-center px-1'
                      }
                    >
                      <div
                        className={
                          compact
                            ? 'w-5 h-5 rounded bg-[#1D1F20] text-white flex items-center justify-center flex-shrink-0'
                            : 'w-11 h-11 rounded-full bg-[#1D1F20] text-white border border-[#1D1F20] flex items-center justify-center'
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
                      <span className={`${compact ? 'text-xs font-medium text-[#111827]' : 'mt-1.5 text-[11px] font-semibold text-[#111827]'} whitespace-nowrap`}>
                        Auto-Digest
                      </span>
                      {!compact && <span className="text-[11px] text-[#5F6368]">Gửi tự động</span>}
                    </div>
                  </>
                )}

                {index < serviceNodes.length - 1 && (
                  <DottedConnector
                    mode={mode}
                    compact={compact}
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

          {compact && dataFlowBadges.length > 0 && (
            <div
              data-testid="workflow-data-flow-strip"
              className="flex flex-wrap items-center gap-1.5"
            >
              {dataFlowBadges.map((edge) => (
                <span
                  key={`${edge.fromStepId}-${edge.toStepId}-${edge.field}`}
                  data-testid="workflow-data-flow-pill"
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white border border-[#E5E5E3] text-[11px] font-medium text-[#4B5563]"
                >
                  <span className="text-[#111827] font-medium">
                    Dữ liệu từ Việc {edge.fromIndex} → Việc {edge.toIndex}
                  </span>
                  <span className="text-[#5F6368] font-mono text-[11px]">({edge.field})</span>
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Router Fan-Out Layout: Sequential Upstream Chain -> Router -> Curved Dotted Branches -> Destinations */
        <div className={`flex flex-col md:flex-row items-center ${compact ? 'justify-start gap-2.5 py-0.5' : 'justify-center gap-3 md:gap-2 py-1.5'}`}>
          {/* Upstream Linear Service Chain BEFORE Router */}
          <div
            data-testid="workflow-upstream-chain"
            className="flex flex-wrap items-center justify-center gap-y-2.5"
          >
            {upstreamNodes.map((uNode, uIdx) => (
              <div key={uNode.service} className="flex items-center">
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

          {/* Central Router Node */}
          <div className={compact ? 'inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-[#DFDFDC]' : 'flex flex-col items-center text-center min-w-[72px]'}>
            <div className="relative flex items-center justify-center">
              <span
                data-connector-ear="true"
                aria-hidden="true"
                className={compact ? 'sr-only' : 'absolute -left-1.5 w-2 h-3 rounded-l-full bg-white border border-[#DFDFDC] pointer-events-none z-0'}
              />
              <span
                data-connector-ear="true"
                aria-hidden="true"
                className={compact ? 'sr-only' : 'absolute -right-1.5 w-2 h-3 rounded-r-full bg-white border border-[#DFDFDC] pointer-events-none z-0'}
              />
              <div
                data-testid="workflow-router-node"
                data-router-node="true"
                className={
                  compact
                    ? 'w-7 h-7 rounded-md bg-[#1D1F20] text-white flex items-center justify-center relative z-10'
                    : 'w-14 h-14 rounded-full bg-[#1D1F20] text-white border border-[#1D1F20] flex items-center justify-center relative z-10'
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
              <span className="text-xs font-semibold text-[#111827] block">Router</span>
              <span className="text-[11px] font-mono px-1.5 rounded border border-[#E5E5E3] bg-[#F4F4F3] text-[#4B5563] tabular-nums">
                {destinationNodes.length} nhánh
              </span>
            </div>
            {!compact && <span className="text-[11px] text-[#5F6368]">Phân luồng dữ liệu</span>}
          </div>

          {/* Fan-Out Branches to Destination Nodes */}
          <div
            data-testid="workflow-branch-chain"
            className={`flex flex-col ${compact ? 'gap-2' : 'gap-2.5'} w-full md:w-auto items-center md:items-start`}
          >
            {destinationNodes.map((destNode, branchIdx) => (
              <div key={destNode.service} className="flex items-center justify-center">
                {/* Curved Dotted Branch SVG */}
                <div className="flex flex-col items-center px-1 sm:px-2 flex-shrink-0 relative" aria-hidden="true">
                  <span className="text-[11px] font-medium text-[#4B5563] bg-white border border-[#E5E5E3] px-1.5 py-0.2 rounded mb-0.5 tabular-nums">
                    {ordinalLabel(branchIdx)}
                  </span>
                  <div className="relative flex items-center justify-center">
                    <svg
                      width={compact ? '40' : '52'}
                      height={compact ? '18' : '24'}
                      viewBox="0 0 52 24"
                      fill="none"
                      className={`${compact ? 'w-8 sm:w-10 h-4' : 'w-10 sm:w-13 h-6'} ${mode === 'executing' ? 'animate-pulse' : ''}`}
                    >
                      <path
                        d={
                          branchIdx === 0
                            ? 'M 2 18 C 20 18, 28 6, 50 6'
                            : branchIdx === destinationNodes.length - 1
                              ? 'M 2 6 C 20 6, 28 18, 50 18'
                              : 'M 2 12 L 50 12'
                        }
                        stroke="#9CA3AF"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeDasharray="4 4"
                      />
                    </svg>
                    <span
                      data-flow-filter-badge="true"
                      className={compact ? 'sr-only' : 'absolute w-3.5 h-3.5 rounded-full bg-white border border-[#E5E5E3] flex items-center justify-center text-[#6B7280]'}
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
                  isSelected={selectedService === destNode.service}
                  onSelect={() => handleToggleService(destNode.service)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Data-Flow Mapping Strip ($ref / $template between steps) for non-compact or router views */}
      {dataFlowBadges.length > 0 && (!compact || hasRouterNode) && (
        <div
          data-testid="workflow-data-flow-strip"
          className="mt-2.5 pt-2 border-t border-[#E6E6E3] flex flex-wrap items-center gap-1.5"
        >
          <span className="text-[11px] font-medium text-[#5F6368]">Luồng truyền dữ liệu:</span>
          {dataFlowBadges.map((edge) => (
            <span
              key={`${edge.fromStepId}-${edge.toStepId}-${edge.field}`}
              data-testid="workflow-data-flow-pill"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-[#E5E5E3] text-[11px] font-medium text-[#111827]"
            >
              <span className="font-medium text-[#111827]">
                Dữ liệu từ Việc {edge.fromIndex} → Việc {edge.toIndex}
              </span>
              <span className="text-[#5F6368] font-mono text-[11px]">({edge.field})</span>
            </span>
          ))}
        </div>
      )}

      {/* Interactive Node Inspector Popover */}
      {inspectedNode && (
        <div
          data-testid="workflow-node-inspector"
          role="region"
          aria-label={`Chi tiết nút ${inspectedNode.label}`}
          className="mt-2.5 p-3 rounded-lg bg-white border border-[#E5E5E3] v3-space-y-2"
        >
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#ECECE9]">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-md bg-[#F8F8F7] border border-[#E6E6E3] flex items-center justify-center flex-shrink-0">
                <ServiceLogo service={inspectedNode.service} className="w-3.5 h-3.5 text-[#111827]" />
              </div>
              <span className="text-xs font-semibold text-[#111827] truncate">
                {inspectedNode.label}
              </span>
              <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-[#F4F4F3] text-[#4B5563] border border-[#E5E5E3] tabular-nums">
                {inspectedNode.stepCount} bước
              </span>
            </div>
            <button
              type="button"
              aria-label="Đóng chi tiết nút"
              onClick={() => handleToggleService(null)}
              className="text-xs font-medium text-[#5F6368] hover:text-[#111827] px-2 py-1 rounded-md hover:bg-[#F5F5F4] transition-colors inline-flex items-center gap-1 cursor-pointer"
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
                  className="p-2.5 rounded-md bg-[#F9F9F8] border border-[#ECECE9] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="v3-space-y-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-[11px] font-medium px-1.5 py-0.5 rounded bg-white border border-[#E5E5E3] text-[#5F6368] tabular-nums">
                        #{sIdx + 1}
                      </span>
                      <span className="font-medium text-[#111827] px-2 py-0.5 rounded bg-white border border-[#E5E5E3]">
                        {op.action}
                      </span>
                      {scopes.map((scope) => (
                        <span
                          key={scope}
                          className="text-[11px] font-medium px-2 py-0.5 rounded bg-white text-[#4B5563] border border-[#E5E5E3]"
                        >
                          Phạm vi: {scope}
                        </span>
                      ))}
                    </div>
                    <p className="text-[#111827] font-medium break-words">{step.description}</p>
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
                      className="flex-shrink-0 h-7 px-2.5 rounded-md bg-white hover:bg-[#F3F3F1] border border-[#DFDFDC] text-[#111827] text-[11px] font-medium transition-colors cursor-pointer"
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
