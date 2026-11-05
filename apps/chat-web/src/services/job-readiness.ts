import type { ServiceInfo } from '../types';

export interface CoreJob {
  id: 'OFF-02' | 'OFF-03' | 'PM-01' | 'PM-03' | 'DEV-02' | 'DEV-04';
  title: string;
  description: string;
  requiredServices: string[];
  prompt: string;
  outputDescription: string;
}

export const CORE_JOBS: CoreJob[] = [
  {
    id: 'OFF-02',
    title: 'Google Meet, biên bản Docs & gửi email',
    description: 'Tạo phòng họp Google Meet, lưu tài liệu Docs vào thư mục đã chọn và gửi link qua email',
    outputDescription: 'Meet link + file Google Docs + email gửi người tham gia',
    requiredServices: ['mycalendar', 'mysheets', 'gmail'],
    prompt: 'Tạo lịch họp Google Meet cho dự án {{tên_dự_án}}, lưu biên bản vào Google Docs trong thư mục dự án và gửi link cho {{email_nhận}}',
  },
  {
    id: 'OFF-03',
    title: 'Báo cáo số liệu Google Sheets vào Slack',
    description: 'Đọc bảng tính Google Sheets, tổng hợp số liệu có đối chiếu và gửi báo cáo vào kênh Slack',
    outputDescription: 'Báo cáo số liệu xác minh từ Sheets gửi tới kênh Slack',
    requiredServices: ['mysheets', 'slack'],
    prompt: 'Đọc dữ liệu từ bảng tính Google Sheets {{tên_bảng}}, tổng hợp số liệu và gửi báo cáo chi tiết vào kênh Slack #{{kênh_slack}}',
  },
  {
    id: 'PM-01',
    title: 'Giao việc Trello & thông báo kênh Slack',
    description: 'Tạo thẻ Trello có người phụ trách và ngày hết hạn, kèm link báo vào Slack',
    outputDescription: 'Card Trello có member + due date, link gửi vào Slack',
    requiredServices: ['trello', 'slack'],
    prompt: 'Tạo thẻ trên bảng Trello {{tên_bảng}} cho công việc {{tiêu_đề_việc}}, gán cho {{người_nhận}} với hạn chót {{hạn_chót}}, và thông báo vào kênh Slack #{{kênh_slack}}',
  },
  {
    id: 'PM-03',
    title: 'Báo cáo tiến độ Jira Sprint vào Slack',
    description: 'Tổng hợp tiến độ Sprint trên Atlassian Jira và gửi báo cáo định kỳ vào Slack (duyệt từng lượt)',
    outputDescription: 'Báo cáo Jira Sprint theo lịch, xác nhận từng lượt gửi Slack',
    requiredServices: ['myjira', 'slack'],
    prompt: 'Tổng hợp tiến độ các ticket trong Sprint hiện tại của dự án Jira {{mã_dự_án}}, đối chiếu trạng thái và gửi bản tóm tắt vào kênh Slack #{{kênh_slack}}',
  },
  {
    id: 'DEV-02',
    title: 'Tổng hợp GitHub PR đang mở & gửi Slack',
    description: 'Đọc danh sách Pull Request đang mở trên GitHub, dựng báo cáo có nguồn xác minh và gửi vào Slack',
    outputDescription: 'Báo cáo Pull Request có nguồn đọc xác minh gửi tới kênh Slack',
    requiredServices: ['github', 'slack'],
    prompt: 'Đọc các Pull Request đang mở trên repository GitHub {{tên_repo}}, tổng hợp người tạo và thời gian chờ, gửi báo cáo có nguồn vào kênh Slack #{{kênh_slack}}',
  },
  {
    id: 'DEV-04',
    title: 'Kiểm tra GitHub Issue tồn đọng theo tuổi',
    description: 'Phân tích tuổi các issue tồn đọng trên GitHub và đặt lịch gửi nhắc nhở vào Slack',
    outputDescription: 'Báo cáo issue aging theo tuổi và lịch gửi nhắc nhở Slack',
    requiredServices: ['github', 'slack'],
    prompt: 'Kiểm tra các issue GitHub đang mở trên repository {{tên_repo}} tồn đọng quá {{số_ngày}} ngày, phân nhóm theo độ tuổi và gửi danh sách nhắc nhở vào kênh Slack #{{kênh_slack}}',
  },
];

