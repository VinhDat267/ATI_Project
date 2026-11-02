import { createHash } from 'node:crypto';
import type {
  ScheduleResponse,
  TelegramDigestCandidate,
  TelegramDigestConfig,
  TelegramDigestSource,
} from '@wap/tool-schemas';
import type { TelegramConnectionLookupResult } from '../telegram/connection-reference.js';
import type { GitHubConnectionLookupResult } from '../github/connection-reference.js';

export const READ_DIGEST_SOURCE_MAP: Record<string, TelegramDigestSource> = {
  github: {
    service: 'github',
    tool: 'github.search_issues',
    args: { query: 'open' },
    label: 'GitHub Issues đang mở',
  },
  calendar: {
    service: 'calendar',
    tool: 'calendar.list_events',
    label: 'Lịch nhóm hôm nay',
  },
  mycalendar: {
    service: 'mycalendar',
    tool: 'mycalendar.list_events',
    label: 'Google Calendar của bạn hôm nay',
  },
  sheets: {
    service: 'sheets',
    tool: 'sheets.read_range',
    label: 'Bảng tính nhóm',
  },
  mysheets: {
    service: 'mysheets',
    tool: 'mysheets.list_spreadsheets',
    label: 'Google Sheets của bạn',
  },
  trello: {
    service: 'trello',
    tool: 'trello.search_cards',
    args: { query: '' },
    label: 'Thẻ Trello',
  },
  notion: {
    service: 'notion',
    tool: 'notion.search_pages',
    args: { query: '' },
    label: 'Trang Notion',
  },
  jira: {
    service: 'jira',
    tool: 'jira.search_issues',
    args: { query: '' },
    label: 'Jira Issues',
  },
  myjira: {
    service: 'myjira',
    tool: 'myjira.search_issues',
    args: { query: '' },
    label: 'Jira của bạn',
  },
  gmail: {
    service: 'gmail',
    tool: 'gmail.search_threads',
    args: { query: 'is:unread' },
    label: 'Email chưa đọc',
  },
};

function foldVietnamese(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .trim();
}

const WRITE_INTENT_PATTERNS: RegExp[] = [
  /\b(?:tao|them|xoa|dong|luu tru|chuyen|cap nhat|sua)\s+(?:the|card|board|bang|danh sach|list)\b/i,
  /\b(?:create|add|delete|close|archive|move|update)\s+(?:card|issue|event|row|page|email)\b/i,
  /\b(?:tao|dong|xoa|cap nhat)\s+(?:issue|su kien|lich|trang|page|task)\b/i,
  /\b(?:them|ghi|xoa|cap nhat)\s+(?:dong|hang|row|bang tinh|sheet)\b/i,
  /\b(?:gui|tra loi|chuyen tiep|xoa)\s+(?:email|mail|thu)\b/i,
];

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

export function computeTelegramDigestConfigHash(config: TelegramDigestConfig): string {
  const canonical: TelegramDigestConfig = {
    credentialId: config.credentialId,
    telegramUserId: config.telegramUserId,
    username: config.username,
    chatId: config.chatId,
    chatTitle: config.chatTitle,
    sources: config.sources.map((s) => ({
      service: s.service,
      tool: s.tool,
      ...(s.args !== undefined ? { args: s.args } : {}),
      label: s.label,
    })),
    recurrence: config.recurrence,
    timeZone: config.timeZone,
  };
  return createHash('sha256').update(JSON.stringify(canonicalize(canonical))).digest('hex');
}

export interface EvaluateTelegramDigestInput {
  proposal: ScheduleResponse;
  services: string[];
  timeZone: string;
  telegramLookup?: TelegramConnectionLookupResult | null;
  githubLookup?: Pick<GitHubConnectionLookupResult, 'status' | 'connection'> | null;
  existingDigest?: TelegramDigestConfig | null;
}

