import { createHash } from 'node:crypto';
import type { NotionDigestConfig, NotionDigestCandidate, ScheduleRecurrence } from '@wap/tool-schemas';
import {
  canonicalNotionDigestBinding, isNotionDigestSourceBinding, NOTION_DIGEST_REAPPROVAL, type NotionDigestSourceAuthority,
} from '../notion/digest-source-authority.js';
import { canonicalizeRecurrence } from './github-digest-candidate.js';

export function canonicalizeNotionDigestConfig(config: NotionDigestConfig): NotionDigestConfig {
  return {
    ...(config.notionBinding !== undefined ? { notionBinding: canonicalNotionDigestBinding(config.notionBinding) } : {}),
    credentialId: config.credentialId,
    workspaceId: config.workspaceId,
    workspaceName: config.workspaceName,
    botId: config.botId,
    identityVersion: config.identityVersion,
    databases: [...config.databases]
      .map((d) => ({
        id: String(d.id).toLowerCase(),
        title: String(d.title),
        ...(d.url ? { url: String(d.url) } : {}),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    channelId: config.channelId,
    channelName: config.channelName,
    ...(config.telegramChatId ? { telegramChatId: config.telegramChatId } : {}),
    ...(config.telegramChatTitle ? { telegramChatTitle: config.telegramChatTitle } : {}),
    ...(typeof config.includeAiSummary === 'boolean' ? { includeAiSummary: config.includeAiSummary } : {}),
  };
}

export function computeNotionDigestConfigHash(input: {
  config: NotionDigestConfig;
  recurrence: ScheduleRecurrence;
  userId: string;
}): string {
  const payload = {
    kind: 'notion_digest' as const,
    userId: input.userId,
    recurrence: canonicalizeRecurrence(input.recurrence),
    config: canonicalizeNotionDigestConfig(input.config),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function approvedSlackNotionBinding(config: NotionDigestConfig) {
  const binding = config.notionBinding;
  if (config.telegramChatId || !isNotionDigestSourceBinding(binding) ||
      !Array.isArray(config.databases) || config.databases.length !== binding.databases.length ||
      !binding.databases.every(({ databaseId }) => config.databases.some((db) => db?.id === databaseId)) ||
      config.credentialId !== binding.credentialId || config.identityVersion !== binding.identityVersion ||
      config.workspaceId !== binding.workspaceId || config.botId !== binding.botId) return;
  return binding;
}

const WRITE_INTENT_REGEX =
  /(?:^|\s)(tạo\s+trang|tạo\s+page|thêm\s+trang|thêm\s+page|thêm\s+nội\s+dung|sửa\s+trang|cập\s+nhật\s+trang|ghi\s+vào\s+notion|create\s+page|append\s+block|update\s+page)(?=$|\s|[.,;!?])/i;

export interface EvaluateNotionDigestInput {
  userId: string;
  request?: string;
  proposal?: { request: string; recurrence: ScheduleRecurrence; [key: string]: any };
  services: string[];
  recurrence?: ScheduleRecurrence;
  workspaceMode?: 'legacy' | 'personal' | 'organization';
  notionSources?: Pick<NotionDigestSourceAuthority, 'prepare'>;
  getAdapter?: (serviceName: string, context?: any) => Promise<any> | any;
}

export async function evaluateNotionDigestCandidate(
  input: EvaluateNotionDigestInput
): Promise<NotionDigestCandidate> {
  const { userId, services } = input;
  const request = input.request ?? input.proposal?.request ?? '';
  const recurrence = (input.recurrence ?? input.proposal?.recurrence)!;
  const serviceSet = new Set(services);
  if (serviceSet.size !== 2 || !serviceSet.has('notion') || !serviceSet.has('slack') ||
      input.workspaceMode === 'organization') {
    return { canAutoDigest: false, disabledReason: NOTION_DIGEST_REAPPROVAL };
  }

  if (WRITE_INTENT_REGEX.test(request)) {
    return {
      canAutoDigest: false,
      disabledReason:
        'Chỉ bật được khi lịch chỉ đọc Notion và gửi báo cáo vào kênh nhận đã chọn (không tự động tạo hoặc sửa dữ liệu).',
    };
  }

  const binding = await input.notionSources?.prepare(userId, request, AbortSignal.timeout(10_000)).catch(() => undefined);
  if (!binding) return { canAutoDigest: false, disabledReason: NOTION_DIGEST_REAPPROVAL };

  // Slack destination
  const hashMatch =
    request.match(/#([a-z0-9._-]+)/i) ?? request.match(/(?:kênh|slack)\s+#?([a-z0-9._-]+)/i);
  const channelQuery = hashMatch?.[1]?.trim() ?? '';

  let matchedChannel: { id: string; name: string } | null = null;
  try {
    const slackAdapter = await input.getAdapter?.('slack', {
      userId,
      workspaceMode: 'personal',
      workspaceId: null,
      phase: 'planning',
    });
    if (slackAdapter && typeof slackAdapter.execute === 'function') {
      const channels = await slackAdapter.execute('slack.search_channels', { query: channelQuery });
      if (Array.isArray(channels) && channels.length > 0) {
        if (channelQuery) {
          const exact = channels.find(
            (c: any) =>
              String(c.name ?? '').replace(/^#/, '').toLowerCase() === channelQuery.toLowerCase() ||
              String(c.id ?? '') === channelQuery
          );
          matchedChannel = exact
            ? { id: String(exact.id), name: String(exact.name).replace(/^#/, '') }
            : channels.length === 1
              ? { id: String(channels[0].id), name: String(channels[0].name).replace(/^#/, '') }
              : null;
        } else if (channels.length === 1) {
          matchedChannel = { id: String(channels[0].id), name: String(channels[0].name).replace(/^#/, '') };
        }
      }
    }
  } catch {
    matchedChannel = null;
  }

  if (!matchedChannel) {
    return {
      canAutoDigest: false,
      disabledReason: 'Cần chỉ rõ 1 kênh Slack hợp lệ thuộc phạm vi được phép nhận bản tin.',
    };
  }

  const config = canonicalizeNotionDigestConfig({
    notionBinding: binding,
    credentialId: binding.credentialId,
    workspaceId: binding.workspaceId,
    workspaceName: binding.workspaceName,
    botId: binding.botId,
    identityVersion: binding.identityVersion,
    databases: binding.databases.map(({ databaseId, title }) => ({ id: databaseId, title })),
    channelId: matchedChannel.id,
    channelName: matchedChannel.name,
  });

  const configHash = computeNotionDigestConfigHash({
    config,
    recurrence,
    userId,
  });

  return {
    canAutoDigest: true,
    config,
    configHash,
  };
}
