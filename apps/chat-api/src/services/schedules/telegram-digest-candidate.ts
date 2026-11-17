import { createHash } from 'node:crypto';
import { JIRA_CAPABILITY_DISABLED_IN_G2A } from '@wap/tool-schemas';
import type {
  GmailDigestBinding,
  JiraDigestSourceBinding,
  NotionDigestSourceBinding,
  ScheduleResponse,
  TelegramDigestCandidate,
  TelegramDigestConfig,
  TelegramDigestSource,
} from '@wap/tool-schemas';
import type { TelegramConnectionLookupResult } from '../telegram/connection-reference.js';
import type { GitHubConnectionLookupResult } from '../github/connection-reference.js';
import type { JiraConnectionLookupResult } from './jira-digest-candidate.js';
import { isUuid } from '../../db/repositories/uuid.js';
import {
  DEFAULT_GMAIL_DIGEST_QUERY,
  isValidGmailDigestBinding,
  isValidGmailDigestQuery,
  validateTelegramDigestGmailConfig,
} from './gmail-digest-binding.js';

export type { TelegramConnectionLookupResult };

import { isNotionDigestSourceBinding, NOTION_DIGEST_REAPPROVAL } from '../notion/digest-source-authority.js';

export function telegramNotionSource(config: TelegramDigestConfig | null | undefined) {
  return Array.isArray(config?.sources) ? config.sources.find((source) => source?.service === 'notion') : undefined;
}

export function approvedTelegramNotionBinding(config: TelegramDigestConfig): NotionDigestSourceBinding | undefined {
  const source = telegramNotionSource(config);
  if (config.sources.length === 1 && source?.tool === 'notion.query_database' &&
      source.args === undefined && isNotionDigestSourceBinding(source.notionBinding)) {
    return source.notionBinding;
  }
}

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
    tool: 'notion.query_database',
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
    args: { query: 'in:inbox is:unread' },
    label: 'Email chưa đọc',
  },
};

// Legacy shared Jira stays permanently retired. myjira is allowed only inside organization workspace digests.
const DISABLED_READ_DIGEST_SERVICES: ReadonlyMap<string, string> = new Map([
  ['jira', `${JIRA_CAPABILITY_DISABLED_IN_G2A}: Scheduled legacy Jira digests are permanently disabled.`],
]);

export function getDigestSourceDisabledReason(
  source: { service?: string; tool?: string; args?: Record<string, unknown> } | null | undefined,
  context?: { workspaceMode?: string | null; workspaceId?: string | null },
): string | undefined {
  const service = typeof source?.service === 'string' ? source.service : '';
  const toolService = typeof source?.tool === 'string' ? source.tool.split('.')[0] ?? '' : '';
  const disabled = DISABLED_READ_DIGEST_SERVICES.get(service) ?? DISABLED_READ_DIGEST_SERVICES.get(toolService);
  if (disabled) return disabled;
  if ((service === 'myjira' || toolService === 'myjira') && service !== toolService) {
    return 'JIRA_SOURCE_MISMATCH: Công cụ myjira không khớp với dịch vụ nguồn.';
  }
  if (service === 'myjira' || toolService === 'myjira') {
    if (context?.workspaceMode !== 'organization' || !context?.workspaceId || !String(context.workspaceId).trim()) {
      return 'JIRA_WORKSPACE_REQUIRED: Nguồn Jira trong bản tin Telegram chỉ khả dụng trong Workspace Tổ chức.';
    }
    const siteId = typeof source?.args?.siteId === 'string' ? source.args.siteId.trim() : '';
    const projectKey = typeof source?.args?.projectKey === 'string' ? source.args.projectKey.trim() : '';
    if (!siteId || !projectKey) {
      return 'JIRA_SCOPE_REQUIRED: Nguồn Jira trong bản tin Telegram phải chỉ rõ siteId và projectKey được phép.';
    }
  }
  return undefined;
}

export function isJiraDigestSourceBinding(value: unknown): value is JiraDigestSourceBinding {
  if (!value || typeof value !== 'object') return false;
  const { grantId, atlassianAccountId } = value as Partial<JiraDigestSourceBinding>;
  return typeof grantId === 'string' && isUuid(grantId) &&
    typeof atlassianAccountId === 'string' && atlassianAccountId.trim().length > 0;
}

function foldVietnamese(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .trim();
}

