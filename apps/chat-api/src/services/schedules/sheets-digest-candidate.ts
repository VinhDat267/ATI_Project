import { createHash } from 'node:crypto';
import type pg from 'pg';
import { decryptCredentials } from '@wap/tool-adapters';
import {
  isSheetsDigestConfigV2,
  type PersonalSpreadsheetItem,
  type ScheduleRecurrence,
  type SheetsDigestCandidate,
  type SheetsDigestConfig,
  type SheetsDigestConfigV1,
  type SheetsDigestConfigV2,
  type SheetsDigestDestinationConfigV2,
  type SheetsDigestPreviewInfo,
  type SheetsDigestSourceConfigV2,
  type SheetsDigestWorkspaceMode,
} from '@wap/tool-schemas';
import { isSheetsDigestEmitV2Enabled } from '../../config/schedules-runtime.js';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';
import { isUuid } from '../../db/repositories/uuid.js';

const WRITE_INTENT_RE =
  /\b(?:thêm\s+dòng|ghi\s+vào|append|chèn\s+dòng|cập\s+nhật\s+bảng|sửa\s+ô|xóa\s+dòng|xoá\s+dòng|đồng\s+bộ\s+vào\s+sheets|ghi\s+thêm)\b/iu;

const EXPLICIT_PERSONAL_SOURCE_RE =
  /\b(?:mysheets|google\s+sheets\s+cá\s+nhân|bảng\s+tính\s+cá\s+nhân|sheets\s+cá\s+nhân|của\s+riêng\s+tôi)\b/iu;

const EXPLICIT_ORG_SOURCE_RE =
  /\b(?:google\s+sheets\s+tổ\s+chức|bảng\s+tính\s+tổ\s+chức|sheets\s+tổ\s+chức|google\s+sheets\s+chung|bảng\s+tính\s+chung)\b/iu;

const SPREADSHEET_ID_TOKEN_RE = /\b[A-Za-z0-9_-]{25,}\b/g;

export interface OrgSpreadsheetMetadataItem {
  id: string;
  title: string;
  sheets?: string[];
}

export type FetchOrgSheetsMetadataFn = (input: {
  credentialId: string;
  allowedSpreadsheetIds: string[];
  workspaceId: string | null;
  signal?: AbortSignal;
}) => Promise<OrgSpreadsheetMetadataItem[]>;

export function resolveTrustedScheduleScope(row: {
  workspace_mode?: string | null;
  workspace_id?: string | null;
}): { workspaceMode: SheetsDigestWorkspaceMode; workspaceId: string | null } {
  if (row.workspace_mode === 'organization') {
    return { workspaceMode: 'organization', workspaceId: row.workspace_id ?? null };
  }
  if (row.workspace_mode === 'personal') {
    return { workspaceMode: 'personal', workspaceId: row.workspace_id ?? null };
  }
  return { workspaceMode: 'legacy', workspaceId: row.workspace_id ?? null };
}

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

export function sheetsDigestCandidateMatches(
  a: SheetsDigestCandidate | undefined | null,
  b: SheetsDigestCandidate | undefined | null
): boolean {
  if (!a?.canAutoDigest || !b?.canAutoDigest || !a.config || !b.config) {
    return false;
  }
  if (a.configHash && b.configHash) {
    return a.configHash === b.configHash;
  }
  return JSON.stringify(a.config) === JSON.stringify(b.config);
}

function extractSheetTabFromPrompt(
  request: string,
  reqLower: string,
  availableSheets?: string[]
): string | undefined {
  const sheetBangRangeMatch =
    /(?:['"“”]([^'"“”!\n]+)['"“”]|(\b[A-Za-z0-9_\u00C0-\u024F\u1E00-\u1EFF-]+))!\$?[A-Za-z]{1,3}\$?\d+\s*:\s*\$?[A-Za-z]{1,3}\$?\d+/u.exec(
      request
    );
  const bangTabCandidate = (sheetBangRangeMatch?.[1] ?? sheetBangRangeMatch?.[2])?.trim();

  const tabMatch =
    /\b(?:tab|sheet)\s+["'“”]?([^"'“”,.!\n]+?)["'“”]?(?=\s+(?:vùng|miền|ô|range|từ|trong|của|và|rồi|vào|lên|\$?[A-Za-z]{1,3}\$?\d+\s*:)\b|$)/iu.exec(
      request
    );
  const explicitKeywordTabCandidate = tabMatch?.[1]?.trim();
  const explicitTabCandidate = bangTabCandidate ?? explicitKeywordTabCandidate;

  if (explicitTabCandidate) {
    if (Array.isArray(availableSheets) && availableSheets.length > 0) {
      const matchedExplicit = availableSheets.find(
        (t) => t.toLowerCase() === explicitTabCandidate.toLowerCase()
      );
      if (matchedExplicit) return matchedExplicit;
    }
    return explicitTabCandidate;
  }

  if (Array.isArray(availableSheets) && availableSheets.length > 0) {
    const matchedTab = availableSheets.find((t) => reqLower.includes(t.toLowerCase()));
    if (matchedTab) return matchedTab;
    if (availableSheets.length === 1) return availableSheets[0];
  }
  return undefined;
}

function colLettersToIndex(letters: string): number {
  let idx = 0;
  for (const ch of letters.toUpperCase()) {
    idx = idx * 26 + (ch.charCodeAt(0) - 64);
  }
  return idx;
}

