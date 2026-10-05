import React from 'react';
import { ServiceCard, type ServiceActionResult } from './ServiceCard';
import { apiClient } from '../services/api-client';
import type { ServiceInfo } from '../types';
import { userErrorMessage } from '../services/user-error';

export interface SettingsModalProps {
  isOpen: boolean;
  page?: boolean;
  onClose: () => void;
  authToken?: string | null;
  onServicesChanged?: () => Promise<void> | void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  page = false,
  onClose,
  authToken,
  onServicesChanged,
}) => {
  const [services, setServices] = React.useState<ServiceInfo[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const dialogContentRef = React.useRef<HTMLDivElement>(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const refreshServices = async () => {
    try {
      const data = await apiClient.getServices();
      if (!Array.isArray(data?.services)) throw new Error('Không tải được danh mục dịch vụ.');
      setServices(data.services); setLoadError(null);
    } catch (error) { setServices([]); setLoadError(userErrorMessage(error)); }
    await onServicesChanged?.();
  };

  React.useEffect(() => {
    if (isOpen) {
      apiClient
        .getServices()
        .then((data) => {
          if (data?.services && Array.isArray(data.services)) {
            setServices(data.services);
          }
        })
        .catch((err) =>
          setLoadError(
            err instanceof Error ? err.message : 'Không thể tải dịch vụ'
          )
        );
    }
  }, [isOpen, authToken]);

  const handleTestConnection = async (
    serviceId: string
  ): Promise<ServiceActionResult> => {
    try {
      const data = await apiClient.testConnection(serviceId);
      await refreshServices();
      return {
        success: Boolean(data.success),
        message:
          data.message ||
          (data.success ? 'Kết nối thành công' : 'Kiểm tra kết nối thất bại'),
        latencyMs: data.latencyMs,
      };
    } catch (err) {
      await refreshServices();
      return {
        success: false,
        message: `Lỗi kết nối: ${err instanceof Error ? err.message : 'Không thể kết nối dịch vụ'}`,
      };
    }
  };

  const handleSave = async (
    serviceId: string,
    input: { credentials: Record<string, string>; allowedScope: string[] }
  ): Promise<ServiceActionResult> => {
    try {
      const data = await apiClient.saveCredentials(
        serviceId,
        input.credentials,
        input.allowedScope
      );
      if (data?.success !== true) {
        return {
          success: false,
          message:
            data?.error || data?.message || 'Không thể lưu cấu hình',
        };
      }
      await refreshServices();
      return { success: true, message: data.message || 'Đã lưu cấu hình' };
    } catch (err: any) {
      return {
        success: false,
        message: `Lỗi kết nối: ${err?.message || 'Không thể lưu cấu hình'}`,
      };
    }
  };

  React.useEffect(() => {
    if (!isOpen || page) return;
    const content = dialogContentRef.current;
    if (!content) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const openerId = opener?.id;
    const focusable = () => Array.from(content.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )).filter(element => element.tabIndex >= 0 && !element.closest('[hidden], [aria-hidden="true"]'));
    const focusFirst = () => (focusable()[0] || content).focus();
    focusFirst();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      } else if (e.key === 'Tab') {
        const elements = focusable();
        const first = elements[0], last = elements[elements.length - 1];
        if (!first) {
          e.preventDefault();
          content.focus();
        } else if (e.shiftKey && (document.activeElement === first || !content.contains(document.activeElement))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !content.contains(document.activeElement))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    const handleFocus = (e: FocusEvent) => {
      if (!content.contains(e.target as Node)) focusFirst();
    };
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocus);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocus);
      const currentOpener = opener?.isConnected ? opener : openerId ? document.getElementById(openerId) : null;
      currentOpener?.focus();
    };
  }, [isOpen, page]);

  if (!isOpen) {
    return null;
  }
  const Heading = page ? 'h1' : 'h2';
  const Container = page ? 'main' : 'div';

  return (
    <Container
      role={page ? undefined : 'dialog'}
      aria-modal={page ? undefined : true}
      aria-labelledby="settings-modal-title"
      className={page ? 'mx-auto max-w-5xl p-4 sm:p-8' : 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg-page/80 backdrop-blur-xs'}
      onClick={(e) => {
        if (!page && e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogContentRef}
        tabIndex={page ? undefined : -1}
        className={`bg-surface rounded-3xl w-full flex flex-col overflow-hidden border border-border ${page ? '' : 'shadow-2xl max-w-4xl max-h-[90vh]'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between gap-4 bg-surface-inset">
          <div>
            <Heading
              id="settings-modal-title"
              className={`${page ? 'text-2xl' : 'text-lg'} font-bold text-text`}
            >
              Cài đặt & Tích hợp Dịch vụ
            </Heading>
            <p className="text-sm text-text-muted mt-1">
              Quản lý khóa API và phân quyền phạm vi Allowed Scope (Write Safety)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-medium text-text-muted hover:text-text hover:bg-surface-raised min-h-10 min-w-10 px-3 py-2 rounded-lg transition"
          >
            Đóng ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6">
          {/* Security Principle Banner */}
          <div className="p-4 bg-primary-tint border border-border rounded-2xl flex items-start gap-3 text-sm text-primary-text">
            <span className="text-sm">🛡️</span>
            <div>
              <span className="font-semibold">
                Bảo mật Cấp quyền Tối thiểu (Least Privilege):
              </span>{' '}
              Các khóa API được mã hóa AES-256-GCM ở tầng lưu trữ. AI chỉ được
              phép dùng những tài nguyên bạn đã cấu hình cho từng dịch vụ.
            </div>
          </div>

          {loadError && (
            <div role="alert" className="p-3 bg-surface-raised border border-border-strong rounded-xl text-sm text-text flex justify-between items-center">
              <span>{loadError}</span>
              <button
                type="button"
                aria-label="Ẩn thông báo lỗi"
                onClick={() => setLoadError(null)}
                className="text-text-muted hover:text-text min-h-10 min-w-10"
              >
                ✕
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {services.map((svc) => (
              <ServiceCard
                key={svc.id}
                service={svc.id}
                title={`${svc.name} Workspace`}
                connected={Boolean(svc.configured)}
                allowedScope={svc.allowedScope || []}
                credentialFields={svc.credentialFields || []}
                scopeLabel={svc.scopeLabel || 'tài nguyên'}
                onTestConnection={() => handleTestConnection(svc.id)}
                onSave={(input) => handleSave(svc.id, input)}
              />
            ))}
          </div>
        </div>
      </div>
    </Container>
  );
};
