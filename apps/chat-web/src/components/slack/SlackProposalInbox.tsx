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

export function SlackProposalInbox({ user, navigate, onLogout }: SlackProposalInboxProps) {
  const [connections, setConnections] = useState<SlackConnectionPublicInfo[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState('');
  const [proposals, setProposals] = useState<SlackProposalViewDto[]>([]);
  const [digests, setDigests] = useState<SlackDigestViewDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshingDigestId, setRefreshingDigestId] = useState('');
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
  }, [selectedConnectionId]);

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

  return (
    <div className="min-h-screen bg-[#F8F8F6] dark:bg-[#121212] text-[#111827] dark:text-white">
      <MainNav user={user} current={null} pageName="Hộp thư đề xuất" navigate={navigate} onLogout={onLogout} />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Hộp thư đề xuất & Bản tóm tắt</h1>
            <p className="text-sm text-[#4B5563] dark:text-[#9CA3AF]">
              Mọi đề xuất đều cần bạn kiểm tra và phê duyệt trước khi thực thi sang dịch vụ đích.
            </p>
          </div>
          {connections.length > 0 && (
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
          )}
        </div>

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
          <h2 id="proposals-heading" className="font-display text-lg font-semibold">
            Đề xuất từ tin nhắn
          </h2>
          {proposals.length === 0 && !loading ? (
            <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF]">Chưa có đề xuất nào cho workspace này.</p>
          ) : (
            <div className="space-y-3">
              {proposals.map((proposal) => (
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
                    <div className="space-y-2 text-xs text-[#4B5563] dark:text-[#9CA3AF]">
                      <p>
                        Tổng {digest.body.summary.totalProposals} đề xuất · {digest.body.summary.pendingCount} đang chờ ·{' '}
                        {digest.body.summary.awaitingApprovalCount} chờ duyệt · {digest.body.summary.approvedCount} đã duyệt ·{' '}
                        {digest.body.summary.rejectedCount} đã từ chối
                      </p>
                      <ul className="space-y-1">
                        {digest.body.items.map((item) => (
                          <li key={item.proposalId}>
                            • {item.title} ({item.status})
                          </li>
                        ))}
                      </ul>
                    </div>
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