export function validateAndCanonicalizeDigestRange(
  rawRange: string
): { ok: true; canonicalRange: string; sheetFromRange?: string } | { ok: false; reason: string } {
  const trimmed = rawRange.trim();
  if (!trimmed || trimmed.length > 200 || /[\[\]\/\\?#\u0000-\u001f]/.test(trimmed)) {
    return {
      ok: false,
      reason: 'Vùng ô (A1 range) không hợp lệ. Vui lòng chỉ định vùng hợp lệ như A1:F50 (tối đa 500 dòng dữ liệu và 26 cột A..Z).',
    };
  }
  let sheetFromRange: string | undefined;
  let spec = trimmed;
  const bangIdx = trimmed.indexOf('!');
  if (bangIdx !== -1) {
    const rawSheet = trimmed.slice(0, bangIdx).trim().replace(/^['"“”]+|['"“”]+$/g, '').replace(/''/g, "'");
    spec = trimmed.slice(bangIdx + 1).trim();
    if (!rawSheet || spec.includes('!')) {
      return {
        ok: false,
        reason: 'Cú pháp vùng ô kèm tên tab không hợp lệ. Vui lòng dùng dạng Tasks!A1:B20.',
      };
    }
    sheetFromRange = rawSheet;
  }

  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)\s*:\s*\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(spec);
  if (!m) {
    return {
      ok: false,
      reason:
        'Vùng ô yêu cầu không đúng định dạng A1 hai chiều (ví dụ A1:B20). Báo cáo tự động không mở rộng ngầm các vùng mơ hồ.',
    };
  }
  const colStartLetters = m[1]!.toUpperCase();
  const rowStart = Number(m[2]);
  const colEndLetters = m[3]!.toUpperCase();
  const rowEnd = Number(m[4]);
  const colStart = colLettersToIndex(colStartLetters);
  const colEnd = colLettersToIndex(colEndLetters);

  if (
    !Number.isInteger(rowStart) ||
    !Number.isInteger(rowEnd) ||
    rowStart < 1 ||
    rowEnd < rowStart ||
    colStart < 1 ||
    colEnd < colStart
  ) {
    return {
      ok: false,
      reason: 'Vùng ô A1 có thứ tự dòng hoặc cột không hợp lệ (ví dụ dòng/cột kết thúc nhỏ hơn bắt đầu).',
    };
  }
  if (colEnd > 26) {
    return {
      ok: false,
      reason: `Vùng ô ${colStartLetters}${rowStart}:${colEndLetters}${rowEnd} vượt quá giới hạn tối đa 26 cột (A..Z) của báo cáo tự động.`,
    };
  }
  const dataRowsSpan = rowEnd - rowStart;
  if (dataRowsSpan > 500) {
    return {
      ok: false,
      reason: `Vùng ô ${colStartLetters}${rowStart}:${colEndLetters}${rowEnd} vượt quá giới hạn tối đa 500 dòng dữ liệu của báo cáo tự động.`,
    };
  }

  return {
    ok: true,
    canonicalRange: `${colStartLetters}${rowStart}:${colEndLetters}${rowEnd}`,
    ...(sheetFromRange ? { sheetFromRange } : {}),
  };
}

function extractPromptDigestRange(
  request: string,
  explicitRangeInput?: string
): { ok: true; canonicalRange?: string; sheetFromRange?: string } | { ok: false; reason: string } {
  if (typeof explicitRangeInput === 'string' && explicitRangeInput.trim()) {
    const validated = validateAndCanonicalizeDigestRange(explicitRangeInput);
    if (!validated.ok) return validated;
    return {
      ok: true,
      canonicalRange: validated.canonicalRange,
      ...(validated.sheetFromRange ? { sheetFromRange: validated.sheetFromRange } : {}),
    };
  }

  // Check if user explicitly wrote "vùng <token>" / "range <token>" with an invalid range token
  const explicitKeywordMatch =
    /\b(?:vùng\s+ô|vùng\s+dữ\s+liệu|vùng|range)\s+["'“”]?([^\s"'“”,;]+)["'“”]?/iu.exec(request);
  const cellRangeTokens = Array.from(
    request.matchAll(
      /(?:(?:['"“”][^'"“”!\n]+['"“”]|[A-Za-z0-9_\u00C0-\u024F\u1E00-\u1EFF-]+)!)?\$?[A-Za-z]{1,3}\$?\d+\s*:\s*\$?[A-Za-z]{1,3}\$?\d*\b/gu
    ),
    (m) => m[0].trim()
  );

  if (cellRangeTokens.length > 1) {
    const distinct = new Set(cellRangeTokens.map((t) => t.toUpperCase().replace(/\s+/g, '')));
    if (distinct.size > 1) {
      return {
        ok: false,
        reason:
          'Chỉ hỗ trợ khóa một vùng ô A1 duy nhất cho mỗi lịch báo cáo tự động. Vui lòng chỉ định một vùng dữ liệu duy nhất.',
      };
    }
  }

  if (cellRangeTokens.length === 1) {
    const validated = validateAndCanonicalizeDigestRange(cellRangeTokens[0]!);
    if (!validated.ok) return validated;
    return {
      ok: true,
      canonicalRange: validated.canonicalRange,
      ...(validated.sheetFromRange ? { sheetFromRange: validated.sheetFromRange } : {}),
    };
  }

  if (explicitKeywordMatch?.[1]) {
    const token = explicitKeywordMatch[1].trim();
    if (/[A-Za-z]/.test(token) && (token.includes(':') || /\d/.test(token))) {
      const validated = validateAndCanonicalizeDigestRange(token);
      if (!validated.ok) return validated;
      return {
        ok: true,
        canonicalRange: validated.canonicalRange,
        ...(validated.sheetFromRange ? { sheetFromRange: validated.sheetFromRange } : {}),
      };
    }
  }

  return { ok: true };
}

function buildSheetsDigestPreviewInfo(
  workspaceMode: SheetsDigestWorkspaceMode,
  sourceConfig: SheetsDigestSourceConfigV2,
  destinationConfig: SheetsDigestDestinationConfigV2,
  includeAiSummary = true
): SheetsDigestPreviewInfo {
  const sourceConnectionLabel =
    sourceConfig.service === 'mysheets'
      ? 'Google Sheets Cá nhân'
      : workspaceMode === 'organization'
        ? 'Google Sheets Tổ chức'
        : 'Google Sheets Chung';

  const sourceOwnerLabel =
    sourceConfig.service === 'mysheets'
      ? sourceConfig.email
        ? `Tài khoản cá nhân (${sourceConfig.email})`
        : 'Tài khoản cá nhân của bạn'
      : workspaceMode === 'organization'
        ? 'Không gian làm việc Tổ chức'
        : 'Không gian làm việc chung';

  const requestedRangeLabel = sourceConfig.range
    ? sourceConfig.sheetName && !sourceConfig.range.includes('!')
      ? `${sourceConfig.sheetName}!${sourceConfig.range}`
      : sourceConfig.range
    : sourceConfig.sheetName
      ? `${sourceConfig.sheetName} (Vùng quét mặc định A1:Z502)`
      : 'Vùng quét mặc định (A1:Z502)';

  const destinationConnectionLabel =
    destinationConfig.service === 'slack'
      ? workspaceMode === 'organization'
        ? 'Slack Tổ chức'
        : 'Slack Chung'
      : destinationConfig.service === 'gmail'
        ? destinationConfig.senderEmail
          ? `Gmail Cá nhân (gửi từ ${destinationConfig.senderEmail})`
          : 'Gmail Cá nhân'
        : 'Telegram Cá nhân';

  const destinationTargetLabel =
    destinationConfig.service === 'slack'
      ? destinationConfig.channelLabel
        ? `#${destinationConfig.channelLabel.replace(/^#/, '')} (${destinationConfig.channelId})`
        : destinationConfig.channelId
      : destinationConfig.service === 'gmail'
        ? destinationConfig.senderEmail &&
          destinationConfig.senderEmail !== destinationConfig.recipientEmail
          ? `${destinationConfig.recipientEmail} (gửi từ ${destinationConfig.senderEmail})`
          : destinationConfig.recipientEmail
        : destinationConfig.chatLabel
          ? `${destinationConfig.chatLabel} (${destinationConfig.chatId})`
          : destinationConfig.chatId;

  const crossBoundaryWarning =
    workspaceMode === 'organization' &&
    sourceConfig.service === 'mysheets' &&
    destinationConfig.service === 'slack'
      ? 'Lưu ý: Dữ liệu từ Google Sheets Cá nhân của bạn sẽ được tổng hợp và gửi vào kênh Slack của Tổ chức.'
      : undefined;

  return {
    workspaceMode,
    sourceConnectionLabel,
    sourceOwnerLabel,
    spreadsheetTitle: sourceConfig.spreadsheetTitle,
    spreadsheetId: sourceConfig.spreadsheetId,
    ...(sourceConfig.sheetName ? { sheetName: sourceConfig.sheetName } : {}),
    ...(sourceConfig.range ? { range: sourceConfig.range } : {}),
    requestedRangeLabel,
    destinationConnectionLabel,
    destinationTargetLabel,
    ...(crossBoundaryWarning ? { crossBoundaryWarning } : {}),
    includeAiSummary,
  };
}

export interface AnalyzeSheetsDigestInput {
  userId?: string;
  workspaceMode?: SheetsDigestWorkspaceMode;
  workspaceId?: string | null;
  request: string;
  recurrence?: ScheduleRecurrence;
  services: string[];
  credentialRepo?: CredentialRepo;
  encryptionKey?: string;
  mysheetsEnabled?: boolean;
  fetchOrgSheetsMetadata?: FetchOrgSheetsMetadataFn;
  emitV2?: boolean;
  includeAiSummary?: boolean;
  explicitRange?: string;
  signal?: AbortSignal;
}

export async function analyzeSheetsDigestCandidate(
  input: AnalyzeSheetsDigestInput
): Promise<SheetsDigestCandidate> {
  const {
    userId,
    request,
    recurrence,
    services,
    credentialRepo,
    encryptionKey,
    mysheetsEnabled,
    fetchOrgSheetsMetadata,
    signal,
  } = input;

  const serviceSet = new Set(services);
  const hasMySheets = serviceSet.has('mysheets');
  const hasSharedSheets = serviceSet.has('sheets');

  if (!hasMySheets && !hasSharedSheets) {
    return {
      canAutoDigest: false,
      reason: 'Lịch không sử dụng nguồn dữ liệu Google Sheets.',
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

  const emitV2 = isSheetsDigestEmitV2Enabled({ emitV2: input.emitV2 });
  if (!emitV2) {
    return {
      canAutoDigest: false,
      reason:
        'Chế độ tự động tổng hợp Google Sheets v2 đang tạm tắt theo cấu hình hệ thống (SHEETS_DIGEST_EMIT_V2=false). Lịch sẽ chạy ở chế độ nhắc duyệt (notify_only).',
    };
  }

  const workspaceMode: SheetsDigestWorkspaceMode = input.workspaceMode ?? 'legacy';
  const workspaceId: string | null = input.workspaceId ?? null;

  if (workspaceMode === 'organization' && (!workspaceId || !isUuid(workspaceId))) {
    return {
      canAutoDigest: false,
      reason: 'Lịch Tổ chức thiếu định danh không gian làm việc (workspaceId) hợp lệ.',
    };
  }
  if (workspaceMode !== 'organization' && workspaceId !== null) {
    return {
      canAutoDigest: false,
      reason: 'Phạm vi không gian làm việc của lịch không hợp lệ.',
    };
  }

  if (!credentialRepo || !encryptionKey || !userId || !isUuid(userId)) {
    return {
      canAutoDigest: false,
      reason: 'Chưa đủ thông tin xác thực để khóa nguồn bảng tính và kênh nhận báo cáo.',
    };
  }

  const reqLower = request.toLowerCase();
  const explicitPersonalSource = EXPLICIT_PERSONAL_SOURCE_RE.test(request);
  const explicitOrgSource = EXPLICIT_ORG_SOURCE_RE.test(request);
  const promptIdTokens = (request.match(SPREADSHEET_ID_TOKEN_RE) ?? []).map((t) => t.toLowerCase());

  let sourceConfig: SheetsDigestSourceConfigV2 | null = null;

  const loadPersonalCandidates = async (): Promise<
    | {
        ok: true;
        credentialId: string;
        email?: string;
        candidates: PersonalSpreadsheetItem[];
        matched: PersonalSpreadsheetItem[];
      }
    | { ok: false; reason: string }
  > => {
    if (!mysheetsEnabled) {
      return {
        ok: false,
        reason: 'Google Sheets cá nhân chưa được bật.',
      };
    }
    const record = await credentialRepo.getPersonalCredentials('mysheets', userId);
    if (!record || record.status !== 'active') {
      return {
        ok: false,
        reason: 'Hãy kết nối Google Sheets cá nhân trước khi bật tự gửi báo cáo.',
      };
    }
    let dec: any;
    try {
      dec = decryptCredentials(record.config, encryptionKey);
    } catch {
      return {
        ok: false,
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
        ok: false,
        reason: 'Bạn chưa chọn bảng tính Google Sheets nào cho Planora.',
      };
    }
    const candidates: PersonalSpreadsheetItem[] =
      selected.length > 0
        ? selected.filter((s) => allowedIds.includes(s.id))
        : allowedIds.map((id) => ({ id, title: id, canEdit: true }));

    const matched = candidates.filter(
      (c) =>
        reqLower.includes(c.id.toLowerCase()) ||
        (Boolean(c.title) && reqLower.includes(c.title.toLowerCase()))
    );

    return {
      ok: true,
      credentialId: record.id,
      email: typeof dec.email === 'string' && dec.email.trim() ? dec.email.trim().toLowerCase() : undefined,
      candidates,
      matched,
    };
  };

  if (workspaceMode === 'personal') {
    if (explicitOrgSource || (hasSharedSheets && !hasMySheets)) {
      return {
        canAutoDigest: false,
        reason:
          'Không gian làm việc Cá nhân chỉ sử dụng Google Sheets cá nhân (mysheets), không sử dụng kết nối Google Sheets chung.',
      };
    }
    const personalLoaded = await loadPersonalCandidates();
    if (!personalLoaded.ok) {
      return { canAutoDigest: false, reason: personalLoaded.reason };
    }
    const hasForeignId =
      promptIdTokens.length > 0 &&
      promptIdTokens.some(
        (tok) => !personalLoaded.candidates.some((c) => c.id.toLowerCase() === tok)
      );
    if (hasForeignId) {
      return {
        canAutoDigest: false,
        reason: 'Bảng tính được yêu cầu không nằm trong phạm vi cấp quyền Google Sheets cá nhân.',
      };
    }
    let chosen: PersonalSpreadsheetItem | undefined;
    if (personalLoaded.matched.length === 1) {
      chosen = personalLoaded.matched[0];
    } else if (personalLoaded.matched.length === 0 && personalLoaded.candidates.length === 1) {
      chosen = personalLoaded.candidates[0];
    }
    if (!chosen) {
      return {
        canAutoDigest: false,
        requiresClarification: true,
        reason:
          'Hãy nêu rõ tên bảng tính Google Sheets cần báo cáo trong yêu cầu để khóa nguồn dữ liệu.',
      };
    }
    const sheetName = extractSheetTabFromPrompt(request, reqLower, chosen.sheets);
    sourceConfig = {
      service: 'mysheets',
      credentialId: personalLoaded.credentialId,
      ...(personalLoaded.email ? { email: personalLoaded.email } : {}),
      spreadsheetId: chosen.id,
      spreadsheetTitle: chosen.title || chosen.id,
      ...(sheetName ? { sheetName } : {}),
      tailRows: 20,
    };
  } else if (workspaceMode === 'legacy') {
    if (hasMySheets && hasSharedSheets && !explicitPersonalSource && !explicitOrgSource) {
      return {
        canAutoDigest: false,
        requiresClarification: true,
        reason: 'Chỉ bật được tự gửi báo cáo khi lịch đọc từ một nguồn Google Sheets duy nhất.',
      };
    }
    const usePersonal = explicitPersonalSource || (hasMySheets && !hasSharedSheets);
    if (usePersonal) {
      const personalLoaded = await loadPersonalCandidates();
      if (!personalLoaded.ok) {
        return { canAutoDigest: false, reason: personalLoaded.reason };
      }
      const hasForeignId =
        promptIdTokens.length > 0 &&
        promptIdTokens.some(
          (tok) => !personalLoaded.candidates.some((c) => c.id.toLowerCase() === tok)
        );
      if (hasForeignId) {
        return {
          canAutoDigest: false,
          reason: 'Bảng tính được yêu cầu không nằm trong phạm vi cấp quyền Google Sheets cá nhân.',
        };
      }
      let chosen: PersonalSpreadsheetItem | undefined;
      if (personalLoaded.matched.length === 1) {
        chosen = personalLoaded.matched[0];
      } else if (personalLoaded.matched.length === 0 && personalLoaded.candidates.length === 1) {
        chosen = personalLoaded.candidates[0];
      }
      if (!chosen) {
        return {
          canAutoDigest: false,
          requiresClarification: true,
          reason:
            'Hãy nêu rõ tên bảng tính Google Sheets cần báo cáo trong yêu cầu để khóa nguồn dữ liệu.',
        };
      }
      const sheetName = extractSheetTabFromPrompt(request, reqLower, chosen.sheets);
      sourceConfig = {
        service: 'mysheets',
        credentialId: personalLoaded.credentialId,
        ...(personalLoaded.email ? { email: personalLoaded.email } : {}),
        spreadsheetId: chosen.id,
        spreadsheetTitle: chosen.title || chosen.id,
        ...(sheetName ? { sheetName } : {}),
        tailRows: 20,
      };
    } else {
      // Legacy shared sheets only (F-09: never silently fall back to mysheets)
      const record = await credentialRepo.getCredentials('sheets', null);
      if (!record || record.status !== 'active') {
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
      const hasForeignId =
        promptIdTokens.length > 0 &&
        promptIdTokens.some((tok) => !allowedIds.some((id) => id.toLowerCase() === tok));
      if (hasForeignId) {
        return {
          canAutoDigest: false,
          reason: 'Bảng tính được yêu cầu không nằm trong phạm vi cho phép của Google Sheets chung.',
        };
      }
      const idMatched = allowedIds.filter((id) => reqLower.includes(id.toLowerCase()));
      let chosenId: string | undefined;
      if (idMatched.length === 1) {
        chosenId = idMatched[0];
      } else if (idMatched.length === 0 && allowedIds.length === 1) {
        chosenId = allowedIds[0];
      }
      if (!chosenId) {
        return {
          canAutoDigest: false,
          requiresClarification: true,
          reason: 'Hãy nêu rõ mã bảng tính Google Sheets cần báo cáo.',
        };
      }
      const sheetName = extractSheetTabFromPrompt(request, reqLower);
      sourceConfig = {
        service: 'sheets',
        credentialId: record.id,
        spreadsheetId: chosenId,
        spreadsheetTitle: chosenId,
        ...(sheetName ? { sheetName } : {}),
        tailRows: 20,
      };
    }
  } else {
    // workspaceMode === 'organization' (Hybrid Source Resolution: TC-02, TC-04, TC-15)
    const checkOrgSheets =
      !explicitPersonalSource && (hasSharedSheets || !hasMySheets || explicitOrgSource);
    const checkPersonalMySheets =
      Boolean(mysheetsEnabled) &&
      !explicitOrgSource &&
      (hasMySheets || hasSharedSheets || explicitPersonalSource);

    let orgCandidateRecord: { id: string; allowedIds: string[]; items: OrgSpreadsheetMetadataItem[] } | null =
      null;
    let orgMatched: OrgSpreadsheetMetadataItem[] = [];

    if (checkOrgSheets) {
      const orgRec = await credentialRepo.getCredentials('sheets', workspaceId);
      if (orgRec && orgRec.status === 'active') {
        let dec: any;
        try {
          dec = decryptCredentials(orgRec.config, encryptionKey);
        } catch {
          return {
            canAutoDigest: false,
            reason: 'Không đọc được cấu hình Google Sheets của Tổ chức.',
          };
        }
        const allowedIds: string[] = Array.isArray(dec.allowedScope?.spreadsheets)
          ? dec.allowedScope.spreadsheets
          : Array.isArray(dec.allowedScope)
            ? dec.allowedScope
            : [];
        if (allowedIds.length > 0) {
          const idMatches = allowedIds.filter((id) => reqLower.includes(id.toLowerCase()));
          let items: OrgSpreadsheetMetadataItem[] = [];
          if (fetchOrgSheetsMetadata) {
            try {
              const fetched = await fetchOrgSheetsMetadata({
                credentialId: orgRec.id,
                allowedSpreadsheetIds: allowedIds,
                workspaceId,
                signal,
              });
              const fetchedById = new Map(fetched.map((m) => [m.id, m]));
              items = allowedIds.map(
                (id) => fetchedById.get(id) ?? { id, title: id }
              );
            } catch {
              return {
                canAutoDigest: false,
                requiresClarification: true,
                reason:
                  'Không thể tải danh sách tên bảng Google Sheets của Tổ chức để đối chiếu nguồn dữ liệu. Vui lòng nêu rõ mã bảng tính (spreadsheetId) hoặc chỉ rõ nguồn dữ liệu (Google Sheets Tổ chức hay Cá nhân).',
              };
            }
          } else if (idMatches.length > 0) {
            items = allowedIds.map((id) => ({ id, title: id }));
          } else {
            return {
              canAutoDigest: false,
              requiresClarification: true,
              reason:
                'Không thể tải danh sách tên bảng Google Sheets của Tổ chức để đối chiếu nguồn dữ liệu. Vui lòng nêu rõ mã bảng tính (spreadsheetId) hoặc chỉ rõ nguồn dữ liệu (Google Sheets Tổ chức hay Cá nhân).',
            };
          }

          orgCandidateRecord = { id: orgRec.id, allowedIds, items };
          orgMatched = items.filter(
            (item) =>
              reqLower.includes(item.id.toLowerCase()) ||
              (Boolean(item.title) &&
                item.title.toLowerCase() !== item.id.toLowerCase() &&
                reqLower.includes(item.title.toLowerCase()))
          );
        }
      }
    }

    let personalLoaded:
      | {
          ok: true;
          credentialId: string;
          email?: string;
          candidates: PersonalSpreadsheetItem[];
          matched: PersonalSpreadsheetItem[];
        }
      | { ok: false; reason: string }
      | null = null;

    if (checkPersonalMySheets) {
      personalLoaded = await loadPersonalCandidates();
    }

    const personalMatched = personalLoaded?.ok ? personalLoaded.matched : [];

    // Check for foreign spreadsheet ID in prompt (TC-02)
    if (promptIdTokens.length > 0) {
      const allowedAllIds = new Set<string>([
        ...(orgCandidateRecord?.allowedIds.map((id) => id.toLowerCase()) ?? []),
        ...(personalLoaded?.ok ? personalLoaded.candidates.map((c) => c.id.toLowerCase()) : []),
      ]);
      if (promptIdTokens.some((tok) => !allowedAllIds.has(tok))) {
        return {
          canAutoDigest: false,
          reason: 'Bảng tính được yêu cầu không nằm trong phạm vi cấp quyền của Tổ chức hoặc Cá nhân.',
        };
      }
    }

    // Check collision between Org sheets and Personal mysheets (TC-15)
    if (orgMatched.length > 0 && personalMatched.length > 0) {
      return {
        canAutoDigest: false,
        requiresClarification: true,
        reason:
          'Có nhiều bảng tính trùng khớp giữa Google Sheets Tổ chức và Google Sheets Cá nhân. Vui lòng chỉ rõ nguồn dữ liệu cần dùng.',
      };
    }

    if (orgMatched.length > 1 || personalMatched.length > 1) {
      return {
        canAutoDigest: false,
        requiresClarification: true,
        reason:
          'Có nhiều bảng tính trùng khớp với yêu cầu. Vui lòng nêu rõ tên hoặc mã bảng tính cần báo cáo.',
      };
    }

    if (orgMatched.length === 1 && orgCandidateRecord) {
      const chosen = orgMatched[0]!;
      const sheetName = extractSheetTabFromPrompt(request, reqLower, chosen.sheets);
      sourceConfig = {
        service: 'sheets',
        credentialId: orgCandidateRecord.id,
        spreadsheetId: chosen.id,
        spreadsheetTitle: chosen.title || chosen.id,
        ...(sheetName ? { sheetName } : {}),
        tailRows: 20,
      };
    } else if (personalMatched.length === 1 && personalLoaded?.ok) {
      const chosen = personalMatched[0]!;
      const sheetName = extractSheetTabFromPrompt(request, reqLower, chosen.sheets);
      sourceConfig = {
        service: 'mysheets',
        credentialId: personalLoaded.credentialId,
        ...(personalLoaded.email ? { email: personalLoaded.email } : {}),
        spreadsheetId: chosen.id,
        spreadsheetTitle: chosen.title || chosen.id,
        ...(sheetName ? { sheetName } : {}),
        tailRows: 20,
      };
    } else {
      // Neither matched by title/ID in prompt: check unambiguous single-spreadsheet fallback
      const orgCount = orgCandidateRecord?.items.length ?? 0;
      const personalCount = personalLoaded?.ok ? personalLoaded.candidates.length : 0;

      if (orgCount === 1 && personalCount === 0 && orgCandidateRecord) {
        const chosen = orgCandidateRecord.items[0]!;
        const sheetName = extractSheetTabFromPrompt(request, reqLower, chosen.sheets);
        sourceConfig = {
          service: 'sheets',
          credentialId: orgCandidateRecord.id,
          spreadsheetId: chosen.id,
          spreadsheetTitle: chosen.title || chosen.id,
          ...(sheetName ? { sheetName } : {}),
          tailRows: 20,
        };
      } else if (personalCount === 1 && orgCount === 0 && personalLoaded?.ok) {
        const chosen = personalLoaded.candidates[0]!;
        const sheetName = extractSheetTabFromPrompt(request, reqLower, chosen.sheets);
        sourceConfig = {
          service: 'mysheets',
          credentialId: personalLoaded.credentialId,
          ...(personalLoaded.email ? { email: personalLoaded.email } : {}),
          spreadsheetId: chosen.id,
          spreadsheetTitle: chosen.title || chosen.id,
          ...(sheetName ? { sheetName } : {}),
          tailRows: 20,
        };
      } else if (orgCount > 0 && personalCount > 0) {
        return {
          canAutoDigest: false,
          requiresClarification: true,
          reason:
            'Có cả Google Sheets Tổ chức và Google Sheets Cá nhân đang kết nối. Vui lòng nêu rõ tên bảng tính hoặc nguồn dữ liệu cần dùng.',
        };
      } else {
        return {
          canAutoDigest: false,
          requiresClarification: true,
          reason:
            'Hãy nêu rõ tên hoặc mã bảng tính Google Sheets cần báo cáo trong yêu cầu để khóa nguồn dữ liệu.',
        };
      }
    }
  }

  // 2. Resolve destination (slack, telegram, or gmail) & Enforce Policy Matrix (Spec §2.4)
  const destService = destServices[0] as 'slack' | 'telegram' | 'gmail';

  if (workspaceMode === 'personal' && destService === 'slack') {
    return {
      canAutoDigest: false,
      reason: 'Không gian làm việc Cá nhân không sử dụng kết nối Slack chung.',
    };
  }

  if (
    workspaceMode === 'organization' &&
    sourceConfig.service === 'sheets' &&
    (destService === 'gmail' || destService === 'telegram')
  ) {
    return {
      canAutoDigest: false,
      reason:
        'Chính sách bảo mật Tổ chức hiện chưa cho phép tự động gửi dữ liệu từ Google Sheets Tổ chức ra Gmail hoặc Telegram cá nhân.',
    };
  }

  let destinationConfig: SheetsDigestDestinationConfigV2;

  if (destService === 'slack') {
    const slackRec = await credentialRepo.getCredentials(
      'slack',
      workspaceMode === 'organization' ? workspaceId : null
    );
    if (!slackRec || slackRec.status !== 'active') {
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
        requiresClarification: true,
        reason: 'Hãy nêu rõ mã kênh Slack nhận báo cáo trong số các kênh đã cấp quyền.',
      };
    }
    destinationConfig = {
      service: 'slack',
      credentialId: slackRec.id,
      channelId: chosenChannel,
    };
  } else if (destService === 'gmail') {
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
    const senderEmail =
      typeof dec.email === 'string' && dec.email.trim().includes('@')
        ? dec.email.trim().toLowerCase()
        : '';
    if (!senderEmail) {
      return {
        canAutoDigest: false,
        reason: 'Kết nối Gmail cá nhân thiếu địa chỉ email gửi hợp lệ.',
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
      /\b(?:cho\s+tôi|cho\s+mình|email\s+của\s+tôi|gmail\s+của\s+tôi)\b/iu.test(request)
    ) {
      recipientEmail = senderEmail;
    }
    if (!recipientEmail) {
      return {
        canAutoDigest: false,
        requiresClarification: true,
        reason: 'Hãy nêu rõ một địa chỉ email nhận báo cáo trong yêu cầu để khóa người nhận.',
      };
    }
    destinationConfig = {
      service: 'gmail',
      credentialId: gmailRec.id,
      senderEmail,
      recipientEmail,
    };
  } else {
    // F-08: Personal Telegram ONLY (never call getCredentials('telegram'))
    const tgRec = await credentialRepo.getPersonalCredentials('telegram', userId);
    if (!tgRec || tgRec.status !== 'active') {
      return {
        canAutoDigest: false,
        reason: 'Hãy kết nối Telegram cá nhân trước khi bật tự gửi báo cáo.',
      };
    }
    let dec: any;
    try {
      dec = decryptCredentials(tgRec.config, encryptionKey);
    } catch {
      return {
        canAutoDigest: false,
        reason: 'Không đọc được cấu hình Telegram cá nhân.',
      };
    }
    const scopeChats: string[] = Array.isArray(dec.allowedScope?.chats)
      ? dec.allowedScope.chats
      : Array.isArray(dec.allowedScope)
        ? dec.allowedScope
        : [];
    const selectedChatItems: Array<{ chatId: string; title?: string }> = Array.isArray(
      dec.selectedChats
    )
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
        reason: 'Telegram cá nhân chưa có nhóm/chat nào trong phạm vi được phép gửi.',
      };
    }
    let chosenChat: { chatId: string; title?: string } | undefined;
    if (chats.length === 1) {
      chosenChat = chats[0];
    } else {
      const matched = chats.filter(
        (c) =>
          reqLower.includes(c.chatId.toLowerCase()) ||
          (typeof c.title === 'string' && reqLower.includes(c.title.toLowerCase()))
      );
      if (matched.length === 1) chosenChat = matched[0];
    }
    if (!chosenChat) {
      return {
        canAutoDigest: false,
        requiresClarification: true,
        reason: 'Hãy nêu rõ nhóm Telegram nhận báo cáo trong số các nhóm đã cấp quyền.',
      };
    }
    destinationConfig = {
      service: 'telegram',
      credentialId: tgRec.id,
      chatId: chosenChat.chatId,
      ...(chosenChat.title ? { chatLabel: chosenChat.title } : {}),
    };
  }

  // GAS-05: Extract, canonicalize, validate, and bind explicit A1 range before preview & hash
  const rangeCheck = extractPromptDigestRange(request, input.explicitRange);
  if (!rangeCheck.ok) {
    return {
      canAutoDigest: false,
      requiresClarification: true,
      reason: rangeCheck.reason,
    };
  }
  if (rangeCheck.canonicalRange) {
    sourceConfig.range = rangeCheck.canonicalRange;
    if (!sourceConfig.sheetName && rangeCheck.sheetFromRange) {
      sourceConfig.sheetName = rangeCheck.sheetFromRange;
    }
  }

  // GAS-02: Bind explicit AI summary choice (or natural-language deterministic opt-out) into config, hash, and preview
  const explicitNoAi =
    /\b(?:không\s+dùng\s+ai|tắt\s+ai|không\s+tóm\s+tắt\s+ai|chỉ\s+thống\s+kê\s+số\s+liệu|deterministic\s+only|without\s+ai)\b/iu.test(
      request
    );
  const resolvedIncludeAiSummary =
    typeof input.includeAiSummary === 'boolean' ? input.includeAiSummary : !explicitNoAi;

  const config: SheetsDigestConfigV2 = {
    version: 2,
    workspaceMode,
    workspaceId,
    source: sourceConfig,
    destination: destinationConfig,
    includeAiSummary: resolvedIncludeAiSummary,
  };

  const configHash = recurrence
    ? computeSheetsDigestHash({ userId, recurrence, config })
    : undefined;

  const preview = buildSheetsDigestPreviewInfo(
    workspaceMode,
    sourceConfig,
    destinationConfig,
    resolvedIncludeAiSummary
  );

  return {
    canAutoDigest: true,
    config,
    ...(configHash ? { configHash } : {}),
    preview,
  };
}

export interface VerifySheetsDigestCandidateInTxInput {
  userId: string;
  recurrence: ScheduleRecurrence;
  config: SheetsDigestConfig;
  expectedHash?: string | null;
  trustedScope: { workspaceMode: SheetsDigestWorkspaceMode; workspaceId: string | null };
  encryptionKey?: string;
  mysheetsEnabled?: boolean;
}

export async function verifySheetsDigestCandidateInTx(
  client: pg.PoolClient,
  input: VerifySheetsDigestCandidateInTxInput
): Promise<
  | { ok: true; config: SheetsDigestConfigV2; configHash: string }
  | { ok: false; reason: string }
> {
  const { userId, recurrence, config, expectedHash, trustedScope, encryptionKey, mysheetsEnabled } =
    input;

  if (!encryptionKey || !isSheetsDigestConfigV2(config)) {
    return {
      ok: false,
      reason: 'Cấu hình báo cáo tự động không hợp lệ hoặc thiếu khóa mã hóa.',
    };
  }

  if (config.source.range !== undefined && config.source.range !== null) {
    const validatedRange = validateAndCanonicalizeDigestRange(config.source.range);
    if (!validatedRange.ok) {
      return { ok: false, reason: validatedRange.reason };
    }
  }

  if (
    trustedScope.workspaceMode === 'organization' &&
    (!trustedScope.workspaceId || !isUuid(trustedScope.workspaceId))
  ) {
    return {
      ok: false,
      reason: 'Lịch Tổ chức thiếu định danh không gian làm việc hợp lệ.',
    };
  }
  if (trustedScope.workspaceMode !== 'organization' && trustedScope.workspaceId !== null) {
    return {
      ok: false,
      reason: 'Phạm vi không gian làm việc của lịch không hợp lệ.',
    };
  }

  if (
    config.workspaceMode !== trustedScope.workspaceMode ||
    (config.workspaceId ?? null) !== trustedScope.workspaceId
  ) {
    return {
      ok: false,
      reason: 'Phạm vi không gian làm việc của đề xuất không khớp với hội thoại.',
    };
  }

  // Enforce Allowed Source × Destination Matrix (Spec §2.4)
  if (trustedScope.workspaceMode === 'organization') {
    if (
      config.source.service === 'sheets' &&
      (config.destination.service === 'gmail' || config.destination.service === 'telegram')
    ) {
      return {
        ok: false,
        reason:
          'Chính sách bảo mật Tổ chức hiện chưa cho phép tự động gửi dữ liệu từ Google Sheets Tổ chức ra Gmail hoặc Telegram cá nhân.',
      };
    }
  } else if (trustedScope.workspaceMode === 'personal') {
    if (config.source.service !== 'mysheets' || config.destination.service === 'slack') {
      return {
        ok: false,
        reason:
          'Không gian Cá nhân chỉ hỗ trợ tự gửi báo cáo từ Google Sheets cá nhân sang Gmail hoặc Telegram cá nhân.',
      };
    }
  }

  // 1. Lock and verify active user row
  const userRes = await client.query<{ id: string; status: string }>(
    'SELECT id, status FROM users WHERE id = $1 FOR SHARE',
    [userId]
  );
  const userRow = userRes.rows[0];
  if (!userRow || userRow.status !== 'active') {
    return { ok: false, reason: 'Tài khoản người dùng không còn hoạt động.' };
  }

  // 2. Lock and verify active workspace member when in organization mode
  if (trustedScope.workspaceMode === 'organization') {
    const memberRes = await client.query<{ status: string }>(
      'SELECT status FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR SHARE',
      [trustedScope.workspaceId, userId]
    );
    const memberRow = memberRes.rows[0];
    if (!memberRow || memberRow.status !== 'active') {
      return { ok: false, reason: 'Quyền thành viên trong Tổ chức không còn hiệu lực.' };
    }
  }

  // 3. Lock source and destination credentials in deterministic id order
  if (!isUuid(config.source.credentialId) || !isUuid(config.destination.credentialId)) {
    return { ok: false, reason: 'Định danh kết nối (credentialId) không hợp lệ.' };
  }
  const credIds = Array.from(
    new Set([config.source.credentialId, config.destination.credentialId])
  );
  const credRes = await client.query<{
    id: string;
    service: string;
    user_id: string | null;
    workspace_id: string | null;
    config: string;
    status: string;
  }>(
    'SELECT id, service, user_id, workspace_id, config, status FROM service_credentials WHERE id = ANY($1::uuid[]) ORDER BY id ASC FOR SHARE',
    [credIds]
  );
  const credById = new Map(credRes.rows.map((r) => [r.id, r]));

  // 4. Verify source credential
  const sourceRow = credById.get(config.source.credentialId);
  if (config.source.service === 'mysheets') {
    if (!mysheetsEnabled) {
      return { ok: false, reason: 'Dịch vụ Google Sheets cá nhân hiện đang tắt.' };
    }
    if (
      !sourceRow ||
      sourceRow.service !== 'mysheets' ||
      sourceRow.status !== 'active' ||
      sourceRow.user_id !== userId ||
      sourceRow.workspace_id !== null
    ) {
      return {
        ok: false,
        reason: 'Kết nối Google Sheets cá nhân không còn hoạt động hoặc đã thay đổi.',
      };
    }
    try {
      const dec = decryptCredentials(sourceRow.config, encryptionKey);
      if (
        config.source.email &&
        typeof dec.email === 'string' &&
        dec.email.trim().toLowerCase() !== config.source.email.trim().toLowerCase()
      ) {
        return {
          ok: false,
          reason: 'Tài khoản Google Sheets cá nhân đã thay đổi.',
        };
      }
      const allowed: string[] = Array.isArray(dec.allowedScope?.spreadsheets)
        ? dec.allowedScope.spreadsheets
        : Array.isArray(dec.selectedSpreadsheets)
          ? dec.selectedSpreadsheets.map((s: any) => s.id)
          : [];
      if (!allowed.includes(config.source.spreadsheetId)) {
        return {
          ok: false,
          reason: `Bảng tính "${config.source.spreadsheetTitle}" đã bị gỡ khỏi phạm vi cấp quyền.`,
        };
      }
    } catch {
      return { ok: false, reason: 'Không giải mã được cấu hình Google Sheets cá nhân.' };
    }
  } else {
    const expectedWsId =
      trustedScope.workspaceMode === 'organization' ? trustedScope.workspaceId : null;
    if (
      !sourceRow ||
      sourceRow.service !== 'sheets' ||
      sourceRow.status !== 'active' ||
      sourceRow.user_id !== null ||
      (sourceRow.workspace_id ?? null) !== expectedWsId
    ) {
      return {
        ok: false,
        reason: 'Kết nối Google Sheets không còn hoạt động hoặc không khớp không gian làm việc.',
      };
    }
    try {
      const dec = decryptCredentials(sourceRow.config, encryptionKey);
      const allowed: string[] = Array.isArray(dec.allowedScope?.spreadsheets)
        ? dec.allowedScope.spreadsheets
        : Array.isArray(dec.allowedScope)
          ? dec.allowedScope
          : [];
      if (!allowed.includes(config.source.spreadsheetId)) {
        return {
          ok: false,
          reason: `Bảng tính "${config.source.spreadsheetTitle}" không còn trong phạm vi cho phép.`,
        };
      }
    } catch {
      return { ok: false, reason: 'Không giải mã được cấu hình Google Sheets.' };
    }
  }

  // 5. Verify destination credential
  const destRow = credById.get(config.destination.credentialId);
  if (config.destination.service === 'slack') {
    const expectedWsId =
      trustedScope.workspaceMode === 'organization' ? trustedScope.workspaceId : null;
    if (
      !destRow ||
      destRow.service !== 'slack' ||
      destRow.status !== 'active' ||
      destRow.user_id !== null ||
      (destRow.workspace_id ?? null) !== expectedWsId
    ) {
      return {
        ok: false,
        reason: 'Kết nối Slack không còn hoạt động hoặc không khớp không gian làm việc.',
      };
    }
    try {
      const dec = decryptCredentials(destRow.config, encryptionKey);
      const channels: string[] = Array.isArray(dec.allowedScope?.channels)
        ? dec.allowedScope.channels
        : Array.isArray(dec.allowedScope)
          ? dec.allowedScope
          : [];
      if (!channels.includes(config.destination.channelId)) {
        return {
          ok: false,
          reason: `Kênh Slack "${config.destination.channelId}" không còn trong phạm vi được phép gửi.`,
        };
      }
    } catch {
      return { ok: false, reason: 'Không giải mã được cấu hình Slack.' };
    }
  } else if (config.destination.service === 'gmail') {
    if (
      !destRow ||
      destRow.service !== 'gmail' ||
      destRow.status !== 'active' ||
      destRow.user_id !== userId ||
      destRow.workspace_id !== null
    ) {
      return {
        ok: false,
        reason: 'Kết nối Gmail cá nhân không còn hoạt động hoặc đã thay đổi.',
      };
    }
    if (
      !config.destination.senderEmail ||
      !config.destination.senderEmail.includes('@') ||
      !config.destination.recipientEmail ||
      !config.destination.recipientEmail.includes('@')
    ) {
      return { ok: false, reason: 'Địa chỉ email gửi hoặc nhận báo cáo không hợp lệ.' };
    }
    try {
      const dec = decryptCredentials(destRow.config, encryptionKey);
      if (
        typeof dec.email !== 'string' ||
        dec.email.trim().toLowerCase() !== config.destination.senderEmail.trim().toLowerCase()
      ) {
        return {
          ok: false,
          reason: 'Tài khoản Gmail gửi báo cáo đã thay đổi.',
        };
      }
    } catch {
      return { ok: false, reason: 'Không giải mã được cấu hình Gmail cá nhân.' };
    }
  } else {
    // F-08: Personal Telegram ONLY
    if (
      !destRow ||
      destRow.service !== 'telegram' ||
      destRow.status !== 'active' ||
      destRow.user_id !== userId ||
      destRow.workspace_id !== null
    ) {
      return {
        ok: false,
        reason: 'Kết nối Telegram cá nhân không còn hoạt động hoặc đã thay đổi.',
      };
    }
    try {
      const dec = decryptCredentials(destRow.config, encryptionKey);
      const scopeChats: string[] = Array.isArray(dec.allowedScope?.chats)
        ? dec.allowedScope.chats
        : Array.isArray(dec.allowedScope)
          ? dec.allowedScope
          : [];
      const selectedChatIds: string[] = Array.isArray(dec.selectedChats)
        ? dec.selectedChats
            .map((c: any) => (typeof c?.chatId === 'string' ? c.chatId.trim() : ''))
            .filter(Boolean)
        : [];
      const chats = [...new Set([...selectedChatIds, ...scopeChats])];
      if (!chats.includes(config.destination.chatId)) {
        return {
          ok: false,
          reason: `Nhóm Telegram "${config.destination.chatId}" không còn trong phạm vi được phép gửi.`,
        };
      }
    } catch {
      return { ok: false, reason: 'Không giải mã được cấu hình Telegram cá nhân.' };
    }
  }

  const configHash = computeSheetsDigestHash({ userId, recurrence, config });
  if (expectedHash && expectedHash !== configHash) {
    return {
      ok: false,
      reason: 'Chữ ký cấu hình báo cáo không khớp với bản xem trước.',
    };
  }

  return { ok: true, config, configHash };
}
