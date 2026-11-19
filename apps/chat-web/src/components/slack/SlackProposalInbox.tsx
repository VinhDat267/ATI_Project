import { useEffect, useRef, useState } from 'react';
import { usePrototypePage, type PageMeta } from '../../prototype/usePrototypePage';
import { MainNav } from '../layout/MainNav';
import type { User } from '../../types';
import css from '../../pages/History/page.css?inline';
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
import { ScheduleSection } from '../../pages/History/ScheduleSection';

export const inboxMeta: PageMeta = {
  id: 'inbox',
  title: 'Tự động — Planora',
  htmlClass: '',
  bodyClass: 'min-h-screen flex flex-col bg-[#F8F4EE] text-[#1a0e08]',
  css,
};

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
  usePrototypePage(inboxMeta);
  const [connections, setConnections] = useState<SlackConnectionPublicInfo[] | null>(null);
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
        setConnections(null);
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
      .catch((reason) => {
        if (owns() && epoch === generation.current) {
          setConnections(null);
          if (reason?.status !== 404) setError('Không tải được kết nối Slack.');
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

  const filters = [
    ['all', 'Tất cả', totalCount],
    ['action_needed', 'Cần xử lý', actionNeededCount],
    ['awaiting_approval', 'Chờ phê duyệt', awaitingApprovalCount],
    ['resolved', 'Đã xử lý', resolvedCount],
  ] as const;

  return (
    <div className="min-h-screen bg-[#F8F4EE] dark:bg-[#131010] text-[#1a0e08] dark:text-[#F3EEE8]">
      <MainNav
        user={user}
        current="inbox"
        pageName="Tự động"
        inboxBadgeCount={badgeCount}
        navigate={navigate}
        onLogout={onLogout}
      />
      {/* Bước 5b: một trang cho mọi việc Planora làm thay bạn: lịch chạy định kỳ, đề xuất từ Slack và bản tóm tắt. */}
      <main data-automations className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 v3-space-y-10">
        <div className="ps-pagehead">
          <h1>Tự động</h1>
          <p>Lịch chạy định kỳ và đề xuất việc từ tin nhắn Slack. Lịch chỉ chạy khi bạn đã xác nhận, đề xuất chỉ ghi khi bạn duyệt.</p>
        </div>

        <ScheduleSection user={user} navigate={navigate} />

        <section aria-labelledby="proposals-heading" className="v3-space-y-4">
          <div className="ps-sectionhead">
            <h2 id="proposals-heading">Hộp thư đề xuất</h2>
            {connections && connections.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Chọn workspace"
                  className="ps-field"
                  value={selectedConnectionId}
                  onChange={(e) => setSelectedConnectionId(e.target.value)}
                >
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.workspaceName}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setReloadTick((v) => v + 1)}
                  className="ps-btn-quiet"
                >
                  Tải lại hộp thư
                </button>
              </div>
            )}
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {error}
            </p>
          )}
          {loading && <p role="status" className="ps-note">Đang tải hộp thư đề xuất…</p>}

          {!loading && !error && connections === null && (
            <p className="ps-note">Slack cá nhân chưa khả dụng trên máy chủ.</p>
          )}
          {!loading && connections?.length === 0 && (
            <div data-inbox-connect className="ps-panel p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p className="ps-note">
                Kết nối Slack cá nhân để Planora nhận ra việc được giao cho bạn trong tin nhắn và gửi đề xuất về đây.
              </p>
              <a
                href="/settings"
                onClick={(e) => {
                  e.preventDefault();
                  navigate('/settings');
                }}
                className="ps-btn-quiet flex-shrink-0 self-start sm:self-auto"
              >
                Mở Kết nối dịch vụ
              </a>
            </div>
          )}

          {connections && connections.length > 0 && (
            <>
              <div role="group" aria-label="Thống kê đề xuất" className="ps-panel ps-stats">
                {filters.map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    className="ps-stat"
                    aria-pressed={statusFilter === key}
                    onClick={() => setStatusFilter(key)}
                  >
                    <span className="ps-stat-label">{label}</span>
                    <span className="ps-stat-value">{count}</span>
                  </button>
                ))}
              </div>
              {proposals.length > 0 && (
                <input
                  type="search"
                  aria-label="Tìm kiếm đề xuất"
                  placeholder="Tìm theo tiêu đề, kênh, nội dung…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="ps-field w-full sm:w-80"
                />
              )}
              {proposals.length === 0 && !loading ? (
                <p className="ps-note">Chưa có đề xuất nào cho workspace này.</p>
              ) : filteredProposals.length === 0 && !loading ? (
                <p className="ps-note">Không có đề xuất nào khớp với bộ lọc hiện tại.</p>
              ) : (
                <div className="v3-space-y-3">
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
            </>
          )}
        </section>

        {connections && connections.length > 0 && (
          <section aria-labelledby="digests-heading" className="v3-space-y-4">
            <div className="ps-sectionhead">
              <h2 id="digests-heading">Bản tóm tắt hàng ngày</h2>
            </div>
            {digests.length === 0 && !loading ? (
              <p className="ps-note">Chưa có bản tóm tắt hàng ngày nào.</p>
            ) : (
              <div className="v3-space-y-3">
                {digests.map((digest) => (
                  <article key={digest.id} className="ps-panel p-4 sm:p-5 v3-space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-sans text-base font-semibold">Bản tóm tắt ngày {digest.localDate}</h3>
                      <button
                        type="button"
                        className="ps-btn-quiet"
                        disabled={refreshingDigestId === digest.id || digest.body === null}
                        onClick={() => void handleRefreshDigest(digest.id)}
                      >
                        Làm mới trạng thái
                      </button>
                    </div>
                    {digest.body === null || digest.status === 'stale' ? (
                      <p className="text-xs text-[#6A5F56] dark:text-[#9CA3AF]">
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
                          <div className="space-y-2 text-xs text-[#51463E] dark:text-[#9CA3AF]">
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
                                    <span className="rounded bg-[#F3F4F6] dark:bg-[#221C18] px-1.5 py-0.5 text-[11px] font-medium text-[#4a4038] dark:text-[#D7CEC4]">
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
        )}
      </main>
    </div>
  );
}
