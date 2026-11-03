import { useEffect, useRef, useState } from 'react';
import { MainNav } from '../layout/MainNav';
import type { User } from '../../types';
import {
  slackConnectionApi,
  slackSessionOwner,
  type SlackConnectionPublicInfo,
} from '../../services/slack-connection';
import {
  slackAssistantApi,
  type SlackDigestViewDto,
  type SlackProposalViewDto,
} from '../../services/slack-assistant';
import { authStorage } from '../../services/auth-storage';
import { SlackProposalCard } from './SlackProposalCard';

export interface SlackProposalInboxProps {
  user: User | null;
  navigate: (path: string) => void;
  onLogout: () => void;
}

type StatusFilter = 'all' | 'action_needed' | 'awaiting_approval' | 'resolved';

const digestStatusLabels: Record<string, string> = {
  pending: 'Đang chờ xem xét',
  needs_info: 'Cần bổ sung thông tin',
  awaiting_approval: 'Chờ phê duyệt',
  approved: 'Đã phê duyệt',
  completed: 'Đã hoàn thành',
  rejected: 'Đã từ chối',
  stale: 'Hết hiệu lực',
};

export function SlackProposalInbox({ user, navigate, onLogout }: SlackProposalInboxProps) {
  const [connections, setConnections] = useState<SlackConnectionPublicInfo[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState('');
  const [proposals, setProposals] = useState<SlackProposalViewDto[]>([]);
  const [digests, setDigests] = useState<SlackDigestViewDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshingDigestId, setRefreshingDigestId] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const generation = useRef(0);

  useEffect(() => {
    const owns = slackSessionOwner();
    return authStorage.subscribeAuthTokens(() => {
      if (!owns()) {
        generation.current++;
        setConnections([]);
        setSelectedConnectionId('');
        setProposals([]);
        setDigests([]);
        setError('');
        setLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    const owns = slackSessionOwner();
    const epoch = ++generation.current;
    setLoading(true);
    setError('');
    void slackConnectionApi
      .list()
      .then((res) => {
        if (!owns() || epoch !== generation.current) return;
        const rows = Array.isArray(res.connections) ? res.connections : [];
        setConnections(rows);
        setSelectedConnectionId((prev) => (rows.some((r) => r.id === prev) ? prev : rows[0]?.id ?? ''));
        if (rows.length === 0) setLoading(false);
      })
      .catch(() => {
        if (owns() && epoch === generation.current) {
          setError('Không tải được danh sách workspace.');
          setLoading(false);
        }
      });
  }, []);

  useEffect(() => {
    if (!selectedConnectionId) return;
    const owns = slackSessionOwner();
    const epoch = ++generation.current;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void Promise.all([
      slackAssistantApi.listProposals(selectedConnectionId, controller.signal),
      slackAssistantApi.listDigests(selectedConnectionId, controller.signal),
    ])
      .then(([propRes, digRes]) => {
        if (!owns() || epoch !== generation.current) return;
        setProposals(Array.isArray(propRes.proposals) ? propRes.proposals : []);
        setDigests(Array.isArray(digRes.digests) ? digRes.digests : []);
      })
      .catch(() => {
        if (owns() && epoch === generation.current && !controller.signal.aborted) {
          setError('Không tải được hộp thư đề xuất.');
        }
      })
      .finally(() => {
        if (owns() && epoch === generation.current) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [selectedConnectionId, reloadTick]);

  const handleRefreshDigest = async (digestId: string) => {
    if (refreshingDigestId) return;
    const owns = slackSessionOwner();
    setRefreshingDigestId(digestId);
    try {
      const res = await slackAssistantApi.refreshDigest(digestId);
      if (owns()) {
        setDigests((prev) => prev.map((d) => (d.id === digestId ? res.digest : d)));
      }
    } catch {
      if (owns()) setError('Chưa làm mới được trạng thái bản tóm tắt.');
    } finally {
      if (owns()) setRefreshingDigestId('');
    }
  };

  const totalCount = proposals.length;
  const actionNeededCount = proposals.filter((p) => p.status === 'pending' || p.status === 'needs_info').length;
  const awaitingApprovalCount = proposals.filter((p) => p.status === 'awaiting_approval').length;
  const resolvedCount = proposals.filter((p) => p.status === 'approved' || p.status === 'rejected').length;
  const badgeCount = actionNeededCount + awaitingApprovalCount;

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredProposals = proposals.filter((proposal) => {
    if (statusFilter === 'action_needed' && !['pending', 'needs_info'].includes(proposal.status)) return false;
    if (statusFilter === 'awaiting_approval' && proposal.status !== 'awaiting_approval') return false;
    if (statusFilter === 'resolved' && !['approved', 'rejected'].includes(proposal.status)) return false;
    if (!normalizedQuery) return true;
    const title = proposal.body?.decision.title?.toLowerCase() ?? '';
    const rationale = proposal.body?.decision.rationale?.toLowerCase() ?? '';
    const channel = (proposal.channelId ?? proposal.body?.context?.[0]?.channelId ?? '').toLowerCase();
    const contextText = (proposal.body?.context ?? []).map((m) => `${m.user} ${m.text}`).join(' ').toLowerCase();
    return (
      title.includes(normalizedQuery) ||
      rationale.includes(normalizedQuery) ||
      channel.includes(normalizedQuery) ||
      contextText.includes(normalizedQuery)
    );
  });

  return (
    <div className="min-h-screen bg-[#F8F8F6] dark:bg-[#121212] text-[#111827] dark:text-white">
      <MainNav
        user={user}
        current={null}
        pageName="Hộp thư đề xuất"
        inboxBadgeCount={badgeCount}
        navigate={navigate}
        onLogout={onLogout}
      />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Hộp thư đề xuất & Bản tóm tắt</h1>
            <p className="text-sm text-[#4B5563] dark:text-[#9CA3AF]">
              Mọi đề xuất đều cần bạn kiểm tra và phê duyệt trước khi thực thi sang dịch vụ đích.
            </p>
          </div>
          {connections.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm flex items-center gap-2">
                <span>Workspace</span>
                <select
                  aria-label="Chọn workspace"
                  className="rounded-lg border border-[#D1D5DB] dark:border-[#4B5563] bg-white dark:bg-[#1E1E1E] px-3 py-1.5 text-sm"
                  value={selectedConnectionId}
                  onChange={(e) => setSelectedConnectionId(e.target.value)}
                >
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.workspaceName}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={loading}
                onClick={() => setReloadTick((v) => v + 1)}
                className="rounded-lg border border-[#D1D5DB] dark:border-[#4B5563] bg-white dark:bg-[#1E1E1E] px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:hover:bg-[#2A2A2A] disabled:opacity-50"
              >
                Tải lại hộp thư
              </button>
            </div>
          )}
        </div>

        {connections.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" aria-label="Thống kê đề xuất">
            <div className="rounded-xl border border-[#E7E7E2] dark:border-[#333333] bg-white dark:bg-[#1E1E1E] p-3">
              <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">Tổng đề xuất</p>
              <p className="mt-1 font-display text-xl font-bold">{totalCount}</p>
            </div>
            <div className="rounded-xl border border-[#E7E7E2] dark:border-[#333333] bg-white dark:bg-[#1E1E1E] p-3">
              <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">Cần xử lý</p>
              <p className="mt-1 font-display text-xl font-bold text-[#FF5701]">{actionNeededCount}</p>
            </div>
            <div className="rounded-xl border border-[#E7E7E2] dark:border-[#333333] bg-white dark:bg-[#1E1E1E] p-3">
              <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">Chờ phê duyệt</p>
              <p className="mt-1 font-display text-xl font-bold text-amber-600 dark:text-amber-400">{awaitingApprovalCount}</p>
            </div>
            <div className="rounded-xl border border-[#E7E7E2] dark:border-[#333333] bg-white dark:bg-[#1E1E1E] p-3">
              <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">Đã xử lý</p>
              <p className="mt-1 font-display text-xl font-bold text-emerald-600 dark:text-emerald-400">{resolvedCount}</p>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
        {loading && <p role="status">Đang tải hộp thư đề xuất…</p>}

        {!loading && connections.length === 0 && (
          <p className="text-sm text-[#4B5563] dark:text-[#9CA3AF]">
            Chưa có workspace nào được kết nối. Hãy kết nối trong trang Kết nối dịch vụ.
          </p>
        )}

        <section aria-labelledby="proposals-heading" className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 id="proposals-heading" className="font-display text-lg font-semibold">
              Đề xuất từ tin nhắn
            </h2>
            {proposals.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-[#D1D5DB] dark:border-[#4B5563] bg-white dark:bg-[#1E1E1E] p-0.5 text-xs">
                  {(
                    [
                      ['all', 'Tất cả'],
                      ['action_needed', 'Cần xử lý'],
                      ['awaiting_approval', 'Chờ phê duyệt'],
                      ['resolved', 'Đã xử lý'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setStatusFilter(key)}
                      className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                        statusFilter === key
                          ? 'bg-[#FF5701] text-white'
                          : 'text-[#4B5563] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  type="search"
                  aria-label="Tìm kiếm đề xuất"
                  placeholder="Tìm theo tiêu đề, kênh, nội dung…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="rounded-lg border border-[#D1D5DB] dark:border-[#4B5563] bg-white dark:bg-[#1E1E1E] px-3 py-1.5 text-xs"
                />
              </div>
            )}
          </div>
          {proposals.length === 0 && !loading ? (
            <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF]">Chưa có đề xuất nào cho workspace này.</p>
          ) : filteredProposals.length === 0 && !loading ? (
            <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF]">
              Không có đề xuất nào khớp với bộ lọc hiện tại.
            </p>
          ) : (
            <div className="space-y-3">
              {filteredProposals.map((proposal) => (
                <SlackProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  navigate={navigate}
                  onUpdated={(updated) =>
                    setProposals((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
                  }
                />
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="digests-heading" className="space-y-3">
          <h2 id="digests-heading" className="font-display text-lg font-semibold">
            Bản tóm tắt hàng ngày
          </h2>
          {digests.length === 0 && !loading ? (
            <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF]">Chưa có bản tóm tắt hàng ngày nào.</p>
          ) : (
            <div className="space-y-3">
              {digests.map((digest) => (
                <article
                  key={digest.id}
                  className="rounded-xl border border-[#E7E7E2] dark:border-[#333333] bg-white dark:bg-[#1E1E1E] p-4 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-display text-base font-semibold">Bản tóm tắt ngày {digest.localDate}</h3>
                    <button
                      type="button"
                      className="rounded-lg border border-[#D1D5DB] dark:border-[#4B5563] px-3 py-1 text-xs font-medium disabled:opacity-50"
                      disabled={refreshingDigestId === digest.id || digest.body === null}
                      onClick={() => void handleRefreshDigest(digest.id)}
                    >
                      Làm mới trạng thái
                    </button>
                  </div>
                  {digest.body === null || digest.status === 'stale' ? (
                    <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                      Bản tóm tắt đã hết hiệu lực hoặc nguồn dữ liệu đã thay đổi.
                    </p>
                  ) : (
                    (() => {
                      const entries = digest.body.entries ?? digest.body.items ?? [];
                      const counts =
                        typeof digest.body.summary === 'object' && digest.body.summary !== null
                          ? digest.body.summary
                          : {
                              totalProposals: entries.length,
                              pendingCount: entries.filter((e) => e.status === 'pending' || e.status === 'needs_info')
                                .length,
                              awaitingApprovalCount: entries.filter((e) => e.status === 'awaiting_approval').length,
                              approvedCount: entries.filter(
                                (e) => e.status === 'approved' || e.status === 'completed',
                              ).length,
                              rejectedCount: entries.filter((e) => e.status === 'rejected').length,
                            };
                      return (
                        <div className="space-y-2 text-xs text-[#4B5563] dark:text-[#9CA3AF]">
                          {typeof digest.body.summary === 'string' && <p>{digest.body.summary}</p>}
                          <p>
                            Tổng {counts.totalProposals} đề xuất · {counts.pendingCount} đang chờ ·{' '}
                            {counts.awaitingApprovalCount} chờ duyệt · {counts.approvedCount} đã duyệt ·{' '}
                            {counts.rejectedCount} đã từ chối
                          </p>
                          <ul className="space-y-1">
                            {entries.map((item) => (
                              <li key={item.proposalId} className="flex flex-wrap items-center gap-1.5">
                                <span>
                                  • {item.title} ({item.status})
                                </span>
                                {digestStatusLabels[item.status] && (
                                  <span className="rounded bg-[#F3F4F6] dark:bg-[#2A2A2A] px-1.5 py-0.5 text-[11px] font-medium text-[#374151] dark:text-[#D1D5DB]">
                                    {digestStatusLabels[item.status]}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })()
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
