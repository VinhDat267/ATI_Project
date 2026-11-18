import { createHash } from 'node:crypto';
import type pg from 'pg';
import type {
  GmailDigestBinding,
  NotionDigestSourceBinding,
  ScheduleResponse,
  SlackDigestCandidate,
  SlackDigestConfig,
} from '@wap/tool-schemas';
import type { GitHubConnectionLookupResult } from '../github/connection-reference.js';
import type { JiraConnectionLookupResult } from './jira-digest-candidate.js';
import type { MyCalendarDigestConnection } from './mycalendar-digest-source.js';
import type { MySheetsDigestConnection } from './mysheets-digest-source.js';
import { validateTelegramDigestGmailConfig } from './gmail-digest-binding.js';
import { extractSlackDigestChannelHint } from './slack-digest-channel.js';
import {
  buildMultiDigestSources,
  canonicalizeDigestValue,
  findSlackDigestCredential,
  foldVietnamese,
  validateMultiDigestSourcePreconditions,
  type GmailDigestQuery,
} from './multi-source-digest-candidate.js';

import { bindOrgSheetsDigestSource } from './org-sheets-digest-source.js';

export function computeSlackDigestConfigHash(config: SlackDigestConfig): string {
  const gmailValidation = validateTelegramDigestGmailConfig(config);
  if (gmailValidation.kind === 'invalid') {
    throw new Error(gmailValidation.reason);
  }
  const canonical: SlackDigestConfig = {
    destination: 'slack',
    workspaceMode: config.workspaceMode,
    workspaceId: config.workspaceId ?? null,
    slackCredentialId: config.slackCredentialId,
    channelId: config.channelId,
    channelName: config.channelName,
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
      ...(s.mysheetsBinding !== undefined ? { mysheetsBinding: s.mysheetsBinding } : {}),
    })),
    recurrence: config.recurrence,
    timeZone: config.timeZone,
  };
  return createHash('sha256').update(JSON.stringify(canonicalizeDigestValue(canonical))).digest('hex');
}

export interface EvaluateSlackDigestInput {
  proposal: ScheduleResponse;
  services: string[];
  timeZone: string;
  userId: string;
  pool?: pg.Pool | Pick<pg.Pool, 'query'> | null;
  slackCredentialId?: string;
  getAdapter?: (serviceName: string, context?: any) => Promise<any> | any;
  githubLookup?: Pick<GitHubConnectionLookupResult, 'status' | 'connection'> | null;
  jiraLookup?: JiraConnectionLookupResult | null;
  mycalendarLookup?: MyCalendarDigestConnection | null;
  reauthorizeMyCalendar?: boolean;
  mysheetsLookup?: MySheetsDigestConnection | null;
  reauthorizeMySheets?: boolean;
  workspaceMode?: 'legacy' | 'personal' | 'organization';
  workspaceId?: string | null;
  gmailBinding?: GmailDigestBinding | null;
  existingDigest?: SlackDigestConfig | null;
  gmailUserTexts?: readonly string[];
  sheetsRequestText?: string;
  reauthorizeOrgSheets?: boolean;
  reauthorizeGmailQuery?: GmailDigestQuery;
  notionBinding?: NotionDigestSourceBinding;
  includeAiSummary?: boolean;
}

