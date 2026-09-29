import React from 'react';
import { ServiceCard, type ServiceActionResult } from './ServiceCard';

interface ServiceInfo {
  id: string;
  name: string;
  connected: boolean;
  allowedScope?: string[];
  credentialFields?: Array<{ key: string; label: string; type?: 'text' | 'password' }>;
  scopeKey?: string;
  scopeLabel?: string;
}

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  authToken?: string | null;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  authToken,
}) => {
  const [services, setServices] = React.useState<ServiceInfo[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen && authToken) {
      fetch('/api/services', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
        .then((res) => {
          if (!res.ok) throw new Error(`Không thể tải dịch vụ (${res.status})`);
          return res.json();
        })
        .then((data) => {
          if (data?.services && Array.isArray(data.services)) {
            setServices(data.services);
          }
        })
        .catch((err) => setLoadError(err instanceof Error ? err.message : 'Không thể tải dịch vụ'));
    }
  }, [isOpen, authToken]);

  const handleTestConnection = async (serviceId: string): Promise<ServiceActionResult> => {
    if (!authToken) {
      return { success: false, message: 'Chưa xác thực - vui lòng đăng nhập' };
    }
    try {
      const res = await fetch(`/api/services/${serviceId}/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json().catch(() => ({}));
      const success = res.ok && data.status === 'healthy';
      return {
        success,
        message: success ? data.message || 'Kết nối thành công' : data.error || data.message || `Kiểm tra kết nối thất bại (${res.status})`,
        latencyMs: success && typeof data.latencyMs === 'number' ? data.latencyMs : undefined,
      };
    } catch (err) {
      return { success: false, message: `Lỗi kết nối: ${err instanceof Error ? err.message : 'Không thể kết nối dịch vụ'}` };
    }
  };

  const handleSave = async (serviceId: string, input: { credentials: Record<string, string>; allowedScope: string[] }): Promise<ServiceActionResult> => {
    if (!authToken) return { success: false, message: 'Chưa xác thực - vui lòng đăng nhập' };
    try {
      const res = await fetch(`/api/services/${serviceId}/credentials`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credentials: input.credentials,
          allowedScope: input.allowedScope,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success !== true) {
        return { success: false, message: data.error || data.message || `Không thể lưu cấu hình (${res.status})` };
      }
      return { success: true, message: data.message || 'Đã lưu cấu hình' };
    } catch (err) {
      return { success: false, message: `Lỗi kết nối: ${err instanceof Error ? err.message : 'Không thể lưu cấu hình'}` };
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
    >
      <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-zinc-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between bg-zinc-50/50">
          <div>
            <h2 id="settings-modal-title" className="text-lg font-bold text-zinc-900">
              Cài đặt & Tích hợp Dịch vụ
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Quản lý khóa API và phân quyền phạm vi Allowed Scope (Write Safety)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium text-zinc-500 hover:text-zinc-800 hover:bg-zinc-200/60 px-3 py-1.5 rounded-lg transition"
          >
            Đóng ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6">
          {/* Security Principle Banner */}
          <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-2xl flex items-start gap-2.5 text-xs text-blue-900">
            <span className="text-sm">🛡️</span>
            <div>
              <span className="font-semibold">Bảo mật Cấp quyền Tối thiểu (Least Privilege):</span>{' '}
              Các khóa API được mã hóa AES-256-GCM ở tầng lưu trữ. AI chỉ được phép dùng những tài nguyên bạn đã cấu hình cho từng dịch vụ.
            </div>
          </div>

          {loadError && (
            <div className="p-3 bg-zinc-100 border border-zinc-300 rounded-xl text-xs text-zinc-800 flex justify-between items-center">
              <span>{loadError}</span>
              <button type="button" onClick={() => setLoadError(null)} className="text-zinc-500 hover:text-zinc-800">✕</button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {services.map((svc) => (
              <ServiceCard
                key={svc.id}
                service={svc.id}
                title={`${svc.name} Workspace`}
                connected={Boolean(svc.connected)}
                allowedScope={svc.allowedScope || []}
                credentialFields={svc.credentialFields || []}
                scopeLabel={svc.scopeLabel || ({ boards: 'board', channels: 'channel', repos: 'Repository' }[svc.scopeKey || ''] ?? 'tài nguyên')}
                onTestConnection={() => handleTestConnection(svc.id)}
                onSave={(input) => handleSave(svc.id, input)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
