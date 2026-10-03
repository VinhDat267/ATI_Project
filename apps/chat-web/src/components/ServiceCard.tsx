import { useState, useEffect } from "react";
import { userError } from "../services/user-error";
export interface ServiceActionResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}
export interface ServiceCardProps {
  service: string;
  title: string;
  connected?: boolean;
  allowedScope?: string[];
  credentialFields?: Array<{
    key: string;
    label: string;
    type?: "text" | "password";
  }>;
  scopeLabel?: string;
  onSave?: (input: {
    credentials: Record<string, string>;
    allowedScope: string[];
  }) => Promise<ServiceActionResult> | void;
  onTestConnection?: () => Promise<ServiceActionResult> | void;
}
const EMPTY_SCOPE: string[] = [];
export function ServiceCard({
  service,
  title,
  connected = false,
  allowedScope = EMPTY_SCOPE,
  credentialFields = [
    { key: "apiKey", label: "API Key / Client ID", type: "password" },
    { key: "token", label: "OAuth / API Token", type: "password" },
  ],
  scopeLabel = "board hoặc channel",
  onSave,
  onTestConnection,
}: ServiceCardProps) {
  const [credentials, setCredentials] = useState<Record<string, string>>({}),
    [scopes, setScopes] = useState(allowedScope),
    [newScope, setNewScope] = useState(""),
    [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState<ServiceActionResult | null>(null);
  useEffect(() => setScopes(allowedScope), [allowedScope]);
  const add = () => {
    if (newScope.trim() && !scopes.includes(newScope.trim())) {
      setScopes([...scopes, newScope.trim()]);
      setNewScope("");
    }
  };
  const run = async (save: boolean) => {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = save
        ? await onSave?.({
            credentials: Object.fromEntries(
              credentialFields.map((f) => [f.key, credentials[f.key] || ""]),
            ),
            allowedScope: scopes,
          })
        : await onTestConnection?.();
      if (result) {
        setFeedback(result);
        if (save && result.success) setCredentials({});
      }
    } catch (e) {
      setFeedback({ success: false, message: userError(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="credential-card">
      <div className="credential-heading">
        <h3>{title}</h3>
        <span className="pill ghost">
          {connected ? "Đã cấu hình" : "Chưa cấu hình"}
        </span>
      </div>
      {credentialFields.map((field) => (
        <div className="field" key={field.key}>
          <label htmlFor={`${service}-${field.key}`}>{field.label}</label>
          <input
            id={`${service}-${field.key}`}
            type={field.type || "password"}
            value={credentials[field.key] || ""}
            autoComplete="off"
            disabled={busy}
            placeholder="Nhập thông tin truy cập"
            onChange={(e) =>
              setCredentials({ ...credentials, [field.key]: e.target.value })
            }
          />
        </div>
      ))}
      <div className="scope-editor">
        <label className="small" htmlFor={`${service}-scope`}>
          Phạm vi được phép truy cập
        </label>
        <p className="small muted">
          Giới hạn {scopeLabel} mà Planora được phép đọc và ghi.
        </p>
        <div className="scope-chips">
          {scopes.map((scope) => (
            <span className="scope-chip" key={scope}>
              {scope}
              <button
                disabled={busy}
                aria-label={"Xóa phạm vi " + scope}
                onClick={() => setScopes(scopes.filter((s) => s !== scope))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="scope-add">
          <input
            id={`${service}-scope`}
            placeholder={`Thêm ${scopeLabel}...`}
            value={newScope}
            disabled={busy}
            onChange={(e) => setNewScope(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <button className="btn" disabled={busy} onClick={add}>
            Thêm
          </button>
        </div>
      </div>
      {feedback && (
        <p
          role="status"
          className={feedback.success ? "service-feedback" : "field-error"}
        >
          {feedback.message}
          {feedback.latencyMs !== undefined ? ` (${feedback.latencyMs}ms)` : ""}
        </p>
      )}
      <div className="dialog-actions">
        {onTestConnection && (
          <button className="btn" disabled={busy} onClick={() => run(false)}>
            Kiểm tra kết nối
          </button>
        )}
        <button
          className="btn primary"
          disabled={busy || !onSave}
          onClick={() => run(true)}
        >
          {busy ? "Đang xử lý…" : "Lưu cấu hình"}
        </button>
      </div>
    </section>
  );
}
