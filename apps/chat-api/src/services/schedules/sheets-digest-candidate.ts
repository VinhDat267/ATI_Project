import { createHash } from 'node:crypto';
import { decryptCredentials } from '@wap/tool-adapters';
import {
  isSheetsDigestConfigV2,
  type PersonalSpreadsheetItem,
  type ScheduleRecurrence,
  type SheetsDigestCandidate,
  type SheetsDigestConfig,
  type SheetsDigestConfigV1,
} from '@wap/tool-schemas';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';

const WRITE_INTENT_RE =
  /\b(?:thêm\s+dòng|ghi\s+vào|append|chèn\s+dòng|cập\s+nhật\s+bảng|sửa\s+ô|xóa\s+dòng|xoá\s+dòng|đồng\s+bộ\s+vào\s+sheets|ghi\s+thêm)\b/iu;

export function computeSheetsDigestV1Hash(input: {
  userId: string;
  recurrence: ScheduleRecurrence;
  config: SheetsDigestConfigV1 | SheetsDigestConfig;
}): string {
  const rec = input.recurrence;
  const canonicalRecurrence =
    rec.type === 'once'
      ? { type: 'once', date: rec.date, time: rec.time }
      : rec.type === 'daily'
        ? { type: 'daily', time: rec.time }
        : { type: 'weekly', time: rec.time, days: [...rec.days] };

  const canonical = JSON.stringify({
    kind: 'sheets_digest',
    userId: input.userId,
    recurrence: canonicalRecurrence,
    source: {
      service: input.config.source.service,
      credentialId: input.config.source.credentialId ?? null,
      spreadsheetId: input.config.source.spreadsheetId,
      sheetName: input.config.source.sheetName ?? null,
      range: input.config.source.range ?? null,
      tailRows: input.config.source.tailRows,
    },
    destination:
      input.config.destination.service === 'slack'
        ? { service: 'slack', channelId: input.config.destination.channelId }
        : input.config.destination.service === 'telegram'
          ? { service: 'telegram', chatId: input.config.destination.chatId }
          : {
              service: 'gmail',
              recipientEmail: input.config.destination.recipientEmail,
              credentialId: input.config.destination.credentialId ?? null,
            },
    includeAiSummary: input.config.includeAiSummary,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function computeSheetsDigestHash(input: {
  userId: string;
  recurrence: ScheduleRecurrence;
  config: SheetsDigestConfig;
}): string {
  if (!isSheetsDigestConfigV2(input.config)) {
    return computeSheetsDigestV1Hash(input);
  }

  const rec = input.recurrence;
  const canonicalRecurrence =
    rec.type === 'once'
      ? { type: 'once', date: rec.date, time: rec.time }
      : rec.type === 'daily'
        ? { type: 'daily', time: rec.time }
        : { type: 'weekly', time: rec.time, days: [...rec.days] };

  const canonical = JSON.stringify({
    kind: 'sheets_digest',
    version: 2,
    userId: input.userId,
    workspaceMode: input.config.workspaceMode,
    workspaceId: input.config.workspaceId,
    recurrence: canonicalRecurrence,
    source: {
      service: input.config.source.service,
      credentialId: input.config.source.credentialId,
      email: input.config.source.email ?? null,
      spreadsheetId: input.config.source.spreadsheetId,
      sheetName: input.config.source.sheetName ?? null,
      range: input.config.source.range ?? null,
      tailRows: input.config.source.tailRows,
    },
    destination:
      input.config.destination.service === 'slack'
        ? {
            service: 'slack',
            credentialId: input.config.destination.credentialId,
            channelId: input.config.destination.channelId,
          }
        : input.config.destination.service === 'telegram'
          ? {
              service: 'telegram',
              credentialId: input.config.destination.credentialId,
              chatId: input.config.destination.chatId,
            }
          : {
              service: 'gmail',
              credentialId: input.config.destination.credentialId,
              senderEmail: input.config.destination.senderEmail,
              recipientEmail: input.config.destination.recipientEmail,
            },
    includeAiSummary: input.config.includeAiSummary,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export interface AnalyzeSheetsDigestInput {
  userId?: string;
  request: string;
  services: string[];
  credentialRepo?: CredentialRepo;
  encryptionKey?: string;
  mysheetsEnabled?: boolean;
}

export async function analyzeSheetsDigestCandidate(
  input: AnalyzeSheetsDigestInput
): Promise<SheetsDigestCandidate> {
  const { userId, request, services, credentialRepo, encryptionKey, mysheetsEnabled } = input;
  const serviceSet = new Set(services);
  const hasMySheets = serviceSet.has('mysheets');
  const hasSharedSheets = serviceSet.has('sheets');

  if (!hasMySheets && !hasSharedSheets) {
    return {
      canAutoDigest: false,
      reason: 'Lịch không sử dụng nguồn dữ liệu Google Sheets.',
    };
  }

  if (hasMySheets && hasSharedSheets) {
    return {
      canAutoDigest: false,
      reason: 'Chỉ bật được tự gửi báo cáo khi lịch đọc từ một nguồn Google Sheets duy nhất.',
    };
  }

  const destServices = services.filter((s) => s === 'slack' || s === 'telegram' || s === 'gmail');
  const otherServices = services.filter(
    (s) => s !== 'mysheets' && s !== 'sheets' && s !== 'slack' && s !== 'telegram' && s !== 'gmail'
  );

  if (otherServices.length > 0 || destServices.length !== 1) {
    return {
      canAutoDigest: false,
      reason:
        'Chế độ tự gửi báo cáo chỉ áp dụng khi lịch đọc từ một bảng tính Google Sheets và gửi vào đúng một kênh Slack, nhóm Telegram hoặc email Gmail.',
    };
  }

  if (WRITE_INTENT_RE.test(request)) {
    return {
      canAutoDigest: false,
      reason: 'Lịch có thao tác ghi hoặc cập nhật bảng tính nên cần bạn duyệt từng lượt.',
    };
  }

  if (!credentialRepo || !encryptionKey) {
    return {
      canAutoDigest: false,
      reason: 'Chưa đủ thông tin xác thực để khóa nguồn bảng tính và kênh nhận báo cáo.',
    };
  }

  // 1. Resolve source spreadsheet (with smart fallback from unconfigured shared 'sheets' to active personal 'mysheets')
  let sourceConfig: SheetsDigestConfig['source'] | null = null;
  const reqLower = request.toLowerCase();
  let useMySheets = hasMySheets;
  if (!useMySheets && hasSharedSheets && mysheetsEnabled && userId) {
    const sharedRec = await credentialRepo.getCredentials('sheets');
    if (!sharedRec) {
      const personalRec = await credentialRepo.getPersonalCredentials('mysheets', userId);
      if (personalRec && personalRec.status === 'active') {
        useMySheets = true;
      }
    }
  }

  if (useMySheets) {
    if (!mysheetsEnabled || !userId) {
      return {
        canAutoDigest: false,
        reason: 'Google Sheets cá nhân chưa được bật hoặc chưa xác định người dùng.',
      };
    }
    const record = await credentialRepo.getPersonalCredentials('mysheets', userId);
    if (!record || record.status !== 'active') {
      return {
        canAutoDigest: false,
        reason: 'Hãy kết nối Google Sheets cá nhân trước khi bật tự gửi báo cáo.',
      };
    }
    let dec: any;
    try {
      dec = decryptCredentials(record.config, encryptionKey);
    } catch {
      return {
        canAutoDigest: false,
        reason: 'Không đọc được cấu hình Google Sheets cá nhân.',
      };
    }
    const selected: PersonalSpreadsheetItem[] = Array.isArray(dec.selectedSpreadsheets)
      ? dec.selectedSpreadsheets
      : [];
    const allowedIds: string[] = Array.isArray(dec.allowedScope?.spreadsheets)
      ? dec.allowedScope.spreadsheets
      : selected.map((s) => s.id);

    if (allowedIds.length === 0) {
      return {
        canAutoDigest: false,
        reason: 'Bạn chưa chọn bảng tính Google Sheets nào cho Planora.',
      };
    }

    const candidates: PersonalSpreadsheetItem[] =
      selected.length > 0
        ? selected.filter((s) => allowedIds.includes(s.id))
        : allowedIds.map((id) => ({ id, title: id, canEdit: true }));

    let chosen: PersonalSpreadsheetItem | undefined;
    if (candidates.length === 1) {
      chosen = candidates[0];
    } else {
      const matched = candidates.filter(
        (c) =>
          reqLower.includes(c.id.toLowerCase()) ||
          (c.title && reqLower.includes(c.title.toLowerCase()))
      );
      if (matched.length === 1) chosen = matched[0];
    }

    if (!chosen) {
      return {
        canAutoDigest: false,
        reason:
          'Hãy nêu rõ tên bảng tính Google Sheets cần báo cáo trong yêu cầu để khóa nguồn dữ liệu.',
      };
    }

    let sheetName: string | undefined;
    if (Array.isArray(chosen.sheets) && chosen.sheets.length > 0) {
      const matchedTab = chosen.sheets.find((t) => reqLower.includes(t.toLowerCase()));
      if (matchedTab) sheetName = matchedTab;
      else if (chosen.sheets.length === 1) sheetName = chosen.sheets[0];
    }
    if (!sheetName) {
      const tabMatch = /\b(?:tab|sheet)\s+["'“”]?([^"'“”,.\n]+?)["'“”]?(?=\s+(?:từ|trong|của|và|rồi|vào|lên)\b|$)/iu.exec(
        request
      );
      if (tabMatch?.[1]?.trim()) {
        sheetName = tabMatch[1].trim();
      }
    }

    sourceConfig = {
      service: 'mysheets',
      credentialId: record.id,
      email: typeof dec.email === 'string' ? dec.email : undefined,
      spreadsheetId: chosen.id,
      spreadsheetTitle: chosen.title || chosen.id,
      ...(sheetName ? { sheetName } : {}),
      tailRows: 20,
    };
  } else {
    const record = await credentialRepo.getCredentials('sheets');
    if (!record) {
      return {
        canAutoDigest: false,
        reason: 'Dịch vụ Google Sheets chung chưa được cấu hình.',
      };
    }
    let dec: any;
    try {
      dec = decryptCredentials(record.config, encryptionKey);
    } catch {
      return {
        canAutoDigest: false,
        reason: 'Không đọc được cấu hình Google Sheets.',
      };
    }
    const allowedIds: string[] = Array.isArray(dec.allowedScope?.spreadsheets)
      ? dec.allowedScope.spreadsheets
      : Array.isArray(dec.allowedScope)
        ? dec.allowedScope
        : [];
    if (allowedIds.length === 0) {
      return {
        canAutoDigest: false,
        reason: 'Google Sheets chung chưa có bảng tính nào trong phạm vi cho phép.',
      };
    }
    let chosenId: string | undefined;
    if (allowedIds.length === 1) {
      chosenId = allowedIds[0];
    } else {
      const matched = allowedIds.filter((id) => reqLower.includes(id.toLowerCase()));
      if (matched.length === 1) chosenId = matched[0];
    }
    if (!chosenId) {
      return {
        canAutoDigest: false,
        reason: 'Hãy nêu rõ mã bảng tính Google Sheets cần báo cáo.',
      };
    }
    sourceConfig = {
      service: 'sheets',
      spreadsheetId: chosenId,
      spreadsheetTitle: chosenId,
      tailRows: 20,
    };
  }

  // 2. Resolve destination (slack, telegram, or gmail)
  const destService = destServices[0] as 'slack' | 'telegram' | 'gmail';
  let destinationConfig: SheetsDigestConfig['destination'] | null = null;

  if (destService === 'slack') {
    const slackRec = await credentialRepo.getCredentials('slack');
    if (!slackRec) {
      return {
        canAutoDigest: false,
        reason: 'Dịch vụ Slack chưa được cấu hình.',
      };
    }
    let dec: any;
    try {
      dec = decryptCredentials(slackRec.config, encryptionKey);
    } catch {
      return {
        canAutoDigest: false,
        reason: 'Không đọc được cấu hình Slack.',
      };
    }
    const channels: string[] = Array.isArray(dec.allowedScope?.channels)
      ? dec.allowedScope.channels
      : Array.isArray(dec.allowedScope)
        ? dec.allowedScope
        : [];
    if (channels.length === 0) {
      return {
        canAutoDigest: false,
        reason: 'Slack chưa có kênh nào trong phạm vi được phép gửi.',
      };
    }
    let chosenChannel: string | undefined;
    if (channels.length === 1) {
      chosenChannel = channels[0];
    } else {
      const matched = channels.filter((ch) => reqLower.includes(ch.toLowerCase()));
      if (matched.length === 1) chosenChannel = matched[0];
    }
    if (!chosenChannel) {
      return {
        canAutoDigest: false,
        reason: 'Hãy nêu rõ mã kênh Slack nhận báo cáo trong số các kênh đã cấp quyền.',
      };
    }
    destinationConfig = {
      service: 'slack',
      channelId: chosenChannel,
    };
  } else if (destService === 'gmail') {
    if (!userId) {
      return {
        canAutoDigest: false,
        reason: 'Chưa xác định người dùng để gửi báo cáo qua Gmail cá nhân.',
      };
    }
    const gmailRec = await credentialRepo.getPersonalCredentials('gmail', userId);
    if (!gmailRec || gmailRec.status !== 'active') {
      return {
        canAutoDigest: false,
        reason: 'Hãy kết nối Gmail cá nhân trước khi bật tự gửi báo cáo qua email.',
      };
    }
    let dec: any = {};
    try {
      dec = decryptCredentials(gmailRec.config, encryptionKey);
    } catch {
      return {
        canAutoDigest: false,
        reason: 'Không đọc được cấu hình Gmail cá nhân.',
      };
    }
    const emailMatches = [
      ...new Set(
        (request.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? []).map((e) =>
          e.trim().toLowerCase()
        )
      ),
    ];
    let recipientEmail: string | undefined;
    if (emailMatches.length === 1) {
      recipientEmail = emailMatches[0];
    } else if (
      emailMatches.length === 0 &&
      typeof dec.email === 'string' &&
      dec.email.includes('@') &&
      /\b(?:cho\s+tôi|cho\s+mình|email\s+của\s+tôi|gmail\s+của\s+tôi)\b/iu.test(request)
    ) {
      recipientEmail = dec.email.trim().toLowerCase();
    }
    if (!recipientEmail) {
      return {
        canAutoDigest: false,
        reason: 'Hãy nêu rõ một địa chỉ email nhận báo cáo trong yêu cầu để khóa người nhận.',
      };
    }
    destinationConfig = {
      service: 'gmail',
      recipientEmail,
      credentialId: gmailRec.id,
    };
  } else {
    const tgRec =
      (userId ? await credentialRepo.getPersonalCredentials('telegram', userId) : null) ??
      (await credentialRepo.getCredentials('telegram'));
    if (!tgRec) {
      return {
        canAutoDigest: false,
        reason: 'Dịch vụ Telegram chưa được cấu hình.',
      };
    }
    let dec: any;
    try {
      dec = decryptCredentials(tgRec.config, encryptionKey);
    } catch {
      return {
        canAutoDigest: false,
        reason: 'Không đọc được cấu hình Telegram.',
      };
    }
    const scopeChats: string[] = Array.isArray(dec.allowedScope?.chats)
      ? dec.allowedScope.chats
      : Array.isArray(dec.allowedScope)
        ? dec.allowedScope
        : [];
    const selectedChatItems: Array<{ chatId: string; title?: string }> = Array.isArray(dec.selectedChats)
      ? dec.selectedChats
          .filter((c: any) => typeof c?.chatId === 'string' && c.chatId.trim())
          .map((c: any) => ({
            chatId: String(c.chatId).trim(),
            ...(typeof c?.title === 'string' && c.title.trim() ? { title: c.title.trim() } : {}),
          }))
      : [];
    const chatMap = new Map<string, { chatId: string; title?: string }>();
    for (const item of selectedChatItems) {
      chatMap.set(item.chatId, item);
    }
    for (const id of scopeChats) {
      if (typeof id === 'string' && id.trim() && !chatMap.has(id.trim())) {
        chatMap.set(id.trim(), { chatId: id.trim() });
      }
    }
    const chats = Array.from(chatMap.values());
    if (chats.length === 0) {
      return {
        canAutoDigest: false,
        reason: 'Telegram chưa có nhóm/chat nào trong phạm vi được phép gửi.',
      };
    }
    let chosenChat: { chatId: string; title?: string } | undefined;
    if (chats.length === 1) {
      chosenChat = chats[0];
    } else {
      const matched = chats.filter(
        (c) =>
          reqLower.includes(c.chatId.toLowerCase()) ||
          (c.title && reqLower.includes(c.title.toLowerCase()))
      );
      if (matched.length === 1) chosenChat = matched[0];
    }
    if (!chosenChat) {
      return {
        canAutoDigest: false,
        reason: 'Hãy nêu rõ nhóm Telegram nhận báo cáo trong số các nhóm đã cấp quyền.',
      };
    }
    destinationConfig = {
      service: 'telegram',
      chatId: chosenChat.chatId,
      ...(chosenChat.title ? { chatLabel: chosenChat.title } : {}),
    };
  }

  return {
    canAutoDigest: true,
    config: {
      version: 1,
      source: sourceConfig,
      destination: destinationConfig,
      includeAiSummary: true,
    },
  };
}