const WRITE_INTENT_PATTERNS: RegExp[] = [
  /\b(?:tao|them|xoa|dong|luu tru|chuyen|cap nhat|sua)\s+(?:the|card|board|bang|danh sach|list|ticket|bug)\b/i,
  /\b(?:create|add|delete|close|archive|move|update|transition)\s+(?:card|issue|ticket|event|row|page|email)\b/i,
  /\b(?:tao|dong|xoa|cap nhat|sua)\s+(?:issue|su kien|lich|trang|page|task)\b/i,
  /\b(?:chuyen\s+trang\s+thai|them\s+binh\s+luan|add\s+comment|gan\s+(?:nguoi|issue|ticket))\b/i,
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
  const gmailValidation = validateTelegramDigestGmailConfig(config);
  if (gmailValidation.kind === 'invalid') {
    throw new Error(gmailValidation.reason);
  }
  const canonical: TelegramDigestConfig = {
    credentialId: config.credentialId,
    telegramUserId: config.telegramUserId,
    username: config.username,
    chatId: config.chatId,
    chatTitle: config.chatTitle,
    ...(gmailValidation.kind === 'gmail_bound' ? { sourceBindingVersion: 1 as const } : {}),
    ...(typeof config.includeAiSummary === 'boolean' ? { includeAiSummary: config.includeAiSummary } : {}),
    sources: config.sources.map((s) => ({
      service: s.service,
      tool: s.tool,
      ...(s.args !== undefined ? { args: s.args } : {}),
      label: s.label,
      ...(gmailValidation.kind === 'gmail_bound' && s.service === 'gmail' && s.binding
        ? {
            binding: {
              kind: s.binding.kind,
              credentialId: s.binding.credentialId,
              email: s.binding.email,
              oauthClientId: s.binding.oauthClientId,
            },
          }
        : {}),
      ...(s.notionBinding !== undefined ? { notionBinding: s.notionBinding } : {}),
      ...(s.jiraBinding !== undefined ? { jiraBinding: s.jiraBinding } : {}),
    })),
    recurrence: config.recurrence,
    timeZone: config.timeZone,
  };
  return createHash('sha256').update(JSON.stringify(canonicalize(canonical))).digest('hex');
}

export function buildTelegramDigestSourceArgs(
  source: TelegramDigestSource,
  window: { sinceIso: string; untilIso: string },
): {
  callArgs: Record<string, any>;
  repoSearchTool?: string;
  sheetListTool?: string;
  sheetReadTool?: string;
} {
  const base = { ...(source.args ?? {}) };
  if (source.tool === 'calendar.list_events') {
    return {
      callArgs: { timeMin: window.sinceIso, timeMax: window.untilIso, maxResults: 20, ...base },
    };
  }
  if (source.tool === 'mycalendar.list_events') {
    return {
      callArgs: { calendarId: 'primary', timeMin: window.sinceIso, timeMax: window.untilIso, ...base },
    };
  }
  if (source.tool === 'sheets.read_range') {
    return {
      callArgs: { range: 'A1:Z20', ...base },
      sheetListTool: 'sheets.list_spreadsheets',
    };
  }
  if (source.tool === 'mysheets.list_spreadsheets') {
    return {
      callArgs: { query: '', ...base },
      sheetReadTool: 'mysheets.read_range',
    };
  }
  if (source.tool === 'github.list_issues') {
    return {
      callArgs: { state: 'open', ...base },
      repoSearchTool: 'github.search_repos',
    };
  }
  return { callArgs: base };
}

type GmailDigestQuery = { query: string; label: string };
const UNSUPPORTED_GMAIL_DIGEST_FILTER =
  'Bộ lọc Gmail chưa thể áp dụng đầy đủ cho lịch tự gửi. Hãy sửa bộ lọc hoặc chọn duyệt thủ công từng lượt.';