export type ReadinessStatus =
  | 'ready'
  | 'needs_connection'
  | 'needs_reauth'
  | 'needs_resource'
  | 'needs_admin';

export interface JobReadiness {
  status: ReadinessStatus;
  isReady: boolean;
  missingServices: string[];
  unhealthyServices: string[];
  missingResourceServices: string[];
  ctaLabel: string;
  ctaPath: string;
}

export function matchService(requiredId: string, services: ServiceInfo[]): ServiceInfo | undefined {
  const norm = requiredId.toLowerCase();
  return services.find((s) => {
    const sId = s.id.toLowerCase();
    if (sId === norm) return true;
    if (norm === 'calendar' && (sId === 'mycalendar' || sId === 'calendar')) return true;
    if (norm === 'mycalendar' && (sId === 'calendar' || sId === 'mycalendar')) return true;
    if (norm === 'sheets' && (sId === 'mysheets' || sId === 'sheets')) return true;
    if (norm === 'mysheets' && (sId === 'sheets' || sId === 'mysheets')) return true;
    if (norm === 'jira' && (sId === 'myjira' || sId === 'jira')) return true;
    if (norm === 'myjira' && (sId === 'jira' || sId === 'myjira')) return true;
    if (norm === 'slack' && (sId === 'myslack' || sId === 'slack')) return true;
    if (norm === 'myslack' && (sId === 'slack' || sId === 'myslack')) return true;
    return false;
  });
}

export function evaluateJobReadiness(
  requiredServices: string[],
  services: ServiceInfo[]
): JobReadiness {
  const missingServices: string[] = [];
  const unhealthyServices: string[] = [];
  const missingResourceServices: string[] = [];
  const adminServices: string[] = [];

  for (const reqId of requiredServices) {
    const matched = matchService(reqId, services);
    if (!matched || !matched.configured || matched.personalStatus === 'not_connected' || matched.personalStatus === 'disconnected') {
      missingServices.push(reqId);
    } else if (matched.connectionStatus === 'unhealthy' || matched.connected === false || matched.personalStatus === 'reconnect_required') {
      unhealthyServices.push(matched.id);
    } else if (
      matched.personalStatus === 'needs_scope' ||
      matched.personalStatus === 'scope_required' ||
      (Array.isArray(matched.allowedScope) && matched.allowedScope.length === 0)
    ) {
      missingResourceServices.push(matched.id);
    } else if (matched.personalStatus === 'needs_workspace' || matched.personalStatus === 'needs_membership') {
      adminServices.push(matched.id);
    }
  }

  if (missingServices.length > 0) {
    return {
      status: 'needs_connection',
      isReady: false,
      missingServices,
      unhealthyServices,
      missingResourceServices,
      ctaLabel: `Kết nối ${missingServices.join(', ')}`,
      ctaPath: '/settings',
    };
  }

  if (unhealthyServices.length > 0) {
    return {
      status: 'needs_reauth',
      isReady: false,
      missingServices,
      unhealthyServices,
      missingResourceServices,
      ctaLabel: `Cấp lại quyền ${unhealthyServices.join(', ')}`,
      ctaPath: '/settings',
    };
  }

  if (missingResourceServices.length > 0) {
    return {
      status: 'needs_resource',
      isReady: false,
      missingServices,
      unhealthyServices,
      missingResourceServices,
      ctaLabel: `Chọn tài nguyên cho ${missingResourceServices.join(', ')}`,
      ctaPath: '/settings',
    };
  }

  if (adminServices.length > 0) {
    return {
      status: 'needs_admin',
      isReady: false,
      missingServices,
      unhealthyServices,
      missingResourceServices,
      ctaLabel: `Cấu hình nhóm ${adminServices.join(', ')}`,
      ctaPath: '/settings',
    };
  }

  return {
    status: 'ready',
    isReady: true,
    missingServices: [],
    unhealthyServices: [],
    missingResourceServices: [],
    ctaLabel: 'Sẵn sàng sử dụng',
    ctaPath: '#',
  };
}
