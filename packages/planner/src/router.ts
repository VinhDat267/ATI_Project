import { ALL_TOOLS, SERVICE_REGISTRY, type ServiceDefinition, type ToolDefinition } from '@wap/tool-schemas';

export type TargetService = string;

function mentionsKeyword(message: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(message);
}

export function classifyIntent(
  message: string,
  toolCatalog: ToolDefinition[] = ALL_TOOLS,
  services: ServiceDefinition[] = SERVICE_REGISTRY,
): TargetService[] {
  const available = new Set(toolCatalog.map((tool) => tool.service));
  const explicitlyNamed = services.filter((service) =>
    mentionsKeyword(message, service.id) || mentionsKeyword(message, service.name)
  );
  const matched = services.filter((service) =>
    explicitlyNamed.includes(service) ||
    service.intentKeywords.some((keyword) => mentionsKeyword(message, keyword))
  );
  const fallback = matched.length > 0 ? matched : services.filter((service) =>
    service.fallbackIntentKeywords?.some((keyword) => mentionsKeyword(message, keyword))
  );
  // Explicit intent for a registered but unavailable service must not silently
  // fall back to another service's write tools.
  if (fallback.length > 0) {
    if (fallback.some((service) => !available.has(service.id))) return [];
    return fallback.map((service) => service.id);
  }
  return services.filter((service) => available.has(service.id)).map((service) => service.id);
}
