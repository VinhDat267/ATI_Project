import React from 'react';
import { ServiceCard } from './ServiceCard';

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
      <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-zinc-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between bg-zinc-50/50">
          <div>
            <h2 className="text-lg font-bold text-zinc-900">
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ServiceCard
              service="trello"
              title="Trello Workspace"
              connected={true}
              allowedScope={['Frontend Team', 'Mobile App', 'Design System']}
              onTestConnection={() => {}}
            />

            <ServiceCard
              service="slack"
              title="Slack Workspace"
              connected={false}
              allowedScope={['#general']}
              onTestConnection={() => {}}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
