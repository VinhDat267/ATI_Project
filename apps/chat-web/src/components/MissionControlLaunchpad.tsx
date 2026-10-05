import React, { useState } from 'react';
import type { ServiceInfo } from '../types';

export interface MissionControlLaunchpadProps {
  onSendMessage: (message: string) => void;
  services?: ServiceInfo[];
  runtimeMode?: 'sandbox' | 'live' | null;
  loading?: boolean;
  error?: string | null;
}

interface BlueprintCard {
  id: string;
  requiredTools: string[];
  icon: string;
  category: string;
  categoryTheme: string;
  badge: string;
  title: string;
  description: string;
  buttonText: string;
  prompt: string;
}

export const BLUEPRINTS: BlueprintCard[] = [
  {
    id: 'onboarding-task',
    requiredTools: ['trello.create_card', 'trello.add_member', 'trello.add_checklist', 'slack.send_message'],
    icon: '👥',
    category: 'Trello ➔ Slack',
    categoryTheme: 'bg-primary-tint text-primary-text border-border',
    badge: 'Đề xuất',
    title: 'Onboarding & Phân công Nhân sự',
    description:
      'Tự động khởi tạo thẻ giao việc trên Trello, thiết lập checklist chi tiết và gửi thông báo trực tiếp tới thành viên qua kênh Slack.',
    buttonText: '✨ Tạo công việc trên Trello, phân công nhân sự và thông báo qua Slack',
    prompt: 'Tạo công việc trên Trello, phân công nhân sự và thông báo qua Slack',
  },
  {
    id: 'system-audit',
    requiredTools: ['trello.search_boards', 'slack.search_channels'],
    icon: '🔍',
    category: 'Trello ➔ Slack ➔ Audit',
    categoryTheme: 'bg-success-tint text-success-text border-border',
    badge: 'Khảo sát nhanh',
    title: 'Kiểm tra Danh mục & Tình trạng Liên dịch vụ',
    description:
      'Liệt kê bảng Trello và kênh Slack trong phạm vi đã cấp để chọn tài nguyên cho quy trình.',
    buttonText: '🔍 Kiểm tra danh sách bảng việc Trello và kênh Slack liên kết',
    prompt: 'Kiểm tra danh sách bảng việc Trello và kênh Slack liên kết',
  },
  {
    id: 'sprint-release',
    requiredTools: ['github.search_issues', 'trello.create_card', 'slack.send_message'],
    icon: '🚀',
    category: 'GitHub ➔ Trello ➔ Slack',
    categoryTheme: 'bg-primary-tint text-primary-text border-border',
    badge: 'Engineering',
    title: 'Theo dõi GitHub issue trên Trello và Slack',
    description:
      'Tìm issue GitHub, tạo thẻ Trello cho issue đã chọn và gửi thông báo qua kênh Slack.',
    buttonText: '🚀 Tạo công việc từ GitHub issue sang Trello & Slack',
    prompt:
      'Tìm issue trên GitHub, tạo thẻ Trello cho issue đã chọn và thông báo qua Slack',
  },
  {
    id: 'executive-digest',
    requiredTools: ['trello.search_cards', 'slack.send_message'],
    icon: '📊',
    category: 'Trello ➔ Slack',
    categoryTheme: 'bg-warning-tint text-warning-text border-border',
    badge: 'Vận hành',
    title: 'Báo cáo Tiến độ & Trích xuất Dữ liệu Quản trị',
    description:
      'Đọc các thẻ Trello trong phạm vi đã cấp và gửi bản tin tóm tắt tiến độ qua Slack.',
    buttonText: '📊 Xuất báo cáo tiến độ tuần & Gửi Slack',
    prompt:
      'Kiểm tra các task đang thực hiện trên Trello và tạo bản tin tóm tắt tiến độ gửi qua Slack channel #general',
  },
];

