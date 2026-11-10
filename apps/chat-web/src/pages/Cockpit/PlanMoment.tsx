// Source: AppStagePage.tsx moment-4. Demo actions replaced with the approved-plan API callbacks.
import { useState, type ReactNode } from 'react';
import type { ActivePlan, PlanStep, ServiceInfo } from '../../types';
import { toolDefinition } from '../../services/tool-definitions';
import { getActiveWorkspaceSummary } from '../../services/workspace-storage';
import { ServiceLogo } from '../../components/ServiceLogo';
import { WorkflowFlowCanvas } from '../../components/WorkflowFlowCanvas';
import { operation, planStepDataFlows, serviceId, servicePalette, serviceName } from './presentation';
import { formatCalendarDateTime, formatRecurrenceLabel } from './PreviewContents';
import { RequestEcho } from './RequestEcho';

function extractSuggestedFreeSlots(warning: string): string[] {
  const hintIndex = warning.indexOf('Gợi ý khung giờ trống');
  const targetText = hintIndex >= 0 ? warning.slice(hintIndex) : '';
  if (!targetText) return [];
  const matches = targetText.match(/\b\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}\b/g);
  return matches ? Array.from(new Set(matches.map((s) => s.replace(/\s+/g, '')))) : [];
}

function cleanPreviewValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const items = value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim());
    return items.length > 0 ? items.join(', ') : null;
  }
  return null;
}

function extractInlinePreviewRows(step: PlanStep): Array<{ label: string; value: string }> {
  if (step.tool === 'myslack.chat_postMessage') return [];
  const service = serviceId(step.tool);
  const rows: Array<{ label: string; value: string }> = [];

  const recipient = cleanPreviewValue(step.args.to);
  if (recipient) {
    rows.push({ label: 'Người nhận', value: recipient });
  }

  const title =
    cleanPreviewValue(step.args.subject) ??
    cleanPreviewValue(step.args.title) ??
    cleanPreviewValue(step.args.name) ??
    cleanPreviewValue(step.args.summary);
  if (title) {
    rows.push({ label: 'Tiêu đề', value: title });
  }

  if ((service === 'mycalendar' || service === 'calendar') && typeof step.args.start === 'string' && step.args.start.trim()) {
    const startText = formatCalendarDateTime(step.args.start, step.args.timeZone);
    const endText =
      typeof step.args.end === 'string' && step.args.end.trim()
        ? formatCalendarDateTime(step.args.end, step.args.timeZone)
        : null;
    rows.push({ label: 'Thời gian', value: endText ? `${startText} → ${endText}` : startText });
  }

  const body =
    cleanPreviewValue(step.args.body) ??
    cleanPreviewValue(step.args.description) ??
    cleanPreviewValue(step.args.desc) ??
    cleanPreviewValue(step.args.content) ??
    cleanPreviewValue(step.args.text);
  if (body) {
    rows.push({ label: 'Nội dung', value: body });
  }

  const labels = cleanPreviewValue(step.args.labels);
  if (labels) {
    rows.push({ label: 'Nhãn', value: labels });
  }

  if (
    rows.length === 1 &&
    rows[0].label === 'Tiêu đề' &&
    step.description.toLocaleLowerCase().includes(rows[0].value.toLocaleLowerCase())
  ) {
    return [];
  }

  return rows.slice(0, 4);
}

