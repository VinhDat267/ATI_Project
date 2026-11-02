import { useEffect, useRef, useState } from 'react';
import type { SlackIntentService, SlackProposalTargetOverride } from '@wap/tool-schemas';
import { slackAssistantApi, type SlackProposalViewDto } from '../../services/slack-assistant';
import { apiClient } from '../../services/api-client';
import { conversationPath } from '../../routes';
import { slackSessionOwner } from '../../services/slack-connection';

const buttonClass =
  'rounded-lg border border-[#D1D5DB] dark:border-[#4B5563] px-3 py-1.5 text-xs font-medium text-[#111827] dark:text-white disabled:opacity-50';
const primaryClass =
  'rounded-lg bg-[#FF5701] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50';
const inputClass =
  'w-full rounded-lg border border-[#D1D5DB] dark:border-[#4B5563] bg-white dark:bg-[#1E1E1E] px-2.5 py-1.5 text-xs text-[#111827] dark:text-white';

const statusLabels: Record<string, string> = {
  pending: 'Đang chờ xem xét',
  needs_info: 'Cần bổ sung thông tin',
  awaiting_approval: 'Chờ phê duyệt kế hoạch',
  approved: 'Đã phê duyệt',
  rejected: 'Đã từ chối',
  stale: 'Đã hết hiệu lực',
};

const relevanceLabels: Record<string, string> = {
  mention: 'Được nhắc trực tiếp',
  dm: 'Tin nhắn riêng',
  followed_thread: 'Thread đang theo dõi',
  author_match: 'Người gửi quan trọng',
  keyword_match: 'Khớp từ khóa',
};

const serviceLabels: Record<string, string> = {
  trello: 'Trello',
  jira: 'Jira',
  mysheets: 'Google Sheets',
  mycalendar: 'Google Calendar',
  github: 'GitHub',
  gmail: 'Gmail',
  myslack: 'Slack Thread',
};

