import { useEffect, useRef, useState } from 'react';
import type { ScheduleApprovalMode, ScheduleView, SheetsDigestPreviewInfo } from '@wap/tool-schemas';
import type { ChatMessage } from '../../types';
import { apiClient } from '../../services/api-client';
import { describeRecurrence, formatRunTime, scheduleLabel } from '../../services/schedule-text';
import { schedulesChanged } from '../../hooks/use-schedules';
import { useChatStore } from '../../store/chat-store';
import { serviceName } from './presentation';
import { ScheduleActions, scheduleButton, primaryScheduleButton } from './ScheduleActions';
import { ServiceLogo } from '../../components/ServiceLogo';
import { WorkflowFlowCanvas } from '../../components/WorkflowFlowCanvas';
import { normalizeConversationMessages } from '../../services/conversation-messages';

export async function reloadScheduleConversation(id: string) {
  const before = useChatStore.getState();
  const { messages } = await apiClient.getConversation(id);
  const current = useChatStore.getState();
  if (current.conversationId === id && current.messages === before.messages && current.planRevision === before.planRevision) useChatStore.setState({ messages: normalizeConversationMessages(messages) });
}
export function ScheduleMoment(props: { message?: ChatMessage; convId?: string; navigate?: (path: string) => void; onEdit?: () => void; digestCandidate?: any }) {
  const message: ChatMessage = props.message ?? {
    id: 'msg-sched-test',
    role: 'assistant',
    content: '',
    metadata: {
      type: 'schedule_proposal',
      proposal: {
        kind: 'schedule',
        action: 'create',
        name: props.digestCandidate?.summary ?? 'Lịch chạy tự động',
        request: props.digestCandidate?.summary ?? 'Chạy báo cáo định kỳ',
        recurrence: {
          type: 'daily',
          time: '09:00',
        },
        summary: props.digestCandidate?.summary ?? 'Lịch chạy định kỳ',
      },
      digestCandidate: props.digestCandidate,
    },
  };
  const convId = props.convId ?? 'conv-default';
  const navigate = props.navigate ?? (() => {});
  const onEdit = props.onEdit ?? (() => {});
  const isReauthorize = Boolean((message.metadata as any)?.reauthorize);
  const rawCandidate = (props.digestCandidate ?? message.metadata?.digestCandidate) as any;
  const initialIncludeAiSummary = Boolean(
    rawCandidate?.preview?.includeAiSummary ?? rawCandidate?.config?.includeAiSummary ?? true
  );
  const [ignored, setIgnored] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState<ScheduleView | null>(null);
  const [approvalMode, setApprovalMode] = useState<ScheduleApprovalMode>(() => (isReauthorize ? 'auto_digest' : 'manual'));
  const [includeAiSummary, setIncludeAiSummary] = useState<boolean>(initialIncludeAiSummary);
  const locked = useRef(false);
  const currentMessage = useRef(message.id); currentMessage.current = message.id;
  useEffect(() => {
    setIgnored(false);
    setConfirmed(null);
    setApprovalMode((message.metadata as any)?.reauthorize ? 'auto_digest' : 'manual');
    const cand = (props.digestCandidate ?? message.metadata?.digestCandidate) as any;
    setIncludeAiSummary(
      Boolean(cand?.preview?.includeAiSummary ?? cand?.config?.includeAiSummary ?? true)
    );
  }, [message.id, (message.metadata as any)?.reauthorize]);
  const metadata = message.metadata!;
  const schedule = confirmed ?? metadata.schedule;
  const proposal = metadata.proposal;
  const previous = metadata.previous;
  const digestCandidate = (props.digestCandidate ?? metadata.digestCandidate) as any;
  const sheetsPreview = digestCandidate?.preview as SheetsDigestPreviewInfo | undefined;
  const isSheetsCandidate = Boolean(
    sheetsPreview ||
      digestCandidate?.config?.source?.service === 'mysheets' ||
      digestCandidate?.config?.source?.service === 'sheets'
  );
  const isTelegramCandidate = Boolean(
    digestCandidate &&
      !Array.isArray(digestCandidate?.config?.repos) &&
      !Array.isArray(digestCandidate?.config?.boards) &&
      !Array.isArray(digestCandidate?.config?.databases) &&
      !Array.isArray(digestCandidate?.config?.projects) &&
      digestCandidate?.kind !== 'notion_digest' &&
      digestCandidate?.kind !== 'myjira_digest' &&
      (Array.isArray(digestCandidate?.config?.sources) ||
        typeof digestCandidate?.config?.telegramUserId === 'string' ||
        (metadata.services?.includes('telegram') &&
          metadata.services.length >= 3 &&
          !('eligible' in digestCandidate) &&
          !('configPreview' in digestCandidate) &&
          !digestCandidate?.config?.source) ||
        (metadata.services?.includes('telegram') &&
          !metadata.services?.includes('github') &&
          !metadata.services?.includes('trello') &&
          !metadata.services?.includes('notion') &&
          !metadata.services?.includes('myjira') &&
          !metadata.services?.includes('jira') &&
          !metadata.services?.includes('mycalendar') &&
          !metadata.services?.includes('calendar') &&
          !metadata.services?.includes('mysheets') &&
          !metadata.services?.includes('sheets') &&
          !('eligible' in digestCandidate) &&
          !('configPreview' in digestCandidate) &&
          !digestCandidate?.config?.source))
  );
  const isGithubCandidate = Boolean(
    !isTelegramCandidate &&
      digestCandidate &&
      (Array.isArray(digestCandidate?.config?.repos) || metadata.services?.includes('github'))
  );
  const isTrelloCandidate = Boolean(
    !isTelegramCandidate &&
      !isGithubCandidate &&
      digestCandidate &&
      (Array.isArray(digestCandidate?.config?.boards) || metadata.services?.includes('trello'))
  );
  const isNotionCandidate = Boolean(
    !isTelegramCandidate &&
      !isGithubCandidate &&
      !isTrelloCandidate &&
      digestCandidate &&
      (digestCandidate?.kind === 'notion_digest' ||
        Array.isArray(digestCandidate?.config?.databases) ||
        metadata.services?.includes('notion'))
  );
  const isJiraCandidate = Boolean(
    !isTelegramCandidate &&
      !isGithubCandidate &&
      !isTrelloCandidate &&
      !isNotionCandidate &&
      digestCandidate &&
      (digestCandidate?.kind === 'myjira_digest' ||
        Array.isArray(digestCandidate?.config?.projects) ||
        metadata.services?.includes('myjira') ||
        metadata.services?.includes('jira'))
  );
  const isCalendarCandidate = Boolean(
    !isTelegramCandidate &&
      !isGithubCandidate &&
      !isTrelloCandidate &&
      !isNotionCandidate &&
      !isJiraCandidate &&
      digestCandidate &&
      ('configPreview' in digestCandidate ||
        'disabledReason' in digestCandidate ||
        'eligible' in digestCandidate ||
        typeof digestCandidate?.config?.source === 'string' ||
        metadata.services?.includes('mycalendar') ||
        metadata.services?.includes('calendar'))
  );
  const canAutoDigest = digestCandidate?.canAutoDigest === true || (isNotionCandidate && digestCandidate?.eligible === true);
  const isEligible = Boolean(digestCandidate?.canAutoDigest ?? digestCandidate?.eligible);
  const ineligibleReason = digestCandidate?.disabledReason ?? digestCandidate?.reason;
  const previewEmail = digestCandidate?.configPreview?.email ?? digestCandidate?.config?.email ?? '';
  const previewCalendars: Array<{ id: string; summary: string }> =
    digestCandidate?.configPreview?.calendars ?? digestCandidate?.config?.calendars ?? [];
  const previewDestination = digestCandidate?.configPreview
    ? `${digestCandidate.configPreview.destinationService === 'slack' ? 'Slack' : 'Telegram'} ${digestCandidate.configPreview.destinationLabel}`
    : digestCandidate?.config && isCalendarCandidate
      ? digestCandidate.config.destination.service === 'slack'
        ? `Slack #${digestCandidate.config.destination.channelName ?? digestCandidate.config.destination.channelId}`
        : `Telegram ${digestCandidate.config.destination.chatTitle ?? digestCandidate.config.destination.chatId}`
      : '';
  const previewWindowHours = digestCandidate?.config?.windowHours ?? 24;
  const confirm = async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const result = isGithubCandidate || isTrelloCandidate || isNotionCandidate || isJiraCandidate
        ? await apiClient.confirmSchedule(
            convId,
            message.id,
            !manage && approvalMode === 'auto_digest' ? { approvalMode: 'auto_digest' } : undefined
          )
        : isCalendarCandidate
          ? isEligible
            ? await apiClient.confirmSchedule(convId, message.id, approvalMode)
            : await apiClient.confirmSchedule(convId, message.id)
          : approvalMode === 'auto_digest' || isReauthorize
            ? isSheetsCandidate && includeAiSummary !== initialIncludeAiSummary
              ? await apiClient.confirmSchedule(convId, message.id, {
                  approvalMode: 'auto_digest',
                  includeAiSummary,
                })
              : await apiClient.confirmSchedule(convId, message.id, 'auto_digest')
            : await apiClient.confirmSchedule(convId, message.id);
      if (currentMessage.current === message.id) setConfirmed(result.schedule); schedulesChanged();
    } catch (reason: any) {
      setError(reason.message || 'Không thể xác nhận lịch.');
      if (reason.status === 409) await reloadScheduleConversation(convId).catch(() => {});
    } finally { locked.current = false; setBusy(false); }
  };
  if (ignored) return <p role="status" className="text-sm text-[#6B7280]">Đã bỏ qua đề xuất trong phiên này.</p>;
  const change = (label: string, old: string | undefined, value: string | undefined) => value && <div className="v3-space-y-1"><p className="text-xs font-semibold text-[#6B7280]">{label}</p>{proposal?.action === 'update' && old !== undefined && old !== value && <del className="block text-sm text-[#6B7280] [overflow-wrap:anywhere]">{old}</del>}<p className="text-sm font-medium text-[#111827] whitespace-pre-wrap [overflow-wrap:anywhere]">{value}</p></div>;
  const manage = proposal && ['pause', 'resume', 'cancel'].includes(proposal.action);
  const title = schedule?.name ?? (manage ? `${proposal.action === 'pause' ? 'Tạm dừng' : proposal.action === 'resume' ? 'Chạy tiếp' : 'Hủy'} lịch "${previous?.name ?? ''}"?` : proposal?.name);
  const scheduleServices = schedule?.services ?? metadata.services ?? [];
  const isAutoDigestActive = approvalMode === 'auto_digest' || schedule?.kind === 'calendar_digest' || schedule?.kind === 'sheets_digest' || schedule?.kind === 'github_digest' || schedule?.kind === 'trello_digest' || schedule?.kind === 'notion_digest' || (schedule?.kind as string) === 'myjira_digest' || schedule?.kind === 'telegram_digest';
  return <section data-moment="schedule" className="w-full min-w-0 max-w-3xl mx-auto">
    <div className="bg-white border border-[#E5E5E0] rounded-2xl shadow-sm overflow-hidden min-w-0">
      <div className="px-5 sm:px-6 py-3 bg-[#F8F8F6] border-b border-[#EAEAE4] flex items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 font-semibold text-[#111827]">
          <svg aria-hidden="true" className="w-3.5 h-3.5 text-[#B43E00]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span>Lịch chạy tự động</span>
        </span>
        <span className="text-[#6B7280] font-medium">{schedule ? 'Đã xác nhận' : 'Đang xem trước đề xuất'}</span>
      </div>
      <div className="p-5 sm:p-6 v3-space-y-5 min-w-0">
        <h1 tabIndex={-1} className="font-sans text-xl sm:text-2xl font-semibold tracking-tight text-[#111827] [overflow-wrap:anywhere]">{title}</h1>
      {!manage && scheduleServices.length >= 2 && (
        <WorkflowFlowCanvas services={scheduleServices} isAutoDigest={isAutoDigestActive} mode="schedule" />
      )}
      {schedule ? <>
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="text-sm font-semibold text-[#111827]">{scheduleLabel(schedule)}</p>
          {schedule.kind === 'plan' ? (
            <span data-schedule-kind="plan" data-schedule-mode="manual" className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
              Mỗi lượt cần bạn duyệt
            </span>
          ) : schedule.kind !== 'telegram_digest' ? (
            <span data-schedule-kind={schedule.kind} data-schedule-mode="auto_digest" className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              Tự gửi
            </span>
          ) : null}
        </div>
        {schedule.kind === 'telegram_digest' && (
          <p data-schedule-kind={schedule.kind} className="text-xs font-semibold text-[#0369A1]">
            Tự gửi Telegram{schedule.digest && 'chatTitle' in schedule.digest && schedule.digest.chatTitle ? ` · ${schedule.digest.chatTitle}` : ''}
          </p>
        )}
        {schedule.kind !== 'plan' && schedule.kind !== 'telegram_digest' && (
          <p className="text-xs font-semibold text-emerald-700">
            Gửi định kỳ theo phạm vi đã xác nhận
          </p>
        )}
        <p className="text-sm text-[#4B5563]">{describeRecurrence(schedule.recurrence)}</p>
        <p className="text-sm text-[#4B5563] [overflow-wrap:anywhere]">{schedule.request}</p>
        <ScheduleActions schedule={schedule} navigate={navigate} onChanged={setConfirmed} onConflict={() => reloadScheduleConversation(convId)} /></>
        : proposal && <>{manage ? <p className="text-sm text-[#4B5563]">{proposal.action === 'cancel' ? 'Lịch đã hủy không bật lại được.' : proposal.summary}</p> : <>
          {isReauthorize && (
            <div
              data-testid="reauthorize-proposal-banner"
              className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 v3-space-y-1"
            >
              <p className="font-semibold">Đề xuất cấp quyền lại lịch Google Sheets (v2)</p>
              <p>Xác nhận lại nguồn bảng tính, kênh nhận và phạm vi tài khoản gửi tự động trước khi bật lại lịch.</p>
            </div>
          )}
          {proposal.action === 'update' && previous?.name !== proposal.name && change('Tên lịch', previous?.name, proposal.name)}
          {change('Thời gian', previous ? describeRecurrence(previous.recurrence) : undefined, proposal.recurrence ? describeRecurrence(proposal.recurrence) : undefined)}
          {change('Việc sẽ làm', previous?.request, proposal.request)}
          <div className="flex flex-wrap gap-2">{metadata.services?.map(id => <span key={id} className="inline-flex items-center gap-2 text-xs text-[#4B5563]"><span aria-hidden="true" className="w-6 h-6 rounded-lg border border-[#E5E5E0] bg-[#F8F8F6] flex items-center justify-center"><ServiceLogo service={id} className="w-3.5 h-3.5" /></span>{serviceName(id, [])}</span>)}</div>
          {!!metadata.nextRuns?.length && <div className="text-xs text-[#4B5563] v3-space-y-1"><p className="font-semibold">Lần chạy tới:</p>{metadata.nextRuns.map(time => <p key={time}>{formatRunTime(time)}</p>)}</div>}
          {isTelegramCandidate ? (
            <>
              <fieldset className="border border-[#E7E7E2] rounded-xl p-3.5 bg-[#F8F8F6] v3-space-y-2.5">
                <legend className="text-xs font-semibold text-[#6B7280] px-1">Chế độ khi tới giờ</legend>
                <label className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs sm:text-sm text-[#111827] cursor-pointer transition-colors ${approvalMode === 'manual' ? 'border-[#FF5701] bg-[#FFF6EE]/40' : 'border-[#E7E7E2] bg-white'}`}>
                  <input
                    id="schedule-mode-manual"
                    type="radio"
                    name={`schedule-mode-${message.id}`}
                    value="manual"
                    checked={approvalMode === 'manual'}
                    onChange={() => setApprovalMode('manual')}
                    className="mt-1 text-[#FF5701] focus:ring-[#FF5701]"
                  />
                  <span>
                    <strong className="font-semibold">Chờ tôi duyệt mỗi lượt</strong> (Mặc định) — Tới giờ, Planora lập kế hoạch mới và chờ bạn duyệt.
                  </span>
                </label>
                <label className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs sm:text-sm transition-colors ${!digestCandidate.canAutoDigest ? 'text-[#6B7280] opacity-70 cursor-not-allowed border-[#E7E7E2] bg-neutral-50' : approvalMode === 'auto_digest' ? 'text-[#111827] cursor-pointer border-[#FF5701] bg-[#FFF6EE]/40' : 'text-[#111827] cursor-pointer border-[#E7E7E2] bg-white'}`}>
                  <input
                    id="schedule-mode-auto-digest"
                    type="radio"
                    name={`schedule-mode-${message.id}`}
                    value="auto_digest"
                    disabled={!digestCandidate.canAutoDigest}
                    checked={approvalMode === 'auto_digest'}
                    onChange={() => digestCandidate.canAutoDigest && setApprovalMode('auto_digest')}
                    className="mt-1 text-[#FF5701] focus:ring-[#FF5701]"
                  />
                  <span className="v3-space-y-1">
                    <span className="block">
                      <strong className="font-semibold">Tự gửi bản tin, không cần duyệt lại</strong>
                    </span>
                    {digestCandidate.canAutoDigest && digestCandidate.config && (
                      <span className="block text-xs text-[#4B5563]">
                        {Array.isArray(digestCandidate.config.sources) && digestCandidate.config.sources.length > 0 && (
                          <>Nguồn đọc: {digestCandidate.config.sources.map((s: { label?: string; service: string }) => s.label || s.service).join(', ')} · </>
                        )}
                        Gửi về Telegram: <strong>{digestCandidate.config.chatTitle}</strong>
                      </span>
                    )}
                    {!digestCandidate.canAutoDigest && digestCandidate.disabledReason && (
                      <span className="block text-xs text-[#6B7280]">
                        {digestCandidate.disabledReason}
                      </span>
                    )}
                  </span>
                </label>
              </fieldset>
              {approvalMode === 'auto_digest' && digestCandidate.canAutoDigest && digestCandidate.config && (
                <div
                  id="schedule-auto-digest-scope"
                  className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 v3-space-y-1.5"
                >
                  <p className="font-semibold">Phạm vi tự gửi đã khóa:</p>
                  {Array.isArray(digestCandidate.config.sources) && digestCandidate.config.sources.length > 0 && (
                    <p>• Nguồn dữ liệu: {digestCandidate.config.sources.map((s: any) => s.label ?? s.service).join(', ')}</p>
                  )}
                  <p>• Nơi nhận: Telegram · {digestCandidate.config.chatTitle}</p>
                  <p>• {digestCandidate.config.sources?.some((source: { service: string }) => source.service === 'notion')
                    ? 'Lịch chỉ đọc database Notion đã duyệt và gửi bản tin vào cuộc trò chuyện đã chọn.'
                    : 'Lịch đọc dữ liệu từ nguồn đã chọn và gửi bản tin vào cuộc trò chuyện đã chọn.'}</p>
                </div>
              )}
              <p className="text-sm text-[#4B5563] leading-relaxed">
                {approvalMode === 'auto_digest'
                  ? 'Tới giờ, Planora chỉ đọc dữ liệu từ các dịch vụ nguồn đã chọn và tự động gửi bản tin về đúng cuộc trò chuyện Telegram đã khóa.'
                  : 'Tới giờ, Planora lập kế hoạch mới và chờ bạn duyệt. Chưa có gì được ghi lên công cụ nào.'}
              </p>
            </>
          ) : isGithubCandidate ? (
            <fieldset className="v3-space-y-2 border-t border-[#E7E7E2] pt-3">
              <legend className="text-xs font-semibold text-[#6B7280] mb-1">Chế độ khi tới giờ</legend>
              <label className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs sm:text-sm cursor-pointer ${approvalMode === 'manual' ? 'border-[#FF5701] bg-[#FFF6EE]/40' : 'border-[#E7E7E2] bg-white'}`}>
                <input
                  id="schedule-mode-manual"
                  type="radio"
                  name={`schedule-mode-${message.id}`}
                  checked={approvalMode === 'manual'}
                  onChange={() => setApprovalMode('manual')}
                  className="mt-0.5 text-[#FF5701] focus:ring-[#FF5701]"
                />
                <div className="v3-space-y-0.5">
                  <p className="font-semibold text-[#111827]">Chờ tôi duyệt mỗi lượt</p>
                  <p className="text-xs text-[#4B5563]">Tới giờ, Planora lập kế hoạch mới và chờ bạn duyệt. Chưa có gì được ghi lên công cụ nào.</p>
                </div>
              </label>
              <label className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs sm:text-sm ${!canAutoDigest ? 'opacity-60 cursor-not-allowed border-[#E7E7E2] bg-neutral-50' : approvalMode === 'auto_digest' ? 'cursor-pointer border-[#FF5701] bg-[#FFF6EE]/40' : 'cursor-pointer border-[#E7E7E2] bg-white'}`}>
                <input
                  id="schedule-mode-auto-digest"
                  type="radio"
                  name={`schedule-mode-${message.id}`}
                  checked={approvalMode === 'auto_digest'}
                  disabled={!canAutoDigest}
                  onChange={() => { if (canAutoDigest) setApprovalMode('auto_digest'); }}
                  className="mt-0.5 text-[#FF5701] focus:ring-[#FF5701]"
                />
                <div className="v3-space-y-1 min-w-0">
                  <p className="font-semibold text-[#111827]">Tự gửi bản tin, không cần duyệt lại</p>
                  {canAutoDigest && digestCandidate?.config ? (
                    <p className="text-xs text-[#4B5563] break-words">
                      {`Repo: ${digestCandidate.config.repos.join(', ')} · ${
                        digestCandidate.config.telegramChatId || digestCandidate.config.telegramChatTitle
                          ? `Telegram: ${digestCandidate.config.telegramChatTitle || digestCandidate.config.telegramChatId}`
                          : `Kênh Slack: #${String(digestCandidate.config.channelName ?? '').replace(/^#/, '')}`
                      } · Nội dung: Issue mới, PR chờ review quá ${digestCandidate.config.staleDays} ngày, Issue chưa ai nhận (+ tóm tắt AI)`}
                    </p>
                  ) : (
                    <p className="text-xs text-[#6B7280] break-words">
                      {digestCandidate?.disabledReason || 'Chỉ bật được khi lịch chỉ đọc GitHub và gửi báo cáo vào 1 kênh Slack hoặc nhóm Telegram đã chọn.'}
                    </p>
                  )}
                </div>
              </label>
            </fieldset>
          ) : isTrelloCandidate ? (
            <fieldset className="v3-space-y-2 border-t border-[#E7E7E2] pt-3">
              <legend className="text-xs font-semibold text-[#6B7280] mb-1">Chế độ khi tới giờ</legend>
              <label className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs sm:text-sm cursor-pointer ${approvalMode === 'manual' ? 'border-[#FF5701] bg-[#FFF6EE]/40' : 'border-[#E7E7E2] bg-white'}`}>
                <input
                  id="schedule-mode-manual"
                  type="radio"
                  name={`schedule-mode-${message.id}`}
                  checked={approvalMode === 'manual'}
                  onChange={() => setApprovalMode('manual')}
                  className="mt-0.5 text-[#FF5701] focus:ring-[#FF5701]"
                />
                <div className="v3-space-y-0.5">
                  <p className="font-semibold text-[#111827]">Chờ tôi duyệt mỗi lượt</p>
                  <p className="text-xs text-[#4B5563]">Tới giờ, Planora lập kế hoạch mới và chờ bạn duyệt. Chưa có gì được ghi lên công cụ nào.</p>
                </div>
              </label>
              <label className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs sm:text-sm ${!canAutoDigest ? 'opacity-60 cursor-not-allowed border-[#E7E7E2] bg-neutral-50' : approvalMode === 'auto_digest' ? 'cursor-pointer border-[#FF5701] bg-[#FFF6EE]/40' : 'cursor-pointer border-[#E7E7E2] bg-white'}`}>
                <input
                  id="schedule-mode-auto-digest"
                  type="radio"
                  name={`schedule-mode-${message.id}`}
                  checked={approvalMode === 'auto_digest'}
                  disabled={!canAutoDigest}
                  onChange={() => { if (canAutoDigest) setApprovalMode('auto_digest'); }}
                  className="mt-0.5 text-[#FF5701] focus:ring-[#FF5701]"
                />
                <div className="v3-space-y-1 min-w-0">
                  <p className="font-semibold text-[#111827]">Tự gửi bản tin, không cần duyệt lại</p>
                  {canAutoDigest && digestCandidate?.config ? (
                    <p className="text-xs text-[#4B5563] break-words">
                      {`Bảng Trello: ${Array.isArray(digestCandidate.config.boards) ? digestCandidate.config.boards.map((b: any) => typeof b === 'string' ? b : b?.name ?? b?.boardName ?? b?.id ?? b?.boardId).join(', ') : ''} · ${
                        digestCandidate.config.telegramChatId || digestCandidate.config.telegramChatTitle
                          ? `Telegram: ${digestCandidate.config.telegramChatTitle || digestCandidate.config.telegramChatId}`
                          : `Kênh Slack: #${String(digestCandidate.config.channelName ?? '').replace(/^#/, '')}`
                      } · Nội dung: Thẻ quá hạn, sắp đến hạn trong ${digestCandidate.config.dueSoonHours ?? 24} giờ, thẻ chưa gán người (+ tóm tắt AI)`}
                    </p>
                  ) : (
                    <p className="text-xs text-[#6B7280] break-words">
                      {digestCandidate?.disabledReason || 'Chỉ bật được khi lịch chỉ đọc Trello và gửi báo cáo vào 1 kênh Slack hoặc nhóm Telegram đã chọn.'}
                    </p>
                  )}
                </div>
              </label>
            </fieldset>
          ) : isNotionCandidate ? (
            <fieldset className="v3-space-y-2 border-t border-[#E7E7E2] pt-3">
              <legend className="text-xs font-semibold text-[#6B7280] mb-1">Chế độ khi tới giờ</legend>
              <label className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs sm:text-sm cursor-pointer ${approvalMode === 'manual' ? 'border-[#FF5701] bg-[#FFF6EE]/40' : 'border-[#E7E7E2] bg-white'}`}>
                <input
                  id="schedule-mode-manual"
                  type="radio"
                  name={`schedule-mode-${message.id}`}
                  checked={approvalMode === 'manual'}
                  onChange={() => setApprovalMode('manual')}
                  className="mt-0.5 text-[#FF5701] focus:ring-[#FF5701]"
                />
                <div className="v3-space-y-0.5">
                  <p className="font-semibold text-[#111827]">Chờ tôi duyệt mỗi lượt</p>
                  <p className="text-xs text-[#4B5563]">Tới giờ, Planora lập kế hoạch mới và chờ bạn duyệt. Chưa có gì được ghi lên công cụ nào.</p>
                </div>
              </label>
              <label className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs sm:text-sm ${!canAutoDigest ? 'opacity-60 cursor-not-allowed border-[#E7E7E2] bg-neutral-50' : approvalMode === 'auto_digest' ? 'cursor-pointer border-[#FF5701] bg-[#FFF6EE]/40' : 'cursor-pointer border-[#E7E7E2] bg-white'}`}>
                <input
                  id="schedule-mode-auto-digest"
                  type="radio"
                  name={`schedule-mode-${message.id}`}
                  checked={approvalMode === 'auto_digest'}
                  disabled={!canAutoDigest}
                  onChange={() => { if (canAutoDigest) setApprovalMode('auto_digest'); }}
                  className="mt-0.5 text-[#FF5701] focus:ring-[#FF5701]"
                />
                <div className="v3-space-y-1 min-w-0">
                  <p className="font-semibold text-[#111827]">Tự gửi bản tin, không cần duyệt lại</p>
                  {canAutoDigest && digestCandidate?.config ? (
                    <p className="text-xs text-[#4B5563] break-words">
                      {`Notion ${digestCandidate.config.workspaceName ?? ''} · Database: ${Array.isArray(digestCandidate.config.databases) ? digestCandidate.config.databases.map((d: any) => typeof d === 'string' ? d : d?.title ?? d?.id).join(', ') : ''} · ${
                        digestCandidate.config.delivery?.service === 'telegram' || digestCandidate.config.telegramChatId
                          ? `Telegram: ${digestCandidate.config.delivery?.label || digestCandidate.config.telegramChatTitle || digestCandidate.config.delivery?.chatId || digestCandidate.config.telegramChatId}`
                          : `Kênh Slack: #${String(digestCandidate.config.delivery?.label ?? digestCandidate.config.channelName ?? '').replace(/^#/, '')}`
                      } · Nội dung: Trang đọc được, trạng thái và thuộc tính`}
                    </p>
                  ) : (
                    <p className="text-xs text-[#6B7280] break-words">
                      {digestCandidate?.disabledReason || 'Chỉ bật được khi lịch chỉ đọc Notion và gửi báo cáo vào 1 kênh Slack hoặc nhóm Telegram đã chọn.'}
                    </p>
                  )}
                </div>
              </label>
            </fieldset>
          ) : isJiraCandidate ? (
            <fieldset className="v3-space-y-2 border-t border-[#E7E7E2] pt-3">
              <legend className="text-xs font-semibold text-[#6B7280] mb-1">Chế độ khi tới giờ</legend>
              <label className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs sm:text-sm cursor-pointer ${approvalMode === 'manual' ? 'border-[#FF5701] bg-[#FFF6EE]/40' : 'border-[#E7E7E2] bg-white'}`}>
                <input
                  id="schedule-mode-manual"
                  type="radio"
                  name={`schedule-mode-${message.id}`}
                  checked={approvalMode === 'manual'}
                  onChange={() => setApprovalMode('manual')}
                  className="mt-0.5 text-[#FF5701] focus:ring-[#FF5701]"
                />
                <div className="v3-space-y-0.5">
                  <p className="font-semibold text-[#111827]">Chờ tôi duyệt mỗi lượt</p>
                  <p className="text-xs text-[#4B5563]">Tới giờ, Planora lập kế hoạch mới và chờ bạn duyệt. Chưa có gì được ghi lên công cụ nào.</p>
                </div>
              </label>
              <label className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs sm:text-sm ${!canAutoDigest ? 'opacity-60 cursor-not-allowed border-[#E7E7E2] bg-neutral-50' : approvalMode === 'auto_digest' ? 'cursor-pointer border-[#FF5701] bg-[#FFF6EE]/40' : 'cursor-pointer border-[#E7E7E2] bg-white'}`}>
                <input
                  id="schedule-mode-auto-digest"
                  type="radio"
                  name={`schedule-mode-${message.id}`}
                  checked={approvalMode === 'auto_digest'}
                  disabled={!canAutoDigest}
                  onChange={() => { if (canAutoDigest) setApprovalMode('auto_digest'); }}
                  className="mt-0.5 text-[#FF5701] focus:ring-[#FF5701]"
                />
                <div className="v3-space-y-1 min-w-0">
                  <p className="font-semibold text-[#111827]">Tự gửi bản tin Standup &amp; Blocker Jira, không cần duyệt lại</p>
                  {canAutoDigest && digestCandidate?.config ? (
                    <p className="text-xs text-[#4B5563] break-words">
                      {`Dự án Jira: ${Array.isArray(digestCandidate.config.projects) ? digestCandidate.config.projects.map((p: any) => typeof p === 'string' ? p : `${p?.siteName ? `${p.siteName} · ` : ''}${p?.projectKey ?? p?.projectName ?? ''}`).join(', ') : ''} · ${
                        digestCandidate.config.telegramChatId || digestCandidate.config.telegramChatTitle
                          ? `Telegram: ${digestCandidate.config.telegramChatTitle || digestCandidate.config.telegramChatId}`
                          : `Kênh Slack: #${String(digestCandidate.config.channelName ?? '').replace(/^#/, '')}`
                      } · Nội dung: Blocker/High Priority, Đang xử lý (In Progress), Mới hoàn thành (+ tóm tắt AI)`}
                    </p>
                  ) : (
                    <p className="text-xs text-[#6B7280] break-words">
                      {digestCandidate?.disabledReason || 'Chỉ bật được khi lịch chỉ đọc Jira (myjira.search_issues) và gửi báo cáo vào 1 kênh Slack hoặc nhóm Telegram đã chọn.'}
                    </p>
                  )}
                </div>
              </label>
            </fieldset>
          ) : isCalendarCandidate ? (
            <>
              {isEligible ? (
                <div className="v3-space-y-3 pt-1" role="radiogroup" aria-label="Chế độ chạy định kỳ">
                  <p className="text-xs font-semibold text-[#6B7280]">Chế độ chạy mỗi lượt</p>
                  <label className="flex items-start gap-2.5 text-sm text-[#111827] cursor-pointer">
                    <input
                      id="schedule-mode-manual"
                      type="radio"
                      name="schedule-approval-mode"
                      checked={approvalMode === 'manual'}
                      onChange={() => setApprovalMode('manual')}
                      className="mt-1 text-[#FF5701] focus:ring-[#FF5701]"
                    />
                    <span>Lập kế hoạch & chờ duyệt từng lượt (Mặc định)</span>
                  </label>
                  <label className="flex items-start gap-2.5 text-sm text-[#111827] cursor-pointer">
                    <input
                      id="schedule-mode-auto-digest"
                      type="radio"
                      name="schedule-approval-mode"
                      checked={approvalMode === 'auto_digest'}
                      onChange={() => setApprovalMode('auto_digest')}
                      className="mt-1 text-[#FF5701] focus:ring-[#FF5701]"
                    />
                    <span>Tự gửi bản tin Lịch theo phạm vi đã khóa (Không cần duyệt lại mỗi sáng)</span>
                  </label>
                  {approvalMode === 'auto_digest' && (
                    <div
                      id="schedule-auto-digest-scope"
                      className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 v3-space-y-1.5"
                    >
                      <p className="font-semibold">Phạm vi tự gửi đã khóa:</p>
                      <p>• Nguồn lịch: {previewCalendars.map((c) => c.summary).join(', ')} ({previewEmail})</p>
                      <p>• Nơi nhận: {previewDestination}</p>
                      <p>• Cam kết an toàn: Chỉ đọc Google Calendar (khung {previewWindowHours} giờ), tự động phát hiện trùng lịch, không tạo/sửa/xoá sự kiện.</p>
                    </div>
                  )}
                </div>
              ) : ineligibleReason ? (
                <p className="text-xs text-[#6B7280]">{ineligibleReason}</p>
              ) : null}
              <p className="text-sm text-[#4B5563] leading-relaxed">Tới giờ, Planora lập kế hoạch mới và chờ bạn duyệt. Chưa có gì được ghi lên công cụ nào.</p>
            </>
          ) : (
            <>
              {digestCandidate && (
                <fieldset className="p-3.5 rounded-xl bg-[#F8F8F6] border border-[#E7E7E2] v3-space-y-2.5">
                  <legend className="text-xs font-semibold text-[#111827] px-1">Chế độ khi tới giờ</legend>
                  <label className={`flex items-start gap-2.5 text-xs sm:text-sm ${isReauthorize ? 'text-[#9CA3AF] cursor-not-allowed' : 'text-[#111827] cursor-pointer'}`}>
                    <input
                      type="radio"
                      name={`schedule-mode-${message.id}`}
                      disabled={isReauthorize}
                      checked={approvalMode === 'manual'}
                      onChange={() => { if (!isReauthorize) setApprovalMode('manual'); }}
                      className="mt-0.5"
                    />
                    <span>Chờ tôi duyệt mỗi lượt (mặc định)</span>
                  </label>
                  <label className={`flex items-start gap-2.5 text-xs sm:text-sm ${digestCandidate.canAutoDigest ? 'text-[#111827] cursor-pointer' : 'text-[#9CA3AF] cursor-not-allowed'}`}>
                    <input
                      type="radio"
                      name={`schedule-mode-${message.id}`}
                      disabled={!digestCandidate.canAutoDigest}
                      checked={approvalMode === 'auto_digest'}
                      onChange={() => setApprovalMode('auto_digest')}
                      className="mt-0.5"
                    />
                    <span>
                      Tự gửi báo cáo, không cần duyệt lại
                      {digestCandidate.canAutoDigest && digestCandidate.config?.source && digestCandidate.config?.destination && (
                        <span className="block text-xs text-[#4B5563] mt-0.5">
                          Nguồn: {digestCandidate.config.source.spreadsheetTitle}
                          {digestCandidate.config.source.sheetName ? ` (${digestCandidate.config.source.sheetName})` : ''} · Đích:{' '}
                          {digestCandidate.config.destination.service === 'slack'
                            ? digestCandidate.config.destination.channelLabel ?? digestCandidate.config.destination.channelId
                            : digestCandidate.config.destination.service === 'gmail'
                              ? `Gmail (${digestCandidate.config.destination.recipientEmail})`
                              : digestCandidate.config.destination.chatLabel ?? digestCandidate.config.destination.chatId}
                        </span>
                      )}
                      {!digestCandidate.canAutoDigest && (digestCandidate.reason || digestCandidate.disabledReason) && (
                        <span className="block text-xs text-[#6B7280] mt-0.5">{digestCandidate.reason ?? digestCandidate.disabledReason}</span>
                      )}
                    </span>
                  </label>
                </fieldset>
              )}
              {sheetsPreview && (
                <div
                  data-testid="sheets-digest-v2-preview"
                  className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs text-[#111827] v3-space-y-1.5"
                >
                  <p className="font-semibold text-emerald-950">Chi tiết phạm vi tự gửi Google Sheets (v2):</p>
                  <p>
                    <span className="font-semibold">Nguồn dữ liệu:</span> {sheetsPreview.sourceConnectionLabel} · Chủ sở hữu/Tài khoản: {sheetsPreview.sourceOwnerLabel}
                  </p>
                  <p>
                    <span className="font-semibold">Bảng tính &amp; vùng đọc:</span> {sheetsPreview.spreadsheetTitle} ({sheetsPreview.sheetName ? `${sheetsPreview.sheetName} · ` : ''}{sheetsPreview.requestedRangeLabel})
                  </p>
                  <p>
                    <span className="font-semibold">Kênh nhận &amp; tài khoản gửi:</span> {sheetsPreview.destinationConnectionLabel} → {sheetsPreview.destinationTargetLabel}
                  </p>
                  {sheetsPreview.crossBoundaryWarning && (
                    <div
                      data-testid="sheets-digest-cross-boundary-warning"
                      role="note"
                      className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 font-medium"
                    >
                      {sheetsPreview.crossBoundaryWarning}
                    </div>
                  )}
                  <div className="pt-1.5 border-t border-emerald-200/80 v3-space-y-1">
                    <label className="flex items-start gap-2 cursor-pointer text-xs text-[#111827]">
                      <input
                        data-testid="checkbox-sheets-include-ai-summary"
                        type="checkbox"
                        checked={includeAiSummary}
                        onChange={(e) => setIncludeAiSummary(e.target.checked)}
                        className="mt-0.5 rounded border-emerald-400 text-[#FF5701] focus:ring-[#FF5701]"
                      />
                      <span>
                        <span className="font-semibold">Tóm tắt bằng AI bên thứ ba:</span>{' '}
                        {includeAiSummary
                          ? 'Gửi tiêu đề cột và tối đa 20 dòng cuối mỗi lượt chạy qua 9router / nhà cung cấp mô hình AI đã cấu hình để viết đoạn nhận xét.'
                          : 'Chỉ thống kê số liệu thuần — tính KPI hoàn toàn trên máy chủ Planora, không gửi dữ liệu ô bảng tính tới mô hình AI bên thứ ba.'}
                      </span>
                    </label>
                  </div>
                </div>
              )}
              {!sheetsPreview && isSheetsCandidate && (approvalMode === 'auto_digest' || isReauthorize) && (
                <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs text-[#111827]">
                  <label className="flex items-start gap-2 cursor-pointer text-xs text-[#111827]">
                    <input
                      data-testid="checkbox-sheets-include-ai-summary"
                      type="checkbox"
                      checked={includeAiSummary}
                      onChange={(e) => setIncludeAiSummary(e.target.checked)}
                      className="mt-0.5 rounded border-emerald-400 text-[#FF5701] focus:ring-[#FF5701]"
                    />
                    <span>
                      <span className="font-semibold">Tóm tắt bằng AI bên thứ ba:</span>{' '}
                      {includeAiSummary
                        ? 'Gửi tiêu đề cột và tối đa 20 dòng cuối mỗi lượt chạy qua 9router / nhà cung cấp mô hình AI đã cấu hình để viết đoạn nhận xét.'
                        : 'Chỉ thống kê số liệu thuần — tính KPI hoàn toàn trên máy chủ Planora, không gửi dữ liệu ô bảng tính tới mô hình AI bên thứ ba.'}
                    </span>
                  </label>
                </div>
              )}
              <p className="text-sm text-[#4B5563] leading-relaxed">
                {approvalMode === 'auto_digest'
                  ? 'Tới giờ, Planora tự đọc bảng tính đã khóa và gửi báo cáo tới kênh đích đã khóa mà không ghi thêm dữ liệu.'
                  : 'Tới giờ, Planora lập kế hoạch mới và chờ bạn duyệt. Chưa có gì được ghi lên công cụ nào.'}
              </p>
            </>
          )}
        </>}
        <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className={primaryScheduleButton} onClick={() => void confirm()}>{(isGithubCandidate || isTrelloCandidate || isJiraCandidate) && !manage && approvalMode === 'auto_digest' ? 'Xác nhận và bật tự gửi' : 'Xác nhận'}</button><button type="button" disabled={busy} className={scheduleButton} onClick={() => { try { if (proposal?.request) sessionStorage.setItem('ati_prefill_prompt', proposal.request); } catch { /* ignore */ } onEdit(); }}>Sửa</button><button type="button" disabled={busy} className={scheduleButton} onClick={() => setIgnored(true)}>Bỏ qua</button></div>
      </>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </div>
    </div>
  </section>;
}
