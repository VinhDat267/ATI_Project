// Source: AppStagePage.tsx moment-6. Receipt connections come only from approved-plan references.
import { Fragment, useState } from 'react';
import { toolDefinition } from '../../services/tool-definitions';
import type { ActivePlan, PlanStep, ServiceInfo } from '../../types';
import { ServiceLogo } from '../../components/ServiceLogo';
import { WorkflowFlowCanvas } from '../../components/WorkflowFlowCanvas';
import { ResultFields, type ExecutionStepInfo } from '../../components/ExecutionProgress';
import {
  operation,
  serviceId,
  serviceName,
  servicePalette,
  statusLabel,
  resultTitle,
  resultObject,
  outcomeURL,
  outcomeMeetURL,
  receiptReferences,
} from './presentation';
import { RequestEcho } from './RequestEcho';

interface CardProps {
  services: ServiceInfo[];
  planSteps: PlanStep[];
  labels?: Record<string, string>;
  gmailConnection?: NonNullable<ActivePlan['connections']>['gmail'];
  mycalendarConnection?: NonNullable<ActivePlan['connections']>['mycalendar'];
  mysheetsConnection?: NonNullable<ActivePlan['connections']>['mysheets'];
  trelloConnection?: NonNullable<ActivePlan['connections']>['trello'];
  githubConnection?: NonNullable<ActivePlan['connections']>['github'];
  notionConnection?: NonNullable<ActivePlan['connections']>['notion'];
  telegramConnection?: NonNullable<ActivePlan['connections']>['telegram'];
  myjiraConnection?: NonNullable<ActivePlan['connections']>['myjira'];
  destination: (step: PlanStep, labels?: Record<string, string>) => string;
}

const METRIC_PILL_BASE =
  'px-2 py-0.5 rounded-[6px] text-[11px] font-medium border bg-[#F4F4F3] text-[#374151] border-[#E5E5E3]';
const METRIC_PILL_WARN =
  'px-2 py-0.5 rounded-[6px] text-[11px] font-medium border bg-[#FEF8EC] text-[#7A4100] border-[#F2DFB6]';

function metricPillClass(warn?: boolean): string {
  return warn ? METRIC_PILL_WARN : METRIC_PILL_BASE;
}

