import type pg from 'pg';
import { JIRA_CAPABILITY_DISABLED_IN_G2A } from '@wap/tool-schemas';
import type {
  GmailDigestBinding,
  JiraDigestSourceBinding,
  NotionDigestSourceBinding,
  TelegramDigestSource,
} from '@wap/tool-schemas';
import type { GitHubConnectionLookupResult } from '../github/connection-reference.js';
import type { JiraConnectionLookupResult } from './jira-digest-candidate.js';
import { isUuid } from '../../db/repositories/uuid.js';
import { isValidGmailDigestBinding, isValidGmailDigestQuery } from './gmail-digest-binding.js';
import { isNotionDigestSourceBinding, NOTION_DIGEST_REAPPROVAL } from '../notion/digest-source-authority.js';
import { bindMyCalendarDigestSource, isMyCalendarDigestSource, MYCALENDAR_DIGEST_REAPPROVAL, type MyCalendarDigestConnection } from './mycalendar-digest-source.js';
import { bindMySheetsDigestSource, isMySheetsDigestSource, MYSHEETS_DIGEST_REAPPROVAL, type MySheetsDigestConnection } from './mysheets-digest-source.js';

export function telegramNotionSource(config: { sources?: TelegramDigestSource[] } | null | undefined) {
  return Array.isArray(config?.sources) ? config.sources.find((source) => source?.service === 'notion') : undefined;
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
export const DISABLED_READ_DIGEST_SERVICES: ReadonlyMap<string, string> = new Map([
  ['jira', `${JIRA_CAPABILITY_DISABLED_IN_G2A}: Scheduled legacy Jira digests are permanently disabled.`],
]);

export function getDigestSourceDisabledReason(
  source: { service?: string; tool?: string; args?: Record<string, unknown> } | null | undefined,
  context?: { workspaceMode?: string | null; workspaceId?: string | null; destination?: string | null },
): string | undefined {
  const service = typeof source?.service === 'string' ? source.service : '';
  const toolService = typeof source?.tool === 'string' ? source.tool.split('.')[0] ?? '' : '';
  const disabled = DISABLED_READ_DIGEST_SERVICES.get(service) ?? DISABLED_READ_DIGEST_SERVICES.get(toolService);
  if (disabled) return disabled;
  if (service === 'sheets' || toolService === 'sheets') {
    if (context?.workspaceMode === 'personal') {
      return 'SHEETS_WORKSPACE_REQUIRED: Bảng tính nhóm (sheets) không khả dụng trong Không gian cá nhân; hãy dùng Google Sheets của bạn (mysheets).';
    }
    if (context?.workspaceMode === 'organization' && context?.destination === 'telegram') {
      return 'SHEETS_TELEGRAM_ORG_FORBIDDEN: Dữ liệu Bảng tính nhóm trong Workspace Tổ chức không được tự động gửi ra Telegram cá nhân; hãy gửi qua Slack của tổ chức.';
    }
  }
  if ((service === 'myjira' || toolService === 'myjira') && service !== toolService) {
    return 'JIRA_SOURCE_MISMATCH: Công cụ myjira không khớp với dịch vụ nguồn.';
  }
  if (service === 'myjira' || toolService === 'myjira') {
    if (context?.workspaceMode !== 'organization' || !context?.workspaceId || !String(context.workspaceId).trim()) {
      return 'JIRA_WORKSPACE_REQUIRED: Nguồn Jira trong bản tin tổng hợp chỉ khả dụng trong Workspace Tổ chức.';
    }
    const siteId = typeof source?.args?.siteId === 'string' ? source.args.siteId.trim() : '';
    const projectKey = typeof source?.args?.projectKey === 'string' ? source.args.projectKey.trim() : '';
    if (!siteId || !projectKey) {
      return 'JIRA_SCOPE_REQUIRED: Nguồn Jira trong bản tin tổng hợp phải chỉ rõ siteId và projectKey được phép.';
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

export function foldVietnamese(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .trim();
}

export const WRITE_INTENT_PATTERNS: RegExp[] = [
  /\b(?:tao|them|xoa|dong|luu tru|chuyen|cap nhat|sua)\s+(?:the|card|board|bang|danh sach|list|ticket|bug)\b/i,
  /\b(?:create|add|delete|close|archive|move|update|transition)\s+(?:card|issue|ticket|event|row|page|email)\b/i,
  /\b(?:tao|dong|xoa|cap nhat|sua)\s+(?:issue|su kien|lich|trang|page|task)\b/i,
  /\b(?:chuyen\s+trang\s+thai|them\s+binh\s+luan|add\s+comment|gan\s+(?:nguoi|issue|ticket))\b/i,
  /\b(?:them|ghi|xoa|cap nhat)\s+(?:dong|hang|row|bang tinh|sheet)\b/i,
  /\b(?:gui|tra loi|chuyen tiep|xoa)\s+(?:email|mail|thu)\b/i,
];

export function hasWriteIntentForDigest(requestText: string): boolean {
  const foldedRequest = foldVietnamese(requestText);
  return WRITE_INTENT_PATTERNS.some((re) => re.test(foldedRequest));
}

export function canonicalizeDigestValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeDigestValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonicalizeDigestValue(v);
    }
    return out;
  }
  return value;
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
      callArgs: { timeMin: window.sinceIso, timeMax: window.untilIso, limit: 20, ...base },
    };
  }
  if (source.tool === 'mycalendar.list_events') {
    return {
      callArgs: { timeMin: window.sinceIso, timeMax: window.untilIso, ...base },
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

export type GmailDigestQuery = { query: string; label: string };
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

  for (const userText of userTexts) {
    const folded = foldVietnamese(userText).replace(/\s+/g, ' ');
    const metadataOnly = SCHEDULE_METADATA_CHANGE.test(folded) && !ADDITIONAL_MAILBOX_REQUEST.test(folded);
    const requested = readGmailFilters(userText, !metadataOnly);
    if (requested.invalid || [...requested.filters].some(filter => !filters.has(filter))) return unsupported;
  }
  const query = ['in:inbox is:unread', ...filters].join(' ');
  if (!isValidGmailDigestQuery(query)) return unsupported;
  return { query, label: filters.size ? `Email chưa đọc (${[...filters].join(', ')})` : 'Email chưa đọc' };
}

export interface BuildMultiDigestSourcesInput {
  sourceServices: string[];
  destinationLabel: 'Telegram' | 'Slack';
  requestText: string;
  githubLookup?: Pick<GitHubConnectionLookupResult, 'status' | 'connection'> | null;
  jiraLookup?: JiraConnectionLookupResult | null;
  mycalendarLookup?: MyCalendarDigestConnection | null;
  existingMyCalendarSources?: TelegramDigestSource[];
  reauthorizeMyCalendar?: boolean;
  mysheetsLookup?: MySheetsDigestConnection | null;
  existingMySheetsSources?: TelegramDigestSource[];
  reauthorizeMySheets?: boolean;
  workspaceMode?: 'legacy' | 'personal' | 'organization';
  workspaceId?: string | null;
  gmailBinding?: GmailDigestBinding | null;
  gmailUserTexts?: readonly string[];
  reauthorizeGmailQuery?: GmailDigestQuery;
  notionBinding?: NotionDigestSourceBinding;
}

export function validateMultiDigestSourcePreconditions(input: {
  sourceServices: string[];
  destinationLabel: 'Telegram' | 'Slack';
  requestText: string;
  notionBinding?: NotionDigestSourceBinding;
  workspaceMode?: 'legacy' | 'personal' | 'organization';
  workspaceId?: string | null;
}): { ok: true } | { ok: false; disabledReason: string } {
  const { sourceServices, destinationLabel, requestText, notionBinding, workspaceMode } = input;
  if (sourceServices.length === 0) {
    return {
      ok: false,
      disabledReason:
        'Cần ít nhất một dịch vụ nguồn dữ liệu (GitHub, Calendar, Trello, Sheets...) để tổng hợp báo cáo tự động.',
    };
  }

  if (
    sourceServices.includes('notion') &&
    (new Set(sourceServices).size !== 1 || !isNotionDigestSourceBinding(notionBinding))
  ) {
    return { ok: false, disabledReason: NOTION_DIGEST_REAPPROVAL };
  }

  const unsupported = sourceServices.filter((s) => !READ_DIGEST_SOURCE_MAP[s]);
  if (unsupported.length > 0) {
    return {
      ok: false,
      disabledReason: `Chế độ tự gửi báo cáo chỉ hỗ trợ đọc dữ liệu từ các dịch vụ nguồn và gửi về đúng 1 ${destinationLabel === 'Slack' ? 'kênh Slack' : 'cuộc trò chuyện Telegram'}.`,
    };
  }

  if (sourceServices.includes('sheets')) {
    if (workspaceMode === 'personal') {
      return {
        ok: false,
        disabledReason: 'Bảng tính nhóm không khả dụng trong Không gian cá nhân. Hãy kết nối Google Sheets của bạn để bật Tự gửi.',
      };
    }
    if (workspaceMode === 'organization' && destinationLabel === 'Telegram') {
      return {
        ok: false,
        disabledReason: 'Trong Không gian làm việc Tổ chức, dữ liệu Bảng tính nhóm không được gửi tự động sang Telegram cá nhân. Hãy chọn kênh Slack của tổ chức.',
      };
    }
  }

  if (hasWriteIntentForDigest(requestText)) {
    return {
      ok: false,
      disabledReason: sourceServices.includes('myjira')
        ? `Lịch có Jira chỉ hỗ trợ bản tin chỉ đọc gửi tới ${destinationLabel}. Hãy bỏ thao tác ghi hoặc thay đổi dữ liệu khỏi lịch.`
        : 'Lịch chạy có thao tác ghi hoặc thay đổi dữ liệu trên dịch vụ khác nên cần duyệt thủ công từng lượt.',
    };
  }

  return { ok: true };
}

export function buildMultiDigestSources(
  input: BuildMultiDigestSourcesInput,
): { ok: true; sources: TelegramDigestSource[] } | { ok: false; disabledReason: string } {
  const { sourceServices, destinationLabel, requestText } = input;
  const precheck = validateMultiDigestSourcePreconditions({
    sourceServices,
    destinationLabel,
    requestText,
    notionBinding: input.notionBinding,
    workspaceMode: input.workspaceMode,
    workspaceId: input.workspaceId,
  });
  if (!precheck.ok) return precheck;

  const sources: TelegramDigestSource[] = [];
  for (const service of [...new Set(sourceServices)]) {
    const source = READ_DIGEST_SOURCE_MAP[service]!;
    if (service === 'github') {
      const repos = input.githubLookup?.status === 'connected' ? input.githubLookup.connection?.repos : undefined;
      if (!repos?.length) {
        return {
          ok: false,
          disabledReason: 'Hãy kết nối GitHub và chọn repository được phép đọc trước khi bật Tự gửi.',
        };
      }
      for (const repo of [...new Set(repos)]) {
        sources.push({ ...source, args: { repo, query: 'open' }, label: `${source.label} (${repo})` });
      }
    } else if (service === 'gmail') {
      if (!isValidGmailDigestBinding(input.gmailBinding)) {
        return {
          ok: false,
          disabledReason: 'Hãy kết nối Gmail cá nhân hợp lệ trước khi bật Tự gửi.',
        };
      }
      const resolvedGmail =
        input.reauthorizeGmailQuery ?? resolveGmailDigestQueryAndLabel(requestText, input.gmailUserTexts);
      if ('disabledReason' in resolvedGmail) {
        return { ok: false, disabledReason: resolvedGmail.disabledReason };
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
          ok: false,
          disabledReason: `Bản tin Jira qua ${destinationLabel} chỉ khả dụng trong Workspace Tổ chức.`,
        };
      }
      const jira = input.jiraLookup;
      if (
        jira?.status !== 'connected' ||
        jira.workspaceId !== input.workspaceId ||
        !isJiraDigestSourceBinding(jira) ||
        !jira.projects?.length
      ) {
        return {
          ok: false,
          disabledReason: 'Hãy kết nối Jira OAuth 3LO và chọn ít nhất 1 dự án trong Workspace trước khi bật Tự gửi.',
        };
      }
      const { projects, grantId, atlassianAccountId } = jira;
      const lowerReq = requestText.toLowerCase();
      const matched = projects.filter(
        (p) =>
          new RegExp(`(?:^|[^a-z0-9_])${p.projectKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9_])`, 'i').test(
            requestText,
          ) || (p.projectName && lowerReq.includes(p.projectName.toLowerCase())),
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
        ...source,
        notionBinding: input.notionBinding,
        label: `Notion · ${input.notionBinding.workspaceName} · ${input.notionBinding.databases.map((d) => d.title).join(', ')}`,
      });
    } else if (service === 'mycalendar') {
      const previous = input.existingMyCalendarSources?.filter(isMyCalendarDigestSource) ?? [];
      const bound = previous.length <= 1
        ? bindMyCalendarDigestSource(source, input.mycalendarLookup, previous[0], input.reauthorizeMyCalendar === true)
        : null;
      if (!bound) {
        return {
          ok: false,
          disabledReason:
            previous.length > 0 ? MYCALENDAR_DIGEST_REAPPROVAL :
              'Hãy kết nối Google Calendar cá nhân và chọn ít nhất 1 lịch trước khi bật tự gửi báo cáo.',
        };
      }
      sources.push(bound);
    } else if (service === 'mysheets') {
      const previous = input.existingMySheetsSources?.filter(isMySheetsDigestSource) ?? [];
      if (previous.length > 1) return { ok: false, disabledReason: MYSHEETS_DIGEST_REAPPROVAL };
      const bound = bindMySheetsDigestSource(source, input.mysheetsLookup, previous[0], input.reauthorizeMySheets === true, requestText);
      if ('disabledReason' in bound) return { ok: false, disabledReason: bound.disabledReason };
      sources.push(bound);
    } else {
      sources.push({ ...source });
    }
  }

  return { ok: true, sources };
}

