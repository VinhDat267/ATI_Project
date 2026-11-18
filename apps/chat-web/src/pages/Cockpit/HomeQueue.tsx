// Trang chủ (redesign 11/2026): việc đang chờ bạn, ngay dưới ô lệnh.
// "Cần bạn" lấy từ GET /api/conversations/attention (kế hoạch chờ duyệt, lượt chạy cần xử lý) và số lịch chạy chờ xác nhận.
// Hội thoại gần đây nằm ở thanh bên (SidebarRecent), không lặp lại ở đây.
// Không có gì đang chờ thì không hiện; lỗi chỉ hiện trong khối, kèm nút thử lại.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { apiClient } from '../../services/api-client';
import { getActiveWorkspaceSelection, subscribeWorkspace } from '../../services/workspace-storage';
import { useSchedulePendingCount } from '../../hooks/use-schedules';
import type { AttentionSummary, User } from '../../types';

const RUN_LABEL: Record<AttentionSummary['needsAttention'][number]['status'], string> = {
  partial: 'Chạy dở, cần xử lý',
  unknown: 'Chưa rõ kết quả',
  reconciliation_required: 'Cần đối soát',
};
const ROW = 'group flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-[#F8F4EE] dark:hover:bg-[#1F1A16] transition-colors';
const ACTION = 'flex-shrink-0 text-sm font-medium text-[#1A0E08] dark:text-[#F3EEE8] underline underline-offset-2 decoration-[#D9D0C4] group-hover:decoration-current';
const time = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });

interface HomeQueueProps {
  user: User | null;
  onOpenConversation: (id: string) => void;
  navigate: (path: string) => void;
}

export function HomeQueue(props: HomeQueueProps) {
  const workspace = useSyncExternalStore(subscribeWorkspace, getActiveWorkspaceSelection);
  return <WorkspaceHomeQueue key={JSON.stringify([workspace.id, props.user?.id])} workspace={workspace} {...props} />;
}

function WorkspaceHomeQueue({ user, onOpenConversation, navigate, workspace }: HomeQueueProps & {
  workspace: ReturnType<typeof getActiveWorkspaceSelection>;
}) {
  const schedules = useSchedulePendingCount(user);
  const [attention, setAttention] = useState<AttentionSummary | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let mounted = true;
    const isCurrent = () => mounted && workspace === getActiveWorkspaceSelection();
    setError(false);
    if (typeof apiClient.getAttention !== 'function') return;
    void Promise.resolve()
      .then(() => apiClient.getAttention(5))
      .then(result => { if (isCurrent()) setAttention(result); })
      .catch(() => { if (isCurrent()) setError(true); });
    return () => { mounted = false; };
  }, [attempt, workspace]);

  const pending = attention?.pendingPlans ?? [];
  const runs = attention?.needsAttention ?? [];
  const needsYou = pending.length + runs.length + (schedules > 0 ? 1 : 0);

  if (error) {
    return (
      <section aria-labelledby="home-queue-heading" className="rounded-2xl border border-[#E6DED3] bg-white dark:bg-[#1A1613] px-4 py-3 flex items-center justify-between gap-3">
        <h2 id="home-queue-heading" className="sr-only">Cần bạn</h2>
        <p className="text-sm text-[#51463E]">Không tải được việc đang chờ.</p>
        <button type="button" onClick={() => setAttempt(value => value + 1)} className={ACTION}>Thử lại</button>
      </section>
    );
  }
  if (!attention || needsYou === 0) return null;

  return (
    <section data-home-queue aria-labelledby="home-queue-heading" className="rounded-2xl border border-[#E6DED3] bg-white dark:bg-[#1A1613] overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-3.5 pb-2">
        <h2 id="home-queue-heading" className="text-base font-semibold text-[#1a0e08]">Cần bạn</h2>
        <span className="text-sm font-medium tabular-nums text-[#B43E00]">{needsYou}</span>
      </div>
      <ul className="divide-y divide-[#F1EBE3] dark:divide-[#2A231E]">
        {pending.map(item => (
          <li key={item.planId}>
            <button type="button" className={ROW} onClick={() => onOpenConversation(item.conversationId)}>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-[#1a0e08]">{item.title || item.summary || 'Kế hoạch chờ duyệt'}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-[#6A5F56] tabular-nums">
                  <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-[#FF5701]" />
                  Chờ duyệt · {item.stepCount} bước · hết hạn {time(item.expiresAt)}
                </span>
              </span>
              <span className={ACTION}>Xem kế hoạch</span>
            </button>
          </li>
        ))}
        {runs.map(item => (
          <li key={item.planId}>
            <button type="button" className={ROW} onClick={() => onOpenConversation(item.conversationId)}>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-[#1a0e08]">{item.title || 'Lượt chạy cần xử lý'}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-[#6A5F56]">
                  <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-[#B45309]" />
                  {RUN_LABEL[item.status]}
                </span>
              </span>
              <span className={ACTION}>Xử lý</span>
            </button>
          </li>
        ))}
        {schedules > 0 && (
          <li>
            <button type="button" className={ROW} onClick={() => navigate('/history')}>
              <span className="block text-sm font-medium text-[#1a0e08] tabular-nums">{schedules} lịch chạy chờ bạn xác nhận</span>
              <span className={ACTION}>Mở Nhật ký</span>
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}
