import { ALL_TOOLS, SERVICE_REGISTRY, type ServiceDefinition, type ToolDefinition } from '@wap/tool-schemas';

export type TargetService = string;

function mentionsKeyword(message: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(message);
}

/** A completed action in an explicitly addressed notification is payload.
 * Keep any subsequent requested action and every later conversation line.
 * The original message still reaches the planner/model unchanged.
 */
function routingText(message: string, services: ServiceDefinition[]): string {
  return message.split('\n').map(line => {
    let current = line;
    const quotedContent = /(?<![\p{L}\p{N}_])(?:với\s+)?nội\s+dung(?:\s+là)?\s*:\s*(?:"[^"]+"|“[^”]+”)/iu.exec(current);
    if (quotedContent) {
      const prefix = current.slice(0, quotedContent.index);
      const hasWriteVerb = /(?<![\p{L}\p{N}_])(?:tạo|viết|soạn|ghi|thêm|lưu|gửi)(?![\p{L}\p{N}_])/iu.test(prefix);
      const hasTargetArtifact =
        services.some(service => mentionsKeyword(prefix, service.id) || mentionsKeyword(prefix, service.name)) ||
        /(?<![\p{L}\p{N}_])(?:tài liệu|biên bản|google docs|docs|trang|page|email|thư)(?![\p{L}\p{N}_])/iu.test(prefix);
      if (hasWriteVerb && hasTargetArtifact) {
        current = prefix + current.slice(quotedContent.index + quotedContent[0].length);
      }
    }
    const reported = /(?<![\p{L}\p{N}_])(?:là|rằng)\s+đã\s+tạo(?![\p{L}\p{N}_])/iu.exec(current);
    if (!reported) return current;
    const prefix = current.slice(0, reported.index);
    if (!/(?<![\p{L}\p{N}_])(?:báo|thông báo|gửi|notify|send)(?![\p{L}\p{N}_])/iu.test(prefix) ||
        !services.some(service => mentionsKeyword(prefix, service.id) || mentionsKeyword(prefix, service.name))) return current;
    const content = current.slice(reported.index + reported[0].length);
    const nextAction = /(?:[.;!?]\s*|\s+(?:rồi|và|sau đó)\s+)(?:tạo|mở|tìm|đọc|lấy|gửi|báo|thông báo|đặt|thêm|gán|cập nhật)(?![\p{L}\p{N}_])/iu.exec(content);
    return prefix + (nextAction ? content.slice(nextAction.index) : '');
  }).join('\n');
}

export interface RoutedIntent {
  services: TargetService[];
  /** Registered services the request needs that this session has not configured. */
  unavailable: Array<{ id: string; name: string }>;
}

export function classifyIntent(
  message: string,
  toolCatalog: ToolDefinition[] = ALL_TOOLS,
  services: ServiceDefinition[] = SERVICE_REGISTRY,
): TargetService[] {
  return routeIntent(message, toolCatalog, services).services;
}