export interface SlackDigestCredentialRow {
  id: string;
  service?: string;
  user_id: string | null;
  workspace_id: string | null;
  status: string;
  config?: unknown;
}

/**
 * Checks whether a service_credentials row belongs to the schedule's workspace context.
 * Personal mode accepts per-user rows (saved via Settings) as well as legacy shared rows;
 * organization mode requires a workspace-scoped row (user_id IS NULL, workspace_id === workspaceId).
 */
export function matchesSlackDigestCredentialOwner(
  credRow: { service?: string; user_id: string | null; workspace_id: string | null },
  context: {
    userId: string;
    workspaceMode: 'legacy' | 'personal' | 'organization' | string | null | undefined;
    trustedWorkspaceId: string | null;
  },
): boolean {
  if (credRow.service !== undefined && credRow.service !== 'slack') return false;
  const mode = context.workspaceMode ?? 'legacy';
  if (mode === 'organization') {
    return (
      Boolean(context.trustedWorkspaceId) &&
      credRow.user_id === null &&
      credRow.workspace_id === context.trustedWorkspaceId
    );
  }
  if (mode === 'personal') {
    return (
      credRow.workspace_id === null &&
      (credRow.user_id === context.userId || credRow.user_id === null)
    );
  }
  return credRow.user_id === null && credRow.workspace_id === null;
}

