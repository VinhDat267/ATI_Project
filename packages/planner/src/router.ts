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
    const reported = /(?<![\p{L}\p{N}_])(?:là|rằng)\s+đã\s+tạo(?![\p{L}\p{N}_])/iu.exec(line);
    if (!reported) return line;
    const prefix = line.slice(0, reported.index);
    if (!/(?<![\p{L}\p{N}_])(?:báo|thông báo|gửi|notify|send)(?![\p{L}\p{N}_])/iu.test(prefix) ||
        !services.some(service => mentionsKeyword(prefix, service.id) || mentionsKeyword(prefix, service.name))) return line;
    const content = line.slice(reported.index + reported[0].length);
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
  const matched = services.filter((service) =>
    explicitlyNamed.includes(service) ||
    service.intentKeywords.some((keyword) => mentionsKeyword(intent, keyword)) ||
    service.intentPatterns?.some((pattern) => pattern.test(intent))
  );
  const fallback = matched.length > 0 ? matched : services.filter((service) =>
    service.fallbackIntentKeywords?.some((keyword) => mentionsKeyword(intent, keyword))
  );
  // Explicit intent for a registered but unavailable service must not silently
  // fall back to another service's write tools.
  if (fallback.length > 0) {
    const unavailable = fallback.filter((service) => !available.has(service.id)).map(({ id, name }) => ({ id, name }));
    return unavailable.length > 0 ? { services: [], unavailable } : { services: fallback.map((service) => service.id), unavailable: [] };
  }
  return { services: services.filter((service) => available.has(service.id)).map((service) => service.id), unavailable: [] };
}

/** "A", "A và B", "A, B và C": the refusal names every service the request still needs. */
export function unavailableServiceReason(unavailable: RoutedIntent['unavailable']): string {
  const names = unavailable.map((service) => service.name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} và ${names[names.length - 1]}` : names[0];
  return `${list} chưa được kết nối hoặc chưa có tài nguyên được phép.`;
}
