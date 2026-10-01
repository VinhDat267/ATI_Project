import React, { useState } from 'react';

export interface MissionControlLaunchpadProps {
  onSendMessage: (message: string) => void;
}

interface IntegrationStatus {
  name: string;
  badge: string;
  sub: string;
  iconBg: string;
  dotColor: string;
}

const INTEGRATIONS: IntegrationStatus[] = [
  {
    name: 'Trello',
    badge: 'Sẵn sàng',
    sub: 'Boards & Tasks Sync',
    iconBg: 'bg-blue-50 text-blue-600 border-blue-200',
    dotColor: 'bg-emerald-500',
  },
  {
    name: 'Slack',
    badge: 'Trực tuyến',
    sub: 'Bot Gateway & Channels',
    iconBg: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    dotColor: 'bg-emerald-500',
  },
  {
    name: 'GitHub',
    badge: 'Kết nối',
    sub: 'Repo & Release CI',
    iconBg: 'bg-zinc-100 text-zinc-700 border-zinc-300',
    dotColor: 'bg-emerald-500',
  },
  {
    name: 'Google Sheets',
    badge: 'Đồng bộ',
    sub: 'Báo cáo & Dữ liệu',
    iconBg: 'bg-amber-50 text-amber-700 border-amber-200',
    dotColor: 'bg-emerald-500',
  },
];

interface BlueprintCard {
  id: string;
  icon: string;
  category: string;
  categoryTheme: string;
  badge: string;
  title: string;
  description: string;
  buttonText: string;
  prompt: string;
}

const BLUEPRINTS: BlueprintCard[] = [
  {
    id: 'onboarding-task',
    icon: '👥',
    category: 'Trello ➔ Slack',
    categoryTheme: 'bg-blue-50 text-blue-700 border-blue-200',
    badge: 'Đề xuất',
    title: 'Onboarding & Phân công Nhân sự',
    description:
      'Tự động khởi tạo thẻ giao việc trên Trello, thiết lập checklist chi tiết và gửi thông báo trực tiếp tới thành viên qua kênh Slack.',
    buttonText: '✨ Tạo công việc trên Trello, phân công nhân sự và thông báo qua Slack',
    prompt: 'Tạo công việc trên Trello, phân công nhân sự và thông báo qua Slack',
  },
  {
    id: 'system-audit',
    icon: '🔍',
    category: 'Trello ➔ Slack ➔ Audit',
    categoryTheme: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    badge: 'Khảo sát nhanh',
    title: 'Kiểm tra Danh mục & Tình trạng Liên dịch vụ',
    description:
      'Quét toàn bộ danh sách bảng việc Trello, kiểm tra các kênh Slack đang kết nối và tổng hợp báo cáo trạng thái hệ thống tức thời.',
    buttonText: '🔍 Kiểm tra danh sách bảng việc Trello và kênh Slack liên kết',
    prompt: 'Kiểm tra danh sách bảng việc Trello và kênh Slack liên kết',
  },
  {
    id: 'sprint-release',
    icon: '🚀',
    category: 'GitHub ➔ Trello ➔ Slack',
    categoryTheme: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    badge: 'Engineering',
    title: 'Tổng hợp Phát hành Sprint & Báo cáo Kỹ thuật',
    description:
      'Đồng bộ pull request hoàn thành, cập nhật trạng thái thẻ Trello sang Done và phát hành thông báo phát hành (release note) vào kênh Slack.',
    buttonText: '🚀 Phát hành Sprint từ Trello sang Slack',
    prompt:
      'Tạo thông báo phát hành sprint từ Trello sang Slack channel #general và cập nhật trạng thái các task',
  },
  {
    id: 'executive-digest',
    icon: '📊',
    category: 'Trello ➔ Google Sheets ➔ Slack',
    categoryTheme: 'bg-amber-50 text-amber-800 border-amber-200',
    badge: 'Vận hành',
    title: 'Báo cáo Tiến độ & Trích xuất Dữ liệu Quản trị',
    description:
      'Trích xuất tiến độ các dự án trên Trello, ghi nhận dữ liệu vào bảng tính và gửi tóm tắt điều hành qua Slack cho ban quản trị.',
    buttonText: '📊 Xuất báo cáo tiến độ tuần & Gửi Slack',
    prompt:
      'Kiểm tra các task đang thực hiện trên Trello và tạo bản tin tóm tắt tiến độ gửi qua Slack channel #general',
  },
];

