import { createHash } from 'node:crypto';
import type {
  GmailDigestBinding,
  NotionDigestSourceBinding,
  ScheduleResponse,
  TelegramDigestCandidate,
  TelegramDigestConfig,
} from '@wap/tool-schemas';
import type { TelegramConnectionLookupResult } from '../telegram/connection-reference.js';
import type { GitHubConnectionLookupResult } from '../github/connection-reference.js';
import type { JiraConnectionLookupResult } from './jira-digest-candidate.js';
import type { MyCalendarDigestConnection } from './mycalendar-digest-source.js';
import { isNotionDigestSourceBinding, NOTION_DIGEST_REAPPROVAL } from '../notion/digest-source-authority.js';
import { validateTelegramDigestGmailConfig } from './gmail-digest-binding.js';
import {
  READ_DIGEST_SOURCE_MAP,
  getDigestSourceDisabledReason,
  isJiraDigestSourceBinding,
  foldVietnamese,
  canonicalizeDigestValue,
  buildTelegramDigestSourceArgs,
  resolveGmailDigestQueryAndLabel,
  validateMultiDigestSourcePreconditions,
  buildMultiDigestSources,
  telegramNotionSource,
  type GmailDigestQuery,
} from './multi-source-digest-candidate.js';
import type { TelegramDigestSource } from '@wap/tool-schemas';

export {
  READ_DIGEST_SOURCE_MAP,
  getDigestSourceDisabledReason,
  isJiraDigestSourceBinding,
  buildTelegramDigestSourceArgs,
  resolveGmailDigestQueryAndLabel,
  telegramNotionSource,
};
export type { TelegramConnectionLookupResult };

export function approvedTelegramNotionBinding(config: TelegramDigestConfig): NotionDigestSourceBinding | undefined {
  const source = telegramNotionSource(config);
  if (config.sources.length === 1 && source?.tool === 'notion.query_database' &&
      source.args === undefined && isNotionDigestSourceBinding(source.notionBinding)) {
    return source.notionBinding;
  }
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
      ...(s.mycalendarBinding !== undefined ? { mycalendarBinding: s.mycalendarBinding } : {}),
    })),
    recurrence: config.recurrence,
    timeZone: config.timeZone,
  };
  return createHash('sha256').update(JSON.stringify(canonicalizeDigestValue(canonical))).digest('hex');
}

export interface EvaluateTelegramDigestInput {
  proposal: ScheduleResponse;
  services: string[];
  timeZone: string;
  telegramLookup?: TelegramConnectionLookupResult | null;
  githubLookup?: Pick<GitHubConnectionLookupResult, 'status' | 'connection'> | null;
  jiraLookup?: JiraConnectionLookupResult | null;
  mycalendarLookup?: MyCalendarDigestConnection | null;
  reauthorizeMyCalendar?: boolean;
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

  const requestText = proposal.request ?? '';
  const foldedRequest = foldVietnamese(requestText);
  const precheck = validateMultiDigestSourcePreconditions({
    sourceServices: nonTelegramServices,
    destinationLabel: 'Telegram',
    requestText,
    notionBinding: input.notionBinding,
  });
  if (!precheck.ok) {
    return {
      canAutoDigest: false,
      disabledReason: precheck.disabledReason,
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

  const sourceResult = buildMultiDigestSources({
    sourceServices: nonTelegramServices,
    destinationLabel: 'Telegram',
    requestText,
    githubLookup: input.githubLookup,
    jiraLookup: input.jiraLookup,
    mycalendarLookup: input.mycalendarLookup,
    existingMyCalendarSources: Array.isArray(existingDigest?.sources) ? existingDigest.sources : undefined,
    reauthorizeMyCalendar: input.reauthorizeMyCalendar,
    workspaceMode: input.workspaceMode,
    workspaceId: input.workspaceId,
    gmailBinding: input.gmailBinding,
    gmailUserTexts: input.gmailUserTexts,
    reauthorizeGmailQuery: input.reauthorizeGmailQuery,
    notionBinding: input.notionBinding,
  });
  if (!sourceResult.ok) {
    return {
      canAutoDigest: false,
      disabledReason: sourceResult.disabledReason,
    };
  }
  const sources = sourceResult.sources;

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
