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

export function classifyIntent(
  message: string,
  toolCatalog: ToolDefinition[] = ALL_TOOLS,
  services: ServiceDefinition[] = SERVICE_REGISTRY,
): TargetService[] {
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
    if (fallback.some((service) => !available.has(service.id))) return [];
    return fallback.map((service) => service.id);
  }
  return services.filter((service) => available.has(service.id)).map((service) => service.id);
}