export const MissionControlLaunchpad: React.FC<MissionControlLaunchpadProps> = ({
  onSendMessage,
}) => {
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
      <div className="bg-white/80 backdrop-blur-xs border border-zinc-200/90 rounded-2xl p-3 shadow-2xs">
        <div className="flex items-center justify-between mb-2.5 px-1">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">
              Hệ thống kết nối liên dịch vụ (Live Integrations Status)
            </span>
          </div>
          <span className="hidden sm:inline-flex items-center text-[11px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/80">
            ✓ 4/4 Dịch vụ hoạt động tốt
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {INTEGRATIONS.map((service) => (
            <div
              key={service.name}
              className="flex items-center gap-2.5 p-2 rounded-xl bg-zinc-50/70 border border-zinc-150 hover:bg-white hover:border-zinc-300 transition duration-150"
            >
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs border ${service.iconBg} shrink-0`}
              >
                {service.name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-zinc-800 truncate">
                    {service.name}
                  </span>
                  <span className={`w-1.5 h-1.5 rounded-full ${service.dotColor} shrink-0`} />
                </div>
                <div className="text-[10px] text-zinc-500 truncate">
                  {service.sub}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Hero Mission Control Command Center */}
      <div className="text-center pt-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50/80 border border-blue-200/80 text-[#0071e3] text-xs font-semibold mb-3 shadow-2xs">
          <span>⚡</span>
          <span>ENTERPRISE MISSION CONTROL v3.1</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-zinc-900 tracking-tight mb-2.5">
          Trung Tâm Điều Phối Quy Trình Tự Động Hóa
        </h1>
        <p className="text-xs sm:text-sm text-zinc-600 max-w-2xl mx-auto leading-relaxed">
          Nền tảng tự động hóa quy trình đa dịch vụ — bạn luôn có toàn quyền kiểm duyệt trước khi chạy và dữ liệu luôn được bảo vệ an toàn.
        </p>
      </div>

      {/* 3. Hero Command Bar (Raycast / Linear Style) */}
      <div className="bg-white rounded-2xl border border-zinc-200 p-2 sm:p-2.5 shadow-sm hover:border-blue-300 transition-all">
        <form onSubmit={handleCommandSubmit} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="flex items-center gap-2 flex-1 px-2.5 py-1.5 bg-[#f8fafc] rounded-xl border border-zinc-200/80 focus-within:bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/10 transition">
            <span className="text-zinc-400 font-mono text-sm shrink-0">⌘</span>
            <input
              type="text"
              aria-label="Khung lệnh điều phối quy trình"
              placeholder="Gõ lệnh điều phối (@trello, @slack, @github) hoặc chọn quy trình mẫu bên dưới..."
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              className="w-full bg-transparent text-xs sm:text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none"
            />
            {commandInput && (
              <button
                type="button"
                onClick={() => setCommandInput('')}
                className="text-zinc-400 hover:text-zinc-600 text-xs px-1"
                aria-label="Xóa nội dung lệnh"
              >
                ✕
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={!commandInput.trim()}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#0071e3] hover:bg-blue-600 disabled:opacity-40 text-white text-xs font-semibold transition shadow-xs shrink-0 cursor-pointer disabled:cursor-not-allowed"
          >
            <span>Thực thi quy trình</span>
            <span>⚡</span>
          </button>
        </form>

        {/* Quick Service Tags & Keyboard Hints */}
        <div className="flex flex-wrap items-center justify-between gap-2 mt-2 pt-2 border-t border-zinc-100 px-1 text-[11px] text-zinc-500">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-zinc-400">Gợi ý tag:</span>
            <button
              type="button"
              onClick={() => handleInsertTag('@Trello')}
              className="px-2 py-0.5 rounded-md bg-zinc-100 hover:bg-blue-50 hover:text-blue-600 border border-zinc-200 transition"
            >
              @Trello
            </button>
            <button
              type="button"
              onClick={() => handleInsertTag('@Slack')}
              className="px-2 py-0.5 rounded-md bg-zinc-100 hover:bg-emerald-50 hover:text-emerald-600 border border-zinc-200 transition"
            >
              @Slack
            </button>
            <button
              type="button"
              onClick={() => handleInsertTag('@GitHub')}
              className="px-2 py-0.5 rounded-md bg-zinc-100 hover:bg-purple-50 hover:text-purple-600 border border-zinc-200 transition"
            >
              @GitHub
            </button>
            <button
              type="button"
              onClick={() => handleInsertTag('@Sheets')}
              className="px-2 py-0.5 rounded-md bg-zinc-100 hover:bg-amber-50 hover:text-amber-700 border border-zinc-200 transition"
            >
              @Sheets
            </button>
          </div>

          <div className="hidden md:flex items-center gap-2 text-zinc-400">
            <span>Phím tắt:</span>
            <kbd className="px-1.5 py-0.5 bg-zinc-100 border border-zinc-200 rounded text-[10px] font-mono text-zinc-600">
              Enter ↵
            </kbd>
            <span>để chạy</span>
          </div>
        </div>
      </div>

      {/* 4. Bento Grid: 4 Blueprint Workflow Launchpad Cards */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-600">
            Quy Trình Mẫu Sẵn Sàng Khởi Chạy (1-Click Blueprints)
          </h2>
          <span className="text-[11px] text-zinc-400">Nhấp để chạy ngay</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {BLUEPRINTS.map((bp) => (
            <div
              key={bp.id}
              className="group relative bg-white border border-zinc-200/90 hover:border-blue-400 rounded-2xl p-4 transition-all duration-150 hover:shadow-md flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{bp.icon}</span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${bp.categoryTheme}`}
                    >
                      {bp.category}
                    </span>
                  </div>
                  <span className="text-[10px] font-medium text-zinc-500 bg-zinc-100 px-2 py-0.5 rounded-full border border-zinc-200">
                    {bp.badge}
                  </span>
                </div>

                <h3 className="text-sm font-bold text-zinc-900 group-hover:text-blue-600 transition-colors mb-1.5">
                  {bp.title}
                </h3>
                <p className="text-xs text-zinc-500 leading-relaxed mb-3">
                  {bp.description}
                </p>
              </div>

              <button
                type="button"
                onClick={() => onSendMessage(bp.prompt)}
                className="w-full text-left text-xs bg-[#fafafc] hover:bg-blue-50/60 border border-zinc-200 hover:border-blue-300 text-zinc-800 hover:text-blue-700 font-medium px-3 py-2 rounded-xl transition flex items-center justify-between gap-2 shadow-2xs group-hover:shadow-xs"
              >
                <span className="truncate">{bp.buttonText}</span>
                <span className="text-blue-500 group-hover:translate-x-0.5 transition-transform shrink-0 font-bold">
                  ➔
                </span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 5. Enterprise Security & Human-In-The-Loop Safeguards */}
      <div className="bg-zinc-50/80 border border-zinc-200/80 rounded-2xl p-3 sm:p-4 text-zinc-600 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex items-start gap-2">
            <span className="text-blue-600 font-bold shrink-0 text-sm">🛡️</span>
            <div>
              <div className="font-semibold text-zinc-800 text-[11px]">
                Kiểm duyệt trước khi chạy
              </div>
              <div className="text-[10px] text-zinc-500 leading-normal">
                Mọi hành động đều tạo bản kế hoạch chi tiết cần bạn phê duyệt.
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <span className="text-emerald-600 font-bold shrink-0 text-sm">🔒</span>
            <div>
              <div className="font-semibold text-zinc-800 text-[11px]">
                Bảo vệ dữ liệu tuyệt đối
              </div>
              <div className="text-[10px] text-zinc-500 leading-normal">
                Chỉ thực hiện trong phạm vi quyền hạn được cấp của từng dịch vụ.
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <span className="text-indigo-600 font-bold shrink-0 text-sm">↩️</span>
            <div>
              <div className="font-semibold text-zinc-800 text-[11px]">
                Dừng khẩn cấp & Phục hồi
              </div>
              <div className="text-[10px] text-zinc-500 leading-normal">
                Hỗ trợ dừng quy trình lập tức và thử lại từng bước khi có lỗi mạng.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
