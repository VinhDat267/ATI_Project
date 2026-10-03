import { useEffect, useState, useCallback } from "react";
import type { ServiceInfo } from "../types";
import { apiClient } from "../services/api-client";
import { userError } from "../services/user-error";
import {
  ServiceCard,
  type ServiceActionResult,
} from "../components/ServiceCard";
import { Modal } from "../components/Modal";
import { Icon } from "../components/Brand";
function ServiceTile({
  service,
  onSaved,
}: {
  service: ServiceInfo;
  onSaved: (scope: string[]) => void;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [test, setTest] = useState<ServiceActionResult | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const check = async () => {
    setBusy(true);
    try {
      setTest(await apiClient.testConnection(service.id));
    } catch (e) {
      setTest({ success: false, message: userError(e) });
    } finally {
      setBusy(false);
    }
  };
  const save = async (input: {
    credentials: Record<string, string>;
    allowedScope: string[];
  }) => {
    try {
      const data = await apiClient.saveCredentials(
        service.id,
        input.credentials,
        input.allowedScope,
      );
      if (data?.success !== true)
        return {
          success: false,
          message: data?.error || data?.message || "Không thể lưu cấu hình",
        };
      setTest(null);
      onSaved(input.allowedScope);
      return {
        success: true,
        message: "Đã lưu cấu hình. Hãy kiểm tra kết nối trước khi sử dụng.",
      };
    } catch (e) {
      return { success: false, message: userError(e) };
    }
  };
  return (
    <>
      <article className="service-card">
        <div className="service-card-top">
          <span className="service-emblem">
            <Icon name={service.id} />
          </span>
          <span
            className={
              "pill " +
              (test?.success ? "" : service.connected ? "pending" : "ghost")
            }
          >
            {test?.success
              ? "Kiểm tra thành công"
              : service.connected
                ? "Đã cấu hình"
                : "Chưa cấu hình"}
          </span>
        </div>
        <h2>{service.name}</h2>
        <p>
          {service.id === "github"
            ? "Mã nguồn và issue trong luồng làm việc."
            : service.id === "trello"
              ? "Chuyển kế hoạch thành công việc của nhóm."
              : service.id === "slack"
                ? "Thông báo đúng kênh, giữ cả nhóm cùng nhịp."
                : "Kết nối tài nguyên vào kế hoạch."}
        </p>
        <div className="service-scope">
          <div className="eyebrow">
            {service.scopeLabel || "Phạm vi được phép"}
          </div>
          {service.allowedScope?.length ? (
            service.allowedScope.map((s) => (
              <span className="scope-chip" key={s}>
                {s}
              </span>
            ))
          ) : (
            <p className="small muted">Chưa chọn tài nguyên</p>
          )}
        </div>
        <div className="service-card-footer">
          <button
            className="btn"
            onClick={check}
            disabled={busy}
            aria-busy={busy}
          >
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? "Đang kiểm tra…" : "Kiểm tra kết nối"}
          </button>
          <button
            className={"btn " + (!service.connected ? "primary" : "")}
            onClick={() => setOpen(true)}
          >
            Cấu hình
          </button>
        </div>
        {test && (
          <p
            className={
              "service-feedback " + (!test.success ? "field-error" : "")
            }
            role="status"
          >
            {test.message}
            {test.latencyMs !== undefined ? ` · ${test.latencyMs} ms` : ""}
          </p>
        )}
      </article>
      {open && (
        <Modal title={"Cấu hình " + service.name} onClose={close}>
          <p className="small muted">
            Thông tin kết nối được dùng chung cho nhóm. Bạn cần quyền quản trị
            dịch vụ để thay đổi cấu hình.
          </p>
          <ServiceCard
            service={service.id}
            title={service.name}
            connected={service.connected}
            allowedScope={service.allowedScope}
            credentialFields={service.credentialFields || []}
            scopeLabel={
              service.scopeLabel ||
              { boards: "board", channels: "channel", repos: "Repository" }[
                service.scopeKey || ""
              ] ||
              "tài nguyên"
            }
            onSave={save}
          />
        </Modal>
      )}
    </>
  );
}
export default function ServicesView() {
  const [services, setServices] = useState<ServiceInfo[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    apiClient
      .getServices()
      .then((data) => {
        if (active) {
          if (!Array.isArray(data?.services))
            throw new Error("Phản hồi dịch vụ không hợp lệ.");
          setServices(data.services);
        }
      })
      .catch((e) => {
        if (active) setError(userError(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload]);
  return (
    <div className="services-body">
      <div className="services-inner">
        <section className="page-intro">
          <div>
            <div className="eyebrow">KẾT NỐI NHỮNG NƠI BẠN LÀM VIỆC</div>
            <h2>
              Mỗi dịch vụ.
              <br />
              Một phần của kế hoạch.
            </h2>
            <p>
              Kết nối các công cụ của nhóm và chọn tài nguyên Planora được phép sử dụng.
            </p>
          </div>
        </section>
        <div className="service-notice">
          <Icon name="shield" />
          <span>
            Sau khi lưu cấu hình, kiểm tra kết nối để bắt đầu sử dụng.
          </span>
        </div>
        {loading ? (
          <div className="skeleton-card" role="status">
            <p>Đang tải dịch vụ…</p>
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        ) : error ? (
          <div className="process-card" role="alert">
            <p>{error}</p>
            <button className="btn" onClick={() => setReload((r) => r + 1)}>
              Tải lại
            </button>
          </div>
        ) : (
          <section className="service-grid" aria-label="Dịch vụ đã tích hợp">
            {services.map((s) => (
              <ServiceTile
                key={s.id}
                service={s}
                onSaved={(scope) =>
                  setServices((previous) =>
                    previous.map((item) =>
                      item.id === s.id
                        ? { ...item, connected: true, allowedScope: scope }
                        : item,
                    ),
                  )
                }
              />
            ))}
            {services.length === 0 && (
              <p>Chưa có dịch vụ nào khả dụng.</p>
            )}
          </section>
        )}
        <section className="roadmap-section">
          <div className="section-heading">
            <h2>Những kết nối tiếp theo.</h2>
            <span className="pill ghost">Dự kiến</span>
          </div>
          <p>Các kết nối này chưa khả dụng.</p>
          <div className="roadmap-chips">
            {[
              "Google Sheets",
              "Google Calendar",
              "Notion",
              "Telegram",
              "Jira",
            ].map((name) => (
              <span className="roadmap-chip" key={name}>
                <Icon name={name} />
                {name}
              </span>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