export const MissionControlLaunchpad: React.FC<MissionControlLaunchpadProps> = ({
  onSendMessage, services = [], runtimeMode = null, loading = false, error = null,
}) => {
  const integrations = services.map(service => ({
    ...service,
    iconBg: 'bg-surface-raised text-text-secondary border-border',
    dotColor: runtimeMode === 'live' && service.connected ? 'bg-success' : 'bg-surface-raised',
    sub: !service.configured ? 'Chưa cấu hình' : runtimeMode === 'sandbox' ? 'Đã cấu hình · thử nghiệm' :
      service.connectionStatus === 'healthy' ? 'Kiểm tra kết nối thành công' :
      service.connectionStatus === 'unhealthy' ? 'Kiểm tra kết nối thất bại' : 'Đã cấu hình · chưa kiểm tra',
  }));
  const availableTools = new Set(services.flatMap(service => service.tools ?? []));
  const blueprints = BLUEPRINTS.filter(bp => bp.requiredTools.every(tool => availableTools.has(tool)));
  const missingServices = (bp: BlueprintCard) => services.filter(service =>
    bp.requiredTools.some(tool => tool.startsWith(`${service.id}.`)) && !service.configured).map(service => service.name);

  const configured = services.filter(service => service.configured).map(service => `@${service.name}`);
  const commandPlaceholder = `Gõ lệnh điều phối${configured.length ? ` (${configured.join(', ')})` : ''} hoặc chọn quy trình mẫu bên dưới...`;

  const [commandInput, setCommandInput] = useState('');

  const handleCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (commandInput.trim()) {
      onSendMessage(commandInput.trim());
      setCommandInput('');
    }
  };

  const handleInsertTag = (tag: string) => {
    setCommandInput((prev) => {
      const trimmed = prev.trim();
      return trimmed ? `${trimmed} ${tag} ` : `${tag} `;
    });
  };

  return (
    <div className="w-full py-4 md:py-6 px-2 md:px-4 max-w-4xl mx-auto flex flex-col gap-6">
      {/* 1. Live Integrations Status Bar */}
      <div className="bg-surface backdrop-blur-xs border border-border rounded-2xl p-3 shadow-2xs">
        <div className="flex items-center justify-between mb-2.5 px-1">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              {runtimeMode === 'live' && services.some(service => service.connected) && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${runtimeMode === 'live' && services.some(service => service.connected) ? 'bg-success' : 'bg-surface-raised'}`}></span>
            </span>
            <span className="text-sm font-semibold tracking-wider text-text-muted uppercase">
              Hệ thống kết nối liên dịch vụ
            </span>
          </div>
          <span className="hidden sm:inline-flex items-center text-sm font-medium text-success-text bg-success-tint px-2 py-0.5 rounded-full border border-border">
            {loading ? 'Đang tải dịch vụ…' : error ? 'Chưa tải được dịch vụ' : `${services.filter(s => s.configured).length}/${services.length} dịch vụ đã cấu hình`}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {integrations.map((service) => (
            <div
              key={service.id}
              className="flex items-center gap-2.5 p-2 rounded-xl bg-surface-inset border border-border hover:bg-surface hover:border-border-strong transition duration-150"
            >
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs border ${service.iconBg} shrink-0`}
              >
                {service.name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-text truncate">
                    {service.name}
                  </span>
                  <span className={`w-1.5 h-1.5 rounded-full ${service.dotColor} shrink-0`} />
                </div>
                <div className="text-sm text-text-muted truncate">
                  {service.sub}
                  {service.lastCheckedAt && <span className="block">Lần kiểm tra: {new Date(service.lastCheckedAt).toLocaleString('vi-VN')}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {error && <p role="status" className="text-warning-text text-sm">{error}</p>}
      {/* 2. Hero Mission Control Command Center */}
      <div className="text-center pt-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary-tint border border-border text-primary-text text-xs font-semibold mb-3 shadow-2xs">
          <span>⚡</span>
          <span>ENTERPRISE MISSION CONTROL v3.1</span>
        </div>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-text tracking-tight mb-2.5">
          Trung Tâm Điều Phối Quy Trình Tự Động Hóa
        </h2>
        <p className="text-xs sm:text-sm text-text-secondary max-w-2xl mx-auto leading-relaxed">
          Nền tảng tự động hóa quy trình đa dịch vụ — bạn phê duyệt các lệnh ghi trước khi chạy và giới hạn tài nguyên được phép sử dụng.
        </p>
      </div>

      {/* 3. Hero Command Bar (Raycast / Linear Style) */}
      <div className="bg-surface rounded-2xl border border-border p-2 sm:p-2.5 shadow-sm hover:border-border-strong transition-all">
        <form onSubmit={handleCommandSubmit} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="flex items-center gap-2 flex-1 px-2.5 py-1.5 bg-surface-inset rounded-xl border border-border focus-within:bg-surface focus-within:border-border-strong focus-within:ring-2 focus-within:ring-primary transition">
            <span className="text-text-muted font-mono text-sm shrink-0">⌘</span>
            <input
              type="text"
              aria-label="Khung lệnh điều phối quy trình"
              placeholder={commandPlaceholder}
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              className="w-full bg-transparent text-xs sm:text-sm text-text placeholder-text-muted focus:outline-none"
            />
            {commandInput && (
              <button
                type="button"
                onClick={() => setCommandInput('')}
                className="text-text-muted hover:text-text-secondary text-xs px-1"
                aria-label="Xóa nội dung lệnh"
              >
                ✕
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={!commandInput.trim()}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary disabled:opacity-40 text-white text-xs font-semibold transition shadow-xs shrink-0 cursor-pointer disabled:cursor-not-allowed"
          >
            <span>Thực thi quy trình</span>
            <span>⚡</span>
          </button>
        </form>

        {/* Quick Service Tags & Keyboard Hints */}
        <div className="flex flex-wrap items-center justify-between gap-2 mt-2 pt-2 border-t border-border px-1 text-sm text-text-muted">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-text-muted">Gợi ý tag:</span>
            {services.map(service => <button key={service.id} type="button" onClick={() => handleInsertTag(`@${service.name}`)} className="px-2 py-0.5 rounded-md bg-surface-raised hover:bg-primary-tint border border-border">@{service.name}</button>)}
          </div>

          <div className="hidden md:flex items-center gap-2 text-text-muted">
            <span>Phím tắt:</span>
            <kbd className="px-1.5 py-0.5 bg-surface-raised border border-border rounded text-sm font-mono text-text-secondary">
              Enter ↵
            </kbd>
            <span>để chạy</span>
          </div>
        </div>
      </div>

      {/* 4. Bento Grid: 4 Blueprint Workflow Launchpad Cards */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 className="text-xs font-bold uppercase tracking-wider text-text-secondary">
            Quy Trình Mẫu Sẵn Sàng Khởi Chạy (1-Click Blueprints)
          </h2>
          <span className="text-sm text-text-muted">Nhấp để chạy ngay</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {blueprints.map((bp) => (
            <div
              key={bp.id}
              className={`group relative bg-surface border border-border hover:border-border-strong rounded-2xl p-4 transition-all duration-150 hover:shadow-md flex flex-col justify-between ${missingServices(bp).length ? 'opacity-70' : ''}`}
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{bp.icon}</span>
                    <span
                      className={`text-sm font-semibold px-2 py-0.5 rounded-md border ${bp.categoryTheme}`}
                    >
                      {bp.category}
                    </span>
                  </div>
                  <span className="text-sm font-medium text-text-muted bg-surface-raised px-2 py-0.5 rounded-full border border-border">
                    {bp.badge}
                  </span>
                </div>

                <h3 className="text-sm font-bold text-text group-hover:text-primary-text transition-colors mb-1.5">
                  {bp.title}
                </h3>
                <p className="text-xs text-text-muted leading-relaxed mb-3">
                  {bp.description}
                </p>
              </div>

              <button
                type="button"
                disabled={loading || Boolean(error) || missingServices(bp).length > 0}
                onClick={() => onSendMessage(bp.prompt)}
                className="w-full text-left text-xs bg-surface-inset hover:bg-primary-tint border border-border hover:border-border-strong text-text hover:text-primary-text font-medium px-3 py-2 rounded-xl transition flex items-center justify-between gap-2 shadow-2xs group-hover:shadow-xs disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <span className="truncate">{missingServices(bp).length ? `Cần kết nối ${missingServices(bp).join(', ')}` : bp.buttonText}</span>
                <span className="text-primary-text group-hover:translate-x-0.5 transition-transform shrink-0 font-bold">
                  ➔
                </span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 5. Enterprise Security & Human-In-The-Loop Safeguards */}
      <div className="bg-surface-inset border border-border rounded-2xl p-3 sm:p-4 text-text-secondary text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex items-start gap-2">
            <span className="text-primary-text font-bold shrink-0 text-sm">🛡️</span>
            <div>
              <div className="font-semibold text-text text-sm">
                Kiểm duyệt trước khi chạy
              </div>
              <div className="text-sm text-text-muted leading-normal">
                Các lệnh ghi vào dịch vụ cần bạn phê duyệt kế hoạch trước khi chạy.
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <span className="text-success-text font-bold shrink-0 text-sm">🔒</span>
            <div>
              <div className="font-semibold text-text text-sm">
                Giới hạn phạm vi dịch vụ
              </div>
              <div className="text-sm text-text-muted leading-normal">
                Chỉ thực hiện trong phạm vi quyền hạn được cấp của từng dịch vụ.
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <span className="text-primary-text font-bold shrink-0 text-sm">↩️</span>
            <div>
              <div className="font-semibold text-text text-sm">
                Dừng khẩn cấp & Phục hồi
              </div>
              <div className="text-sm text-text-muted leading-normal">
                Hỗ trợ dừng quy trình; bước chưa rõ kết quả cần đối soát trước khi tiếp tục.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