export function evaluateTelegramDigestCandidate(
  input: EvaluateTelegramDigestInput,
): TelegramDigestCandidate {
  const { proposal, services, timeZone, telegramLookup, existingDigest } = input;

  if (proposal.action !== 'create' && proposal.action !== 'update') {
    return { canAutoDigest: false };
  }

  if (!services.includes('telegram')) {
    return { canAutoDigest: false };
  }

  const nonTelegramServices = services.filter((s) => s !== 'telegram');
  if (nonTelegramServices.length === 0) {
    return {
      canAutoDigest: false,
      disabledReason: 'Cần ít nhất một dịch vụ nguồn dữ liệu (GitHub, Calendar, Trello, Sheets...) để tổng hợp báo cáo tự động.',
    };
  }

  const unsupported = nonTelegramServices.filter((s) => !READ_DIGEST_SOURCE_MAP[s]);
  if (unsupported.length > 0) {
    return {
      canAutoDigest: false,
      disabledReason: 'Chế độ tự gửi báo cáo chỉ hỗ trợ đọc dữ liệu từ các dịch vụ nguồn và gửi về đúng 1 cuộc trò chuyện Telegram.',
    };
  }

  const requestText = proposal.request ?? '';
  const foldedRequest = foldVietnamese(requestText);
  if (WRITE_INTENT_PATTERNS.some((re) => re.test(foldedRequest))) {
    return {
      canAutoDigest: false,
      disabledReason: 'Lịch chạy có thao tác ghi hoặc thay đổi dữ liệu trên dịch vụ khác nên cần duyệt thủ công từng lượt.',
    };
  }

  if (
    !telegramLookup ||
    telegramLookup.status !== 'connected' ||
    !telegramLookup.connection ||
    telegramLookup.selectedChats.length === 0
  ) {
    return {
      canAutoDigest: false,
      disabledReason: 'Hãy Kết nối Telegram và chọn cuộc trò chuyện nhận báo cáo trước khi bật Tự gửi.',
    };
  }

  const { selectedChats, connection } = telegramLookup;
  let targetChat = selectedChats[0]!;

  const mentionsPersonal =
    foldedRequest.includes('telegram cua toi') ||
    foldedRequest.includes('ca nhan') ||
    foldedRequest.includes('rieng') ||
    foldedRequest.includes('cho toi');

  if (mentionsPersonal) {
    const privateChat = selectedChats.find(
      (c) => c.type === 'private' || c.chatId === connection.telegramUserId,
    );
    if (privateChat) targetChat = privateChat;
  } else {
    const matchedGroup = selectedChats.find((c) => {
      if (c.type === 'private') return false;
      const foldedTitle = foldVietnamese(c.title);
      return foldedTitle.length > 0 && foldedRequest.includes(foldedTitle);
    });
    if (matchedGroup) {
      targetChat = matchedGroup;
    } else if (existingDigest) {
      const existingMatch = selectedChats.find((c) => c.chatId === existingDigest.chatId);
      if (existingMatch) targetChat = existingMatch;
    } else {
      const privateChat = selectedChats.find(
        (c) => c.type === 'private' || c.chatId === connection.telegramUserId,
      );
      if (privateChat) targetChat = privateChat;
    }
  }

  const sources: TelegramDigestSource[] = [];
  for (const service of [...new Set(nonTelegramServices)]) {
    const source = READ_DIGEST_SOURCE_MAP[service]!;
    if (service === 'github') {
      const repos = input.githubLookup?.status === 'connected' ? input.githubLookup.connection?.repos : undefined;
      if (!repos?.length) {
        return {
          canAutoDigest: false,
          disabledReason: 'Hãy kết nối GitHub và chọn repository được phép đọc trước khi bật Tự gửi.',
        };
      }
      for (const repo of [...new Set(repos)]) {
        sources.push({ ...source, args: { repo, query: 'open' }, label: `${source.label} (${repo})` });
      }
    } else {
      sources.push({ ...source });
    }
  }

  const config: TelegramDigestConfig = {
    credentialId: connection.credentialId,
    telegramUserId: connection.telegramUserId,
    username: connection.username,
    chatId: targetChat.chatId,
    chatTitle: targetChat.title,
    sources,
    recurrence: proposal.recurrence!,
    timeZone,
  };

  return {
    canAutoDigest: true,
    config,
    configHash: computeTelegramDigestConfigHash(config),
  };
}