export function PlanMoment({
  request,
  runtimeMode,
  plan,
  services,
  destination,
  onPreview,
  onApprove,
  onCancel,
  onEdit,
  inlineComposer,
}: {
  request?: string;
  runtimeMode: 'sandbox' | 'live' | null;
  plan: ActivePlan;
  services: ServiceInfo[];
  destination: (step: PlanStep, labels?: Record<string, string>) => string;
  onPreview: (step: PlanStep) => void;
  onApprove: () => void;
  onCancel: () => void;
  onEdit: (prefillText?: string) => void;
  inlineComposer: ReactNode;
}) {
  const [techOpen, setTechOpen] = useState(false);
  const slackRead = !!plan.connections?.myslack && plan.steps.every((s) => s.tool !== 'myslack.chat_postMessage');
  const slackPost = plan.steps.some((s) => s.tool === 'myslack.chat_postMessage');
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const dataFlows = planStepDataFlows(plan.steps);
  const uniqueServicesCount = new Set(plan.steps.map((step) => serviceId(step.tool))).size;
  const showFlowDiagram = uniqueServicesCount >= 2 || dataFlows.length > 0;
  const isReadOnlyPlan =
    plan.steps.length > 0 && plan.steps.every((step) => toolDefinition(step.tool)?.sideEffect === 'read');
  const isPersonalWorkspace = (getActiveWorkspaceSummary()?.id || 'personal') === 'personal';

  const accountChips: Array<{ key: string; service: string; text: string }> = [];
  if (plan.steps.some((step) => step.tool.startsWith('gmail.')) && plan.connections?.gmail) {
    accountChips.push({
      key: 'gmail',
      service: 'gmail',
      text: `Gửi từ: ${plan.connections.gmail.email}`,
    });
  }
  for (const [svcKey, rawConn] of Object.entries(plan.connections ?? {})) {
    if (!rawConn || svcKey === 'gmail') continue;
    const conn = rawConn as Record<string, unknown>;
    if (svcKey === 'mycalendar' && typeof conn.email === 'string' && conn.email) {
      accountChips.push({
        key: svcKey,
        service: svcKey,
        text: `Tài khoản: ${conn.email} (Google Calendar của bạn)`,
      });
    } else if (svcKey === 'mysheets' && typeof conn.email === 'string' && conn.email) {
      accountChips.push({
        key: svcKey,
        service: svcKey,
        text: `Tài khoản: ${conn.email} (Google Sheets của bạn)`,
      });
    } else if (svcKey === 'myslack' && conn.bindings && typeof conn.bindings === 'object') {
      for (const binding of Object.values(
        conn.bindings as Record<string, { connectionId: string; workspaceId: string; slackUserId: string }>,
      )) {
        accountChips.push({
          key: `${svcKey}-${binding.connectionId}`,
          service: svcKey,
          text: `Workspace: ${plan.resourceLabels?.[binding.connectionId] ?? `${binding.workspaceId} · ${binding.slackUserId}`}`,
        });
      }
    } else if (typeof conn.workspaceName === 'string' && conn.workspaceName) {
      accountChips.push({
        key: svcKey,
        service: svcKey,
        text: `Workspace Notion: ${conn.workspaceName}`,
      });
    } else if (typeof conn.login === 'string' && conn.login) {
      accountChips.push({
        key: svcKey,
        service: svcKey,
        text: `Tài khoản: @${conn.login} (GitHub của bạn)`,
      });
    } else if (typeof conn.username === 'string' && conn.username) {
      const displayLabel = serviceName(svcKey, services);
      accountChips.push({
        key: svcKey,
        service: svcKey,
        text: `Tài khoản: @${conn.username} (${displayLabel} của bạn)`,
      });
    } else if (typeof conn.atlassianAccountId === 'string' && typeof conn.workspaceId === 'string') {
      accountChips.push({
        key: svcKey,
        service: svcKey,
        text: `Tài khoản Atlassian: ${conn.atlassianAccountId} · Workspace: ${conn.workspaceId}`,
      });
    }
  }

  const safetyTitle = slackPost
    ? 'Gửi nguyên văn bằng tài khoản Slack của bạn sau khi duyệt. Nếu chưa rõ kết quả, hãy đối soát trước khi tạo lần gửi khác.'
    : slackRead
      ? 'Chỉ đọc Slack sau khi duyệt. Kết quả được lưu tối đa 1 ngày và có thể bị ẩn khi quyền hoặc nguồn thay đổi.'
      : runtimeMode === 'sandbox'
        ? 'Các thao tác này chỉ chạy trong chế độ thử nghiệm, không ghi lên công cụ thật.'
        : runtimeMode === 'live'
          ? isReadOnlyPlan
            ? 'Kế hoạch chỉ tra cứu dữ liệu, không tạo hay sửa nội dung trên công cụ của bạn.'
            : isPersonalWorkspace
              ? 'Các thao tác này ghi thật vào công cụ bạn đã kết nối và không tự hoàn tác.'
              : 'Các thao tác này ghi thật vào công cụ của không gian làm việc và không tự hoàn tác.'
          : 'Hãy kiểm tra chế độ máy chủ trước khi duyệt các thao tác ghi.';

  const isSafeTone = runtimeMode === 'sandbox' || slackRead || (runtimeMode === 'live' && isReadOnlyPlan && !slackPost);

  return (
    <section
      id="moment-4"
      className="stage-section is-active max-w-3xl mx-auto w-full pt-2 sm:pt-3 relative"
      aria-label="Cockpit"
      data-moment="4"
      aria-labelledby="heading-moment-4"
    >
      <div className="bg-white rounded-2xl border border-[#E5E5E0] shadow-2xs">
        {/* Top Workflow Stepper Bar */}
        <div className="px-5 sm:px-6 py-3 bg-[#F8F8F6] border-b border-[#EAEAE4] rounded-t-2xl flex items-center justify-between gap-3 flex-wrap">
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
            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium hidden md:inline-flex">
              <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
              </svg>
              <span>2. Chuẩn bị</span>
            </span>
            <span className="text-[#9CA3AF] hidden md:inline" aria-hidden="true">
              →
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-[#DEDED8] font-semibold text-[#111827] shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-[#FF5701]" aria-hidden="true" />
              <span>3. Xem trước & duyệt kế hoạch</span>
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white border border-[#E5E5E0] text-[#4B5563] font-medium">
              <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span>Chưa thực thi</span>
            </span>
            <span className="text-[#6B7280] font-medium hidden sm:inline">Bước 3 / 3</span>
          </div>
        </div>

        {/* Plan Header & Connected Account Attribution */}
        <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-[#F1F1EC] v3-space-y-2.5">
          <RequestEcho request={request} />
          <div>
            <h1
              id="heading-moment-4"
              className="text-xl sm:text-2xl font-semibold text-[#111827] tracking-tight leading-snug"
              tabIndex={-1}
            >
              {plan.steps.length === 1
                ? 'Tôi sẽ làm 1 việc'
                : `Tôi sẽ làm ${plan.steps.length} việc, theo thứ tự`}
            </h1>
            <p className="text-sm text-[#4B5563] mt-1 leading-relaxed">
              {slackRead
                ? 'Xem workspace và phạm vi tra cứu trước khi duyệt.'
                : plan.steps.length === 1
                  ? 'Kiểm tra đích đến và nội dung chi tiết bên dưới trước khi bấm duyệt.'
                  : 'Kiểm tra thứ tự các bước và nội dung sẽ được ghi vào từng công cụ trước khi duyệt.'}
            </p>
          </div>

          {accountChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {accountChips.map((chip) => (
                <div
                  key={chip.key}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#F8F8F6] border border-[#E5E5E0] max-w-full"
                >
                  <ServiceLogo service={chip.service} className="w-3.5 h-3.5 flex-shrink-0" />
                  <p className="text-xs font-medium text-[#374151] [overflow-wrap:anywhere]">{chip.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Plan Review Body */}
        <div className="px-5 sm:px-6 py-5 v3-space-y-4 bg-white">
          {plan.reportEvidence && (
            <div
              data-testid="verified-report-evidence-badge"
              className="flex items-center gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs font-medium"
            >
              <svg className="w-4 h-4 text-emerald-700 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span>
                <strong>Báo cáo có nguồn dữ liệu xác minh:</strong> {plan.reportEvidence.sourceLabel} ·{' '}
                {plan.reportEvidence.itemCount} mục ({plan.reportEvidence.coverage === 'complete' ? 'đầy đủ' : 'một phần'}) · Đọc lúc{' '}
                {plan.reportEvidence.readAt}
              </span>
            </div>
          )}

          {plan.steps.some((s) => s.tool === 'mysheets.create_doc') &&
            plan.steps.some(
              (s) =>
                s.tool === 'gmail.send_message' ||
                s.tool === 'mycalendar.schedule_meet' ||
                s.tool === 'mycalendar.create_event',
            ) && (
              <div
                data-testid="google-docs-sharing-notice"
                className="flex items-start gap-2.5 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs leading-relaxed"
              >
                <svg className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <div>
                  <strong>Lưu ý quyền truy cập Google Docs (drive.file):</strong> Planora chỉ tạo tài liệu trong phạm vi tệp của bạn và không tự động mở quyền xem cho người nhận email. Trước hoặc sau khi gửi, hãy kiểm tra mục <em>Chia sẻ (Share)</em> trên Google Docs để cấp quyền đọc cho người nhận.
                </div>
              </div>
            )}

          {showFlowDiagram && (
            <WorkflowFlowCanvas
              steps={plan.steps}
              mode="preview"
              resourceLabels={plan.resourceLabels}
              selectedService={selectedService}
              onSelectService={setSelectedService}
              onStepPreview={onPreview}
            />
          )}

          {/* Task Action Cards */}
          <div className="v3-space-y-3" id="plan-cards-container" role="list" aria-label="Các bước thực thi">
            {plan.steps.map((step, index) => {
              const service = serviceId(step.tool);
              const palette = servicePalette(service);
              const isHighlighted = selectedService === service;
              const incomingFlows = dataFlows.filter((edge) => edge.toStepId === step.id);
              const previewRows = extractInlinePreviewRows(step);

              return (
                <article
                  key={step.id}
                  data-highlighted-step={isHighlighted ? 'true' : undefined}
                  className={`plan-card-stagger-${Math.min(index + 1, 4)} bg-white rounded-xl border ${
                    isHighlighted
                      ? 'border-brand-primary ring-2 ring-brand-primary/20'
                      : 'border-[#E5E5E0] hover:border-[#D4D4CE]'
                  } p-4 transition-all`}
                  data-od-id={`plan-item-${index + 1}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3.5 min-w-0 flex-1">
                      <div className="w-9 h-9 rounded-xl bg-[#F8F8F6] border border-[#E5E5E0] text-[#111827] flex items-center justify-center flex-shrink-0 mt-0.5">
                        <ServiceLogo service={service} className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs font-semibold px-2 py-0.5 ${palette.badge} rounded-md`}>
                            {serviceName(service, services)}
                          </span>
                          <span className="text-xs font-medium px-2 py-0.5 bg-[#F4F4F1] text-[#374151] rounded-md">
                            {operation(step.tool).action}
                          </span>
                          <span className="text-xs text-[#6B7280] font-medium">Việc {index + 1}</span>
                          {incomingFlows.map((edge) => (
                            <span
                              key={`${edge.fromStepId}-${edge.field}`}
                              data-testid="plan-step-data-flow-badge"
                              className="text-[11px] font-semibold px-2 py-0.5 bg-[#FFF6EE] text-[#B43E00] border border-[#F5D0B5] rounded-full"
                            >
                              Dữ liệu từ Việc {edge.fromIndex} → Việc {edge.toIndex} ({edge.field})
                            </span>
                          ))}
                        </div>
                        <h2 className="text-[15px] sm:text-base font-semibold text-[#111827] mt-1.5 leading-snug">
                          {step.tool === 'mysheets.read_range'
                            ? `Đọc từ bảng tính của bạn: ${plan.resourceLabels?.[String(step.args.spreadsheetId)] ?? step.description}`
                            : step.description}
                        </h2>
                        <p className="text-xs text-[#6B7280] mt-1 break-words">
                          Đích đến: {destination(step, plan.resourceLabels)}
                        </p>
                        {service === 'myjira' &&
                          plan.connections?.myjira?.siteSteps?.[step.id] &&
                          (() => {
                            const siteStep = plan.connections!.myjira!.siteSteps[step.id];
                            const siteLabel =
                              plan.resourceLabels?.[siteStep.siteId] ??
                              plan.resourceLabels?.[`jira_site:${siteStep.siteId}`] ??
                              siteStep.siteId;
                            const projectLabel =
                              (typeof step.args.projectKey === 'string' && step.args.projectKey) ||
                              (siteStep.projectId
                                ? (plan.resourceLabels?.[siteStep.projectId] ??
                                  plan.resourceLabels?.[`jira_project:${siteStep.projectId}`] ??
                                  siteStep.projectId)
                                : undefined);
                            return (
                              <p className="text-xs text-[#6B7280] mt-1 break-words">
                                Site đích: {siteLabel}
                                {projectLabel ? ` · Dự án: ${projectLabel}` : ''}
                              </p>
                            );
                          })()}

                        {previewRows.length > 0 && (
                          <dl
                            data-testid="step-inline-payload"
                            className="mt-3 px-3.5 py-2.5 rounded-xl bg-[#F8F8F6] border border-[#EAEAE4] v3-space-y-1.5 text-xs"
                          >
                            {previewRows.map((row) => (
                              <div key={row.label} className="grid grid-cols-1 sm:grid-cols-[84px_1fr] gap-0.5 sm:gap-2">
                                <dt className="font-medium text-[#6B7280]">{row.label}</dt>
                                <dd className="text-[#111827] font-medium line-clamp-2 whitespace-pre-wrap break-words">
                                  {row.value}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )}

                        {step.tool === 'myslack.chat_postMessage' && (
                          <div className="mt-3 px-3.5 py-2.5 rounded-xl bg-[#F8F8F6] border border-[#EAEAE4] whitespace-pre-wrap break-words text-xs sm:text-sm text-[#111827]">
                            <span className="font-semibold text-[#6B7280] block text-xs mb-0.5">Nội dung gửi:</span>
                            <p>{String(step.args.text)}</p>
                          </div>
                        )}

                        {(service === 'mycalendar' || service === 'calendar') &&
                          (() => {
                            const hasMeet = step.tool === 'mycalendar.schedule_meet' || step.args.createMeetLink === true;
                            const attendees = Array.isArray(step.args.attendees)
                              ? step.args.attendees.filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
                              : [];
                            const notifyExisting = step.tool.endsWith('.update_event') && step.args.sendInvites === true;
                            const sendInvites = (attendees.length > 0 || notifyExisting) && step.args.sendInvites === true;
                            const suppressInvites = attendees.length > 0 && step.args.sendInvites !== true;
                            const recurrence = formatRecurrenceLabel(step.args.recurrence);
                            const timeZone =
                              typeof step.args.timeZone === 'string' && step.args.timeZone.trim().length > 0
                                ? step.args.timeZone.trim()
                                : null;
                            const loc =
                              typeof step.args.location === 'string' && step.args.location.trim().length > 0
                                ? step.args.location.trim()
                                : null;
                            if (!hasMeet && attendees.length === 0 && !recurrence && !timeZone && !loc && !notifyExisting) return null;
                            return (
                              <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                                {hasMeet && (
                                  <span className="text-[11px] font-semibold px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full">
                                    🎥 Google Meet
                                  </span>
                                )}
                                {attendees.length > 0 && (
                                  <span className="text-[11px] font-semibold px-2 py-0.5 bg-blue-50 text-blue-800 border border-blue-200 rounded-full">
                                    👥 {attendees.length} khách mời
                                  </span>
                                )}
                                {sendInvites && (
                                  <span className="text-[11px] font-medium px-2 py-0.5 bg-sky-50 text-sky-800 border border-sky-200 rounded-full">
                                    {notifyExisting ? '📨 Gửi thông báo cập nhật cho khách mời hiện có và danh sách khách mời sau thay đổi' : '📨 Gửi email mời họp'}
                                  </span>
                                )}
                                {suppressInvites && (
                                  <span className="text-[11px] font-medium px-2 py-0.5 bg-neutral-100 text-neutral-700 border border-neutral-200 rounded-full">
                                    🔕 Không gửi email mời họp
                                  </span>
                                )}
                                {recurrence && (
                                  <span className="text-[11px] font-semibold px-2 py-0.5 bg-indigo-50 text-indigo-800 border border-indigo-200 rounded-full">
                                    🔁 {recurrence}
                                  </span>
                                )}
                                {timeZone && (
                                  <span className="text-[11px] font-medium px-2 py-0.5 bg-neutral-100 text-neutral-700 border border-neutral-200 rounded-full">
                                    🌐 Múi giờ: {timeZone}
                                  </span>
                                )}
                                {loc && (
                                  <span className="text-[11px] font-medium px-2 py-0.5 bg-amber-50 text-amber-900 border border-amber-200 rounded-full">
                                    📍 {loc}
                                  </span>
                                )}
                              </div>
                            );
                          })()}

                        {service === 'mysheets' &&
                          (() => {
                            const isDocCreate = step.tool === 'mysheets.create_doc';
                            const isDocAppend = step.tool === 'mysheets.append_doc_text';
                            const isDocRead = step.tool === 'mysheets.get_doc';
                            const isFolderCreate = step.tool === 'mysheets.create_drive_folder';
                            const isDriveMove = step.tool === 'mysheets.move_drive_file';
                            const isDriveList = step.tool === 'mysheets.list_drive_files';
                            if (
                              !isDocCreate &&
                              !isDocAppend &&
                              !isDocRead &&
                              !isFolderCreate &&
                              !isDriveMove &&
                              !isDriveList
                            ) {
                              return null;
                            }
                            const hasFolderTarget = Boolean(step.args.folderId || step.args.parentFolderId);
                            const mimeLabel =
                              step.args.mimeType === 'document'
                                ? 'Google Docs'
                                : step.args.mimeType === 'spreadsheet'
                                  ? 'Google Sheets'
                                  : step.args.mimeType === 'folder'
                                    ? 'Thư mục'
                                    : 'Tất cả tệp';
                            return (
                              <div data-testid="google-workspace-step-pills" className="flex flex-wrap items-center gap-1.5 mt-2.5">
                                {isDocCreate && (
                                  <span className="text-[11px] font-semibold px-2 py-0.5 bg-blue-50 text-blue-800 border border-blue-200 rounded-full">
                                    📝 Tài liệu Google Docs
                                  </span>
                                )}
                                {isDocAppend && (
                                  <span className="text-[11px] font-semibold px-2 py-0.5 bg-blue-50 text-blue-800 border border-blue-200 rounded-full">
                                    ✏️ Nối văn bản Google Docs
                                  </span>
                                )}
                                {isDocRead && (
                                  <span className="text-[11px] font-semibold px-2 py-0.5 bg-blue-50 text-blue-800 border border-blue-200 rounded-full">
                                    📖 Đọc tài liệu Google Docs
                                  </span>
                                )}
                                {isFolderCreate && (
                                  <span className="text-[11px] font-semibold px-2 py-0.5 bg-amber-50 text-amber-900 border border-amber-200 rounded-full">
                                    📁 Thư mục Google Drive mới
                                  </span>
                                )}
                                {isDriveMove && (
                                  <span className="text-[11px] font-semibold px-2 py-0.5 bg-amber-50 text-amber-900 border border-amber-200 rounded-full">
                                    📦 Di chuyển vào thư mục Drive
                                  </span>
                                )}
                                {isDriveList && (
                                  <span className="text-[11px] font-medium px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full">
                                    🔎 Tìm tệp Drive ({mimeLabel})
                                  </span>
                                )}
                                {hasFolderTarget && !isDriveMove && (
                                  <span className="text-[11px] font-medium px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-full">
                                    📁 Lưu vào thư mục Drive
                                  </span>
                                )}
                              </div>
                            );
                          })()}

                        {step.tool.endsWith('.list_pull_requests') && (
                          <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                            <span className="text-[11px] font-semibold px-2 py-0.5 bg-purple-50 text-purple-800 border border-purple-200 rounded-full">
                              🔀 Pull Requests ({typeof step.args.state === 'string' ? step.args.state : 'open'})
                            </span>
                            {typeof step.args.query === 'string' && step.args.query.trim().length > 0 && (
                              <span className="text-[11px] font-medium px-2 py-0.5 bg-neutral-100 text-neutral-700 border border-neutral-200 rounded-full">
                                🔍 “{step.args.query.trim()}”
                              </span>
                            )}
                          </div>
                        )}

                        {step.tool.endsWith('.read_messages') && (
                          <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                            <span className="text-[11px] font-semibold px-2 py-0.5 bg-fuchsia-50 text-fuchsia-800 border border-fuchsia-200 rounded-full">
                              💬 Đọc {typeof step.args.limit === 'number' ? step.args.limit : 10} tin nhắn gần nhất
                            </span>
                          </div>
                        )}

                        {service === 'notion' &&
                          (() => {
                            const rawProps =
                              step.args.properties &&
                              typeof step.args.properties === 'object' &&
                              !Array.isArray(step.args.properties)
                                ? (step.args.properties as Record<string, unknown>)
                                : null;
                            const propKeys = rawProps ? Object.keys(rawProps) : [];
                            const statusEntry = rawProps
                              ? Object.entries(rawProps).find(([k]) => /^(status|trạng thái|stage|tình trạng)$/i.test(k.trim()))
                              : undefined;
                            const filterStatus =
                              typeof step.args.status === 'string' && step.args.status.trim() ? step.args.status.trim() : null;
                            const statusText = statusEntry && typeof statusEntry[1] === 'string' ? statusEntry[1] : filterStatus;
                            const hasContent =
                              (typeof step.args.content === 'string' && step.args.content.trim().length > 0) ||
                              (typeof step.args.text === 'string' && step.args.text.trim().length > 0);
                            const isArchived = step.args.archived === true;
                            if (!statusText && propKeys.length === 0 && !hasContent && !isArchived) return null;
                            return (
                              <div data-testid="notion-step-pills" className="flex flex-wrap items-center gap-1.5 mt-2.5">
                                {statusText && (
                                  <span className="text-[11px] font-semibold px-2 py-0.5 bg-sky-50 text-sky-800 border border-sky-200 rounded-full">
                                    🏷️ {statusText}
                                  </span>
                                )}
                                {propKeys.length > 0 && (
                                  <span className="text-[11px] font-medium px-2 py-0.5 bg-neutral-100 text-neutral-700 border border-neutral-200 rounded-full">
                                    📋 {propKeys.length} thuộc tính
                                  </span>
                                )}
                                {hasContent && (
                                  <span className="text-[11px] font-medium px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full">
                                    📝 Có nội dung văn bản
                                  </span>
                                )}
                                {isArchived && (
                                  <span className="text-[11px] font-semibold px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-full">
                                    📦 Lưu trữ trang
                                  </span>
                                )}
                              </div>
                            );
                          })()}

                        {service === 'trello' &&
                          (() => {
                            const rawMembers = Array.isArray(step.args.idMembers)
                              ? step.args.idMembers.filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
                              : typeof step.args.memberId === 'string' && step.args.memberId.trim().length > 0
                                ? [step.args.memberId.trim()]
                                : [];
                            const checklistItems = Array.isArray(step.args.items)
                              ? step.args.items.filter((it): it is string => typeof it === 'string' && it.trim().length > 0)
                              : [];
                            const hasDue = typeof step.args.due === 'string' && step.args.due.trim().length > 0;
                            const dueComplete = typeof step.args.dueComplete === 'boolean' ? step.args.dueComplete : null;
                            const isClosed = step.args.closed === true;
                            const chkState =
                              step.tool === 'trello.update_checklist_item' &&
                              (step.args.state === 'complete' || step.args.state === 'incomplete')
                                ? step.args.state
                                : null;
                            const isComment =
                              step.tool === 'trello.add_comment' &&
                              typeof step.args.text === 'string' &&
                              step.args.text.trim().length > 0;
                            if (
                              rawMembers.length === 0 &&
                              checklistItems.length === 0 &&
                              !hasDue &&
                              dueComplete === null &&
                              !isClosed &&
                              !chkState &&
                              !isComment
                            ) {
                              return null;
                            }
                            return (
                              <div data-testid="trello-step-pills" className="flex flex-wrap items-center gap-1.5 mt-2.5">
                                {rawMembers.length > 0 && (
                                  <span className="text-[11px] font-medium px-2 py-0.5 bg-blue-50 text-blue-800 border border-blue-200 rounded-full">
                                    👤 {rawMembers.length} thành viên
                                  </span>
                                )}
                                {hasDue && (
                                  <span className="text-[11px] font-medium px-2 py-0.5 bg-amber-50 text-amber-900 border border-amber-200 rounded-full">
                                    📅 Hạn: {formatCalendarDateTime(step.args.due)}
                                  </span>
                                )}
                                {dueComplete !== null && (
                                  <span
                                    className={`text-[11px] font-semibold px-2 py-0.5 border rounded-full ${
                                      dueComplete
                                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                        : 'bg-neutral-100 text-neutral-700 border-neutral-200'
                                    }`}
                                  >
                                    {dueComplete ? '✓ Hoàn thành hạn' : '⏳ Chưa hoàn thành hạn'}
                                  </span>
                                )}
                                {checklistItems.length > 0 && (
                                  <span className="text-[11px] font-medium px-2 py-0.5 bg-sky-50 text-sky-800 border border-sky-200 rounded-full">
                                    ☑️ {checklistItems.length} mục checklist
                                  </span>
                                )}
                                {chkState && (
                                  <span
                                    className={`text-[11px] font-semibold px-2 py-0.5 border rounded-full ${
                                      chkState === 'complete'
                                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                        : 'bg-amber-50 text-amber-800 border-amber-200'
                                    }`}
                                  >
                                    {chkState === 'complete' ? '☑ Đã hoàn thành' : '☐ Chưa xong'}
                                  </span>
                                )}
                                {isComment && (
                                  <span className="text-[11px] font-medium px-2 py-0.5 bg-neutral-100 text-neutral-700 border border-neutral-200 rounded-full">
                                    💬 Có bình luận
                                  </span>
                                )}
                                {isClosed && (
                                  <span className="text-[11px] font-semibold px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-full">
                                    📦 Lưu trữ thẻ
                                  </span>
                                )}
                              </div>
                            );
                          })()}

                        {service === 'myjira' &&
                          (() => {
                            const issueKey =
                              typeof step.args.issueKey === 'string' && step.args.issueKey.trim()
                                ? step.args.issueKey.trim()
                                : null;
                            const targetStatus =
                              typeof step.args.targetStatus === 'string' && step.args.targetStatus.trim()
                                ? step.args.targetStatus.trim()
                                : null;
                            const priority =
                              typeof step.args.priority === 'string' && step.args.priority.trim()
                                ? step.args.priority.trim()
                                : null;
                            const issueType =
                              typeof step.args.issueType === 'string' && step.args.issueType.trim()
                                ? step.args.issueType.trim()
                                : null;
                            const assigneeId =
                              typeof step.args.assigneeAccountId === 'string' && step.args.assigneeAccountId.trim()
                                ? step.args.assigneeAccountId.trim()
                                : null;
                            const assigneeLabel = assigneeId ? (plan.resourceLabels?.[assigneeId] ?? assigneeId) : null;
                            const dueDate =
                              typeof step.args.dueDate === 'string' && step.args.dueDate.trim()
                                ? step.args.dueDate.trim()
                                : null;
                            const parentKey =
                              typeof step.args.parentKey === 'string' && step.args.parentKey.trim()
                                ? step.args.parentKey.trim()
                                : null;
                            const filterStatus =
                              typeof step.args.status === 'string' && step.args.status.trim()
                                ? step.args.status.trim()
                                : null;
                            if (
                              !issueKey &&
                              !targetStatus &&
                              !priority &&
                              !issueType &&
                              !assigneeLabel &&
                              !dueDate &&
                              !parentKey &&
                              !filterStatus
                            ) {
                              return null;
                            }
                            return (
                              <div data-testid="myjira-step-pills" className="flex flex-wrap items-center gap-1.5 mt-2.5">
                                {issueKey && (
                                  <span className="text-[11px] font-semibold px-2 py-0.5 bg-blue-50 text-[#0052CC] border border-blue-200 rounded-full">
                                    🎫 {issueKey}
                                  </span>
                                )}
                                {targetStatus && (
                                  <span className="text-[11px] font-semibold px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full">
                                    🔄 → {targetStatus}
                                  </span>
                                )}
                                {priority && (
                                  <span className="text-[11px] font-semibold px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-full">
                                    ⚡ Ưu tiên: {priority}
                                  </span>
                                )}
                                {issueType && (
                                  <span className="text-[11px] font-medium px-2 py-0.5 bg-sky-50 text-sky-800 border border-sky-200 rounded-full">
                                    🏷️ {issueType}
                                  </span>
                                )}
                                {assigneeLabel && (
                                  <span className="text-[11px] font-medium px-2 py-0.5 bg-indigo-50 text-indigo-800 border border-indigo-200 rounded-full">
                                    👤 Phụ trách: {assigneeLabel}
                                  </span>
                                )}
                                {dueDate && (
                                  <span className="text-[11px] font-medium px-2 py-0.5 bg-amber-50 text-amber-900 border border-amber-200 rounded-full">
                                    📅 Hạn: {dueDate}
                                  </span>
                                )}
                                {parentKey && (
                                  <span className="text-[11px] font-medium px-2 py-0.5 bg-purple-50 text-purple-800 border border-purple-200 rounded-full">
                                    🔗 Epic: {parentKey}
                                  </span>
                                )}
                                {filterStatus && (
                                  <span className="text-[11px] font-medium px-2 py-0.5 bg-neutral-100 text-neutral-700 border border-neutral-200 rounded-full">
                                    🔍 Trạng thái: {filterStatus}
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                      </div>
                    </div>

                    <button
                      id={`preview-${step.id}`}
                      type="button"
                      onClick={() => onPreview(step)}
                      className="flex-shrink-0 px-3 py-1.5 bg-white hover:bg-[#F8F8F6] border border-[#DEDED8] text-[#111827] text-xs font-medium rounded-lg shadow-2xs transition-colors inline-flex items-center gap-1.5"
                      aria-label="Xem trước"
                    >
                      <svg className="w-3.5 h-3.5 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                      <span>Xem trước</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {plan.warnings && plan.warnings.length > 0 && (
            <div
              data-testid="plan-warnings-callout"
              className="p-3.5 rounded-xl bg-amber-50/90 border border-amber-200 v3-space-y-2"
            >
              <div className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
                <svg aria-hidden="true" className="w-4 h-4 text-amber-700 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>Lưu ý kiểm tra trước khi thực thi</span>
              </div>
              {plan.warnings.map((warning, index) => {
                const freeSlots = extractSuggestedFreeSlots(warning);
                if (warning.includes('trùng giờ') || freeSlots.length > 0) {
                  return (
                    <div
                      key={index}
                      data-testid="calendar-conflict-banner"
                      className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 v3-space-y-2.5"
                    >
                      <p className="text-xs font-medium text-brand-danger leading-relaxed">{warning}</p>
                      {freeSlots.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-semibold text-rose-800">Đổi nhanh khung giờ trống:</span>
                          {freeSlots.map((slot) => (
                            <button
                              key={slot}
                              type="button"
                              onClick={() => onEdit(`Đổi khung giờ họp sang ${slot}`)}
                              className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white hover:bg-rose-100 text-rose-800 border border-rose-300 shadow-2xs transition-colors"
                            >
                              Đổi sang {slot}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }
                return (
                  <p key={index} className="text-xs text-brand-danger font-medium leading-relaxed">
                    {warning}
                  </p>
                );
              })}
            </div>
          )}

          {!plan.id && <p role="alert">Kế hoạch thiếu mã định danh hợp lệ. Hãy tải lại hội thoại trước khi duyệt.</p>}

          {techOpen && (
            <div
              id="tech-details-panel"
              className="p-4 rounded-xl bg-neutral-900 text-neutral-200 font-mono text-xs v3-space-y-3 border border-neutral-800"
            >
              <pre className="whitespace-pre-wrap break-all">
                {JSON.stringify(slackRead ? { summary: plan.summary, steps: plan.steps } : plan, null, 2)}
              </pre>
            </div>
          )}

          {/* Safety & Expiry Notice (in normal document flow so sticky bar stays slim) */}
          <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl bg-[#F8F8F6] border border-[#EAEAE4]">
            {isSafeTone ? (
              <svg
                aria-hidden="true"
                className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
            ) : (
              <svg
                aria-hidden="true"
                className="w-4 h-4 text-[#B45309] flex-shrink-0 mt-0.5"
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
            )}
            <div className="text-xs leading-relaxed text-[#4B5563]">
              <span className="font-semibold text-[#111827]">{safetyTitle}</span>{' '}
              <span>Kế hoạch giữ hiệu lực trong 30 phút — bạn có thể sửa qua chat hoặc bấm duyệt để chạy ngay.</span>
            </div>
          </div>
        </div>

        {/* Slim Opaque Sticky Approval Footer */}
        <div
          id="moment-4-sticky-bar"
          className="sticky bottom-0 z-30 px-5 sm:px-6 py-3.5 bg-[#F8F8F6] border-t border-[#EAEAE4] rounded-b-2xl"
        >
          {inlineComposer}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap w-full sm:w-auto">
              <button
                id="btn-approve-plan"
                type="button"
                aria-label="Duyệt kế hoạch"
                disabled={!plan.id}
                onClick={onApprove}
                className="w-full sm:w-auto px-5 py-2.5 bg-[#C84300] hover:bg-[#B03B00] disabled:opacity-50 text-white text-sm font-semibold rounded-xl shadow-2xs transition-colors flex items-center justify-center gap-2 flex-shrink-0"
              >
                <span>Duyệt kế hoạch</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                </svg>
              </button>
              <button
                id="btn-edit-plan"
                type="button"
                onClick={() => onEdit()}
                className="px-3.5 py-2.5 bg-white hover:bg-neutral-50 border border-[#DEDED8] text-[#111827] text-xs sm:text-sm font-medium rounded-xl shadow-2xs transition-colors flex items-center justify-center gap-1.5 flex-shrink-0"
              >
                <svg className="w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
                <span>Sửa qua Chat</span>
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="px-3 py-2.5 text-xs sm:text-sm font-medium text-[#6B7280] hover:text-[#DC2626] hover:bg-red-50/60 rounded-xl transition-colors flex-shrink-0"
              >
                Hủy
              </button>
            </div>
            <div>
              <button
                type="button"
                onClick={() => setTechOpen(!techOpen)}
                aria-controls="tech-details-panel"
                className="text-xs text-[#6B7280] hover:text-[#111827] font-mono inline-flex items-center gap-1.5 py-1.5 px-2.5 rounded-lg hover:bg-white/80 transition-colors"
                aria-expanded={techOpen ? 'true' : 'false'}
                id="btn-tech-toggle"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                <span>Chi tiết kỹ thuật</span>
                <span id="tech-toggle-arrow" className="inline-flex items-center">
                  <svg
                    className={`w-3.5 h-3.5 transition-transform ${techOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