export async function evaluateSlackDigestCandidate(
  input: EvaluateSlackDigestInput,
): Promise<SlackDigestCandidate> {
  const { proposal, services, timeZone, userId, existingDigest } = input;

  if (proposal.action !== 'create' && proposal.action !== 'update') {
    return { canAutoDigest: false };
  }

  if (!services.includes('slack') || services.includes('telegram')) {
    return { canAutoDigest: false };
  }

  const workspaceMode = input.workspaceMode ?? 'personal';
  const workspaceId = workspaceMode === 'organization' ? (input.workspaceId ?? null) : null;
  if (workspaceMode === 'organization' && (!workspaceId || !String(workspaceId).trim())) {
    return {
      canAutoDigest: false,
      disabledReason: 'Không gian làm việc Tổ chức không hợp lệ để lập lịch bản tin Slack.',
    };
  }

  const requestText = proposal.request ?? '';
  const sourceServices = services.filter((s) => s !== 'slack');
  const precheck = validateMultiDigestSourcePreconditions({
    sourceServices,
    destinationLabel: 'Slack',
    requestText,
    notionBinding: input.notionBinding,
    workspaceMode,
    workspaceId,
  });
  if (!precheck.ok) {
    return {
      canAutoDigest: false,
      disabledReason: precheck.disabledReason,
    };
  }

  // Verify workspace-scoped active Slack credential
  let slackCredentialId = input.slackCredentialId?.trim() || '';
  if (input.pool) {
    const cred = await findSlackDigestCredential(input.pool, {
      userId,
      workspaceMode,
      workspaceId,
    });
    slackCredentialId = cred?.id ?? '';
  }

  if (!slackCredentialId) {
    return {
      canAutoDigest: false,
      disabledReason: 'Hãy kết nối Slack và chọn kênh được phép nhận báo cáo trước khi bật Tự gửi.',
    };
  }

  // Resolve target Slack channel from explicit request, existing digest, or single allowed channel
  const rawChannelHint = extractSlackDigestChannelHint(requestText);
  const channelHint =
    rawChannelHint && !['slack', 'nay', 'này', 'moi', 'mới', 'do', 'đó'].includes(foldVietnamese(rawChannelHint))
      ? rawChannelHint
      : '';

  let matchedChannel: { id: string; name: string } | null = null;
  try {
    const slackAdapter = await input.getAdapter?.('slack', {
      userId,
      phase: 'planning' as const,
      workspaceMode,
      workspaceId,
    });
    if (slackAdapter && typeof slackAdapter.execute === 'function') {
      const channels = await slackAdapter.execute('slack.search_channels', { query: channelHint, limit: 200 });
      if (Array.isArray(channels) && channels.length > 0) {
        if (channelHint) {
          const hintLower = channelHint.toLowerCase();
          const exact = channels.find(
            (c: any) =>
              String(c.name ?? '').replace(/^#/, '').toLowerCase() === hintLower ||
              String(c.id ?? '').toLowerCase() === hintLower,
          );
          matchedChannel = exact
            ? { id: String(exact.id), name: String(exact.name).replace(/^#/, '') }
            : channels.length === 1
              ? { id: String(channels[0].id), name: String(channels[0].name).replace(/^#/, '') }
              : null;
        } else if (existingDigest) {
          const existingMatch = channels.find((c: any) => String(c.id) === existingDigest.channelId);
          if (existingMatch) {
            matchedChannel = {
              id: String(existingMatch.id),
              name: String(existingMatch.name).replace(/^#/, ''),
            };
          }
        } else if (channels.length === 1) {
          matchedChannel = {
            id: String(channels[0].id),
            name: String(channels[0].name).replace(/^#/, ''),
          };
        }
      }
    }
  } catch {
    matchedChannel = null;
  }

  if (!matchedChannel) {
    return {
      canAutoDigest: false,
      disabledReason:
        'Hãy nêu rõ tên kênh Slack (ví dụ #general) và chọn kênh được phép trong Kết nối dịch vụ để bật Tự gửi.',
    };
  }

  const sourceResult = buildMultiDigestSources({
    sourceServices,
    destinationLabel: 'Slack',
    requestText,
    githubLookup: input.githubLookup,
    jiraLookup: input.jiraLookup,
    mycalendarLookup: input.mycalendarLookup,
    existingMyCalendarSources: Array.isArray(existingDigest?.sources) ? existingDigest.sources : undefined,
    reauthorizeMyCalendar: input.reauthorizeMyCalendar,
    mysheetsLookup: input.mysheetsLookup,
    existingMySheetsSources: Array.isArray(existingDigest?.sources) ? existingDigest.sources : undefined,
    reauthorizeMySheets: input.reauthorizeMySheets,
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
  const orgSheetsIndex = sources.findIndex((source) => source.service === 'sheets');
  if (orgSheetsIndex !== -1) {
    const bound = await bindOrgSheetsDigestSource(
      sources[orgSheetsIndex]!,
      input.sheetsRequestText?.trim() || requestText,
      existingDigest?.sources?.find((source) => source.service === 'sheets'),
      { userId, workspaceMode, workspaceId },
      input.getAdapter,
      input.reauthorizeOrgSheets,
    );
    if ('disabledReason' in bound) return { canAutoDigest: false, disabledReason: bound.disabledReason };
    sources[orgSheetsIndex] = bound;
  }

  const hasGmailSource = sources.some((s) => s.service === 'gmail');
  const resolvedIncludeAiSummary =
    typeof input.includeAiSummary === 'boolean'
      ? input.includeAiSummary
      : typeof existingDigest?.includeAiSummary === 'boolean'
        ? existingDigest.includeAiSummary
        : undefined;

  const config: SlackDigestConfig = {
    destination: 'slack',
    workspaceMode,
    workspaceId,
    slackCredentialId,
    channelId: matchedChannel.id,
    channelName: matchedChannel.name,
    ...(hasGmailSource ? { sourceBindingVersion: 1 as const } : {}),
    ...(typeof resolvedIncludeAiSummary === 'boolean' ? { includeAiSummary: resolvedIncludeAiSummary } : {}),
    sources,
    recurrence: proposal.recurrence!,
    timeZone,
  };

  return {
    canAutoDigest: true,
    config,
    configHash: computeSlackDigestConfigHash(config),
  };
}
