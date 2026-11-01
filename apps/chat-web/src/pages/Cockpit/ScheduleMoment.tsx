import { useEffect, useRef, useState } from 'react';
import type { ScheduleApprovalMode, ScheduleView } from '@wap/tool-schemas';
import type { ChatMessage } from '../../types';
import { apiClient } from '../../services/api-client';
import { describeRecurrence, formatRunTime, scheduleLabel } from '../../services/schedule-text';
import { schedulesChanged } from '../../hooks/use-schedules';
import { useChatStore } from '../../store/chat-store';
import { serviceName, servicePalette } from './presentation';
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
export function ScheduleMoment({ message, convId, navigate, onEdit }: { message: ChatMessage; convId: string; navigate: (path: string) => void; onEdit: () => void }) {
  const [ignored, setIgnored] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState<ScheduleView | null>(null);
  const [approvalMode, setApprovalMode] = useState<ScheduleApprovalMode>('manual');
  const locked = useRef(false);
  const currentMessage = useRef(message.id); currentMessage.current = message.id;
  useEffect(() => { setIgnored(false); setConfirmed(null); setApprovalMode('manual'); }, [message.id]);
  const metadata = message.metadata!;
  const schedule = confirmed ?? metadata.schedule;
  const proposal = metadata.proposal;
  const previous = metadata.previous;
  const digestCandidate = metadata.digestCandidate as any;
  const isTelegramCandidate = Boolean(
    digestCandidate &&
      (Array.isArray(digestCandidate?.config?.sources) ||
        typeof digestCandidate?.config?.telegramUserId === 'string' ||
        (metadata.services?.includes('telegram') &&
          !('eligible' in digestCandidate) &&
          !('configPreview' in digestCandidate) &&
          !digestCandidate?.config?.source))
  );
  const isGithubCandidate = Boolean(
    !isTelegramCandidate &&
      digestCandidate &&
      (Array.isArray(digestCandidate?.config?.repos) || metadata.services?.includes('github'))
  );
  const isCalendarCandidate = Boolean(
    !isTelegramCandidate &&
      !isGithubCandidate &&
      digestCandidate &&
      ('configPreview' in digestCandidate ||
        'disabledReason' in digestCandidate ||
        'eligible' in digestCandidate ||
        typeof digestCandidate?.config?.source === 'string' ||
        metadata.services?.includes('mycalendar') ||
        metadata.services?.includes('calendar'))
  );
  const canAutoDigest = digestCandidate?.canAutoDigest === true;
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
      const result = isGithubCandidate
        ? await apiClient.confirmSchedule(
            convId,
            message.id,
            !manage && approvalMode === 'auto_digest' ? { approvalMode: 'auto_digest' } : undefined
          )
        : isCalendarCandidate
          ? isEligible
            ? await apiClient.confirmSchedule(convId, message.id, approvalMode)
            : await apiClient.confirmSchedule(convId, message.id)
          : approvalMode === 'auto_digest'
            ? await apiClient.confirmSchedule(convId, message.id, 'auto_digest')
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
  const isAutoDigestActive = approvalMode === 'auto_digest' || schedule?.kind === 'calendar_digest' || schedule?.kind === 'sheets_digest';
  return <section data-moment="schedule" className="w-full min-w-0 max-w-3xl mx-auto v3-space-y-5">
    <p className="text-xs uppercase tracking-wider text-[#6B7280]">ATI · Lịch chạy workflow</p>
    <h1 tabIndex={-1} className="font-display text-3xl sm:text-4xl font-bold text-[#111827] [overflow-wrap:anywhere]">{title}</h1>
    <div className="bg-white border border-[#E7E7E2] rounded-2xl shadow-soft-card p-5 sm:p-6 v3-space-y-5 min-w-0">
      {!manage && scheduleServices.length > 0 && (
        <WorkflowFlowCanvas services={scheduleServices} isAutoDigest={isAutoDigestActive} mode="schedule" />
      )}
      {schedule ? <>
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="text-sm font-semibold text-[#111827]">{scheduleLabel(schedule)}</p>
          {(schedule.kind === 'calendar_digest' || schedule.kind === 'github_digest' || schedule.kind === 'sheets_digest') && (
            <span data-schedule-kind={schedule.kind} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              Tự gửi
            </span>
          )}
        </div>
        {schedule.kind === 'telegram_digest' && (
          <p data-schedule-kind={schedule.kind} className="text-xs font-semibold text-[#0369A1]">
            Tự gửi Telegram{schedule.digest && 'chatTitle' in schedule.digest && schedule.digest.chatTitle ? ` · ${schedule.digest.chatTitle}` : ''}
          </p>
        )}
        <p className="text-sm text-[#4B5563]">{describeRecurrence(schedule.recurrence)}</p>
        <p className="text-sm text-[#4B5563] [overflow-wrap:anywhere]">{schedule.request}</p>
        <ScheduleActions schedule={schedule} navigate={navigate} onChanged={setConfirmed} onConflict={() => reloadScheduleConversation(convId)} /></>
        : proposal && <>{manage ? <p className="text-sm text-[#4B5563]">{proposal.action === 'cancel' ? 'Lịch đã hủy không bật lại được.' : proposal.summary}</p> : <>
          {proposal.action === 'update' && previous?.name !== proposal.name && change('Tên lịch', previous?.name, proposal.name)}
          {change('Thời gian', previous ? describeRecurrence(previous.recurrence) : undefined, proposal.recurrence ? describeRecurrence(proposal.recurrence) : undefined)}
          {change('Việc sẽ làm', previous?.request, proposal.request)}
          <div className="flex flex-wrap gap-2">{metadata.services?.map(id => <span key={id} className="inline-flex items-center gap-2 text-xs text-[#4B5563]"><span aria-hidden="true" className={`w-6 h-6 rounded-lg border flex items-center justify-center ${servicePalette(id).icon}`}><ServiceLogo service={id} className="w-3.5 h-3.5" /></span>{serviceName(id, [])}</span>)}</div>
          {!!metadata.nextRuns?.length && <div className="text-xs text-[#4B5563] v3-space-y-1"><p className="font-semibold">Lần chạy tới:</p>{metadata.nextRuns.map(time => <p key={time}>{formatRunTime(time)}</p>)}</div>}
          {isTelegramCandidate ? (
            <>
              <fieldset className="border border-[#E7E7E2] rounded-xl p-3.5 bg-[#F8F8F6] v3-space-y-2.5">
                <legend className="text-xs font-semibold text-[#6B7280] px-1">Chế độ khi tới giờ</legend>
                <label className="flex items-start gap-2.5 text-xs sm:text-sm text-[#111827] cursor-pointer">
                  <input
                    id="schedule-mode-manual"
                    type="radio"
                    name={`schedule-mode-${message.id}`}
                    value="manual"
                    checked={approvalMode === 'manual'}
                    onChange={() => setApprovalMode('manual')}
                    className="mt-1"
                  />
                  <span>
                    <strong className="font-semibold">Chờ tôi duyệt mỗi lượt</strong> (Mặc định) — Tới giờ, ATI lập kế hoạch mới và chờ bạn duyệt.
                  </span>
                </label>
                <label className={`flex items-start gap-2.5 text-xs sm:text-sm ${digestCandidate.canAutoDigest ? 'text-[#111827] cursor-pointer' : 'text-[#6B7280] opacity-70 cursor-not-allowed'}`}>
                  <input
                    id="schedule-mode-auto-digest"
                    type="radio"
                    name={`schedule-mode-${message.id}`}
                    value="auto_digest"
                    disabled={!digestCandidate.canAutoDigest}
                    checked={approvalMode === 'auto_digest'}
                    onChange={() => digestCandidate.canAutoDigest && setApprovalMode('auto_digest')}
                    className="mt-1"
                  />
                  <span className="v3-space-y-1">
                    <span className="block">
                      <strong className="font-semibold">Tự gửi bản tin, không cần duyệt lại</strong>
                    </span>
                    {digestCandidate.canAutoDigest && digestCandidate.config && (
                      <span className="block text-xs text-[#4B5563]">
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
              <p className="text-sm text-[#4B5563] leading-relaxed">
                {approvalMode === 'auto_digest'
                  ? 'Tới giờ, ATI chỉ đọc dữ liệu từ các dịch vụ nguồn đã chọn và tự động gửi bản tin về đúng cuộc trò chuyện Telegram đã khóa.'
                  : 'Tới giờ, ATI lập kế hoạch mới và chờ bạn duyệt. Chưa có gì được ghi lên công cụ nào.'}
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
                  <p className="text-xs text-[#4B5563]">Tới giờ, ATI lập kế hoạch mới và chờ bạn duyệt. Chưa có gì được ghi lên công cụ nào.</p>
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
                      {`Repo: ${digestCandidate.config.repos.join(', ')} · Kênh Slack: #${digestCandidate.config.channelName.replace(/^#/, '')} · Nội dung: Issue mới, PR chờ review quá ${digestCandidate.config.staleDays} ngày, Issue chưa ai nhận (+ tóm tắt AI)`}
                    </p>
                  ) : (
                    <p className="text-xs text-[#6B7280] break-words">
                      {digestCandidate?.disabledReason || 'Chỉ bật được khi lịch chỉ đọc GitHub và gửi báo cáo vào 1 kênh Slack đã chọn.'}
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
              <p className="text-sm text-[#4B5563] leading-relaxed">Tới giờ, ATI lập kế hoạch mới và chờ bạn duyệt. Chưa có gì được ghi lên công cụ nào.</p>
            </>
          ) : (
            <>
              {digestCandidate && (
                <fieldset className="p-3.5 rounded-xl bg-[#F8F8F6] border border-[#E7E7E2] v3-space-y-2.5">
                  <legend className="text-xs font-semibold text-[#111827] px-1">Chế độ khi tới giờ</legend>
                  <label className="flex items-start gap-2.5 text-xs sm:text-sm text-[#111827] cursor-pointer">
                    <input
                      type="radio"
                      name={`schedule-mode-${message.id}`}
                      checked={approvalMode === 'manual'}
                      onChange={() => setApprovalMode('manual')}
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
                      {digestCandidate.canAutoDigest && digestCandidate.config && (
                        <span className="block text-xs text-[#4B5563] mt-0.5">
                          Nguồn: {digestCandidate.config.source.spreadsheetTitle}
                          {digestCandidate.config.source.sheetName ? ` (${digestCandidate.config.source.sheetName})` : ''} · Đích:{' '}
                          {digestCandidate.config.destination.service === 'slack'
                            ? digestCandidate.config.destination.channelLabel ?? digestCandidate.config.destination.channelId
                            : digestCandidate.config.destination.chatLabel ?? digestCandidate.config.destination.chatId}
                        </span>
                      )}
                      {!digestCandidate.canAutoDigest && digestCandidate.reason && (
                        <span className="block text-xs text-[#6B7280] mt-0.5">{digestCandidate.reason}</span>
                      )}
                    </span>
                  </label>
                </fieldset>
              )}
              <p className="text-sm text-[#4B5563] leading-relaxed">
                {approvalMode === 'auto_digest'
                  ? 'Tới giờ, ATI tự đọc bảng tính đã khóa và gửi báo cáo tới kênh đích đã khóa mà không ghi thêm dữ liệu.'
                  : 'Tới giờ, ATI lập kế hoạch mới và chờ bạn duyệt. Chưa có gì được ghi lên công cụ nào.'}
              </p>
            </>
          )}
        </>}
        <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className={primaryScheduleButton} onClick={() => void confirm()}>{isGithubCandidate && !manage && approvalMode === 'auto_digest' ? 'Xác nhận và bật tự gửi' : 'Xác nhận'}</button><button type="button" disabled={busy} className={scheduleButton} onClick={onEdit}>Sửa</button><button type="button" disabled={busy} className={scheduleButton} onClick={() => setIgnored(true)}>Bỏ qua</button></div>
      </>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  </section>;
}