/**
 * Finds the active Slack destination credential matching the caller's workspace context.
 * In personal mode, prefers the user's personal credential (`user_id = $userId`) over legacy shared rows.
 */
export async function findSlackDigestCredential(
  pool: Pick<pg.Pool, 'query'>,
  context: {
    userId: string;
    workspaceMode: 'legacy' | 'personal' | 'organization' | string | null | undefined;
    workspaceId?: string | null;
  },
): Promise<SlackDigestCredentialRow | null> {
  const mode = context.workspaceMode ?? 'legacy';
  if (mode === 'organization') {
    if (!context.workspaceId) return null;
    const res = await pool.query<SlackDigestCredentialRow>(
      `SELECT id, service, user_id, workspace_id, status, config
       FROM service_credentials
       WHERE service = 'slack' AND user_id IS NULL AND workspace_id = $1 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [context.workspaceId],
    );
    return res.rows[0] ?? null;
  }
  if (mode === 'personal') {
    const res = await pool.query<SlackDigestCredentialRow>(
      `SELECT id, service, user_id, workspace_id, status, config
       FROM service_credentials
       WHERE service = 'slack' AND workspace_id IS NULL AND (user_id = $1 OR user_id IS NULL) AND status = 'active'
       ORDER BY (user_id IS NOT DISTINCT FROM $1) DESC, created_at DESC LIMIT 1`,
      [context.userId],
    );
    return res.rows[0] ?? null;
  }
  const res = await pool.query<SlackDigestCredentialRow>(
    `SELECT id, service, user_id, workspace_id, status, config
     FROM service_credentials
     WHERE service = 'slack' AND user_id IS NULL AND workspace_id IS NULL AND status = 'active'
     ORDER BY created_at DESC LIMIT 1`,
  );
  return res.rows[0] ?? null;
}