export function routeIntent(
  message: string,
  toolCatalog: ToolDefinition[] = ALL_TOOLS,
  services: ServiceDefinition[] = SERVICE_REGISTRY,
): RoutedIntent {
  const intent = routingText(message, services);
  const available = new Set(toolCatalog.map((tool) => tool.service));
  const explicitlyNamed = services.filter((service) =>
    mentionsKeyword(intent, service.id) || mentionsKeyword(intent, service.name)
  );
  let matched = services.filter((service) =>
    explicitlyNamed.includes(service) ||
    service.intentKeywords.some((keyword) => mentionsKeyword(intent, keyword)) ||
    service.intentPatterns?.some((pattern) => pattern.test(intent))
  );
  // The personal Jira service replaces the legacy Jira route whenever it is
  // registered. Availability is checked below so a disconnected personal
  // service cannot fall back to the shared Basic-token connection.
  const personalJira = services.find((service) => service.id === 'myjira');
  if (personalJira && matched.some((service) => service.id === personalJira.id || (service.name === personalJira.name && service.connection !== 'personal'))) {
    matched = matched.filter((service) => !(service.name === personalJira.name && service.connection !== 'personal'));
    if (!matched.some((service) => service.id === personalJira.id)) {
      matched.push(personalJira);
    }
  }
  const hasProjectIssueRoute = matched.some((service) => service.scopeKey === 'projects' || service.id === 'myjira');
  if (hasProjectIssueRoute) {
    matched = matched.filter((service) => {
      if (service.scopeKey !== 'repos' || available.has(service.id) || explicitlyNamed.includes(service)) {
        return true;
      }
      return service.intentKeywords.some(
        (keyword) => keyword !== 'issue' && keyword !== 'issues' && mentionsKeyword(intent, keyword),
      );
    });
  }
  const mentionsExplicitChannelService =
    explicitlyNamed.some((s) => s.scopeKey === 'channels') ||
    ['channel', 'channels', 'kênh'].some((keyword) => mentionsKeyword(intent, keyword)) ||
    /(?<![\p{L}\p{N}_])#[\p{L}\p{N}_-]+/u.test(intent);
  if (
    !mentionsExplicitChannelService &&
    matched.some((s) => s.scopeKey === 'channels' && !available.has(s.id))
  ) {
    const chatSvc = services.find((s) => s.scopeKey === 'chats');
    if (chatSvc && available.has(chatSvc.id)) {
      const mappedIds = new Set(
        matched.map((s) => (s.scopeKey === 'channels' ? chatSvc.id : s.id)),
      );
      matched = services.filter((s) => mappedIds.has(s.id));
    }
  }
  const mentionsSharedCalendar =
    mentionsKeyword(intent, 'lịch chung') ||
    mentionsKeyword(intent, 'lịch nhóm') ||
    mentionsKeyword(intent, 'lịch team') ||
    mentionsKeyword(intent, 'calendar chung') ||
    mentionsKeyword(intent, 'google calendar chung') ||
    ['shared calendar', 'team calendar', 'group calendar', 'shared google calendar', 'team google calendar', 'group google calendar']
      .some(keyword => mentionsKeyword(intent, keyword));
  const hasPersonalCalendar = matched.some((s) => s.connection === 'personal' && s.scopeKey === 'calendars');
  const hasSharedCalendar = matched.some((s) => s.connection !== 'personal' && s.scopeKey === 'calendars');
  if (hasPersonalCalendar && hasSharedCalendar) {
    if (!mentionsSharedCalendar) {
      matched = matched.filter((s) => !(s.connection !== 'personal' && s.scopeKey === 'calendars'));
    }
  } else if (hasSharedCalendar && !hasPersonalCalendar && !mentionsSharedCalendar) {
    const personalCal = services.find((s) => s.connection === 'personal' && s.scopeKey === 'calendars');
    if (
      personalCal &&
      available.has(personalCal.id) &&
      !matched.some((s) => s.scopeKey === 'calendars' && available.has(s.id))
    ) {
      matched = matched.map((s) => (s.connection !== 'personal' && s.scopeKey === 'calendars' ? personalCal : s));
    }
  }
  const mentionsSharedSheets =
    mentionsKeyword(intent, 'bảng tính chung') ||
    mentionsKeyword(intent, 'bảng tính nhóm') ||
    mentionsKeyword(intent, 'bảng tính team') ||
    mentionsKeyword(intent, 'sheet chung') ||
    ['shared spreadsheet', 'team spreadsheet', 'team sheet']
      .some(keyword => mentionsKeyword(intent, keyword));
  const hasPersonalSheets = matched.some((s) => s.connection === 'personal' && s.scopeKey === 'spreadsheets');
  const hasSharedSheets = matched.some((s) => s.connection !== 'personal' && s.scopeKey === 'spreadsheets');
  if (hasPersonalSheets && hasSharedSheets) {
    if (!mentionsSharedSheets) {
      matched = matched.filter((s) => !(s.connection !== 'personal' && s.scopeKey === 'spreadsheets'));
    }
  } else if (hasSharedSheets && !hasPersonalSheets && !mentionsSharedSheets) {
    const personalSheets = services.find((s) => s.connection === 'personal' && s.scopeKey === 'spreadsheets');
    if (personalSheets && available.has(personalSheets.id)) {
      matched = matched.map((s) => (s.connection !== 'personal' && s.scopeKey === 'spreadsheets' ? personalSheets : s));
    }
  }
  let fallback = matched.length > 0 ? matched : services.filter((service) =>
    service.fallbackIntentKeywords?.some((keyword) => mentionsKeyword(intent, keyword))
  );
  if (
    !mentionsExplicitChannelService &&
    fallback.some((s) => s.scopeKey === 'channels' && !available.has(s.id))
  ) {
    const chatSvc = services.find((s) => s.scopeKey === 'chats');
    if (chatSvc && available.has(chatSvc.id)) {
      const mappedIds = new Set(
        fallback.map((s) => (s.scopeKey === 'channels' ? chatSvc.id : s.id)),
      );
      fallback = services.filter((s) => mappedIds.has(s.id));
    }
  }
  if (
    !mentionsSharedCalendar &&
    fallback.some((s) => s.connection !== 'personal' && s.scopeKey === 'calendars') &&
    !fallback.some((s) => s.scopeKey === 'calendars' && available.has(s.id))
  ) {
    const personalCal = services.find((s) => s.connection === 'personal' && s.scopeKey === 'calendars');
    if (personalCal && available.has(personalCal.id)) {
      fallback = fallback
        .map((s) => (s.connection !== 'personal' && s.scopeKey === 'calendars' ? personalCal : s))
        .filter((s, idx, arr) => arr.findIndex((item) => item.id === s.id) === idx);
    }
  }
  if (
    !mentionsSharedSheets &&
    fallback.some((s) => s.connection !== 'personal' && s.scopeKey === 'spreadsheets') &&
    !fallback.some((s) => s.scopeKey === 'spreadsheets' && available.has(s.id))
  ) {
    const personalSheets = services.find((s) => s.connection === 'personal' && s.scopeKey === 'spreadsheets');
    if (personalSheets && available.has(personalSheets.id)) {
      fallback = fallback
        .map((s) => (s.connection !== 'personal' && s.scopeKey === 'spreadsheets' ? personalSheets : s))
        .filter((s, idx, arr) => arr.findIndex((item) => item.id === s.id) === idx);
    }
  }
  // Explicit intent for a registered but unavailable service must not silently
  // fall back to another service's write tools.
  if (fallback.length > 0) {
    const unavailable = fallback.filter((service) => !available.has(service.id)).map(({ id, name }) => ({ id, name }));
    return unavailable.length > 0 ? { services: [], unavailable } : { services: fallback.map((service) => service.id), unavailable: [] };
  }
  return { services: services.filter((service) => service.connection !== 'personal' && available.has(service.id)).map((service) => service.id), unavailable: [] };
}

/** "A", "A và B", "A, B và C": the refusal names every service the request still needs. */
export function unavailableServiceReason(unavailable: RoutedIntent['unavailable']): string {
  const names = unavailable.map((service) => service.name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} và ${names[names.length - 1]}` : names[0];
  return `${list} chưa được kết nối hoặc chưa có tài nguyên được phép.`;
}