function formatSlackTs(ts?: string): string {
  if (!ts) return '';
  const seconds = Number(ts.split('.')[0]);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  try {
    return new Date(seconds * 1000).toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export interface SlackProposalCardProps {
  proposal: SlackProposalViewDto;
  navigate: (path: string) => void;
  onUpdated: (updated: SlackProposalViewDto) => void;
}

export function SlackProposalCard({ proposal, navigate, onUpdated }: SlackProposalCardProps) {
  const [replyInThread, setReplyInThread] = useState(true);
  const [instruction, setInstruction] = useState('');
  const [overrideService, setOverrideService] = useState<SlackIntentService | ''>('');
  const [overrideListId, setOverrideListId] = useState('');
  const [overrideProjectKey, setOverrideProjectKey] = useState('');
  const [overrideSpreadsheetId, setOverrideSpreadsheetId] = useState('');
  const [overrideSheet, setOverrideSheet] = useState('');
  const [overrideCalendarId, setOverrideCalendarId] = useState('');
  const [overrideStartIso, setOverrideStartIso] = useState('');
  const [overrideEndIso, setOverrideEndIso] = useState('');
  const [overrideRepo, setOverrideRepo] = useState('');
  const [overrideToEmail, setOverrideToEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [question, setQuestion] = useState('');
  const [planPreview, setPlanPreview] = useState<{
    proposalId: string;
    sourceRevision: string;
    preparedRevision: string;
    id: string;
    planHash: string;
    summary: string;
    steps: Array<{
      id: string;
      tool?: string;
      action?: string;
      description: string;
      args?: Record<string, unknown>;
    }>;
    connections?: Record<string, unknown>;
  } | null>(null);
  const [hasPreparedOnce, setHasPreparedOnce] = useState(false);

  const latestProposalRef = useRef(proposal);
  latestProposalRef.current = proposal;
  const prepareSeqRef = useRef(0);

  const isStaleOrRedacted = proposal.status === 'stale' || proposal.body === null;
  const actionable = ['pending', 'needs_info', 'awaiting_approval'].includes(proposal.status) && !isStaleOrRedacted;
  const isPreviewCurrent =
    planPreview !== null &&
    !isStaleOrRedacted &&
    planPreview.proposalId === proposal.id &&
    (proposal.revision === planPreview.preparedRevision ||
      proposal.revision === planPreview.sourceRevision) &&
    (!proposal.activePlanId || !planPreview.id || proposal.activePlanId === planPreview.id) &&
    (!proposal.planHash || !planPreview.planHash || proposal.planHash === planPreview.planHash);

  useEffect(() => {
    if (isStaleOrRedacted) {
      prepareSeqRef.current += 1;
      setPlanPreview(null);
      setHasPreparedOnce(false);
      setQuestion('');
      setNotice('');
      return;
    }
    if (planPreview && !isPreviewCurrent) {
      setPlanPreview(null);
      setNotice('');
    }
  }, [
    isStaleOrRedacted,
    isPreviewCurrent,
    planPreview,
    proposal.id,
    proposal.revision,
    proposal.status,
    proposal.body,
    proposal.activePlanId,
    proposal.planHash,
  ]);

  const invalidatePreview = () => {
    prepareSeqRef.current += 1;
    setPlanPreview(null);
    setNotice('');
  };
  const channelLabel = proposal.channelId ?? proposal.body?.context?.[0]?.channelId ?? 'Slack';
  const rawTs = proposal.triggerMessageTs ?? proposal.body?.context?.[0]?.ts;
  const formattedTs = formatSlackTs(rawTs);
  const primaryIntent = proposal.body?.decision.intents?.[0];
  const effectiveService = overrideService || primaryIntent?.service || '';
  const isQuestionProposal =
    effectiveService === 'myslack' ||
    (overrideService === '' && primaryIntent?.action === 'question');

  const buildTargetOverride = (): SlackProposalTargetOverride | undefined => {
    const out: SlackProposalTargetOverride = {};
    if (overrideService) out.service = overrideService;
    if (overrideListId.trim()) out.listId = overrideListId.trim();
    if (overrideProjectKey.trim()) out.projectKey = overrideProjectKey.trim();
    if (overrideSpreadsheetId.trim()) out.spreadsheetId = overrideSpreadsheetId.trim();
    if (overrideSheet.trim()) out.sheet = overrideSheet.trim();
    if (overrideCalendarId.trim()) out.calendarId = overrideCalendarId.trim();
    if (overrideStartIso.trim()) out.startIso = overrideStartIso.trim();
    if (overrideEndIso.trim()) out.endIso = overrideEndIso.trim();
    if (overrideRepo.trim()) out.repo = overrideRepo.trim();
    if (overrideToEmail.trim()) out.toEmail = overrideToEmail.trim();
    return Object.keys(out).length > 0 ? out : undefined;
  };

  const handleRefine = async () => {
    if (busy) return;
    const owns = slackSessionOwner();
    const startId = proposal.id;
    const startRevision = proposal.revision;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await slackAssistantApi.refineProposal(proposal.id, proposal.revision);
      const latest = latestProposalRef.current;
      const latestStale = latest.status === 'stale' || latest.body === null;
      if (owns() && latest.id === startId && latest.revision === startRevision && !latestStale) {
        onUpdated(res.proposal);
        navigate(conversationPath(res.conversationId));
      }
    } catch (e: any) {
      if (owns()) {
        setError(
          e?.status === 409
            ? 'Đề xuất đã thay đổi hoặc nguồn không còn hiệu lực. Hãy tải lại hộp thư.'
            : 'Chưa mở được hội thoại cho đề xuất này.',
        );
      }
    } finally {
      if (owns()) setBusy(false);
    }
  };

  const handlePrepare = async () => {
    if (busy) return;
    const owns = slackSessionOwner();
    const reqSeq = ++prepareSeqRef.current;
    const startId = proposal.id;
    const startRevision = proposal.revision;
    setBusy(true);
    setError('');
    setNotice('');
    setQuestion('');
    try {
      const targetOverride = buildTargetOverride();
      const res = await slackAssistantApi.prepareProposal(proposal.id, {
        expectedRevision: proposal.revision,
        instruction: instruction.trim() || undefined,
        replyInThread,
        ...(targetOverride ? { targetOverride } : {}),
      });
      const latest = latestProposalRef.current;
      const latestStale = latest.status === 'stale' || latest.body === null;
      if (
        owns() &&
        reqSeq === prepareSeqRef.current &&
        latest.id === startId &&
        latest.revision === startRevision &&
        !latestStale
      ) {
        onUpdated(res.proposal);
        if (res.status === 'needs_info') {
          setPlanPreview(null);
          setQuestion(
            res.clarification || res.question || 'Vui lòng làm rõ thêm thông tin trước khi tạo kế hoạch.',
          );
        } else if (res.plan) {
          const resolvedId = res.planId ?? res.plan.id ?? res.proposal?.activePlanId ?? '';
          const resolvedHash = res.planHash ?? res.plan.planHash ?? res.proposal?.planHash ?? '';
          setHasPreparedOnce(true);
          setPlanPreview({
            proposalId: startId,
            sourceRevision: startRevision,
            preparedRevision: res.proposal?.revision ?? startRevision,
            id: resolvedId,
            planHash: resolvedHash,
            summary: res.plan.summary,
            steps: res.plan.steps,
            connections: res.plan.connections,
          });
          setNotice('Đã tạo bản xem trước kế hoạch. Kiểm tra các bước trước khi phê duyệt.');
        }
      }
    } catch (e: any) {
      if (owns() && reqSeq === prepareSeqRef.current) {
        setError(
          e?.status === 409
            ? 'Đề xuất hoặc cấu hình dịch vụ chưa sẵn sàng. Hãy kiểm tra kết nối dịch vụ hoặc tải lại.'
            : 'Chưa tạo được bản xem trước kế hoạch.',
        );
      }
    } finally {
      if (owns()) setBusy(false);
    }
  };

  const handleApprove = async () => {
    const planId = isPreviewCurrent ? planPreview?.id : undefined;
    if (!planId) {
      setError('Vui lòng bấm "Xem trước kế hoạch" để kiểm tra chi tiết trước khi phê duyệt.');
      return;
    }
    if (busy) return;
    const owns = slackSessionOwner();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiClient.approvePlan(planId);
      if (owns()) {
        setNotice('Đã gửi lệnh phê duyệt và bắt đầu thực thi kế hoạch.');
      }
    } catch {
      if (owns()) {
        setError('Chưa phê duyệt được kế hoạch. Nguồn tin nhắn có thể đã thay đổi.');
      }
    } finally {
      if (owns()) setBusy(false);
    }
  };

  const handleReject = async () => {
    if (busy) return;
    const owns = slackSessionOwner();
    const startId = proposal.id;
    const startRevision = proposal.revision;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await slackAssistantApi.rejectProposal(proposal.id, proposal.revision);
      const latest = latestProposalRef.current;
      if (owns() && latest.id === startId && latest.revision === startRevision) {
        prepareSeqRef.current += 1;
        setPlanPreview(null);
        onUpdated(res.proposal);
        setNotice('Đã từ chối đề xuất.');
      }
    } catch {
      if (owns()) {
        setError('Chưa từ chối được đề xuất. Hãy tải lại hộp thư.');
      }
    } finally {
      if (owns()) setBusy(false);
    }
  };

  return (
    <article className="rounded-xl border border-[#E7E7E2] dark:border-[#333333] bg-white dark:bg-[#1E1E1E] p-4 space-y-3 text-[#111827] dark:text-white">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center rounded-full bg-[#F8F8F6] dark:bg-[#2A2A2A] px-2.5 py-0.5 text-xs font-medium">
          {statusLabels[proposal.status] ?? proposal.status}
        </span>
        <span className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
          Kênh {channelLabel} · Phiên bản {proposal.revision}
          {formattedTs ? ` · ${formattedTs}` : ''}
        </span>
      </div>

      {isStaleOrRedacted ? (
        <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF]">
          Nguồn tin nhắn đã thay đổi hoặc hết hạn xem lại. Nội dung nguồn đã được ẩn để đảm bảo an toàn dữ liệu.
        </p>
      ) : (
        proposal.body && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-base font-semibold">{proposal.body.decision.title}</h3>
              <span className="rounded-md bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-200">
                {relevanceLabels[proposal.body.decision.relevance.kind] ?? proposal.body.decision.relevance.kind}
              </span>
            </div>
            <p className="text-sm text-[#4B5563] dark:text-[#9CA3AF]">{proposal.body.decision.rationale}</p>
            {proposal.body.decision.question && (
              <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                {proposal.body.decision.question}
              </p>
            )}
            {proposal.body.context.length > 0 && (
              <blockquote className="rounded-lg border-l-2 border-[#FF5701] bg-[#F8F8F6] dark:bg-[#262626] p-2.5 text-xs text-[#374151] dark:text-[#D1D5DB] space-y-1">
                {proposal.body.context.map((msg) => {
                  const msgTime = formatSlackTs(msg.ts);
                  return (
                    <p key={msg.ts}>
                      <span className="font-semibold">{msg.user}</span>
                      {msgTime ? <span className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF]"> ({msgTime})</span> : null}
                      <span>:</span> {msg.text}
                    </p>
                  );
                })}
              </blockquote>
            )}
            {(proposal.body.decision.intents ?? []).length > 0 && (
              <ul className="space-y-1 text-xs text-[#374151] dark:text-[#D1D5DB]">
                {(proposal.body.decision.intents ?? []).map((intent, idx) => (
                  <li key={idx} className="flex flex-wrap items-center gap-1.5">
                    <span>
                      • [{intent.service}] {intent.summary}
                    </span>
                    {serviceLabels[intent.service] && (
                      <span className="rounded bg-[#F3F4F6] dark:bg-[#2D2D2D] px-1.5 py-0.5 text-[11px] font-medium text-[#4B5563] dark:text-[#D1D5DB]">
                        {serviceLabels[intent.service]}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      )}

      {question && (
        <p role="status" className="rounded-lg bg-amber-50 dark:bg-amber-950/40 p-2.5 text-xs text-amber-800 dark:text-amber-200">
          {question}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-green-700 dark:text-green-300">
          {notice}
        </p>
      )}

      {isPreviewCurrent && planPreview && (
        <div className="rounded-lg border border-[#D1D5DB] dark:border-[#4B5563] p-3 space-y-2">
          <p className="text-xs font-semibold">{planPreview.summary}</p>
          <ol className="list-decimal list-inside space-y-1.5 text-xs text-[#4B5563] dark:text-[#9CA3AF]">
            {planPreview.steps.map((step) => (
              <li key={step.id} className="space-y-1">
                <span className="font-medium text-[#111827] dark:text-white">{step.description}</span>
                {step.tool && (
                  <span className="ml-1.5 rounded bg-[#F3F4F6] dark:bg-[#2D2D2D] px-1.5 py-0.5 font-mono text-[11px]">
                    {step.tool}
                  </span>
                )}
                {step.args && Object.keys(step.args).length > 0 && (
                  <dl className="ml-4 grid grid-cols-1 gap-0.5 rounded bg-[#F8F8F6] dark:bg-[#262626] p-2 text-[11px]">
                    {Object.entries(step.args).map(([key, val]) => (
                      <div key={key} className="flex flex-wrap gap-1">
                        <dt className="font-semibold text-[#374151] dark:text-[#D1D5DB]">{key}:</dt>
                        <dd className="break-all font-mono">
                          {typeof val === 'string' ? val : JSON.stringify(val)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ol>
          {planPreview.connections && Object.keys(planPreview.connections).length > 0 && (
            <div className="border-t border-[#E7E7E2] dark:border-[#333333] pt-2 text-[11px] text-[#4B5563] dark:text-[#9CA3AF] space-y-1">
              <p className="font-semibold text-[#111827] dark:text-white">Danh tính thực thi & phạm vi kết nối:</p>
              {Object.entries(planPreview.connections).map(([serviceKey, connVal]) => {
                if (!connVal || typeof connVal !== 'object') return null;
                if (serviceKey === 'myslack') {
                  const bindings = (connVal as { bindings?: Record<string, Record<string, unknown>> }).bindings ?? {};
                  return Object.entries(bindings).map(([bindKey, b]) => (
                    <div key={`myslack-${bindKey}`} className="font-mono break-all">
                      {serviceLabels[serviceKey] ?? serviceKey}: workspace={String(b.workspaceId ?? '')} actor=
                      {String(b.slackUserId ?? '')} connection={String(b.connectionId ?? bindKey)}
                    </div>
                  ));
                }
                const c = connVal as Record<string, unknown>;
                const details = Object.entries(c)
                  .filter(([, v]) => v !== undefined && v !== null && v !== '')
                  .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : String(v)}`)
                  .join(' ');
                return (
                  <div key={serviceKey} className="font-mono break-all">
                    {serviceLabels[serviceKey] ?? serviceKey}: {details}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {actionable && (
        <div className="space-y-2 pt-2 border-t border-[#E7E7E2] dark:border-[#333333]">
          {isQuestionProposal && (
            <p className="text-xs text-[#FF5701] font-medium">
              Đề xuất phản hồi câu hỏi Slack: nhập câu trả lời vào ô bên dưới để lên kế hoạch gửi trực tiếp vào thread nguồn.
            </p>
          )}
          <label className="block text-xs space-y-1">
            <span>Ghi chú điều chỉnh (tùy chọn, ví dụ hạn chót cụ thể)</span>
            <input
              className={inputClass}
              placeholder={
                isQuestionProposal
                  ? 'Nhập nội dung câu trả lời gửi vào thread Slack…'
                  : 'Ví dụ: Hạn chót 2026-11-15 hoặc bổ sung người phụ trách…'
              }
              value={instruction}
              maxLength={1000}
              disabled={busy}
              onChange={(e) => {
                setInstruction(e.target.value);
                invalidatePreview();
              }}
            />
          </label>
          <details className="rounded-lg border border-[#E7E7E2] dark:border-[#333333] bg-[#FAFAFA] dark:bg-[#242424] p-2.5 text-xs">
            <summary className="cursor-pointer font-medium text-[#374151] dark:text-[#D1D5DB]">
              Đổi dịch vụ đích hoặc điền tham số đích cho đề xuất này
            </summary>
            <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <label className="block space-y-1 sm:col-span-2">
                <span>Dịch vụ đích ghi đè</span>
                <select
                  aria-label="Dịch vụ đích ghi đè"
                  className={inputClass}
                  value={overrideService}
                  disabled={busy}
                  onChange={(e) => {
                    setOverrideService(e.target.value as SlackIntentService | '');
                    invalidatePreview();
                  }}
                >
                  <option value="">Theo gợi ý mặc định ({serviceLabels[primaryIntent?.service ?? ''] ?? (primaryIntent?.service || 'Tự động')})</option>
                  <option value="trello">Trello — Tạo thẻ công việc</option>
                  <option value="jira">Jira — Tạo Issue / Bug</option>
                  <option value="mysheets">Google Sheets — Ghi dòng tiến độ</option>
                  <option value="mycalendar">Google Calendar — Đặt lịch họp</option>
                  <option value="github">GitHub — Tạo Issue mã nguồn</option>
                  <option value="gmail">Gmail — Gửi email thông báo</option>
                  <option value="myslack">Slack — Phản hồi trực tiếp vào thread</option>
                </select>
              </label>
              {effectiveService === 'trello' && (
                <label className="block space-y-1 sm:col-span-2">
                  <span>ID danh sách Trello (List ID)</span>
                  <input
                    className={inputClass}
                    placeholder="Ví dụ: list-sprint-1"
                    value={overrideListId}
                    disabled={busy}
                    onChange={(e) => {
                      setOverrideListId(e.target.value);
                      invalidatePreview();
                    }}
                  />
                </label>
              )}
              {effectiveService === 'jira' && (
                <label className="block space-y-1 sm:col-span-2">
                  <span>Mã dự án Jira (Project Key)</span>
                  <input
                    className={inputClass}
                    placeholder="Ví dụ: OPS"
                    value={overrideProjectKey}
                    disabled={busy}
                    onChange={(e) => {
                      setOverrideProjectKey(e.target.value);
                      invalidatePreview();
                    }}
                  />
                </label>
              )}
              {effectiveService === 'mysheets' && (
                <>
                  <label className="block space-y-1">
                    <span>ID bảng tính Google Sheets</span>
                    <input
                      className={inputClass}
                      placeholder="Spreadsheet ID"
                      value={overrideSpreadsheetId}
                      disabled={busy}
                      onChange={(e) => {
                        setOverrideSpreadsheetId(e.target.value);
                        invalidatePreview();
                      }}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span>Tên trang tính (Sheet)</span>
                    <input
                      className={inputClass}
                      placeholder="Sheet1"
                      value={overrideSheet}
                      disabled={busy}
                      onChange={(e) => {
                        setOverrideSheet(e.target.value);
                        invalidatePreview();
                      }}
                    />
                  </label>
                </>
              )}
              {effectiveService === 'mycalendar' && (
                <>
                  <label className="block space-y-1 sm:col-span-2">
                    <span>ID lịch Google Calendar</span>
                    <input
                      className={inputClass}
                      placeholder="primary"
                      value={overrideCalendarId}
                      disabled={busy}
                      onChange={(e) => {
                        setOverrideCalendarId(e.target.value);
                        invalidatePreview();
                      }}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span>Thời gian bắt đầu (ISO 8601)</span>
                    <input
                      className={inputClass}
                      placeholder="2026-11-12T09:00:00+07:00"
                      value={overrideStartIso}
                      disabled={busy}
                      onChange={(e) => {
                        setOverrideStartIso(e.target.value);
                        invalidatePreview();
                      }}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span>Thời gian kết thúc (ISO 8601)</span>
                    <input
                      className={inputClass}
                      placeholder="2026-11-12T09:30:00+07:00"
                      value={overrideEndIso}
                      disabled={busy}
                      onChange={(e) => {
                        setOverrideEndIso(e.target.value);
                        invalidatePreview();
                      }}
                    />
                  </label>
                </>
              )}
              {effectiveService === 'github' && (
                <label className="block space-y-1 sm:col-span-2">
                  <span>Kho mã nguồn GitHub (owner/repo)</span>
                  <input
                    className={inputClass}
                    placeholder="Ví dụ: acme/platform"
                    value={overrideRepo}
                    disabled={busy}
                    onChange={(e) => {
                      setOverrideRepo(e.target.value);
                      invalidatePreview();
                    }}
                  />
                </label>
              )}
              {effectiveService === 'gmail' && (
                <label className="block space-y-1 sm:col-span-2">
                  <span>Email người nhận (To)</span>
                  <input
                    className={inputClass}
                    placeholder="Ví dụ: ops@acme.vn"
                    value={overrideToEmail}
                    disabled={busy}
                    onChange={(e) => {
                      setOverrideToEmail(e.target.value);
                      invalidatePreview();
                    }}
                  />
                </label>
              )}
            </div>
          </details>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={replyInThread}
              disabled={busy}
              onChange={(e) => {
                setReplyInThread(e.target.checked);
                invalidatePreview();
              }}
            />
            Phản hồi lại vào thread nguồn kèm liên kết kết quả
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass} disabled={busy} onClick={() => void handleRefine()}>
              Trao đổi thêm trong Chat
            </button>
            <button type="button" className={buttonClass} disabled={busy} onClick={() => void handlePrepare()}>
              Xem trước kế hoạch
            </button>
            {(planPreview || hasPreparedOnce || proposal.activePlanId) && (
              <button type="button" className={primaryClass} disabled={busy} onClick={() => void handleApprove()}>
                Phê duyệt và thực thi
              </button>
            )}
            <button type="button" className={buttonClass} disabled={busy} onClick={() => void handleReject()}>
              Từ chối đề xuất
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
