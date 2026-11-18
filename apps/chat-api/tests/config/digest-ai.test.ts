import { describe, expect, it, vi } from 'vitest';
import { selectDigestTextProvider } from '../../src/config/digest-ai.js';

describe('digest text provider selection', () => {
  const provider = { name: 'deepseek', generateText: vi.fn() };

  it('allows Calendar summaries and leaves unrelated DeepSeek digest jobs without an AI provider', () => {
    expect(selectDigestTextProvider(provider, 'calendar')).toBe(provider);
    expect(selectDigestTextProvider(provider, 'other')).toBeUndefined();
  });

  it('requires both a Calendar source and an explicit opt-in for multi-source DeepSeek summaries', () => {
    const sources = [{ service: 'mycalendar' }, { service: 'sheets' }];
    expect(selectDigestTextProvider(provider, { sources })).toBeUndefined();
    expect(selectDigestTextProvider(provider, { sources, includeAiSummary: false })).toBeUndefined();
    expect(selectDigestTextProvider(provider, { sources, includeAiSummary: true })).toBe(provider);
    expect(selectDigestTextProvider(provider, { sources: [{ service: 'github' }], includeAiSummary: true })).toBeUndefined();
  });
});
