type DigestAiScope = 'calendar' | 'other' | {
  includeAiSummary?: boolean;
  sources: ReadonlyArray<{ service: string }>;
};

// Adding text completions for Calendar must not activate unrelated DeepSeek egress.
export function selectDigestTextProvider<T extends { name: string }>(
  provider: T | undefined,
  scope: DigestAiScope,
): T | undefined {
  if (provider?.name !== 'deepseek' || scope === 'calendar') return provider;
  if (scope === 'other' || scope.includeAiSummary !== true) return undefined;
  return scope.sources.some((source) => source.service === 'mycalendar' || source.service === 'calendar')
    ? provider
    : undefined;
}
