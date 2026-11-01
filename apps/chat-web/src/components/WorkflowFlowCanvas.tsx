import { useState } from 'react';
import type { PlanStep, StepState } from '../types';
import { ServiceLogo } from './ServiceLogo';
import { operation, serviceId } from '../pages/Cockpit/presentation';

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
  onStepPreview?: (step: PlanStep) => void;
  className?: string;
}

interface OrbitalServiceMeta {
  label: string;
  ringClass: string;
  strokeHex: string;
  badgeClass: string;
}

const SERVICE_ORBITAL_META: Record<string, OrbitalServiceMeta> = {
  trello: {
    label: 'Trello',
    ringClass: 'ring-[#0079BF]/25 border-[#0079BF]',
    strokeHex: '#0079BF',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  slack: {
    label: 'Slack',
    ringClass: 'ring-[#E01E5A]/25 border-[#E01E5A]',
    strokeHex: '#E01E5A',
    badgeClass: 'bg-purple-50 text-purple-800 border-purple-200',
  },
  github: {
    label: 'GitHub',
    ringClass: 'ring-[#24292E]/25 border-[#24292E]',
    strokeHex: '#24292E',
    badgeClass: 'bg-neutral-100 text-neutral-800 border-neutral-300',
  },
  sheets: {
    label: 'Google Sheets',
    ringClass: 'ring-[#188038]/25 border-[#188038]',
    strokeHex: '#188038',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  mysheets: {
    label: 'Google Sheets',
    ringClass: 'ring-[#188038]/25 border-[#188038]',
    strokeHex: '#188038',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  calendar: {
    label: 'Google Calendar',
    ringClass: 'ring-[#1A73E8]/25 border-[#1A73E8]',
    strokeHex: '#1A73E8',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  mycalendar: {
    label: 'Google Calendar',
    ringClass: 'ring-[#1A73E8]/25 border-[#1A73E8]',
    strokeHex: '#1A73E8',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  gmail: {
    label: 'Gmail',
    ringClass: 'ring-[#EA4335]/25 border-[#EA4335]',
    strokeHex: '#EA4335',
    badgeClass: 'bg-red-50 text-red-700 border-red-200',
  },
  notion: {
    label: 'Notion',
    ringClass: 'ring-[#111827]/20 border-[#111827]',
    strokeHex: '#111827',
    badgeClass: 'bg-neutral-100 text-neutral-800 border-neutral-300',
  },
  telegram: {
    label: 'Telegram',
    ringClass: 'ring-[#229ED9]/25 border-[#229ED9]',
    strokeHex: '#229ED9',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  jira: {
    label: 'Jira',
    ringClass: 'ring-[#0052CC]/25 border-[#0052CC]',
    strokeHex: '#0052CC',
    badgeClass: 'bg-blue-50 text-blue-800 border-blue-200',
  },
};

function getOrbitalMeta(service: string): OrbitalServiceMeta {
  return (
    SERVICE_ORBITAL_META[service] ?? {
      label: service,
      ringClass: 'ring-[#FF5701]/25 border-[#FF5701]',
      strokeHex: '#FF5701',
      badgeClass: 'bg-orange-50 text-orange-800 border-orange-200',
    }
  );
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
}: {
  mode: WorkflowFlowMode;
  fromColor: string;
  toColor: string;
  label?: string;
}) {
  const isReceipt = mode === 'receipt';
  const isExecuting = mode === 'executing';
  const strokeColor = isReceipt ? '#10B981' : fromColor || toColor || '#9CA3AF';

  return (
    <div
      data-flow-connector="true"
      className="flex flex-col items-center justify-center px-1 sm:px-2 flex-shrink-0 select-none"
      aria-hidden="true"
    >
      {label && (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#F8F8F6] text-[#4B5563] border border-[#E7E7E2] mb-1 whitespace-nowrap">
          {label}
        </span>
      )}
      <svg
        width="44"
        height="16"
        viewBox="0 0 44 16"
        fill="none"
        className={`w-8 sm:w-11 h-4 ${isExecuting ? 'animate-pulse' : ''}`}
      >
        <line
          x1="2"
          y1="8"
          x2="42"
          y2="8"
          stroke={strokeColor}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="4 4"
        />
        <circle cx="8" cy="8" r="2.5" fill={isReceipt ? '#10B981' : fromColor} />
        <circle cx="22" cy="8" r="2.5" fill={strokeColor} />
        <circle cx="36" cy="8" r="2.5" fill={isReceipt ? '#10B981' : toColor} />
      </svg>
    </div>
  );
}

function OrbitalNodeButton({
  node,
  index,
  mode,
  isSelected,
  onSelect,
}: {
  node: GroupedServiceNode;
  index: number;
  mode: WorkflowFlowMode;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const showStatusBubble =
    (mode === 'executing' || mode === 'receipt') &&
    (node.status === 'succeeded' || node.status === 'running' || node.status === 'failed');

  return (
    <div className="flex flex-col items-center text-center min-w-[76px] max-w-[116px]">
      <div className="relative">
        <button
          type="button"
          data-testid={`workflow-node-${node.service}`}
          data-service={node.service}
          data-step-count={node.stepCount}
          aria-label={`Nút dịch vụ ${node.label} (${node.stepCount} bước)`}
          aria-expanded={isSelected ? 'true' : 'false'}
          onClick={onSelect}
          className={`w-16 h-16 rounded-full bg-white ring-4 ${node.meta.ringClass} border-2 shadow-sm hover:shadow-md transition-all flex items-center justify-center relative group cursor-pointer focus:v3-outline-none ${
            isSelected ? 'scale-105 ring-[#FF5701]/40 border-[#FF5701]' : 'hover:scale-105'
          } ${mode === 'executing' && node.status === 'running' ? 'animate-pulse' : ''}`}
        >
          <ServiceLogo service={node.service} className="w-7 h-7 transition-transform group-hover:scale-110" />
        </button>

        {/* Top-Right Step Count or Status Bubble (Make.com style) */}
        <span
          data-testid={`node-bubble-${node.service}`}
          data-step-count={node.stepCount}
          data-status-icon={showStatusBubble ? node.status : 'count'}
          className={`absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] px-1 rounded-full text-[11px] font-bold flex items-center justify-center border shadow-xs pointer-events-none ${
            showStatusBubble && node.status === 'succeeded'
              ? 'bg-emerald-600 text-white border-emerald-700'
              : showStatusBubble && node.status === 'running'
                ? 'bg-[#FF5701] text-white border-[#E04D00]'
                : showStatusBubble && node.status === 'failed'
                  ? 'bg-red-600 text-white border-red-700'
                  : 'bg-white text-[#111827] border-[#E7E7E2]'
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
      <div className="mt-2 flex items-center justify-center gap-1 max-w-full">
        {node.status === 'succeeded' && (mode === 'executing' || mode === 'receipt') && (
          <span
            aria-hidden="true"
            className="w-3.5 h-3.5 rounded-full bg-emerald-600 text-white text-[9px] font-bold inline-flex items-center justify-center flex-shrink-0"
          >
            ✓
          </span>
        )}
        <span className="text-xs font-bold text-[#111827] truncate">{node.label}</span>
        <span className="text-[10px] font-mono px-1 py-0.2 rounded border border-[#E7E7E2] bg-[#F8F8F6] text-[#4B5563] flex-shrink-0">
          {index + 1}
        </span>
      </div>
      <span className="text-[11px] text-[#4B5563] line-clamp-1 mt-0.5">{node.actionSummary}</span>
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
  onStepPreview,
  className = '',
}: WorkflowFlowCanvasProps) {
  const [selectedService, setSelectedService] = useState<string | null>(null);

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

  // Automatic Router Fan-Out detection: when 1 source service fans out to >= 2 destination services (>= 3 services total)
  const hasRouterNode = serviceNodes.length >= 3;
  const sourceNode = serviceNodes[0];
  const destinationNodes = serviceNodes.slice(1);
  const inspectedNode = serviceNodes.find((n) => n.service === selectedService) ?? null;

  return (
    <div
      data-testid="workflow-flow-canvas"
      data-flow-mode={mode}
      data-router-node={hasRouterNode ? 'true' : undefined}
      data-auto-digest={mode === 'schedule' ? (isAutoDigest ? 'true' : 'false') : undefined}
      className={`w-full rounded-2xl border border-[#E7E7E2] bg-[#F8F8F6] ${
        compact ? 'p-3 sm:p-4' : 'p-4 sm:p-5'
      } shadow-xs min-w-0 overflow-hidden ${className}`}
    >
      {/* Top Stage Header Pill */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#4B5563]">
          <span
            aria-hidden="true"
            className={`w-2 h-2 rounded-full ${
              mode === 'receipt'
                ? 'bg-emerald-600'
                : mode === 'executing'
                  ? 'bg-[#FF5701] animate-ping'
                  : 'bg-[#FF5701]'
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
        <span className="text-[11px] text-[#6B7280]">
          Bấm vào biểu tượng dịch vụ để xem chi tiết
        </span>
      </div>

      {/* Make.com Orbital Canvas Area */}
      {!hasRouterNode ? (
        <div className="flex flex-wrap items-center justify-center gap-y-4 py-2">
          {serviceNodes.map((node, index) => (
            <div key={node.service} className="flex items-center">
              <OrbitalNodeButton
                node={node}
                index={index}
                mode={mode}
                isSelected={selectedService === node.service}
                onSelect={() =>
                  setSelectedService((prev) => (prev === node.service ? null : node.service))
                }
              />

              {/* Schedule Auto-Digest Central Pill */}
              {mode === 'schedule' && isAutoDigest && index === 0 && serviceNodes.length >= 2 && (
                <>
                  <DottedConnector
                    mode={mode}
                    fromColor={node.meta.strokeHex}
                    toColor="#10B981"
                  />
                  <div
                    data-testid="workflow-auto-digest-node"
                    className="flex flex-col items-center text-center px-1"
                  >
                    <div className="w-12 h-12 rounded-full bg-emerald-600 text-white ring-4 ring-emerald-500/25 flex items-center justify-center shadow-sm">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M13 10V3L4 14h7v7l9-11h-7z"
                        />
                      </svg>
                    </div>
                    <span className="mt-1.5 text-[11px] font-bold text-emerald-800 whitespace-nowrap">
                      Auto-Digest
                    </span>
                    <span className="text-[10px] text-[#4B5563]">Tự gửi an toàn</span>
                  </div>
                </>
              )}

              {index < serviceNodes.length - 1 && (
                <DottedConnector
                  mode={mode}
                  fromColor={
                    mode === 'schedule' && isAutoDigest && index === 0
                      ? '#10B981'
                      : node.meta.strokeHex
                  }
                  toColor={serviceNodes[index + 1].meta.strokeHex}
                />
              )}
            </div>
          ))}
        </div>
      ) : (
        /* Make.com Router Fan-Out Layout: Source -> Green Router -> Curved Dotted Branches -> Destinations */
        <div className="flex flex-col md:flex-row items-center justify-center gap-3 md:gap-2 py-2">
          {/* Source Service Node */}
          <OrbitalNodeButton
            node={sourceNode}
            index={0}
            mode={mode}
            isSelected={selectedService === sourceNode.service}
            onSelect={() =>
              setSelectedService((prev) =>
                prev === sourceNode.service ? null : sourceNode.service
              )
            }
          />

          <DottedConnector
            mode={mode}
            fromColor={sourceNode.meta.strokeHex}
            toColor="#10B981"
          />

          {/* Central Make.com Emerald Router Node */}
          <div className="flex flex-col items-center text-center min-w-[72px]">
            <div
              data-testid="workflow-router-node"
              data-router-node="true"
              className="w-16 h-16 rounded-full bg-emerald-600 text-white ring-4 ring-emerald-500/30 border-2 border-emerald-700 shadow-sm flex items-center justify-center"
            >
              <svg
                className="w-7 h-7"
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
            <div className="mt-2 flex items-center gap-1">
              <span className="text-xs font-bold text-[#111827]">Router</span>
              <span className="text-[10px] font-mono px-1 rounded border border-emerald-200 bg-emerald-50 text-emerald-800">
                {destinationNodes.length} nhánh
              </span>
            </div>
            <span className="text-[11px] text-[#4B5563]">Phân luồng dữ liệu</span>
          </div>

          {/* Fan-Out Branches to Destination Nodes */}
          <div className="flex flex-col gap-3 w-full md:w-auto items-center md:items-start">
            {destinationNodes.map((destNode, branchIdx) => (
              <div key={destNode.service} className="flex items-center justify-center">
                {/* Curved Dotted Branch SVG */}
                <div className="flex flex-col items-center px-1 sm:px-2 flex-shrink-0" aria-hidden="true">
                  <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded-full mb-0.5">
                    {ordinalLabel(branchIdx)}
                  </span>
                  <svg
                    width="52"
                    height="24"
                    viewBox="0 0 52 24"
                    fill="none"
                    className={`w-10 sm:w-13 h-6 ${mode === 'executing' ? 'animate-pulse' : ''}`}
                  >
                    <path
                      d={
                        branchIdx === 0
                          ? 'M 2 18 C 20 18, 28 6, 50 6'
                          : branchIdx === destinationNodes.length - 1
                            ? 'M 2 6 C 20 6, 28 18, 50 18'
                            : 'M 2 12 L 50 12'
                      }
                      stroke={mode === 'receipt' ? '#10B981' : destNode.meta.strokeHex}
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray="4 4"
                    />
                  </svg>
                </div>

                <OrbitalNodeButton
                  node={destNode}
                  index={branchIdx + 1}
                  mode={mode}
                  isSelected={selectedService === destNode.service}
                  onSelect={() =>
                    setSelectedService((prev) =>
                      prev === destNode.service ? null : destNode.service
                    )
                  }
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Interactive Node Inspector Popover */}
      {inspectedNode && (
        <div
          data-testid="workflow-node-inspector"
          role="region"
          aria-label={`Chi tiết nút ${inspectedNode.label}`}
          className="mt-3 p-3.5 sm:p-4 rounded-xl bg-white border border-[#E7E7E2] shadow-sm v3-space-y-2.5"
        >
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#E7E7E2]">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-[#F8F8F6] border border-[#E7E7E2] flex items-center justify-center flex-shrink-0">
                <ServiceLogo service={inspectedNode.service} className="w-4 h-4" />
              </div>
              <span className="text-xs sm:text-sm font-bold text-[#111827] truncate">
                {inspectedNode.label}
              </span>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${inspectedNode.meta.badgeClass}`}>
                {inspectedNode.stepCount} bước
              </span>
            </div>
            <button
              type="button"
              aria-label="Đóng chi tiết nút"
              onClick={() => setSelectedService(null)}
              className="text-xs font-medium text-[#6B7280] hover:text-[#111827] px-2 py-1 rounded-lg hover:bg-[#F8F8F6] transition-colors"
            >
              Đóng ✕
            </button>
          </div>

          <ul className="v3-space-y-2">
            {inspectedNode.steps.map((step, sIdx) => {
              const op = operation(step.tool);
              const scopes = extractScopeBadges(step, resourceLabels);
              return (
                <li
                  key={step.id}
                  className="p-2.5 rounded-lg bg-[#F8F8F6] border border-[#E7E7E2] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="v3-space-y-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white border border-[#E7E7E2] text-[#4B5563]">
                        #{sIdx + 1}
                      </span>
                      <span className="font-semibold text-[#111827] px-2 py-0.5 rounded bg-white border border-[#E7E7E2]">
                        {op.action}
                      </span>
                      {scopes.map((scope) => (
                        <span
                          key={scope}
                          className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200"
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
                      className="flex-shrink-0 px-2.5 py-1 rounded-lg bg-white hover:bg-neutral-100 border border-[#E7E7E2] text-[#111827] text-[11px] font-semibold transition-colors"
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
