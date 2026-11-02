import { createHash } from 'node:crypto';
import type { GithubDigestConfig, ScheduleDigestCandidate, ScheduleRecurrence } from '@wap/tool-schemas';

export function canonicalizeDigestConfig(config: GithubDigestConfig): GithubDigestConfig {
  return {
    credentialId: config.credentialId,
    githubUserId: config.githubUserId,
    login: config.login,
    repos: [...config.repos].sort(),
    channelId: config.channelId,
    channelName: config.channelName,
    staleDays: config.staleDays,
  };
}

export function canonicalizeRecurrence(recurrence: ScheduleRecurrence): ScheduleRecurrence {
  if (recurrence.type === 'once') {
    return { type: 'once', date: recurrence.date, time: recurrence.time };
  }
  if (recurrence.type === 'daily') {
    return { type: 'daily', time: recurrence.time };
  }
  return {
    type: 'weekly',
    time: recurrence.time,
    days: [...recurrence.days].sort((a, b) => a - b),
  };
}

export function computeDigestConfigHash(input: {
  config: GithubDigestConfig;
  recurrence: ScheduleRecurrence;
  userId: string;
}): string {
  const payload = {
    kind: 'github_digest' as const,
    userId: input.userId,
    recurrence: canonicalizeRecurrence(input.recurrence),
    config: canonicalizeDigestConfig(input.config),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

const WRITE_INTENT_REGEX =
  /\b(tạo\s+issue|mở\s+issue|đóng\s+issue|sửa\s+issue|cập\s+nhật\s+issue|gắn\s+nhãn|thêm\s+nhãn|add\s+label|create\s+issue|close\s+issue|update\s+issue|tạo\s+thẻ|create\s+card)\b/i;

export interface EvaluateGithubDigestInput {
  userId: string;
  request: string;
  services: string[];
  recurrence: ScheduleRecurrence;
  githubConnection?: (userId: string) => Promise<any>;
  getAdapter?: (serviceName: string, context?: any) => Promise<any> | any;
}

export async function evaluateGithubDigestCandidate(
  input: EvaluateGithubDigestInput,
): Promise<ScheduleDigestCandidate> {
  const { userId, request, services, recurrence } = input;
  const serviceSet = new Set(services);

  if (serviceSet.size !== 2 || !serviceSet.has('github') || !serviceSet.has('slack')) {
    return {
      canAutoDigest: false,
      disabledReason:
        'Chỉ bật được khi lịch chỉ đọc GitHub và gửi báo cáo vào 1 kênh Slack đã chọn.',
    };
  }

  if (WRITE_INTENT_REGEX.test(request)) {
    return {
      canAutoDigest: false,
      disabledReason:
        'Chỉ bật được khi lịch chỉ đọc GitHub và gửi báo cáo vào 1 kênh Slack đã chọn (không tự động tạo hoặc sửa dữ liệu).',
    };
  }

  let gh: any;
  try {
    gh = await input.githubConnection?.(userId);
  } catch {
    gh = null;
  }

  if (
    !gh ||
    gh.status !== 'connected' ||
    !gh.connection ||
    !Array.isArray(gh.connection.repos) ||
    gh.connection.repos.length === 0
  ) {
    return {
      canAutoDigest: false,
      disabledReason:
        'Cần kết nối GitHub cá nhân và có quyền truy cập ít nhất 1 repository của nhóm.',
    };
  }

  const lowerReq = request.toLowerCase();
  const memberItems: Array<{ fullName: string; name: string }> = Array.isArray(gh.memberRepos) && gh.memberRepos.length > 0
    ? gh.memberRepos
    : (gh.connection.repos as string[]).map((fullName: string) => ({
        fullName,
        name: fullName.split('/')[1] ?? fullName,
      }));

  const matchedRepos = new Set<string>();
  const nameCounts = new Map<string, number>();
  for (const item of memberItems) {
    const n = item.name.toLowerCase();
    nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
    if (lowerReq.includes(item.fullName.toLowerCase())) {
      matchedRepos.add(item.fullName);
    }
  }
  for (const item of memberItems) {
    if (matchedRepos.has(item.fullName)) continue;
    const nameLower = item.name.toLowerCase();
    if ((nameCounts.get(nameLower) ?? 0) > 1) continue;
    const escapedName = nameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:^|[^a-z0-9_./-])${escapedName}(?:$|[^a-z0-9_./-])`, 'i').test(request)) {
      matchedRepos.add(item.fullName);
    }
  }

  if (matchedRepos.size === 0 && gh.connection.repos.length === 1) {
    matchedRepos.add(gh.connection.repos[0]);
  }

  if (matchedRepos.size === 0 || matchedRepos.size > 5) {
    return {
      canAutoDigest: false,
      disabledReason:
        'Cần chỉ rõ từ 1 đến 5 repository GitHub thuộc phạm vi nhóm trong yêu cầu đặt lịch.',
    };
  }

  // Extract Slack channel from request
  const hashMatch = request.match(/#([a-z0-9._-]+)/i) ?? request.match(/(?:kênh|slack)\s+#?([a-z0-9._-]+)/i);
  const channelQuery = hashMatch?.[1]?.trim() ?? '';

  let matchedChannel: { id: string; name: string } | null = null;
  try {
    const slackAdapter = await input.getAdapter?.('slack', { userId, phase: 'planning' });
    if (slackAdapter && typeof slackAdapter.execute === 'function') {
      const channels = await slackAdapter.execute('slack.search_channels', { query: channelQuery });
      if (Array.isArray(channels) && channels.length > 0) {
        if (channelQuery) {
          const exact = channels.find(
            (c: any) =>
              String(c.name ?? '').replace(/^#/, '').toLowerCase() === channelQuery.toLowerCase() ||
              String(c.id ?? '') === channelQuery,
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
      disabledReason:
        'Cần chỉ rõ 1 kênh Slack hợp lệ thuộc phạm vi được phép nhận bản tin.',
    };
  }

  const staleMatch = request.match(/(?:quá|trên|hơn)\s*(\d{1,2})\s*ngày/i);
  const parsedStale = staleMatch ? Number.parseInt(staleMatch[1]!, 10) : 2;
  const staleDays = Number.isInteger(parsedStale) ? Math.min(14, Math.max(1, parsedStale)) : 2;

  const config = canonicalizeDigestConfig({
    credentialId: gh.connection.credentialId,
    githubUserId: gh.connection.githubUserId,
    login: gh.connection.login,
    repos: [...matchedRepos],
    channelId: matchedChannel.id,
    channelName: matchedChannel.name,
    staleDays,
  });

  const configHash = computeDigestConfigHash({
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
