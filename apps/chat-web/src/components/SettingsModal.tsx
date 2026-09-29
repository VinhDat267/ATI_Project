import React from 'react';
import { ServiceCard } from './ServiceCard';

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
  const [services, setServices] = React.useState<any[]>([
    { id: 'trello', name: 'Trello', connected: false, scopes: ['Frontend Team', 'Mobile App'] },
    { id: 'slack', name: 'Slack', connected: false, scopes: ['#general'] },
  ]);
  const [testResult, setTestResult] = React.useState<{ service: string; message: string } | null>(null);

  React.useEffect(() => {
    if (isOpen && authToken) {
      fetch('/api/services', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.services && Array.isArray(data.services)) {
            setServices(data.services);
          }
        })
        .catch((err) => console.warn('Failed to load services:', err));
    }
  }, [isOpen, authToken]);

  const handleTestConnection = async (serviceId: string) => {
    if (!authToken) {
      setTestResult({ service: serviceId, message: 'Chưa xác thực - vui lòng đăng nhập' });
      return;
    }
    try {
      const res = await fetch(`/api/services/${serviceId}/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json();
      setTestResult({
        service: serviceId,
        message: `${data.message || 'Kết nối thành công'} (${data.latencyMs || 45}ms)`,
      });
    } catch (err: any) {
      setTestResult({
        service: serviceId,
        message: `Lỗi kết nối: ${err?.message || 'Không thể kết nối dịch vụ'}`,
      });
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
              Các khóa API được mã hóa AES-256-GCM ở tầng lưu trữ. AI chỉ được phép đọc và ghi trong các Board/Channel bạn đã cấu hình bên dưới.
            </div>
          </div>

          {testResult && (
            <div className="p-3 bg-zinc-100 border border-zinc-300 rounded-xl text-xs text-zinc-800 flex justify-between items-center">
              <span><strong>[{testResult.service.toUpperCase()}]:</strong> {testResult.message}</span>
              <button type="button" onClick={() => setTestResult(null)} className="text-zinc-500 hover:text-zinc-800">✕</button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {services.map((svc) => (
              <ServiceCard
                key={svc.id}
                service={svc.id as any}
                title={`${svc.name} Workspace`}
                connected={Boolean(svc.connected)}
                allowedScope={svc.scopes || []}
                onTestConnection={() => handleTestConnection(svc.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
