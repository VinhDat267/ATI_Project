import { useState } from 'react';
import { slackAssistantApi, type SlackProposalViewDto } from '../../services/slack-assistant';
import { apiClient } from '../../services/api-client';
import { conversationPath } from '../../routes';
import { slackSessionOwner } from '../../services/slack-connection';

const buttonClass =
  'rounded-lg border border-[#D1D5DB] dark:border-[#4B5563] px-3 py-1.5 text-xs font-medium text-[#111827] dark:text-white disabled:opacity-50';
const primaryClass =
  'rounded-lg bg-[#FF5701] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50';

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

export interface SlackProposalCardProps {
  proposal: SlackProposalViewDto;
  navigate: (path: string) => void;
  onUpdated: (updated: SlackProposalViewDto) => void;
}

export function SlackProposalCard({ proposal, navigate, onUpdated }: SlackProposalCardProps) {
  const [replyInThread, setReplyInThread] = useState(true);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [question, setQuestion] = useState('');
  const [planPreview, setPlanPreview] = useState<{
    id: string;
    planHash: string;
    summary: string;
    steps: Array<{ id: string; tool?: string; action?: string; description: string }>;
  } | null>(null);

  const isStaleOrRedacted = proposal.status === 'stale' || proposal.body === null;
  const actionable = ['pending', 'needs_info', 'awaiting_approval'].includes(proposal.status) && !isStaleOrRedacted;
  const channelLabel = proposal.channelId ?? proposal.body?.context?.[0]?.channelId ?? 'Slack';

  const handleRefine = async () => {
    if (busy) return;
    const owns = slackSessionOwner();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await slackAssistantApi.refineProposal(proposal.id, proposal.revision);
      if (owns()) {
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
    setBusy(true);
    setError('');
    setNotice('');
    setQuestion('');
    try {
      const res = await slackAssistantApi.prepareProposal(proposal.id, {
        expectedRevision: proposal.revision,
        instruction: instruction.trim() || undefined,
        replyInThread,
      });
      if (owns()) {
        onUpdated(res.proposal);
        if (res.status === 'needs_info') {
          setPlanPreview(null);
          setQuestion(
            res.clarification || res.question || 'Vui lòng làm rõ thêm thông tin trước khi tạo kế hoạch.',
          );
        } else if (res.plan) {
          const resolvedId = res.planId ?? res.plan.id ?? res.proposal?.activePlanId ?? '';
          const resolvedHash = res.planHash ?? res.plan.planHash ?? res.proposal?.planHash ?? '';
          setPlanPreview({
            id: resolvedId,
            planHash: resolvedHash,
            summary: res.plan.summary,
            steps: res.plan.steps,
          });
          setNotice('Đã tạo bản xem trước kế hoạch. Kiểm tra các bước trước khi phê duyệt.');
        }
      }
    } catch (e: any) {
      if (owns()) {
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
    const planId = planPreview?.id || proposal.activePlanId;
    if (!planId || busy) return;
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
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await slackAssistantApi.rejectProposal(proposal.id, proposal.revision);
      if (owns()) {
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
              <blockquote className="rounded-lg border-l-2 border-[#FF5701] bg-[#F8F8F6] dark:bg-[#262626] p-2.5 text-xs text-[#374151] dark:text-[#D1D5DB]">
                {proposal.body.context.map((msg) => (
                  <p key={msg.ts}>
                    <span className="font-semibold">{msg.user}:</span> {msg.text}
                  </p>
                ))}
              </blockquote>
            )}
            {(proposal.body.decision.intents ?? []).length > 0 && (
              <ul className="space-y-1 text-xs text-[#374151] dark:text-[#D1D5DB]">
                {(proposal.body.decision.intents ?? []).map((intent, idx) => (
                  <li key={idx}>
                    • [{intent.service}] {intent.summary}
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

      {planPreview && (
        <div className="rounded-lg border border-[#D1D5DB] dark:border-[#4B5563] p-3 space-y-2">
          <p className="text-xs font-semibold">{planPreview.summary}</p>
          <ol className="list-decimal list-inside space-y-1 text-xs text-[#4B5563] dark:text-[#9CA3AF]">
            {planPreview.steps.map((step) => (
              <li key={step.id}>{step.description}</li>
            ))}
          </ol>
        </div>
      )}

      {actionable && (
        <div className="space-y-2 pt-2 border-t border-[#E7E7E2] dark:border-[#333333]">
          <label className="block text-xs space-y-1">
            <span>Ghi chú điều chỉnh (tùy chọn, ví dụ hạn chót cụ thể)</span>
            <input
              className="w-full rounded-lg border border-[#D1D5DB] dark:border-[#4B5563] bg-white dark:bg-[#1E1E1E] px-2.5 py-1.5 text-xs"
              value={instruction}
              maxLength={1000}
              disabled={busy}
              onChange={(e) => setInstruction(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={replyInThread}
              disabled={busy}
              onChange={(e) => setReplyInThread(e.target.checked)}
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
            {(planPreview || proposal.activePlanId) && (
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