const EXPLICIT_GMAIL_FILTER = /(?<![\p{L}\p{N}_@./:-])(-?)([A-Za-z][A-Za-z0-9_-]*):(\S*)/gu;
const POSITIVE_ONLY_GMAIL_FILTERS = new Set(['in:inbox', 'label:inbox', 'is:unread']);
const GMAIL_PROSE_NEGATION =
  /\b(?:khong(?:\s+(?:phai|co|kem))?|bo\s+qua|loai\s+tru|except|excluding|without|not)(?:\s+(?:thu|email|mail))?(?:\s*[:(-])?$/;
const GMAIL_SUBJECT_FILTER =
  /\b(?:(?:co|voi|theo)\s+(?:tieu de|chu de)|(?:tieu de|chu de)\s+(?:chua|co|la|bang|bat dau|ket thuc)|(?:with|having|by)\s+(?:the\s+)?subject|subject\s+(?:contains?|starts?|ends?|equals?|includes?|is))\b/;
const SCHEDULE_METADATA_CHANGE =
  /^(?:(?:vui long|hay|giup toi)\s+)?(?:doi|sua|chinh|cap nhat)\s+(?:lai\s+)?(?:ten|tieu de|gio|thoi gian|ngay|tan suat)(?:\s+cua)?\s+(?:lich|ban tin)\b/;
const ADDITIONAL_MAILBOX_REQUEST =
  /(?:[,;.]|\bva\b)\s*(?:chi\s+)?(?:loc|lay|doc|tim|tom tat|bo qua|loai tru|them dieu kien|doi bo loc)\b/;

function readExplicitGmailFilters(requestText: string) {
  const filters = new Set<string>();
  let explicit = false;
  let invalid = false;
  const prose = requestText.replace(EXPLICIT_GMAIL_FILTER, (token, sign: string, key: string, value: string, offset: number) => {
    const operator = key.toLowerCase();
    if (!value && !sign && !/^(?:from|to|subject|label|has|is|in|newer_than|older_than|before|after)$/i.test(operator)) {
      return token;
    }
    explicit = true;
    if (GMAIL_PROSE_NEGATION.test(foldVietnamese(requestText.slice(0, offset)))) invalid = true;
    const lower = value.toLowerCase();
    const filter = `${operator}:${lower}`;
    if (!sign && POSITIVE_ONLY_GMAIL_FILTERS.has(filter)) return ' ';
    if (operator === 'from' && /^[a-z0-9._%+-]+(?:@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)?$/.test(lower)) {
      filters.add(`${sign}from:${lower}`);
    } else if (operator === 'label' && /^[\p{L}\p{N}_/.-]+$/u.test(value)) {
      filters.add(`${sign}label:${value}`);
    } else if (filter === 'has:attachment' || (operator === 'newer_than' && /^\d+[dmy]$/.test(lower))) {
      filters.add(`${sign}${filter}`);
    } else {
      invalid = true;
    }
    return ' ';
  });
  return { prose, filters, invalid: invalid || (explicit && /[{}|]|\bOR\b/i.test(prose)) };
}

function readGmailFilters(requestText: string, includeNaturalFilters = true): { filters: Set<string>; invalid: boolean } {
  const { prose, filters, invalid } = readExplicitGmailFilters(requestText);
  if (invalid || !includeNaturalFilters) return { filters, invalid };

  const foldedProse = foldVietnamese(prose).replace(/\s+/g, ' ');
  if (GMAIL_SUBJECT_FILTER.test(foldedProse)) return { filters, invalid: true };

  for (const match of foldedProse.matchAll(/(?:^|[\s,(:;])(?:tu|cua)\s+([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/g)) {
    const prefix = foldedProse.slice(0, match.index).trimEnd();
    if (GMAIL_PROSE_NEGATION.test(prefix)) return { filters, invalid: true };
    filters.add(`from:${match[1]}`);
  }
  const attachmentExclusion =
    /\b(?:khong(?: co| kem)?|thieu|(?:bo qua|loai tru)(?: (?:thu|email|mail))?(?: co)?)\s+(?:tep |file )?dinh kem\b|\b(?:no|without(?: any)?)\s+attachments?\b/g;
  const withoutAttachmentExclusions = foldedProse.replace(attachmentExclusion, ' ');
  if (withoutAttachmentExclusions !== foldedProse) {
    filters.add('-has:attachment');
  }
  if (/\bdinh kem\b|\battachments?\b/.test(withoutAttachmentExclusions)) {
    filters.add('has:attachment');
  }
  if (filters.has('-has:attachment') && filters.has('has:attachment')) return { filters, invalid: true };
  for (const [pattern, query] of [
    [/\b(?:hoa don|invoice)\b/, '(hóa đơn OR invoice)'],
    [/\b(?:bao gia|quote|quotation)\b/, '(báo giá OR quote)'],
    [/\b(?:hop dong|contract)\b/, '(hợp đồng OR contract)'],
    [/\b(?:vip|khan cap|urgent)\b/, '(VIP OR khẩn OR urgent)'],
  ] as const) {
    const match = pattern.exec(foldedProse);
    if (!match) continue;
    if (GMAIL_PROSE_NEGATION.test(foldedProse.slice(0, match.index).trimEnd())) return { filters, invalid: true };
    filters.add(query);
  }
  return { filters, invalid: false };
}

export function resolveGmailDigestQueryAndLabel(
  requestText: string,
  userTexts: readonly string[] = [],
): GmailDigestQuery | { disabledReason: string } {
  const unsupported = { disabledReason: UNSUPPORTED_GMAIL_DIGEST_FILTER };
  const { filters, invalid } = readGmailFilters(requestText);
  if (invalid) return unsupported;

  // A name can contain filter words without changing which mail the digest reads.
  for (const userText of userTexts) {
    const folded = foldVietnamese(userText).replace(/\s+/g, ' ');
    const metadataOnly = SCHEDULE_METADATA_CHANGE.test(folded) && !ADDITIONAL_MAILBOX_REQUEST.test(folded);
    const requested = readGmailFilters(userText, !metadataOnly);
    if (requested.invalid || [...requested.filters].some(filter => !filters.has(filter))) return unsupported;
  }
  const query = [DEFAULT_GMAIL_DIGEST_QUERY, ...filters].join(' ');
  if (!isValidGmailDigestQuery(query)) return unsupported;
  return { query, label: filters.size ? `Email chưa đọc (${[...filters].join(', ')})` : 'Email chưa đọc' };
}

export interface EvaluateTelegramDigestInput {
  proposal: ScheduleResponse;
  services: string[];
  timeZone: string;
  telegramLookup?: TelegramConnectionLookupResult | null;
  githubLookup?: Pick<GitHubConnectionLookupResult, 'status' | 'connection'> | null;
  jiraLookup?: JiraConnectionLookupResult | null;
  workspaceMode?: 'legacy' | 'personal' | 'organization';
  workspaceId?: string | null;
  gmailBinding?: GmailDigestBinding | null;
  existingDigest?: TelegramDigestConfig | null;
  gmailUserTexts?: readonly string[];
  reauthorizeGmailQuery?: GmailDigestQuery;
  notionBinding?: NotionDigestSourceBinding;
  includeAiSummary?: boolean;
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

  if (nonTelegramServices.includes('notion') &&
      (new Set(nonTelegramServices).size !== 1 || !isNotionDigestSourceBinding(input.notionBinding))) {
    return { canAutoDigest: false, disabledReason: NOTION_DIGEST_REAPPROVAL };
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
      disabledReason: nonTelegramServices.includes('myjira')
        ? 'Lịch có Jira chỉ hỗ trợ bản tin chỉ đọc gửi tới Telegram. Hãy bỏ thao tác ghi hoặc thay đổi dữ liệu khỏi lịch.'
        : 'Lịch chạy có thao tác ghi hoặc thay đổi dữ liệu trên dịch vụ khác nên cần duyệt thủ công từng lượt.',
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
  const privateChat = selectedChats.find(
    (c) => c.type === 'private' || c.chatId === connection.telegramUserId,
  );
  const selectedGroups = selectedChats.filter(
    (c) => c.type !== 'private' && c.chatId !== connection.telegramUserId,
  );

  const mentionsPersonal =
    foldedRequest.includes('telegram cua toi') ||
    foldedRequest.includes('ca nhan') ||
    foldedRequest.includes('rieng') ||
    foldedRequest.includes('cho toi');

  const mentionsGroupDestination =
    /\b(?:vao|qua|tren|den|cho|tai)\s+(?:nhom|group|kenh|channel)\b/i.test(foldedRequest) ||
    /\b(?:nhom|group)\s+telegram\b/i.test(foldedRequest);

  let targetChat = selectedChats[0]!;

  if (mentionsPersonal) {
    if (privateChat) {
      targetChat = privateChat;
    } else if (selectedChats.length === 1) {
      targetChat = selectedChats[0]!;
    } else {
      return {
        canAutoDigest: false,
        disabledReason: 'Hãy chọn cuộc trò chuyện Telegram của tôi trong trang Kết nối dịch vụ để bật chế độ tự gửi.',
      };
    }
  } else {
    const matchedGroups = selectedGroups.filter((c) => {
      const foldedTitle = foldVietnamese(c.title);
      return foldedTitle.length > 0 && foldedRequest.includes(foldedTitle);
    });
    if (matchedGroups.length === 1) {
      targetChat = matchedGroups[0]!;
    } else if (matchedGroups.length > 1) {
      return {
        canAutoDigest: false,
        disabledReason: 'Hãy nêu rõ tên nhóm Telegram nhận bản tin để bật chế độ tự gửi.',
      };
    } else if (existingDigest) {
      const existingMatch = selectedChats.find((c) => c.chatId === existingDigest.chatId);
      if (existingMatch) {
        targetChat = existingMatch;
      } else {
        return {
          canAutoDigest: false,
          disabledReason: 'Hãy nêu rõ tên nhóm Telegram nhận bản tin để bật chế độ tự gửi.',
        };
      }
    } else if (mentionsGroupDestination) {
      if (selectedGroups.length === 1) {
        targetChat = selectedGroups[0]!;
      } else {
        return {
          canAutoDigest: false,
          disabledReason: 'Hãy nêu rõ tên nhóm Telegram nhận bản tin để bật chế độ tự gửi.',
        };
      }
    } else if (selectedChats.length === 1) {
      targetChat = selectedChats[0]!;
    } else if (privateChat) {
      targetChat = privateChat;
    } else {
      return {
        canAutoDigest: false,
        disabledReason: 'Hãy nêu rõ tên nhóm Telegram nhận bản tin để bật chế độ tự gửi.',
      };
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
    } else if (service === 'gmail') {
      if (!isValidGmailDigestBinding(input.gmailBinding)) {
        return {
          canAutoDigest: false,
          disabledReason: 'Hãy kết nối Gmail cá nhân hợp lệ trước khi bật Tự gửi.',
        };
      }
      const resolvedGmail = input.reauthorizeGmailQuery ?? resolveGmailDigestQueryAndLabel(requestText, input.gmailUserTexts);
      if ('disabledReason' in resolvedGmail) {
        return { canAutoDigest: false, disabledReason: resolvedGmail.disabledReason };
      }
      sources.push({
        ...source,
        args: { query: resolvedGmail.query },
        label: `${resolvedGmail.label} (${input.gmailBinding.email})`,
        binding: {
          kind: 'gmail',
          credentialId: input.gmailBinding.credentialId,
          email: input.gmailBinding.email,
          oauthClientId: input.gmailBinding.oauthClientId,
        },
      });
    } else if (service === 'myjira') {
      if (input.workspaceMode !== 'organization' || !input.workspaceId) {
        return {
          canAutoDigest: false,
          disabledReason: 'Bản tin Jira qua Telegram chỉ khả dụng trong Workspace Tổ chức.',
        };
      }
      const jira = input.jiraLookup;
      if (
        jira?.status !== 'connected' || jira.workspaceId !== input.workspaceId ||
        !isJiraDigestSourceBinding(jira) || !jira.projects?.length
      ) {
        return {
          canAutoDigest: false,
          disabledReason: 'Hãy kết nối Jira OAuth 3LO và chọn ít nhất 1 dự án trong Workspace trước khi bật Tự gửi.',
        };
      }
      const { projects, grantId, atlassianAccountId } = jira;
      const lowerReq = requestText.toLowerCase();
      const matched = projects.filter(
        (p) =>
          new RegExp(`(?:^|[^a-z0-9_])${p.projectKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9_])`, 'i').test(requestText) ||
          (p.projectName && lowerReq.includes(p.projectName.toLowerCase())),
      );
      for (const proj of (matched.length > 0 ? matched : projects).slice(0, 5)) {
        sources.push({
          ...source,
          args: { siteId: proj.siteId, projectKey: proj.projectKey, query: '' },
          label: `${source.label} (${proj.projectKey})`,
          jiraBinding: { grantId, atlassianAccountId },
        });
      }
    } else if (service === 'notion' && input.notionBinding) {
      sources.push({
        ...source, notionBinding: input.notionBinding,
        label: `Notion · ${input.notionBinding.workspaceName} · ${input.notionBinding.databases.map((d) => d.title).join(', ')}`,
      });
    } else {
      sources.push({ ...source });
    }
  }

  const hasGmailSource = sources.some((s) => s.service === 'gmail');
  const resolvedIncludeAiSummary =
    typeof input.includeAiSummary === 'boolean'
      ? input.includeAiSummary
      : typeof input.existingDigest?.includeAiSummary === 'boolean'
        ? input.existingDigest.includeAiSummary
        : undefined;
  const config: TelegramDigestConfig = {
    credentialId: connection.credentialId,
    telegramUserId: connection.telegramUserId,
    username: connection.username,
    chatId: targetChat.chatId,
    chatTitle: targetChat.title,
    ...(hasGmailSource ? { sourceBindingVersion: 1 as const } : {}),
    ...(typeof resolvedIncludeAiSummary === 'boolean' ? { includeAiSummary: resolvedIncludeAiSummary } : {}),
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
