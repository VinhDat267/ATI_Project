import { useEffect, useRef, useState, useCallback } from "react";
import {
  MailCheck,
  ShieldCheck,
  Search,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import type { User } from "../types";
import { apiClient } from "../services/api-client";
import { userError } from "../services/user-error";
import { Modal } from "../components/Modal";
export function AccountApproval() {
  const [users, setUsers] = useState<Array<User & { createdAt: string }>>([]),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [approvalError, setApprovalError] = useState(""),
    [selected, setSelected] = useState<User | null>(null),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0),
    [notice, setNotice] = useState("");
  const request = useRef(0),
    approvalBusy = useRef(false);
  const closeApproval = useCallback(() => {
    if (!approvalBusy.current) setSelected(null);
  }, []);
  useEffect(() => {
    const ticket = ++request.current;
    setLoading(true);
    setError("");
    const timer = setTimeout(
      () => {
        apiClient
          .getPendingUsers(page, query)
          .then((data) => {
            if (ticket === request.current) {
              setUsers(data.users);
              setTotal(data.total);
            }
          })
          .catch((err) => {
            if (ticket === request.current) setError(userError(err));
          })
          .finally(() => {
            if (ticket === request.current) setLoading(false);
          });
      },
      query ? 200 : 0,
    );
    return () => {
      clearTimeout(timer);
      request.current++;
    };
  }, [page, query, version]);
  return (
    <>
      <h3 id="settings-section-title">Duyệt tài khoản.</h3>
      <p className="settings-description">
        Kiểm tra thành viên mới trước khi cấp quyền sử dụng dịch vụ chung của
        nhóm.
      </p>
      <label className="approval-search">
        <Search className="icon" aria-hidden="true" />
        <input
          aria-label="Tìm tài khoản chờ duyệt"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm theo tên hoặc email…"
        />
      </label>
      {notice && (
        <p role="status" className="approval-notice">
          {notice}
        </p>
      )}
      {loading ? (
        <p role="status">Đang tải tài khoản chờ duyệt…</p>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <button className="btn" onClick={() => setVersion((v) => v + 1)}>
            Thử lại
          </button>
        </div>
      ) : users.length === 0 ? (
        <div className="approval-empty">
          <ShieldCheck className="icon" aria-hidden="true" />
          <h4>
            {query ? "Chưa tìm thấy tài khoản." : "Mọi thứ đã được xem xét."}
          </h4>
          <p>
            {query
              ? "Thử một tên hoặc email khác."
              : "Chưa có tài khoản nào đang chờ duyệt."}
          </p>
        </div>
      ) : (
        <>
          <div className="approval-count">{total} tài khoản chờ duyệt</div>
          <ul className="approval-list">
            {users.map((user) => (
              <li key={user.id}>
                <span className="settings-avatar" aria-hidden="true">
                  {(user.name || user.email).slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{user.name}</strong>
                  <span>{user.email}</span>
                  <small>
                    <MailCheck className="icon" aria-hidden="true" />
                    {user.emailVerified
                      ? "Email đã xác minh"
                      : "Chờ xác minh email"}
                  </small>
                </div>
                <button
                  className="btn"
                  disabled={!user.emailVerified}
                  onClick={() => {
                    setSelected(user);
                    setApprovalError("");
                  }}
                >
                  Duyệt
                </button>
              </li>
            ))}
          </ul>
          <div className="approval-pagination">
            <button
              className="btn"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ArrowLeft className="icon" aria-hidden="true" />
              Trước
            </button>
            <span>Trang {page}</span>
            <button
              className="btn"
              disabled={page * 20 >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Sau
              <ArrowRight className="icon" aria-hidden="true" />
            </button>
          </div>
        </>
      )}
      {selected && (
        <Modal
          onClose={closeApproval}
          title="Duyệt quyền truy cập?"
        >
          <p>
            <strong>{selected.name}</strong> ({selected.email}) sẽ dùng được các
            dịch vụ nhóm đã kết nối, gồm GitHub, Trello và Slack. Mọi hành động
            ghi vẫn cần được duyệt qua kế hoạch.
          </p>
          {approvalError && <p role="alert">{approvalError}</p>}
          <div className="approval-dialog-actions">
            <button
              className="btn"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              Quay lại
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                if (approvalBusy.current) return;
                approvalBusy.current = true;
                setBusy(true);
                setApprovalError("");
                try {
                  await apiClient.approveUser(selected.id);
                  setNotice(`Đã duyệt tài khoản ${selected.name}.`);
                  setSelected(null);
                  setPage(1);
                  setVersion((v) => v + 1);
                } catch (err) {
                  setApprovalError(userError(err));
                } finally {
                  approvalBusy.current = false;
                  setBusy(false);
                }
              }}
            >
              {busy ? "Đang duyệt…" : "Duyệt tài khoản"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