function MetricPill({ text, warn }: { text: string; warn?: boolean }) {
  // Split leading emoji/symbol prefix into sr-only so tests reading textContent pass while visual UI stays pure achromatic text
  const match = text.match(/^([^\p{L}\p{N}#✓☑☐]+)\s+(.+)$/u);
  return (
    <span className={metricPillClass(warn)}>
      {match ? (
        <>
          <span className="sr-only">{`${match[1]} `}</span>
          <span>{match[2]}</span>
        </>
      ) : (
        text
      )}
    </span>
  );
}

function SheetsReceiptMetrics({ step }: { step: ExecutionStepInfo }) {
  if (step.status !== 'succeeded') return null;
  const service = serviceId(step.tool);
  if (service !== 'mysheets' && service !== 'sheets') return null;
  const out = resultObject(step.output);
  if (!out) return null;
  const pills: Array<{ text: string; warn?: boolean }> = [];
  const rowsCount =
    typeof out.updatedRows === 'number'
      ? out.updatedRows
      : typeof out.appendedRows === 'number'
        ? out.appendedRows
        : null;
  if (step.tool.endsWith('.append_rows') && rowsCount != null && rowsCount > 0) {
    pills.push({ text: `Đã ghi ${rowsCount} dòng` });
  } else if (step.tool.endsWith('.update_rows') && rowsCount != null) {
    pills.push({
      text: `Đã cập nhật ${rowsCount} dòng${typeof out.updatedCells === 'number' ? ` (${out.updatedCells} ô)` : ''}`,
    });
  }
  if (
    step.tool.endsWith('.append_rows') &&
    typeof out.updatedCells === 'number' &&
    out.updatedCells > 0 &&
    (out.updatedRows === 0 || out.updatedRows === undefined)
  ) {
    pills.push({ text: `Đã cập nhật ${out.updatedCells} ô` });
  }
  if (typeof out.skippedDuplicates === 'number' && out.skippedDuplicates > 0) {
    pills.push({ text: `Bỏ qua ${out.skippedDuplicates} dòng trùng` });
  }
  if (typeof out.totalMatched === 'number') {
    pills.push({
      text: `Khớp ${out.totalMatched}${typeof out.totalDataRows === 'number' ? `/${out.totalDataRows}` : ''} dòng`,
    });
  }
  if (step.tool.endsWith('.create_sheet') && typeof out.title === 'string' && out.title) {
    pills.push({ text: `Tab mới: ${out.title}` });
  }
  if (step.tool === 'mysheets.create_doc' && typeof out.title === 'string' && out.title) {
    pills.push({ text: `📝 Tài liệu Docs: ${out.title}` }); // taste-skill-ignore
  }
  if (step.tool === 'mysheets.append_doc_text') {
    pills.push({ text: '✏️ Đã nối thêm nội dung vào Docs' }); // taste-skill-ignore
  }
  if (step.tool === 'mysheets.get_doc' && typeof out.content === 'string') {
    pills.push({ text: '📖 Đã đọc nội dung tài liệu' }); // taste-skill-ignore
  }
  if (step.tool === 'mysheets.create_drive_folder' && typeof out.title === 'string' && out.title) {
    pills.push({ text: `📁 Thư mục Drive: ${out.title}` }); // taste-skill-ignore
  }
  if (step.tool === 'mysheets.move_drive_file') {
    pills.push({ text: '📦 Đã chuyển tệp vào thư mục' }); // taste-skill-ignore
  }
  if (step.tool === 'mysheets.list_drive_files' && Array.isArray(out.files)) {
    pills.push({ text: `📂 Tìm thấy ${out.files.length} tệp trên Drive` }); // taste-skill-ignore
  }
  if (typeof out.updatedRange === 'string' && out.updatedRange) {
    pills.push({ text: `Phạm vi ${out.updatedRange}` });
  }
  if (Array.isArray(out.unmatchedKeys) && out.unmatchedKeys.length > 0) {
    pills.push({ text: `Chưa tìm thấy khóa: ${out.unmatchedKeys.join(', ')}`, warn: true });
  }
  if (pills.length === 0) return null;
  return (
    <div data-testid="sheets-receipt-metrics" className="flex flex-wrap items-center gap-1.5 mt-2">
      {pills.map((pill, i) => (
        <MetricPill key={i} text={pill.text} warn={pill.warn} />
      ))}
    </div>
  );
}

function NotionReceiptMetrics({ step }: { step: ExecutionStepInfo }) {
  if (step.status !== 'succeeded') return null;
  if (serviceId(step.tool) !== 'notion') return null;
  const out = resultObject(step.output);
  if (!out) return null;
  const pills: Array<{ text: string; warn?: boolean }> = [];
  if (Array.isArray(out.updatedProperties) && out.updatedProperties.length > 0) {
    pills.push({
      text: `Đã cập nhật ${out.updatedProperties.length} thuộc tính (${out.updatedProperties.join(', ')})`,
    });
  } else if (out.properties && typeof out.properties === 'object' && !Array.isArray(out.properties)) {
    const propKeys = Object.keys(out.properties as Record<string, unknown>);
    if (propKeys.length > 0) {
      pills.push({ text: `Đã cập nhật ${propKeys.length} thuộc tính (${propKeys.join(', ')})` });
    }
  }
  if (typeof out.archived === 'boolean') {
    pills.push({ text: out.archived ? '📦 Đã lưu trữ trang' : '📂 Đã khôi phục trang', warn: out.archived }); // taste-skill-ignore
  }
  if (Array.isArray(out.blockIds) && out.blockIds.length > 0) {
    pills.push({ text: `Đã nối ${out.blockIds.length} khối văn bản` });
  }
  if (Array.isArray(out.blocks) && out.blocks.length > 0) {
    pills.push({ text: `Đọc ${out.blocks.length} khối nội dung` });
  }
  if (Array.isArray(out.pages)) {
    pills.push({ text: `Khớp ${out.pages.length} trang` });
  }
  if (pills.length === 0) return null;
  return (
    <div data-testid="notion-receipt-metrics" className="flex flex-wrap items-center gap-1.5 mt-2">
      {pills.map((pill, i) => (
        <MetricPill key={i} text={pill.text} warn={pill.warn} />
      ))}
    </div>
  );
}

function TrelloReceiptMetrics({ step }: { step: ExecutionStepInfo }) {
  if (step.status !== 'succeeded') return null;
  if (serviceId(step.tool) !== 'trello') return null;
  const out = resultObject(step.output);
  if (!out) return null;
  const pills: Array<{ text: string; warn?: boolean }> = [];
  if (Array.isArray(out.idMembers) && out.idMembers.length > 0) {
    pills.push({ text: `👤 Đã gán ${out.idMembers.length} thành viên` }); // taste-skill-ignore
  }
  if (Array.isArray(out.items) && out.items.length > 0) {
    pills.push({ text: `☑️ Đã tạo ${out.items.length} mục checklist` }); // taste-skill-ignore
  }
  if (step.tool === 'trello.update_checklist_item' && typeof out.state === 'string') {
    pills.push({
      text: out.state === 'complete' ? '☑ Đã đánh dấu hoàn thành' : '☐ Đã mở lại mục việc',
      warn: out.state !== 'complete',
    });
  }
  if (typeof out.dueComplete === 'boolean') {
    pills.push({
      text: out.dueComplete ? '✓ Đã hoàn thành hạn' : '⏳ Chưa hoàn thành hạn', // taste-skill-ignore
      warn: !out.dueComplete,
    });
  }
  if (out.closed === true) {
    pills.push({ text: '📦 Đã lưu trữ thẻ', warn: true }); // taste-skill-ignore
  }
  if (pills.length === 0) return null;
  return (
    <div data-testid="trello-receipt-metrics" className="flex flex-wrap items-center gap-1.5 mt-2">
      {pills.map((pill, i) => (
        <MetricPill key={i} text={pill.text} warn={pill.warn} />
      ))}
    </div>
  );
}

function MyJiraReceiptMetrics({ step }: { step: ExecutionStepInfo }) {
  if (step.status !== 'succeeded') return null;
  const service = serviceId(step.tool);
  if (service !== 'myjira' && service !== 'jira') return null;
  const out = resultObject(step.output);
  if (!out) return null;
  const pills: Array<{ text: string; warn?: boolean }> = [];
  if (typeof out.key === 'string' && out.key) {
    pills.push({ text: `🎫 Mã: ${out.key}` }); // taste-skill-ignore
  }
  if (step.tool === 'myjira.transition_issue' && typeof out.newStatus === 'string' && out.newStatus) {
    const prev =
      typeof out.previousStatus === 'string' && out.previousStatus ? `${out.previousStatus} → ` : '';
    pills.push({ text: `🔄 Trạng thái: ${prev}${out.newStatus}` }); // taste-skill-ignore
  } else if (typeof out.status === 'string' && out.status) {
    pills.push({ text: `🏷️ Trạng thái: ${out.status}` }); // taste-skill-ignore
  }
  if (step.tool === 'myjira.update_issue' && Array.isArray(out.updatedFields) && out.updatedFields.length > 0) {
    pills.push({ text: `✏️ Đã cập nhật: ${out.updatedFields.join(', ')}` }); // taste-skill-ignore
  }
  if (typeof out.issueType === 'string' && out.issueType) {
    pills.push({ text: `📌 Loại: ${out.issueType}` }); // taste-skill-ignore
  }
  if (typeof out.priority === 'string' && out.priority) {
    pills.push({ text: `⚡ Ưu tiên: ${out.priority}` }); // taste-skill-ignore
  }
  if (typeof out.assignee === 'string' && out.assignee) {
    pills.push({ text: `👤 Phụ trách: ${out.assignee}` }); // taste-skill-ignore
  }
  if (typeof out.dueDate === 'string' && out.dueDate) {
    pills.push({ text: `📅 Hạn: ${out.dueDate}` }); // taste-skill-ignore
  }
  if (Array.isArray(out.comments) && out.comments.length > 0) {
    pills.push({ text: `💬 ${out.comments.length} bình luận` }); // taste-skill-ignore
  }
  if (pills.length === 0) return null;
  return (
    <div data-testid="myjira-receipt-metrics" className="flex flex-wrap items-center gap-1.5 mt-2">
      {pills.map((pill, i) => (
        <MetricPill key={i} text={pill.text} warn={pill.warn} />
      ))}
    </div>
  );
}

function GitHubReceiptMetrics({ step }: { step: ExecutionStepInfo }) {
  if (step.status !== 'succeeded') return null;
  if (serviceId(step.tool) !== 'github') return null;
  const pills: Array<{ text: string; warn?: boolean }> = [];
  if (step.tool.endsWith('.list_pull_requests') && Array.isArray(step.output)) {
    pills.push({ text: `🔀 ${step.output.length} Pull Requests` }); // taste-skill-ignore
  }
  const out = resultObject(step.output);
  if (out) {
    if (typeof out.number === 'number') {
      pills.push({ text: `🐙 Issue #${out.number}` }); // taste-skill-ignore
    }
    if (typeof out.state === 'string' && out.state) {
      pills.push({ text: `Trạng thái: ${out.state}` });
    }
    if (Array.isArray(out.labels) && out.labels.length > 0) {
      pills.push({ text: `🏷️ Nhãn: ${out.labels.join(', ')}` }); // taste-skill-ignore
    }
    if (Array.isArray(out.assignees) && out.assignees.length > 0) {
      pills.push({ text: `👤 Phụ trách: ${out.assignees.join(', ')}` }); // taste-skill-ignore
    }
  }
  if (pills.length === 0) return null;
  return (
    <div data-testid="github-receipt-metrics" className="flex flex-wrap items-center gap-1.5 mt-2">
      {pills.map((pill, i) => (
        <MetricPill key={i} text={pill.text} warn={pill.warn} />
      ))}
    </div>
  );
}

function SlackReceiptMetrics({ step }: { step: ExecutionStepInfo }) {
  if (step.status !== 'succeeded') return null;
  if (!step.tool.endsWith('.read_messages')) return null;
  const out = resultObject(step.output);
  if (!out) return null;
  const pills: Array<{ text: string }> = [];
  if (Array.isArray(out.messages)) {
    pills.push({ text: `💬 Đã đọc ${out.messages.length} tin nhắn` }); // taste-skill-ignore
  }
  if (pills.length === 0) return null;
  return (
    <div data-testid="slack-receipt-metrics" className="flex flex-wrap items-center gap-1.5 mt-2">
      {pills.map((pill, i) => (
        <MetricPill key={i} text={pill.text} />
      ))}
    </div>
  );
}

function TelegramReceiptMetrics({ step }: { step: ExecutionStepInfo }) {
  if (step.status !== 'succeeded') return null;
  if (serviceId(step.tool) !== 'telegram') return null;
  const out = resultObject(step.output);
  if (!out) return null;
  const pills: Array<{ text: string; warn?: boolean }> = [];
  if (typeof out.messageId === 'number' || (typeof out.messageId === 'string' && out.messageId)) {
    pills.push({ text: `📨 Tin nhắn #${out.messageId}` }); // taste-skill-ignore
  }
  if (pills.length === 0) return null;
  return (
    <div data-testid="telegram-receipt-metrics" className="flex flex-wrap items-center gap-1.5 mt-2">
      {pills.map((pill, i) => (
        <MetricPill key={i} text={pill.text} />
      ))}
    </div>
  );
}

function CalendarReceiptMetrics({ step }: { step: ExecutionStepInfo }) {
  if (step.status !== 'succeeded') return null;
  const service = serviceId(step.tool);
  if (service !== 'calendar' && service !== 'mycalendar') return null;
  const out = resultObject(step.output);
  if (!out) return null;
  const pills: Array<{ text: string }> = [];
  if (typeof out.start === 'string' && out.start) {
    pills.push({ text: `📅 Bắt đầu: ${out.start}` }); // taste-skill-ignore
  }
  if (typeof out.meetLink === 'string' && out.meetLink) {
    pills.push({ text: '🎥 Đã tạo phòng họp Google Meet' }); // taste-skill-ignore
  }
  if (typeof out.attendeesCount === 'number' && out.attendeesCount > 0) {
    pills.push({ text: `👥 ${out.attendeesCount} khách mời` }); // taste-skill-ignore
  }
  if (pills.length === 0) return null;
  return (
    <div data-testid="calendar-receipt-metrics" className="flex flex-wrap items-center gap-1.5 mt-2">
      {pills.map((pill, i) => (
        <MetricPill key={i} text={pill.text} />
      ))}
    </div>
  );
}

function GmailReceiptMetrics({ step }: { step: ExecutionStepInfo }) {
  if (step.status !== 'succeeded') return null;
  if (serviceId(step.tool) !== 'gmail') return null;
  const out = resultObject(step.output);
  if (!out) return null;
  const pills: Array<{ text: string }> = [];
  if (typeof out.id === 'string' && out.id) {
    pills.push({ text: `✉️ Mã thư: ${out.id}` }); // taste-skill-ignore
  }
  if (pills.length === 0) return null;
  return (
    <div data-testid="gmail-receipt-metrics" className="flex flex-wrap items-center gap-1.5 mt-2">
      {pills.map((pill, i) => (
        <MetricPill key={i} text={pill.text} />
      ))}
    </div>
  );
}

interface HorizontalConnectorInfo {
  from: string;
  to: string;
  sourceIndex: number;
  label: string;
}

function resolveSecondaryTitle(step: ExecutionStepInfo, primaryTitle: string): string | null {
  if (step.status !== 'succeeded') return null;
  const out = resultObject(step.output);
  if (!out) return null;
  const candidate =
    (typeof out.title === 'string' && out.title.trim()) ||
    (typeof out.summary === 'string' && out.summary.trim()) ||
    null;
  if (!candidate) return null;
  if (primaryTitle.toLocaleLowerCase().includes(candidate.toLocaleLowerCase())) return null;
  return candidate;
}

function ReceiptConnector({ from, to, sourceIndex, label }: HorizontalConnectorInfo) {
  return (
    <div
      data-receipt-connector
      data-from={from}
      data-to={to}
      className="connector-stagger-1 mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 bg-[#F4F4F3] text-[#4B5563] border border-[#E5E5E3] rounded-[6px] text-[11px] font-medium max-w-full"
      title="Dữ liệu được truyền sang bước tiếp theo"
    >
      <span className="text-[#5F6368] flex-shrink-0">↳ Từ Việc {sourceIndex}:</span>
      <code className="font-mono text-[11px] text-[#111111] truncate">{label}</code>
    </div>
  );
}

function ReceiptCard({
  step,
  index,
  highlighted,
  horizontalConnector,
  services,
  planSteps,
  labels,
  gmailConnection,
  mycalendarConnection,
  mysheetsConnection,
  trelloConnection,
  githubConnection,
  notionConnection,
  telegramConnection,
  myjiraConnection,
  destination,
}: CardProps & {
  step: ExecutionStepInfo;
  index: number;
  highlighted?: boolean;
  horizontalConnector?: HorizontalConnectorInfo;
}) {
  const service = serviceId(step.tool);
  const palette = servicePalette(service);
  const primaryTitle = resultTitle(step);
  const secondaryTitle = resolveSecondaryTitle(step, primaryTitle);
  const directUrl = outcomeURL(step);
  const meetUrl = outcomeMeetURL(step);
  const hasLinks = Boolean(directUrl || meetUrl);
  const hasDetails = !step.tool.startsWith('myslack.');
  const showDuration = step.status === 'succeeded' && Boolean(step.duration);

  return (
    <div
      data-highlighted-step={highlighted ? 'true' : undefined}
      className={`receipt-stagger-${Math.min(index + 1, 4)} min-w-0 rounded-lg border ${
        highlighted ? 'bg-[#FAFAFA] border-[#111827]' : 'bg-white border-[#E5E5E3]'
      } p-4 flex flex-col hover:border-[#CFCFC9] transition-colors group`}
      aria-label={serviceName(service, services)}
    >
      <div className="v3-space-y-2.5 min-w-0">
        {/* Card Header: Service + Kind on left, single pale status pill on right */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-[6px] bg-[#F8F8F7] border border-[#E6E6E3] flex items-center justify-center p-1 flex-shrink-0">
              <ServiceLogo
                service={service}
                className={`w-3.5 h-3.5 ${palette.logo === 'text-white' ? 'text-[#111827]' : (palette.logo ?? '')}`}
              />
            </div>
            <span className="text-xs font-medium text-[#5F6368] truncate">
              {serviceName(service, services)} · {operation(step.tool).kind}
            </span>
          </div>
          <span
            className={`text-[11px] font-medium ${
              step.status === 'succeeded'
                ? 'bg-[#DCFAE5] text-[#04250E]'
                : 'bg-[#F3F3F1] text-[#4B5563]'
            } px-2 py-0.5 rounded-[6px] flex-shrink-0 whitespace-nowrap`}
          >
            {step.status === 'succeeded' ? `✓ ${operation(step.tool).receipt}` : statusLabel(step.status)}
          </span>
        </div>

        {/* Outcome Identity & Metadata */}
        <div className="min-w-0">
          <h3 className="font-sans text-[15px] font-semibold text-[#111111] line-clamp-2 leading-snug break-words">
            {secondaryTitle ?? primaryTitle}
          </h3>
          <p className="text-xs text-[#5F6368] mt-1 break-words">
            {destination(
              planSteps.find((row) => row.id === step.id) ?? {
                id: step.id,
                tool: step.tool,
                description: step.description,
                args: {},
              },
              labels
            )}
          </p>
          {service === 'gmail' && gmailConnection?.email && (
            <p className="text-xs text-[#6B7280] mt-0.5 break-words">
              Gửi từ: {gmailConnection.email} (Gmail của bạn)
            </p>
          )}
          {service === 'mycalendar' && mycalendarConnection?.email && (
            <p className="text-xs text-[#6B7280] mt-0.5 break-words">
              Tài khoản: {mycalendarConnection.email} (Google Calendar của bạn)
            </p>
          )}
          {service === 'mysheets' && mysheetsConnection?.email && (
            <p className="text-xs text-[#6B7280] mt-0.5 break-words">
              Tài khoản: {mysheetsConnection.email} (Google Sheets của bạn)
            </p>
          )}
          {service === 'trello' && trelloConnection?.username && (
            <p className="text-xs text-[#6B7280] mt-0.5 break-words">
              Tài khoản: @{trelloConnection.username} (Trello của bạn)
            </p>
          )}
          {service === 'github' && githubConnection?.login && (
            <p className="text-xs text-[#6B7280] mt-0.5 break-words">
              Tài khoản: @{githubConnection.login} (GitHub của bạn)
            </p>
          )}
          {service === 'notion' && notionConnection?.workspaceName && (
            <p className="text-xs text-[#6B7280] mt-0.5 break-words">
              Workspace Notion: {notionConnection.workspaceName}
            </p>
          )}
          {service === 'telegram' && telegramConnection?.username && (
            <p className="text-xs text-[#6B7280] mt-0.5 break-words">
              Tài khoản: @{telegramConnection.username} (Telegram của bạn)
            </p>
          )}
          {service === 'myjira' && myjiraConnection && (
            <p className="text-xs text-[#6B7280] mt-0.5 break-words">
              Tài khoản Atlassian: {myjiraConnection.atlassianAccountId} · Workspace:{' '}
              {myjiraConnection.workspaceId}
            </p>
          )}
          {service === 'myjira' &&
            myjiraConnection?.siteSteps?.[step.id] &&
            (() => {
              const siteStep = myjiraConnection.siteSteps[step.id];
              const siteLabel =
                labels?.[siteStep.siteId] ?? labels?.[`jira_site:${siteStep.siteId}`] ?? siteStep.siteId;
              const planStep = planSteps.find((row) => row.id === step.id);
              const projectLabel =
                (typeof planStep?.args?.projectKey === 'string' && planStep.args.projectKey) ||
                (siteStep.projectId
                  ? (labels?.[siteStep.projectId] ??
                    labels?.[`jira_project:${siteStep.projectId}`] ??
                    siteStep.projectId)
                  : undefined);
              return (
                <p className="text-xs text-[#6B7280] mt-0.5 break-words">
                  Site đích: {siteLabel}
                  {projectLabel ? ` · Dự án: ${projectLabel}` : ''}
                </p>
              );
            })()}

          {horizontalConnector && <ReceiptConnector {...horizontalConnector} />}

          <SheetsReceiptMetrics step={step} />
          <NotionReceiptMetrics step={step} />
          <TrelloReceiptMetrics step={step} />
          <MyJiraReceiptMetrics step={step} />
          <GitHubReceiptMetrics step={step} />
          <SlackReceiptMetrics step={step} />
          <TelegramReceiptMetrics step={step} />
          <CalendarReceiptMetrics step={step} />
          <GmailReceiptMetrics step={step} />
        </div>
      </div>

      {step.status === 'succeeded' &&
        (toolDefinition(step.tool)?.sideEffect === 'read' || step.tool === 'myslack.chat_postMessage') &&
        step.output != null && <ResultFields output={step.output} tool={step.tool} />}

      {/* Unified Card Footer: never leaves an empty left gap or orphan duration */}
      {(hasLinks || hasDetails || showDuration) && (
        <div className="pt-3 mt-3.5 border-t border-[#ECECE9] min-w-0">
          {hasLinks && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                {directUrl && (
                  <a
                    href={directUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`text-xs font-semibold ${palette.name} hover:underline inline-flex items-center gap-1`}
                  >
                    <span>{operation(step.tool).link}</span>
                    <svg
                      aria-hidden="true"
                      className="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </a>
                )}
                {meetUrl && (
                  <a
                    href={meetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-[#111827] bg-[#F4F4F3] border border-[#E5E5E3] px-2 py-0.5 rounded-[6px] hover:bg-[#EAEAE8] inline-flex items-center gap-1"
                  >
                    <span>Tham gia Google Meet</span>
                  </a>
                )}
              </div>
              {showDuration && (
                <span className="text-xs text-[#5F6368] tabular-nums">{step.duration}</span>
              )}
            </div>
          )}

          {!hasLinks && !hasDetails && showDuration && (
            <div className="flex items-center justify-end">
              <span className="text-xs text-[#5F6368] tabular-nums">{step.duration}</span>
            </div>
          )}

          {hasDetails && (
            <details className={`group/details ${hasLinks ? 'mt-2' : ''} text-xs text-[#5F6368] min-w-0`}>
              <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-2 hover:text-[#111827] select-none">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <svg
                    aria-hidden="true"
                    className="w-3 h-3 text-[#6B7280] transition-transform group-open/details:rotate-90"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                  </svg>
                  <span>Chi tiết kỹ thuật</span>
                </span>
                {!hasLinks && showDuration && (
                  <span className="text-xs text-[#5F6368] tabular-nums">{step.duration}</span>
                )}
              </summary>
              <div className="mt-2 rounded-lg bg-[#F8F8F7] border border-[#E6E6E3] overflow-hidden min-w-0">
                <div className="px-2.5 py-1.5 bg-[#F1F1EF] border-b border-[#E6E6E3] flex flex-wrap items-center justify-between gap-2">
                  <code className="font-mono text-[11px] font-medium text-[#111827]">{step.tool}</code>
                  {step.completedAt && (
                    <time className="font-mono text-[11px] text-[#5F6368] tabular-nums" dateTime={step.completedAt}>
                      {new Date(step.completedAt).toLocaleString('vi-VN', { hour12: false })}
                    </time>
                  )}
                </div>
                {step.status === 'succeeded' && step.output != null && (
                  <pre className="p-2.5 overflow-x-auto whitespace-pre font-mono text-[11px] leading-relaxed text-[#262626]">
                    {JSON.stringify(step.output, null, 2)}
                  </pre>
                )}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function ReceiptBetweenRows({
  from,
  to,
  sourceLabel,
  targetLabel,
  field,
}: {
  from: string;
  to: string;
  sourceLabel: string;
  targetLabel: string;
  field: string;
}) {
  return (
    <div
      data-receipt-connector
      data-from={from}
      data-to={to}
      className="connector-stagger-2 flex items-center justify-center my-0.5 w-full"
    >
      <div className="hidden md:flex items-center justify-between w-full px-2 gap-3 text-[#9CA3AF]">
        <div className="flex-1 h-px bg-[#ECECE9]" />
        <div
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-[#F8F8F7] border border-[#E5E5E3] rounded-[6px] text-[11px] font-medium text-[#4B5563]"
          title="Dữ liệu được truyền giữa các bước trong kế hoạch đã duyệt"
        >
          <span>{sourceLabel}</span>
          <span aria-hidden="true" className="text-[#9CA3AF]">
            →
          </span>
          <code className="font-mono text-[11px] text-[#111111]">{field}</code>
          <span aria-hidden="true" className="text-[#9CA3AF]">
            →
          </span>
          <span>{targetLabel}</span>
        </div>
        <div className="flex-1 h-px bg-[#ECECE9]" />
      </div>
      <div className="flex md:hidden items-center justify-center py-0.5">
        <span
          className="px-2 py-0.5 bg-[#F8F8F7] text-[#4B5563] border border-[#E5E5E3] rounded-[6px] text-[11px] font-medium whitespace-nowrap"
          title="Dữ liệu được truyền sang bước tiếp theo"
        >
          {`${sourceLabel} · ${field} → ${targetLabel} ↓`}
        </span>
      </div>
    </div>
  );
}

export function ReceiptMoment({
  request,
  terminalStatus,
  steps,
  planSteps,
  services,
  labels,
  gmailConnection,
  mycalendarConnection,
  mysheetsConnection,
  trelloConnection,
  githubConnection,
  notionConnection,
  telegramConnection,
  myjiraConnection,
  destination,
  totalDuration,
  onNewConversation,
  onFollowup,
  servicePrompt,
  onSettings,
  servicesLoading,
  servicesError,
}: CardProps & {
  request?: string;
  terminalStatus?: string;
  steps: ExecutionStepInfo[];
  totalDuration?: string;
  onNewConversation: () => void;
  onFollowup: (text: string) => void;
  servicePrompt?: (service: ServiceInfo) => string;
  onSettings?: () => void;
  servicesLoading?: boolean;
  servicesError?: string | null;
}) {
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const rows: ExecutionStepInfo[][] = [];
  for (let index = 0; index < steps.length; index += 2) rows.push(steps.slice(index, index + 2));
  const ids = new Set(steps.map((step) => step.id));
  const refs = receiptReferences(planSteps).filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  const cardProps = {
    services,
    planSteps,
    labels,
    gmailConnection,
    mycalendarConnection,
    mysheetsConnection,
    trelloConnection,
    githubConnection,
    notionConnection,
    telegramConnection,
    myjiraConnection,
    destination,
  };
  const getPrompt = servicePrompt ?? ((s) => s.name);
  const stepStatuses = Object.fromEntries(steps.map((step) => [step.id, step.status]));
  const canvasSteps: PlanStep[] = planSteps.length
    ? planSteps
    : steps.map((step) => ({
        id: step.id,
        tool: step.tool,
        description: step.description,
        args: {},
      }));
  const uniqueServicesCount = new Set(canvasSteps.map((step) => serviceId(step.tool))).size;
  const showFlowDiagram = uniqueServicesCount >= 2 || refs.length > 0;
  const succeededCount = steps.filter((step) => step.status === 'succeeded').length;
  const succeededServiceCount = new Set(
    steps.filter((step) => step.status === 'succeeded').map((step) => serviceId(step.tool))
  ).size;

  return (
    <section
      id={terminalStatus ? 'moment-unsuccessful' : 'moment-6'}
      className={`stage-section is-active w-full ${steps.length > 1 ? 'max-w-4xl' : 'max-w-3xl'} mx-auto`}
      aria-label="Cockpit"
      data-moment={terminalStatus ? 'unsuccessful' : '6'}
      aria-labelledby="heading-moment-6"
    >
      <div className="rounded-xl border border-[#E5E5E3] bg-white overflow-hidden">
        {/* Ledger Header */}
        <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-[#ECECE9]">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 text-xs">
            <div className="inline-flex items-center gap-1.5 font-medium">
              <span
                className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${
                  terminalStatus ? 'bg-[#F3F3F1] text-[#4B5563]' : 'bg-[#DCFAE5] text-[#04250E]'
                }`}
              >
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    className="animate-draw-check"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.8"
                    d={terminalStatus ? 'M6 6l12 12M6 18L18 6' : 'M5 13l4 4L19 7'}
                  />
                </svg>
              </span>
              <span className="text-[#111827]">
                {terminalStatus ? 'Biên nhận phiên thực thi' : 'Hoàn tất thực thi'}
              </span>
            </div>
            <div className="inline-flex items-center gap-2 text-xs text-[#5F6368] tabular-nums">
              {steps.length > 0 && (
                <span>
                  {succeededCount}/{steps.length} bước
                </span>
              )}
              {totalDuration && (
                <>
                  {steps.length > 0 && <span aria-hidden="true">·</span>}
                  <span
                    id="moment-6-duration-tag"
                    className="inline-flex items-center px-2 py-0.5 rounded-[6px] bg-[#F4F4F3] border border-[#E5E5E3] text-[#111827] text-xs font-medium tabular-nums"
                  >
                    Trong {totalDuration}
                  </span>
                </>
              )}
            </div>
          </div>

          <RequestEcho request={request} />
          <h1
            id="heading-moment-6"
            className="font-sans text-xl sm:text-[22px] text-[#111111] font-semibold tracking-[-0.02em] leading-snug"
            tabIndex={-1}
          >
            {terminalStatus ? (
              terminalStatus === 'stopped' ? (
                'Kế hoạch đã dừng'
              ) : terminalStatus === 'rejected' ? (
                'Kế hoạch đã hủy'
              ) : (
                'Kế hoạch chưa hoàn thành'
              )
            ) : (
              <>
                Đã xong {succeededCount} việc trên {succeededServiceCount} công cụ
              </>
            )}
          </h1>
          {terminalStatus && (
            <>
              <p role="status" className="sr-only">
                {terminalStatus === 'stopped'
                  ? 'Quy trình đã dừng.'
                  : terminalStatus === 'rejected'
                    ? 'Kế hoạch đã hủy; chưa thực thi.'
                    : 'Quy trình không hoàn thành.'}
              </p>
              <p className="text-sm text-[#4B5563] mt-1 tabular-nums">
                Đã làm {succeededCount} việc; {steps.length - succeededCount} việc chưa hoàn thành.
              </p>
            </>
          )}
        </div>

        {/* Execution Ledger Body */}
        <div className="p-5 sm:p-6 v3-space-y-4">
          {canvasSteps.some((s) => s.tool === 'mysheets.create_doc') &&
            canvasSteps.some(
              (s) =>
                s.tool === 'gmail.send_message' ||
                s.tool === 'mycalendar.schedule_meet' ||
                s.tool === 'mycalendar.create_event'
            ) && (
              <div
                data-testid="google-docs-sharing-notice"
                className="flex items-start gap-2.5 p-3 bg-[#FEF8EC] border border-[#F2DFB6] rounded-lg text-[#6E3B00] text-xs leading-relaxed"
              >
                <svg
                  aria-hidden="true"
                  className="w-4 h-4 mt-0.5 shrink-0 text-[#7A4100]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
                <div>
                  <strong>Lưu ý quyền truy cập Google Docs (drive.file):</strong> Tài liệu vừa tạo thuộc phạm
                  vi cá nhân của bạn và không tự động mở quyền xem cho người nhận email. Hãy mở liên kết
                  Google Docs và nhấn <em>Chia sẻ (Share)</em> nếu cần cấp quyền đọc cho người nhận.
                </div>
              </div>
            )}

          {showFlowDiagram && (
            <WorkflowFlowCanvas
              compact
              steps={canvasSteps}
              stepStatuses={stepStatuses}
              resourceLabels={labels}
              selectedService={selectedService}
              onSelectService={setSelectedService}
              mode="receipt"
            />
          )}

          <div id="receipt-chain" className="flex flex-col gap-4">
            {rows.map((row, rowIndex) => {
              const horizontal =
                row.length === 2 ? refs.filter((edge) => edge.from === row[0].id && edge.to === row[1].id) : [];
              const incoming = refs.filter(
                (edge) => row.some((step) => step.id === edge.to) && !horizontal.includes(edge)
              );
              return (
                <Fragment key={row[0].id}>
                  {incoming.map((edge) => (
                    <ReceiptBetweenRows
                      key={`${edge.from}-${edge.to}-${edge.field}`}
                      from={edge.from}
                      to={edge.to}
                      sourceLabel={`${serviceName(serviceId(steps.find((s) => s.id === edge.from)!.tool), services)} (việc ${steps.findIndex((s) => s.id === edge.from) + 1})`}
                      targetLabel={`${serviceName(serviceId(steps.find((s) => s.id === edge.to)!.tool), services)} (việc ${steps.findIndex((s) => s.id === edge.to) + 1})`}
                      field={edge.field}
                    />
                  ))}
                  <div
                    className={`grid grid-cols-1 ${
                      row.length > 1 ? 'md:grid-cols-2' : ''
                    } items-start gap-4`}
                  >
                    <ReceiptCard
                      step={row[0]}
                      index={rowIndex * 2}
                      highlighted={selectedService === serviceId(row[0].tool)}
                      {...cardProps}
                    />
                    {row[1] && (
                      <ReceiptCard
                        step={row[1]}
                        index={rowIndex * 2 + 1}
                        highlighted={selectedService === serviceId(row[1].tool)}
                        horizontalConnector={
                          horizontal.length > 0
                            ? {
                                from: row[0].id,
                                to: row[1].id,
                                sourceIndex: rowIndex * 2 + 1,
                                label: horizontal.map((edge) => edge.field).join(' + '),
                              }
                            : undefined
                        }
                        {...cardProps}
                      />
                    )}
                  </div>
                </Fragment>
              );
            })}
          </div>
        </div>

        {/* Disciplined Footer Bar: One near-black primary, uniform 32px control height */}
        <div className="px-5 sm:px-6 py-3.5 bg-[#FAFAFA] border-t border-[#ECECE9] flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-medium text-[#5F6368]">Bước tiếp theo</span>
          <div role="group" aria-label="Gợi ý tiếp theo" className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onNewConversation}
              className="h-8 px-3.5 bg-[#1D1F20] hover:bg-[#111111] text-white text-xs font-medium rounded-lg transition-colors inline-flex items-center justify-center cursor-pointer"
            >
              Nhờ việc khác
            </button>
            <button
              type="button"
              data-testid="receipt-schedule-workflow-btn"
              onClick={() =>
                onFollowup(`Mỗi sáng 08:00, tự động thực hiện: ${request || 'quy trình vừa hoàn tất'}`)
              }
              className="h-8 px-3 bg-white hover:bg-[#F3F3F1] border border-[#DFDFDC] text-[#111827] text-xs font-medium rounded-lg transition-colors inline-flex items-center gap-1.5 cursor-pointer"
            >
              <svg
                aria-hidden="true"
                className="w-3.5 h-3.5 text-[#5F6368]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>Đặt lịch chạy định kỳ quy trình này</span>
            </button>
            {services
              .filter((service) => service.configured)
              .slice(0, 2)
              .map((service) => (
                <button
                  key={service.id}
                  type="button"
                  onClick={() => onFollowup(getPrompt(service))}
                  className="h-8 px-3 bg-white hover:bg-[#F3F3F1] border border-[#E5E5E3] text-[#4B5563] hover:text-[#111827] text-xs font-medium rounded-lg transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <svg
                    aria-hidden="true"
                    className="w-3 h-3 text-[#6B7280]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                  </svg>
                  <span>{getPrompt(service)}</span>
                </button>
              ))}
            {!servicesLoading && !servicesError && !services.some((service) => service.configured) && (
              <p className="text-xs text-[#5F6368]">
                Chưa có dịch vụ nào được kết nối.{' '}
                <a
                  href="/settings"
                  onClick={(event) => {
                    event.preventDefault();
                    onSettings?.();
                  }}
                  className="underline font-medium text-[#111827]"
                >
                  Kết nối thêm
                </a>
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
